'use strict';

/* ── DOM refs ─────────────────────────────────────── */
const panel           = document.getElementById('panel');
const statusPill      = document.getElementById('statusPill');
const minBtn          = document.getElementById('minBtn');
const closeBtn        = document.getElementById('closeBtn');

// Pages
const pageOnboarding  = document.getElementById('pageOnboarding');
const pagePermissions = document.getElementById('pagePermissions');
const pageFeature     = document.getElementById('pageFeature');

// Nav buttons
const toPermissionsBtn    = document.getElementById('toPermissionsBtn');
const backToOnboardingBtn = document.getElementById('backToOnboardingBtn');
const toFeatureBtn        = document.getElementById('toFeatureBtn');

// Mode buttons
const modeIconBtn = document.getElementById('modeIconBtn');
const modeMiniBtn = document.getElementById('modeMiniBtn');
const modeFullBtn = document.getElementById('modeFullBtn');
const miniToIcon  = document.getElementById('miniToIcon');
const miniToFull  = document.getElementById('miniToFull');

// Settings
const openSettingsBtn = document.getElementById('openSettingsBtn');
const settingsPanel   = document.getElementById('settingsPanel');

// Full view
const heroState   = document.getElementById('heroState');
const heroConf    = document.getElementById('heroConf');
const heroMsg     = document.getElementById('heroMsg');
const confBarFill = document.getElementById('confBarFill');
const fullTyping  = document.getElementById('fullTyping');
const fullMouse   = document.getElementById('fullMouse');
const fullSwitches= document.getElementById('fullSwitches');
const fullCpu     = document.getElementById('fullCpu');
const fullTypingSub   = document.getElementById('fullTypingSub');
const fullMouseSub    = document.getElementById('fullMouseSub');
const fullSwitchesSub = document.getElementById('fullSwitchesSub');
const fullCpuSub      = document.getElementById('fullCpuSub');
const detailState     = document.getElementById('detailState');
const detailConf      = document.getElementById('detailConf');
const detailSignals   = document.getElementById('detailSignals');
const detailTime      = document.getElementById('detailTime');

// Mini view
const miniStateName = document.getElementById('miniStateName');
const miniConf      = document.getElementById('miniConf');
const miniMsg       = document.getElementById('miniMsg');
const miniTyping    = document.getElementById('miniTyping');
const miniMouse     = document.getElementById('miniMouse');
const miniSwitches  = document.getElementById('miniSwitches');
const miniCpu       = document.getElementById('miniCpu');
const miniTime      = document.getElementById('miniTime');

// Icon view
const iconDot = document.getElementById('iconDot');

// Glass sliders
const blurRange   = document.getElementById('blurRange');
const refractRange= document.getElementById('refractRange');
const depthRange  = document.getElementById('depthRange');
const blurVal     = document.getElementById('blurVal');
const refractVal  = document.getElementById('refractVal');
const depthVal    = document.getElementById('depthVal');

// Permission pairs [onboarding id, settings id]
const PERM_PAIRS = [
  ['permKeyboard', 'setPermKeyboard'],
  ['permMouse',    'setPermMouse'],
  ['permWindow',   'setPermWindow'],
  ['permSystem',   'setPermSystem'],
];

const API_URL  = 'http://127.0.0.1:8001/latest';
const POLL_MS  = 3000;
const FLOW_KEY = 'cognisense_onboarded';
const COGNITIVE_BASE_URL = 'http://127.0.0.1:6100';
const COGNITIVE_FALLBACK_BASE_URL = 'http://localhost:6100';
const LOCAL_ANALYZER_URL = 'http://127.0.0.1:8001/vitals/analyze';
const LOCAL_BRIDGE_SCAN_URL = 'http://127.0.0.1:8001/bridge/vitals/scan';
const DESKTOP_SESSION_KEY = 'cognisense_backend_session_id';
const DESKTOP_SESSION_BASE_KEY = 'cognisense_backend_session_base_url';
const VITAL_PROMPT_INTERVAL_MS = 60 * 1000;
const VITAL_RETRY_INTERVAL_MS = 2 * 60 * 1000;
const VITAL_SCAN_SECONDS = 20;
const VITAL_FIRST_PROMPT_DELAY_MS = 15 * 1000;
const CAMERA_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

// Vital scan modal
const vitalModal = document.getElementById('vitalModal');
const vitalModalBackdrop = document.getElementById('vitalModalBackdrop');
const vitalAcceptBtn = document.getElementById('vitalAcceptBtn');
const vitalRejectBtn = document.getElementById('vitalRejectBtn');
const vitalPreview = document.getElementById('vitalPreview');
const vitalStatus = document.getElementById('vitalStatus');

let vitalTimer = null;
let vitalInProgress = false;
let vitalStream = null;
let nextVitalPromptAt = 0;
let cameraFailureCount = 0;
let cameraBlockedUntil = 0;

const CAMERA_CONSTRAINT_PROFILES = [
  {
    video: {
      width: { ideal: 320, max: 640 },
      height: { ideal: 180, max: 360 },
      frameRate: { ideal: 5, max: 8 },
      facingMode: 'user',
    },
    audio: false,
  },
  {
    video: {
      width: { ideal: 240, max: 480 },
      height: { ideal: 135, max: 270 },
      frameRate: { ideal: 4, max: 6 },
      facingMode: 'user',
    },
    audio: false,
  },
  {
    video: true,
    audio: false,
  },
];

/* ── State labels & messages ─────────────────────── */
const STATE_LABELS = {
  focused:    'Focused',
  flow:       'In Flow',
  normal:     'Normal',
  distracted: 'Normal',
  stressed:   'Stressed',
  idle:       'Idle',
  connecting: 'Connecting',
};

const STATE_MESSAGES = {
  focused:    'Deep focus detected — keep it up',
  flow:       'You\'re in the zone ⚡',
  normal:     'Tracking...',
  distracted: 'Tracking...',
  stressed:   'High error rate — consider a break',
  idle:       'No activity detected',
  connecting: 'Waiting for backend...',
};

/* ── Helpers ─────────────────────────────────────── */
const cap   = s  => STATE_LABELS[s] || (s.charAt(0).toUpperCase() + s.slice(1));
const toNum = (v, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const now   = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

/* ── Pages ───────────────────────────────────────── */
function showPage(target) {
  [pageOnboarding, pagePermissions, pageFeature].forEach(p => {
    p.classList.toggle('active', p === target);
  });
}

/* ── Panel mode ─────────────────────────────────── */
let currentMode = 'full';

function setPanelMode(mode) {
  currentMode = mode;
  panel.classList.remove('panel-icon', 'panel-mini', 'panel-full');
  panel.classList.add(`panel-${mode}`);

  // Sync mode button active states (full view)
  [modeIconBtn, modeMiniBtn, modeFullBtn].forEach((btn, i) => {
    if (btn) btn.classList.toggle('active', ['icon','mini','full'][i] === mode);
  });

  if (window.desktopWindow) window.desktopWindow.setPanelMode(mode);
}

/* ── Glass sliders ───────────────────────────────── */
function applyGlass() {
  const b = blurRange.value;
  const r = refractRange.value;
  const d = depthRange.value;
  document.documentElement.style.setProperty('--blur',       `${b}px`);
  document.documentElement.style.setProperty('--refraction', `${r}px`);
  document.documentElement.style.setProperty('--depth',      `${d}px`);
  blurVal.textContent    = b;
  refractVal.textContent = r;
  depthVal.textContent   = d;
}

/* ── Permission sync ─────────────────────────────── */
function syncPerms(fromId, toId) {
  const from = document.getElementById(fromId);
  const to   = document.getElementById(toId);
  if (from && to) to.checked = from.checked;
}

/* ── Apply data to UI ─────────────────────────────── */
function applyState(data) {
  const summary     = data?.summary      || {};
  const features    = data?.features     || {};
  const stateResult = data?.state_result || {};

  const rawState = String(stateResult.state || data?.state || 'normal').toLowerCase();
  const conf     = Math.round(toNum(stateResult.confidence, 0) * 100);
  const signals  = Array.isArray(stateResult.signals) ? stateResult.signals : [];

  const typing   = toNum(summary?.keyboard?.typing_speed, 0).toFixed(2);
  const mouse    = toNum(summary?.mouse?.avg_speed, 0).toFixed(1);
  const switches = Math.round(toNum(summary?.focus?.switches, 0));
  const cpu      = toNum(summary?.system?.avg_cpu, 0).toFixed(1);
  const label    = cap(rawState);
  const msg      = STATE_MESSAGES[rawState] || label;
  const initial  = label.charAt(0);
  const time     = now();

  // Panel data-state for glow theming
  panel.dataset.state = rawState;
  statusPill.textContent = rawState === 'connecting' ? 'Waiting' : 'Active';

  // ── Icon view (dot just pulses, no letter needed)

  // ── Mini view
  miniStateName.textContent = label;
  miniConf.textContent      = `${conf}%`;
  miniMsg.textContent       = msg;
  miniTyping.textContent    = typing;
  miniMouse.textContent     = mouse;
  miniSwitches.textContent  = String(switches);
  miniCpu.textContent       = cpu;
  miniTime.textContent      = time;

  // ── Full view
  heroState.textContent       = label;
  heroConf.textContent        = `${conf}%`;
  heroMsg.textContent         = msg;
  confBarFill.style.width     = `${conf}%`;

  fullTyping.textContent      = typing;
  fullMouse.textContent       = mouse;
  fullSwitches.textContent    = String(switches);
  fullCpu.textContent         = cpu;

  fullTypingSub.textContent   = Number(typing) > 2 ? 'Fast rhythm' : Number(typing) > 1 ? 'Steady' : 'Slow pace';
  fullMouseSub.textContent    = Number(mouse) > 200 ? 'Quick movement' : 'Measured';
  fullSwitchesSub.textContent = switches > 6 ? 'High — distracted?' : switches > 3 ? 'Moderate' : 'Low';
  fullCpuSub.textContent      = Number(cpu) > 70 ? 'High load' : 'Normal';

  detailState.textContent     = label;
  detailConf.textContent      = `${conf}%`;
  detailSignals.textContent   = signals.slice(0, 2).join(', ') || (Object.keys(features).length ? 'balanced' : 'low data');
  detailTime.textContent      = time;
}

function setConnecting() {
  applyState({ state: 'connecting', state_result: { state: 'connecting', confidence: 0, signals: [] } });
}

/* ── Vital scan flow ───────────────────────────── */
function setVitalStatus(message) {
  if (vitalStatus) vitalStatus.textContent = message;
}

function stopVitalStream() {
  if (!vitalStream) return;
  vitalStream.getTracks().forEach(track => track.stop());
  vitalStream = null;
  if (vitalPreview) vitalPreview.srcObject = null;
}

function closeVitalModal() {
  if (!vitalModal) return;
  vitalModal.classList.remove('open');
  vitalModal.setAttribute('aria-hidden', 'true');
  stopVitalStream();
}

function openVitalModal() {
  if (!vitalModal || vitalInProgress) return;
  setPanelMode('full');
  vitalModal.classList.add('open');
  vitalModal.setAttribute('aria-hidden', 'false');
  setVitalStatus('Ready to begin.');
  nextVitalPromptAt = Number.POSITIVE_INFINITY;
}

function scheduleVitalPrompt(delayMs) {
  nextVitalPromptAt = Date.now() + Math.max(0, delayMs);
}

function startVitalScheduler() {
  if (vitalTimer) clearInterval(vitalTimer);
  scheduleVitalPrompt(VITAL_FIRST_PROMPT_DELAY_MS);
  vitalTimer = setInterval(() => {
    if (!vitalInProgress && Date.now() >= nextVitalPromptAt) {
      openVitalModal();
    }
  }, 1000);
}

async function openCameraWithFallback() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API is not available in this environment.');
  }

  if (Date.now() < cameraBlockedUntil) {
    const sec = Math.max(1, Math.ceil((cameraBlockedUntil - Date.now()) / 1000));
    throw new Error(`Camera temporarily blocked after repeated failures. Retry in ~${sec}s.`);
  }

  let lastError = null;
  for (const constraints of CAMERA_CONSTRAINT_PROFILES) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraFailureCount = 0;
      return stream;
    } catch (err) {
      lastError = err;
    }
  }

  cameraFailureCount += 1;
  if (cameraFailureCount >= 2) {
    cameraBlockedUntil = Date.now() + CAMERA_FAILURE_COOLDOWN_MS;
  }

  const message = lastError instanceof Error ? lastError.message : 'Unable to access webcam.';
  throw new Error(`Unable to access webcam. ${message}`);
}

async function fetchWithStep(url, options, stepLabel) {
  try {
    return await fetch(url, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error';
    throw new Error(`${stepLabel} failed (${url}): ${msg}`);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function createBackendSessionWithFallback() {
  const hosts = [COGNITIVE_BASE_URL, COGNITIVE_FALLBACK_BASE_URL];
  let lastError = 'unknown';

  for (const host of hosts) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const createRes = await fetchWithStep(`${host}/api/v1/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            external_user_id: 'desktop-cognisense',
            client_meta: { source: 'electron-widget', attempt, host },
          }),
        }, 'Create backend session');

        if (!createRes.ok) {
          lastError = `HTTP ${createRes.status}`;
          continue;
        }

        const createData = await createRes.json();
        const sessionId = String(createData?.id || '').trim();
        if (!sessionId) {
          lastError = 'empty session id';
          continue;
        }

        localStorage.setItem(DESKTOP_SESSION_KEY, sessionId);
        localStorage.setItem(DESKTOP_SESSION_BASE_KEY, host);
        return { sessionId, host };
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'network error';
        await sleep(250);
      }
    }
  }

  throw new Error(`Unable to create backend session on ${COGNITIVE_BASE_URL} or ${COGNITIVE_FALLBACK_BASE_URL}. Last error: ${lastError}`);
}

async function uploadVitalVideo(blob) {
  // Reliable path: send to local bridge on 8001, which persists to cognitive backend 6000.
  const bridgeFd = new FormData();
  bridgeFd.append('video', blob, `vital_scan_${Date.now()}.webm`);
  bridgeFd.append('duration_seconds', String(VITAL_SCAN_SECONDS));
  const bridgeRes = await fetchWithStep(
    LOCAL_BRIDGE_SCAN_URL,
    { method: 'POST', body: bridgeFd },
    'Bridge upload/persist',
  );
  if (!bridgeRes.ok) {
    throw new Error(`Bridge upload failed with HTTP ${bridgeRes.status}`);
  }
  const bridgePayload = await bridgeRes.json();
  if (bridgePayload?.error) {
    throw new Error(`Bridge error: ${bridgePayload.error}`);
  }
  console.log('[Vitals] Saved in cognitive backend via local bridge:', bridgePayload);
  return bridgePayload;

  let sessionId = localStorage.getItem(DESKTOP_SESSION_KEY);
  let activeBaseUrl = localStorage.getItem(DESKTOP_SESSION_BASE_KEY) || COGNITIVE_BASE_URL;
  if (!sessionId) {
    const created = await createBackendSessionWithFallback();
    sessionId = created.sessionId;
    activeBaseUrl = created.host;
  }

  const buildFormData = () => {
    const fd = new FormData();
    fd.append('video', blob, `vital_scan_${Date.now()}.webm`);
    fd.append('duration_seconds', String(VITAL_SCAN_SECONDS));
    return fd;
  };

  let response;
  try {
    response = await fetchWithStep(`${activeBaseUrl}/api/v1/sessions/${sessionId}/face-scan/video`, {
      method: 'POST',
      body: buildFormData(),
    }, 'Upload scan video');
  } catch (err) {
    console.warn('[Vitals] Direct video upload failed:', err);
    if (activeBaseUrl === COGNITIVE_BASE_URL) {
      try {
        response = await fetchWithStep(`${COGNITIVE_FALLBACK_BASE_URL}/api/v1/sessions/${sessionId}/face-scan/video`, {
          method: 'POST',
          body: buildFormData(),
        }, 'Upload scan video fallback host');
        activeBaseUrl = COGNITIVE_FALLBACK_BASE_URL;
        localStorage.setItem(DESKTOP_SESSION_BASE_KEY, activeBaseUrl);
      } catch {
        response = null;
      }
    } else {
      response = null;
    }
  }

  if (response?.status === 404) {
    // Session may have been deleted on backend; recreate once and retry.
    localStorage.removeItem(DESKTOP_SESSION_KEY);
    const recreated = await createBackendSessionWithFallback();
    const retrySessionId = recreated.sessionId;
    activeBaseUrl = recreated.host;
    response = await fetchWithStep(`${activeBaseUrl}/api/v1/sessions/${retrySessionId}/face-scan/video`, {
      method: 'POST',
      body: buildFormData(),
    }, 'Retry upload scan video');
  }

  if (!response || !response.ok) {
    // Fallback path: local analysis + JSON persistence to backend.
    const analysisRes = await fetchWithStep(LOCAL_ANALYZER_URL, {
      method: 'POST',
      body: (() => {
        const fd = new FormData();
        fd.append('video', blob, `vital_scan_${Date.now()}.webm`);
        return fd;
      })(),
    }, 'Local fallback analysis');

    if (!analysisRes.ok) {
      const status = response?.status ?? analysisRes.status;
      throw new Error(`Vital upload/analysis failed (HTTP ${status})`);
    }

    const analyzed = await analysisRes.json();
    const persistRes = await fetchWithStep(`${activeBaseUrl}/api/v1/sessions/${sessionId}/face-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duration_seconds: VITAL_SCAN_SECONDS,
        status: 'ok',
        missing_metrics: analyzed?.missing_metrics || {},
        face_stats: analyzed?.face_stats || {},
        rppg: analyzed?.rppg || {},
        metrics_meta: {
          source: 'electron-fallback-persist',
          fallback_reason: response ? `video_upload_http_${response.status}` : 'video_upload_network_error',
        },
      }),
    }, 'Fallback JSON persist');

    if (!persistRes.ok) {
      throw new Error(`Fallback persist failed with HTTP ${persistRes.status}`);
    }

    const payload = await persistRes.json();
    console.log('[Vitals] Saved in cognitive backend via fallback:', payload);
    return payload;
  }

  const payload = await response.json();
  console.log('[Vitals] Saved in cognitive backend:', payload);
  return payload;
}

async function startVitalScan() {
  if (vitalInProgress) return;
  vitalInProgress = true;

  try {
    setVitalStatus('Opening webcam...');
    vitalStream = await openCameraWithFallback();
    if (vitalPreview) {
      vitalPreview.srcObject = vitalStream;
      await vitalPreview.play().catch(() => {});
    }

    setVitalStatus(`Recording for ${VITAL_SCAN_SECONDS} seconds...`);
    const chunks = [];

    let recorder;
    const preferred = 'video/webm;codecs=vp9';
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(preferred)) {
      recorder = new MediaRecorder(vitalStream, { mimeType: preferred });
    } else {
      recorder = new MediaRecorder(vitalStream);
    }

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    const recordingDone = new Promise((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Webcam recording failed.'));
      recorder.onstop = async () => {
        try {
          setVitalStatus('Uploading for analysis...');
          const videoBlob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
          if (!videoBlob.size) {
            throw new Error('Recorded video is empty. Camera stream did not produce frames.');
          }
          await uploadVitalVideo(videoBlob);
          setVitalStatus('Scan complete. Check backend terminal output.');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
    });

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, VITAL_SCAN_SECONDS * 1000);

    await recordingDone;
    setTimeout(closeVitalModal, 1200);
    scheduleVitalPrompt(VITAL_PROMPT_INTERVAL_MS);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unable to complete vital scan.';
    setVitalStatus(reason);
    scheduleVitalPrompt(VITAL_RETRY_INTERVAL_MS);
  } finally {
    vitalInProgress = false;
    stopVitalStream();
  }
}

/* ── Fetch loop ─────────────────────────────────── */
async function refresh() {
  try {
    const res = await fetch(API_URL, { method: 'GET', signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    applyState(data);
  } catch {
    setConnecting();
  }
}

/* ── Wire events ─────────────────────────────────── */

// Navigation
toPermissionsBtn.addEventListener('click', () => showPage(pagePermissions));
backToOnboardingBtn.addEventListener('click', () => showPage(pageOnboarding));

toFeatureBtn.addEventListener('click', () => {
  sessionStorage.setItem(FLOW_KEY, '1');
  showPage(pageFeature);
  setPanelMode('full');
});

// Mode buttons (full view)
modeIconBtn.addEventListener('click', () => setPanelMode('icon'));
modeMiniBtn.addEventListener('click', () => setPanelMode('mini'));
modeFullBtn.addEventListener('click', () => setPanelMode('full'));

// Mode buttons (mini view)
if (miniToIcon) miniToIcon.addEventListener('click', () => setPanelMode('icon'));
if (miniToFull) miniToFull.addEventListener('click', () => setPanelMode('full'));

// Icon dot click → mini
iconDot.addEventListener('click', () => setPanelMode('mini'));

// Window controls
minBtn.addEventListener('click',   () => window.desktopWindow?.minimize());
closeBtn.addEventListener('click', () => window.desktopWindow?.close());

// Settings toggle
openSettingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('open'));

// Glass sliders
[blurRange, refractRange, depthRange].forEach(el => el.addEventListener('input', applyGlass));

// Permission sync (bidirectional)
PERM_PAIRS.forEach(([a, b]) => {
  document.getElementById(a)?.addEventListener('change', () => syncPerms(a, b));
  document.getElementById(b)?.addEventListener('change', () => syncPerms(b, a));
});

vitalAcceptBtn?.addEventListener('click', () => {
  startVitalScan();
});

vitalRejectBtn?.addEventListener('click', () => {
  closeVitalModal();
  scheduleVitalPrompt(VITAL_RETRY_INTERVAL_MS);
});

vitalModalBackdrop?.addEventListener('click', () => {
  closeVitalModal();
  scheduleVitalPrompt(VITAL_RETRY_INTERVAL_MS);
});

/* ── Init ────────────────────────────────────────── */
applyGlass();
setConnecting();

if (sessionStorage.getItem(FLOW_KEY) === '1') {
  showPage(pageFeature);
  setPanelMode('full');
} else {
  showPage(pageOnboarding);
}

refresh();
setInterval(refresh, POLL_MS);
startVitalScheduler();