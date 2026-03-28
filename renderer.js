const panel = document.getElementById('panel');
const pageOnboarding = document.getElementById('pageOnboarding');
const pagePermissions = document.getElementById('pagePermissions');
const pageFeature = document.getElementById('pageFeature');

const toPermissionsBtn = document.getElementById('toPermissionsBtn');
const backToOnboardingBtn = document.getElementById('backToOnboardingBtn');
const toFeatureBtn = document.getElementById('toFeatureBtn');

const minBtn = document.getElementById('minBtn');
const closeBtn = document.getElementById('closeBtn');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const compactMenuBtn = document.getElementById('compactMenuBtn');
const settingsPanel = document.getElementById('settingsPanel');
const statusPill = document.getElementById('statusPill');

const modeIconBtn = document.getElementById('modeIconBtn');
const modeMiniBtn = document.getElementById('modeMiniBtn');
const modeFullBtn = document.getElementById('modeFullBtn');

// Full view elements
const stateText = document.getElementById('stateText');
const stateConfidence = document.getElementById('stateConfidence');
const stateMessage = document.getElementById('stateMessage');
const stateChip = document.getElementById('stateChip');
const confidencePercent = document.getElementById('confidencePercent');
const signalText = document.getElementById('signalText');

// Compact view elements
const compactStateBadge = document.getElementById('compactStateBadge');
const compactTime = document.getElementById('compactTime');
const compactMessage = document.getElementById('compactMessage');
const compactConfidence = document.getElementById('compactConfidence');
const compactActivity = document.getElementById('compactActivity');
const compactSignal = document.getElementById('compactSignal');
const compactMotion = document.getElementById('compactMotion');

const typingSpeed = document.getElementById('typingSpeed');
const mouseSpeed = document.getElementById('mouseSpeed');
const focusSwitches = document.getElementById('focusSwitches');
const cpuValue = document.getElementById('cpuValue');

const blurRange = document.getElementById('blurRange');
const refractRange = document.getElementById('refractRange');
const depthRange = document.getElementById('depthRange');

const API_URL = 'http://127.0.0.1:8000/latest';
const POLL_MS = 3000;
const FLOW_KEY = 'cognisense_flow_complete';

const permissionIds = [
  ['permKeyboard', 'setPermKeyboard'],
  ['permMouse', 'setPermMouse'],
  ['permWindow', 'setPermWindow'],
  ['permSystem', 'setPermSystem']
];

const modeButtons = {
  icon: modeIconBtn,
  mini: modeMiniBtn,
  full: modeFullBtn
};

function showPage(page) {
  [pageOnboarding, pagePermissions, pageFeature].forEach((el) => {
    el.classList.toggle('active', el === page);
  });
}

function syncPermissions(fromId, toId) {
  const from = document.getElementById(fromId);
  const to = document.getElementById(toId);
  if (!from || !to) {
    return;
  }
  to.checked = from.checked;
}

function setPanelMode(mode) {
  panel.classList.remove('panel-icon', 'panel-mini', 'panel-full');
  panel.classList.add(`panel-${mode}`);
  Object.entries(modeButtons).forEach(([key, btn]) => {
    btn.classList.toggle('active', key === mode);
  });
  window.desktopWindow.setPanelMode(mode);
}

function applyVisualSettings() {
  document.documentElement.style.setProperty('--blur', `${blurRange.value}px`);
  document.documentElement.style.setProperty('--refraction', `${refractRange.value}px`);
  document.documentElement.style.setProperty('--depth', `${depthRange.value}px`);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getStateMessage(state, signals) {
  const messages = {
    focused: '🎯 Deep focus detected',
    flow: '⚡ In the zone',
    normal: '😊 Working normally',
    distracted: '📱 Possible distraction',
    idle: '😴 Idle time',
    connecting: '🔄 Initializing...'
  };
  return messages[state] || `${state.charAt(0).toUpperCase() + state.slice(1)}`;
}

function applyState(data) {
  const summary = data?.summary || {};
  const features = data?.features || {};
  const stateResult = data?.state_result || {};
  const state = String(stateResult.state || data?.state || 'normal');
  const confidence = Math.round(toNumber(stateResult.confidence, 0) * 100);

  // Get current time
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  panel.dataset.state = state.toLowerCase();
  statusPill.textContent = 'Active';
  
  const stateDisplay = state.charAt(0).toUpperCase() + state.slice(1);
  stateText.textContent = stateDisplay;
  stateConfidence.textContent = `${confidence}%`;
  stateChip.textContent = state;
  confidencePercent.textContent = `${confidence}%`;

  const signals = Array.isArray(stateResult.signals) ? stateResult.signals : [];
  const signalDisplay = signals.slice(0, 2).join(', ') || 'balanced';
  signalText.textContent = signalDisplay;

  const typing = toNumber(summary?.keyboard?.typing_speed).toFixed(2);
  const mouse = toNumber(summary?.mouse?.avg_speed).toFixed(1);
  const switches = Math.round(toNumber(summary?.focus?.switches));
  const cpu = toNumber(summary?.system?.avg_cpu).toFixed(1);

  typingSpeed.textContent = `${typing}k/s`;
  mouseSpeed.textContent = `${mouse}px/s`;
  focusSwitches.textContent = `${switches}`;
  cpuValue.textContent = `${cpu}%`;

  // Update compact view
  compactStateBadge.textContent = state.toUpperCase();
  compactTime.textContent = timeStr;
  compactMessage.textContent = getStateMessage(state, signals);
  compactConfidence.textContent = `${confidence}%`;
  compactActivity.textContent = `${typing}k/s`;
  compactMotion.textContent = `${mouse}px/s`;
  compactSignal.textContent = signals.length > 0 ? '✓' : '○';

  // Update full view message
  stateMessage.textContent = getStateMessage(state, signals);

  if (!features || Object.keys(features).length === 0) {
    signalText.textContent = 'low_data';
    compactSignal.textContent = '○';
  }
}

function setConnecting() {
  panel.dataset.state = 'connecting';
  statusPill.textContent = 'Waiting';
  stateText.textContent = 'Connecting';
  stateConfidence.textContent = '--%';
  stateChip.textContent = 'connecting';
  confidencePercent.textContent = '--%';
  stateMessage.textContent = 'Initializing session...';
  signalText.textContent = 'backend_offline';
  typingSpeed.textContent = '-';
  mouseSpeed.textContent = '-';
  focusSwitches.textContent = '-';
  cpuValue.textContent = '-';

  // Compact view
  compactStateBadge.textContent = 'WAITING';
  compactMessage.textContent = 'Connecting to backend...';
  compactConfidence.textContent = '--%';
  compactActivity.textContent = '-';
  compactMotion.textContent = '-';
  compactSignal.textContent = '○';
}

async function fetchState() {
  const response = await fetch(API_URL, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function refresh() {
  try {
    const data = await fetchState();
    applyState(data);
  } catch (_error) {
    setConnecting();
  }
}

toPermissionsBtn.addEventListener('click', () => showPage(pagePermissions));
backToOnboardingBtn.addEventListener('click', () => showPage(pageOnboarding));

toFeatureBtn.addEventListener('click', () => {
  sessionStorage.setItem(FLOW_KEY, '1');
  showPage(pageFeature);
  setPanelMode('full');
});

permissionIds.forEach(([left, right]) => {
  const leftEl = document.getElementById(left);
  const rightEl = document.getElementById(right);
  leftEl.addEventListener('change', () => syncPermissions(left, right));
  rightEl.addEventListener('change', () => syncPermissions(right, left));
});

[blurRange, refractRange, depthRange].forEach((el) => {
  el.addEventListener('input', applyVisualSettings);
});

openSettingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

compactMenuBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

modeIconBtn.addEventListener('click', () => setPanelMode('icon'));
modeMiniBtn.addEventListener('click', () => setPanelMode('mini'));
modeFullBtn.addEventListener('click', () => setPanelMode('full'));

minBtn.addEventListener('click', () => window.desktopWindow.minimize());
closeBtn.addEventListener('click', () => window.desktopWindow.close());

if (sessionStorage.getItem(FLOW_KEY) === '1') {
  showPage(pageFeature);
  setPanelMode('full');
} else {
  showPage(pageOnboarding);
}

applyVisualSettings();
setConnecting();
refresh();
setInterval(refresh, POLL_MS);
