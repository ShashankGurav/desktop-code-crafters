import math
import time
from typing import Dict, List, Tuple

from buffer_manager import BufferManager
from collector import RawCollector
from sender import send_to_backend


WINDOW_SECONDS = 30


def _safe_div(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return numerator / denominator


def _compute_mouse_distance(mouse_positions: List[Tuple[float, int, int]]) -> float:
    if len(mouse_positions) < 2:
        return 0.0

    total_distance = 0.0
    for i in range(1, len(mouse_positions)):
        _, x1, y1 = mouse_positions[i - 1]
        _, x2, y2 = mouse_positions[i]
        total_distance += math.hypot(x2 - x1, y2 - y1)

    return total_distance


def _average(values: List[float]) -> float:
    if not values:
        return 0.0
    return _safe_div(sum(values), len(values))


def _activity_level(total_keys: int) -> str:
    if total_keys < 10:
        return "low"
    if total_keys < 50:
        return "medium"
    return "high"


def _round_floats(value):
    if isinstance(value, float):
        return round(value, 2)
    if isinstance(value, dict):
        return {k: _round_floats(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_round_floats(v) for v in value]
    return value


def build_summary(raw: Dict) -> Dict:
    window_sec = float(raw.get("window_sec", WINDOW_SECONDS))

    key_presses = raw.get("key_presses", [])
    error_keys = raw.get("error_keys", [])
    typing_bursts = raw.get("typing_bursts", [])

    mouse_positions = raw.get("mouse_positions", [])
    click_events = raw.get("click_events", [])
    click_corrections = raw.get("click_corrections", [])
    scroll_events = raw.get("scroll_events", [])
    mouse_pauses = raw.get("mouse_pauses", [])

    window_switches = raw.get("window_switches", [])
    system_snapshots = raw.get("system_snapshots", [])

    idle_duration = float(raw.get("idle_duration", 0.0))

    total_keys = len(key_presses)
    error_count = len(error_keys)
    typing_speed = _safe_div(total_keys, window_sec)
    burst_count = len(typing_bursts)

    total_distance = _compute_mouse_distance(mouse_positions)
    avg_speed = _safe_div(total_distance, window_sec)
    clicks = len(click_events)
    double_clicks = sum(1 for evt in click_events if len(evt) > 4 and bool(evt[4]))
    corrections = len(click_corrections)
    scroll_total = float(sum(evt[1] for evt in scroll_events))
    pause_count = len(mouse_pauses)
    avg_pause_duration = _average([float(pause[1]) for pause in mouse_pauses if len(pause) > 1])

    switches = len(window_switches)
    switch_rate = _safe_div(switches, window_sec)
    active_apps = sorted({entry[1] for entry in window_switches if len(entry) > 1})

    cpu_values = [float(snap[1]) for snap in system_snapshots if len(snap) > 2]
    ram_values = [float(snap[2]) for snap in system_snapshots if len(snap) > 2]
    avg_cpu = _average(cpu_values)
    avg_ram = _average(ram_values)

    idle_ratio = min(_safe_div(idle_duration, window_sec), 1.0)

    summary = {
        "keyboard": {
            "total_keys": total_keys,
            "error_keys": error_count,
            "typing_speed": typing_speed,
            "burst_count": burst_count,
        },
        "mouse": {
            "total_distance": total_distance,
            "avg_speed": avg_speed,
            "clicks": clicks,
            "double_clicks": double_clicks,
            "corrections": corrections,
            "scroll_total": scroll_total,
            "pause_count": pause_count,
            "avg_pause_duration": avg_pause_duration,
        },
        "focus": {
            "switches": switches,
            "switch_rate": switch_rate,
            "active_apps": active_apps,
        },
        "system": {
            "avg_cpu": avg_cpu,
            "avg_ram": avg_ram,
        },
        "state_indicators": {
            "idle_ratio": idle_ratio,
            "activity_level": _activity_level(total_keys),
        },
    }
    return _round_floats(summary)


def detect_state(summary: Dict) -> str:
    total_keys = int(summary["keyboard"]["total_keys"])
    switches = int(summary["focus"]["switches"])
    idle_ratio = float(summary["state_indicators"]["idle_ratio"])

    if idle_ratio > 0.6:
        return "idle"
    if switches > 5:
        return "distracted"
    if total_keys > 40:
        return "focused"
    return "normal"


def compress_raw(data: Dict) -> Dict:
    mouse_positions = data.get("mouse_positions", [])[-20:]
    click_events = data.get("click_events", [])
    window_switches = data.get("window_switches", [])

    return {
        "mouse_positions": _round_floats(mouse_positions),
        "click_events": _round_floats(click_events),
        "window_switches": _round_floats(window_switches),
    }


def log_snapshot(summary: Dict, state: str) -> None:
    print("====== SESSION SNAPSHOT ======")
    print()
    print(f"State: {state}")
    print()
    print("Keyboard:")
    print(f"  Keys: {summary['keyboard']['total_keys']} | Errors: {summary['keyboard']['error_keys']}")
    print()
    print("Mouse:")
    print(f"  Speed: {summary['mouse']['avg_speed']:.2f} px/s | Clicks: {summary['mouse']['clicks']}")
    print()
    print("Focus:")
    print(f"  Switches: {summary['focus']['switches']}")
    print()
    print("System:")
    print(f"  CPU: {summary['system']['avg_cpu']:.2f}%")
    print()
    print("State Indicators:")
    print(f"  Idle: {summary['state_indicators']['idle_ratio']:.2f}")
    print()
    print("==============================")

def build_payload(raw: Dict, summary: Dict, session_duration: float) -> Dict:
    state = detect_state(summary)
    sample = compress_raw(raw)
    return {
        "timestamp": int(time.time()),
        "session_duration": round(session_duration, 2),
        "summary": summary,
        "state": state,
        "raw_sample": sample,
    }


def run_loop() -> None:
    collector = RawCollector()
    buffer = BufferManager()

    collector.start()
    print("[INFO] RawCollector started.")

    while True:
        time.sleep(WINDOW_SECONDS)

        raw = collector.flush_window(WINDOW_SECONDS)
        summary = build_summary(raw)
        session_duration = time.time() - collector.session_start
        payload = build_payload(raw, summary, session_duration)
        summary = payload["summary"]
        state = payload["state"]

        buffer.add(payload)
        print("[INFO] Data collected")
        log_snapshot(summary, state)

        batch = buffer.get_all()
        print(f"[INFO] Sending batch... ({len(batch)} item(s))")

        if send_to_backend(batch):
            buffer.clear()
            print("[SUCCESS] Sent")
        else:
            print("[WARN] Send failed. Buffer retained for next retry.")


if __name__ == "__main__":
    run_loop()
