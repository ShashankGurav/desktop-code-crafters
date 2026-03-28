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

const API_URL  = 'http://127.0.0.1:8000/latest';
const POLL_MS  = 3000;
const FLOW_KEY = 'cognisense_onboarded';

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