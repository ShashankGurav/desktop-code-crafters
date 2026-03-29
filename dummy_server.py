from fastapi import FastAPI
from fastapi import File, Form, UploadFile
import json
import threading
from collections import deque
from typing import List, Dict, Any
import tempfile
import os
import math
from datetime import datetime, timezone
from uuid import UUID, uuid4
import requests

try:
    import numpy as np
    NP_AVAILABLE = True
except ImportError:
    NP_AVAILABLE = False

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

from session_memory import SessionMemory

app = FastAPI()
history = deque(maxlen=60)
history_lock = threading.Lock()
trend_memory = SessionMemory(max_windows=60)
sessions_store: Dict[str, Dict[str, Any]] = {}
bridge_session_id: str | None = None

COGNITIVE_BASE_URL = os.getenv("COGNITIVE_BASE_URL", "http://127.0.0.1:6100")

@app.get("/")
def root():
    return {"message": "Dummy backend running"}


@app.get("/latest")
def latest() -> Dict[str, Any]:
    with history_lock:
        if history:
            return history[-1]
    return {
        "state": "normal",
        "features": {},
        "state_result": {
            "state": "normal",
            "confidence": 0.0,
            "signals": [],
        },
        "summary": {
            "keyboard": {},
            "mouse": {},
            "focus": {},
            "system": {},
            "state_indicators": {},
        },
    }


@app.get("/trend")
def trend() -> Dict[str, Any]:
    with history_lock:
        snapshot = list(history)

    temp_memory = SessionMemory(max_windows=60)
    for item in snapshot:
        temp_memory.push(item)
    return temp_memory.get_trend()


@app.get("/history")
def get_history(n: int = 10) -> Dict[str, Any]:
    n = max(1, min(int(n), 60))
    with history_lock:
        items = list(history)[-n:]
    return {
        "count": len(items),
        "items": items,
    }

@app.post("/data")
async def receive_data(payload: List[Dict[str, Any]]):
    print("\n📥 RECEIVED JSON ARRAY:\n")
    print(json.dumps(payload, indent=2))
    print(f"[INFO] Items received: {len(payload)}")

    if payload:
        with history_lock:
            for item in payload:
                history.append(item)
                trend_memory.push(item)

    return {
        "status": "success",
        "items_received": len(payload)
    }


@app.post("/api/v1/sessions")
async def create_session_compat(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    sid = str(uuid4())
    started = datetime.now(timezone.utc).isoformat()
    body = payload or {}
    sessions_store[sid] = {
        "id": sid,
        "external_user_id": body.get("external_user_id"),
        "started_at": started,
        "ended_at": None,
        "client_meta": body.get("client_meta") or {},
    }
    print(f"[INFO] Compat session created: {sid}")
    return {"id": sid, "started_at": started}


@app.post("/api/v1/sessions/{session_id}/snapshots")
async def ingest_snapshot_compat(session_id: UUID, payload: Dict[str, Any]) -> Dict[str, Any]:
    sid = str(session_id)
    if sid not in sessions_store:
        # Autocreate missing session for compatibility mode to avoid repeated 404 loops.
        sessions_store[sid] = {
            "id": sid,
            "external_user_id": None,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "ended_at": None,
            "client_meta": {"source": "compat-autocreate"},
        }

    # Keep dashboard data source in sync with extension snapshots where possible.
    with history_lock:
        history.append(
            {
                "state": "normal",
                "features": {
                    "stress_index": payload.get("stress_index"),
                    "fatigue_index": payload.get("fatigue_index"),
                    "heart_rate": payload.get("heart_rate"),
                    "hrv": payload.get("hrv"),
                    "spo2": payload.get("spo2"),
                },
                "summary": {
                    "keyboard": payload.get("keyboard") or {},
                    "mouse": payload.get("mouse") or {},
                    "focus": payload.get("tab") or {},
                    "system": {},
                    "state_indicators": {},
                },
                "state_result": {
                    "state": "normal",
                    "confidence": 0.5,
                    "signals": ["compat_snapshot"],
                },
                "source": "api_v1_compat",
                "ts": payload.get("ts"),
            }
        )

    print("[INFO] Compat snapshot accepted:")
    print(json.dumps({"session_id": sid, "payload": payload}, indent=2))
    return {
        "ok": True,
        "session_id": sid,
        "buffer_len": 1,
        "current_minute_bucket": datetime.now(timezone.utc).replace(second=0, microsecond=0).isoformat(),
    }


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _blend_with_default(value: Any, default: float, reliability: float) -> float:
    if value is None:
        return float(default)
    return (float(value) * reliability) + (float(default) * (1.0 - reliability))


def _moving_average(values, window: int):
    if window <= 1:
        return values
    kernel = np.ones(window, dtype=np.float64) / float(window)
    return np.convolve(values, kernel, mode="same")


def _bandpass_fft(signal, fs: float, low_hz: float = 0.75, high_hz: float = 3.0):
    n = len(signal)
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    spectrum = np.fft.rfft(signal)
    band_mask = (freqs >= low_hz) & (freqs <= high_hz)
    filtered_spec = spectrum.copy()
    filtered_spec[~band_mask] = 0
    filtered = np.fft.irfft(filtered_spec, n=n)
    return filtered, freqs, band_mask


def _detect_peaks(signal, min_distance: int, threshold: float):
    peaks = []
    last_idx = -min_distance
    for i in range(1, len(signal) - 1):
        if i - last_idx < min_distance:
            continue
        if signal[i] > threshold and signal[i] >= signal[i - 1] and signal[i] >= signal[i + 1]:
            peaks.append(i)
            last_idx = i
    return peaks


def _extract_rppg_signals(video_path: str) -> Dict[str, Any]:
    empty_stats = {
        "sampled_frames": 0,
        "face_frames": 0,
        "face_presence_ratio": 0.0,
        "transitions": 0,
        "signal_quality": 0.0,
    }
    empty_vitals = {
        "avg_heart_rate": None,
        "avg_hrv": None,
        "avg_spo2": None,
        "signal_quality": 0.0,
    }

    if not CV2_AVAILABLE or not NP_AVAILABLE:
        return {"face_stats": empty_stats, "vitals": empty_vitals}

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"face_stats": empty_stats, "vitals": empty_vitals}

    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0

    sampled_frames = 0
    face_frames = 0
    transitions = 0
    last_face_present = None

    frame_idx = 0
    rgb_samples = []
    time_samples = []

    # Performance guardrails: process only an early segment and subsample frames.
    max_analysis_seconds = 60.0
    target_sample_hz = 8.0
    sample_step = max(1, int(round(fps / target_sample_hz)))

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if (frame_idx / float(fps)) > max_analysis_seconds:
            break

        if frame_idx % sample_step != 0:
            frame_idx += 1
            continue

        sampled_frames += 1
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(60, 60),
        )

        face_present = len(faces) > 0
        if face_present:
            face_frames += 1
            largest_face = max(faces, key=lambda f: f[2] * f[3])
            x, y, w, h = [int(v) for v in largest_face]

            # Forehead ROI is less affected by mouth motion than full-face ROI.
            fx = max(0, x + int(0.22 * w))
            fy = max(0, y + int(0.14 * h))
            fw = max(1, int(0.56 * w))
            fh = max(1, int(0.18 * h))
            x2 = min(frame.shape[1], fx + fw)
            y2 = min(frame.shape[0], fy + fh)
            roi = frame[fy:y2, fx:x2]

            if roi.size > 0:
                b, g, r, _ = cv2.mean(roi)
                rgb_samples.append((float(r), float(g), float(b)))
                time_samples.append(frame_idx / float(fps))

        if last_face_present is not None and face_present != last_face_present:
            transitions += 1
        last_face_present = face_present
        frame_idx += 1

    cap.release()

    face_ratio = (face_frames / sampled_frames) if sampled_frames else 0.0
    face_stats = {
        "sampled_frames": sampled_frames,
        "face_frames": face_frames,
        "face_presence_ratio": round(face_ratio, 4),
        "transitions": transitions,
        "signal_quality": 0.0,
    }

    if len(time_samples) < 120:
        return {"face_stats": face_stats, "vitals": empty_vitals}

    t = np.array(time_samples, dtype=np.float64)
    rgb = np.array(rgb_samples, dtype=np.float64)
    duration = float(t[-1] - t[0])
    if duration <= 2.0:
        return {"face_stats": face_stats, "vitals": empty_vitals}

    fs = float((len(t) - 1) / duration)
    if fs <= 0:
        fs = 30.0

    target_fs = min(30.0, max(20.0, fs))
    uniform_t = np.arange(t[0], t[-1], 1.0 / target_fs)
    if len(uniform_t) < 120:
        return {"face_stats": face_stats, "vitals": empty_vitals}

    r_u = np.interp(uniform_t, t, rgb[:, 0])
    g_u = np.interp(uniform_t, t, rgb[:, 1])
    b_u = np.interp(uniform_t, t, rgb[:, 2])

    # Chrominance-style combination to suppress global illumination changes.
    pulse_raw = (0.5 * g_u) + (0.25 * r_u) - (0.25 * b_u)
    pulse_raw = pulse_raw - _moving_average(pulse_raw, int(target_fs * 1.0))
    pulse_raw = pulse_raw - np.mean(pulse_raw)

    filtered, freqs, band_mask = _bandpass_fft(pulse_raw, target_fs, low_hz=0.75, high_hz=3.0)
    band_freqs = freqs[band_mask]
    if band_freqs.size == 0:
        return {"face_stats": face_stats, "vitals": empty_vitals}

    power = np.abs(np.fft.rfft(filtered)) ** 2
    band_power = power[band_mask]
    peak_idx = int(np.argmax(band_power))
    peak_freq = float(band_freqs[peak_idx])
    heart_rate = peak_freq * 60.0
    if heart_rate < 42.0 or heart_rate > 180.0:
        heart_rate = None

    band_power_sum = float(np.sum(band_power) + 1e-9)
    peak_power = float(band_power[peak_idx])
    snr_like = 10.0 * math.log10((peak_power + 1e-9) / ((band_power_sum - peak_power) + 1e-9))
    snr_norm = _clamp((snr_like + 5.0) * 10.0, 0.0, 100.0)

    peak_threshold = float(np.mean(filtered) + 0.45 * np.std(filtered))
    min_dist = max(1, int(target_fs * 0.35))
    peaks = _detect_peaks(filtered, min_dist, peak_threshold)

    hrv_rmssd = None
    if len(peaks) >= 4:
        rr = np.diff(np.array(peaks, dtype=np.float64)) / target_fs
        if rr.size >= 3:
            rr_diff = np.diff(rr)
            hrv_rmssd = float(np.sqrt(np.mean(rr_diff ** 2)) * 1000.0)

    # Webcam SpO2 is only a weak proxy; this uses ratio-of-ratios from RGB AC/DC components.
    dc_red = float(np.mean(r_u))
    dc_blue = float(np.mean(b_u))
    ac_red = float(np.std(r_u))
    ac_blue = float(np.std(b_u))
    spo2 = None
    if dc_red > 1e-6 and dc_blue > 1e-6 and ac_blue > 1e-6:
        ratio = (ac_red / dc_red) / (ac_blue / dc_blue)
        spo2 = _clamp(100.0 - (8.5 * ratio), 85.0, 100.0)

    quality = _clamp((face_ratio * 65.0) + (snr_norm * 0.35), 0.0, 100.0)
    face_stats["signal_quality"] = round(float(quality), 2)

    vitals = {
        "avg_heart_rate": round(float(heart_rate), 2) if heart_rate is not None else None,
        "avg_hrv": round(float(hrv_rmssd), 2) if hrv_rmssd is not None else None,
        "avg_spo2": round(float(spo2), 2) if spo2 is not None else None,
        "signal_quality": round(float(quality), 2),
    }
    return {"face_stats": face_stats, "vitals": vitals}


def _compute_missing_metrics(face_stats: Dict[str, Any], vitals: Dict[str, Any]) -> Dict[str, Any]:
    ratio = float(face_stats.get("face_presence_ratio", 0.0))
    sampled = int(face_stats.get("sampled_frames", 0))
    transitions = int(face_stats.get("transitions", 0))
    signal_quality = float(vitals.get("signal_quality", 0.0))
    reliability = _clamp(signal_quality, 0.0, 100.0) / 100.0
    heart_rate = vitals.get("avg_heart_rate")
    hrv = vitals.get("avg_hrv")
    spo2 = vitals.get("avg_spo2")

    # Blend toward physiological defaults when the signal is weak,
    # then clamp to normal adult resting ranges.
    heart_rate = _clamp(_blend_with_default(heart_rate, default=75.0, reliability=reliability), 60.0, 100.0)
    hrv = _clamp(_blend_with_default(hrv, default=42.0, reliability=reliability), 20.0, 90.0)
    spo2 = _clamp(_blend_with_default(spo2, default=98.0, reliability=reliability), 95.0, 100.0)

    transition_rate = (transitions / max(sampled - 1, 1)) if sampled > 1 else 1.0

    hr_stress = _clamp(((float(heart_rate) - 68.0) / 45.0) * 100.0)

    hrv_stress = _clamp(((55.0 - float(hrv)) / 45.0) * 100.0)
    hrv_fatigue = _clamp(((45.0 - float(hrv)) / 40.0) * 100.0)

    spo2_penalty = _clamp((97.0 - float(spo2)) * 15.0)

    stress_index = _clamp((0.5 * hr_stress) + (0.4 * hrv_stress) + (0.1 * spo2_penalty))
    focus_percentage = _clamp(
        (ratio * 60.0)
        + ((100.0 - (transition_rate * 100.0)) * 0.2)
        + (signal_quality * 0.2)
    )
    confusion_percentage = _clamp((transition_rate * 70.0) + ((100.0 - signal_quality) * 0.3))
    fatigue_percentage = _clamp((0.45 * (100.0 - focus_percentage)) + (0.4 * hrv_fatigue) + (0.15 * spo2_penalty))
    fatigue_index = _clamp((0.55 * fatigue_percentage) + (0.25 * hrv_fatigue) + (0.2 * (100.0 - signal_quality)))
    productivity_score = _clamp(
        (focus_percentage * 0.6)
        + ((100.0 - fatigue_percentage) * 0.25)
        + ((100.0 - confusion_percentage) * 0.15)
    )

    # Keep outputs in operationally normal bands to avoid extreme 0/100 spikes.
    stress_index = _clamp(stress_index, 10.0, 75.0)
    fatigue_index = _clamp(fatigue_index, 10.0, 75.0)
    focus_percentage = _clamp(focus_percentage, 35.0, 95.0)
    fatigue_percentage = _clamp(fatigue_percentage, 5.0, 65.0)
    confusion_percentage = _clamp(confusion_percentage, 5.0, 55.0)
    productivity_score = _clamp(productivity_score, 45.0, 95.0)

    return {
        "avg_heart_rate": round(float(heart_rate), 2),
        "avg_hrv": round(float(hrv), 2),
        "avg_spo2": round(float(spo2), 2),
        "stress_index": round(stress_index, 2),
        "fatigue_index": round(fatigue_index, 2),
        "focus_percentage": round(focus_percentage, 2),
        "fatigue_percentage": round(fatigue_percentage, 2),
        "confusion_percentage": round(confusion_percentage, 2),
        "productivity_score": round(productivity_score, 2),
    }


@app.post("/vitals/analyze")
async def analyze_vitals(video: UploadFile = File(...)) -> Dict[str, Any]:
    suffix = ".webm"
    if video.filename and "." in video.filename:
        suffix = os.path.splitext(video.filename)[1] or suffix

    temp_path = ""
    try:
        file_bytes = await video.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(file_bytes)
            temp_path = temp_file.name

        extracted = _extract_rppg_signals(temp_path)
        face_stats = extracted["face_stats"]
        vitals = extracted["vitals"]
        metrics = _compute_missing_metrics(face_stats, vitals)

        payload = {
            "missing_metrics": metrics,
            "face_stats": face_stats,
            "rppg": {
                "signal_quality": vitals.get("signal_quality", 0.0),
                "note": "Webcam rPPG is non-clinical and sensitive to lighting and motion.",
            },
        }

        print("\n[INFO] Vitals analysis result:\n")
        print(json.dumps(payload, indent=2))
        return payload
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def _ensure_bridge_session() -> str:
    global bridge_session_id
    if bridge_session_id:
        try:
            chk = requests.get(
                f"{COGNITIVE_BASE_URL}/api/v1/sessions",
                params={"limit": 200, "external_user_id": "desktop-cognisense"},
                timeout=10,
            )
            chk.raise_for_status()
            sessions = (chk.json() or {}).get("sessions") or []
            if any(str(s.get("id", "")).strip() == bridge_session_id for s in sessions):
                return bridge_session_id
            bridge_session_id = None
        except Exception:
            # If validation fails, recreate below.
            bridge_session_id = None

    body = {
        "external_user_id": "desktop-cognisense",
        "client_meta": {"source": "desktop-bridge"},
    }
    resp = requests.post(f"{COGNITIVE_BASE_URL}/api/v1/sessions", json=body, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    sid = str(data.get("id", "")).strip()
    if not sid:
        raise RuntimeError("Bridge session creation returned empty id")
    bridge_session_id = sid
    return sid


@app.post("/bridge/vitals/scan")
async def bridge_vitals_scan(
    video: UploadFile = File(...),
    duration_seconds: int = Form(default=20),
) -> Dict[str, Any]:
    suffix = ".webm"
    if video.filename and "." in video.filename:
        suffix = os.path.splitext(video.filename)[1] or suffix

    temp_path = ""
    try:
        file_bytes = await video.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(file_bytes)
            temp_path = temp_file.name

        sid = _ensure_bridge_session()

        with open(temp_path, "rb") as f:
            files = {"video": (os.path.basename(temp_path), f, "video/webm")}
            data = {"duration_seconds": str(duration_seconds)}
            up = requests.post(
                f"{COGNITIVE_BASE_URL}/api/v1/sessions/{sid}/face-scan/video",
                files=files,
                data=data,
                timeout=90,
            )

        if up.status_code == 404:
            # Session was likely cleared/recreated server-side; refresh and retry once.
            bridge_session_id = None
            sid = _ensure_bridge_session()
            with open(temp_path, "rb") as f:
                files = {"video": (os.path.basename(temp_path), f, "video/webm")}
                data = {"duration_seconds": str(duration_seconds)}
                up = requests.post(
                    f"{COGNITIVE_BASE_URL}/api/v1/sessions/{sid}/face-scan/video",
                    files=files,
                    data=data,
                    timeout=90,
                )

        if up.ok:
            payload = up.json()
            print("\n[INFO] Bridge saved face scan to cognitive backend:\n")
            print(json.dumps(payload, indent=2))
            return payload

        # Fallback: local analysis + JSON persist
        extracted = _extract_rppg_signals(temp_path)
        face_stats = extracted["face_stats"]
        vitals = extracted["vitals"]
        metrics = _compute_missing_metrics(face_stats, vitals)

        json_payload = {
            "duration_seconds": duration_seconds,
            "status": "ok",
            "missing_metrics": metrics,
            "face_stats": face_stats,
            "rppg": {
                "signal_quality": vitals.get("signal_quality", 0.0),
                "note": "persisted via bridge fallback",
            },
            "metrics_meta": {
                "source": "desktop-bridge-fallback",
                "video_upload_status": up.status_code,
                "video_upload_body": up.text[:500],
            },
        }
        persisted = requests.post(
            f"{COGNITIVE_BASE_URL}/api/v1/sessions/{sid}/face-scan",
            json=json_payload,
            timeout=20,
        )
        persisted.raise_for_status()
        payload = persisted.json()
        print("\n[INFO] Bridge fallback persisted face scan to cognitive backend:\n")
        print(json.dumps(payload, indent=2))
        return payload
    except requests.RequestException as err:
        return {"error": f"bridge request failed: {err}"}
    except Exception as err:
        return {"error": f"bridge failed: {err}"}
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)