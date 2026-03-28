const widget = document.getElementById('widget');
const statusPill = document.getElementById('statusPill');
const stateText = document.getElementById('stateText');
const confidenceText = document.getElementById('confidenceText');
const signalFill = document.getElementById('signalFill');
const signalPercent = document.getElementById('signalPercent');

const typingSpeed = document.getElementById('typingSpeed');
const mouseSpeed = document.getElementById('mouseSpeed');
const focusSwitches = document.getElementById('focusSwitches');
const cpuValue = document.getElementById('cpuValue');

const sessionStat = document.getElementById('sessionStat');
const inStateStat = document.getElementById('inStateStat');
const breakStat = document.getElementById('breakStat');

const suggestionIcon = document.getElementById('suggestionIcon');
const suggestionTitle = document.getElementById('suggestionTitle');
const suggestionDesc = document.getElementById('suggestionDesc');
const suggestionAction = document.getElementById('suggestionAction');

const selectorFocus = document.getElementById('selectorFocus');
const selectorFatigue = document.getElementById('selectorFatigue');
const selectorConfused = document.getElementById('selectorConfused');

const minBtn = document.getElementById('minBtn');
const closeBtn = document.getElementById('closeBtn');

const API_URL = 'http://127.0.0.1:8000/latest';
const POLL_MS = 3000;

const stateConfig = {
  focused: {
    label: 'Focused',
    suggestion: {
      icon: '🔥',
      title: 'Momentum detected',
      desc: 'Protect your flow with one focused block and no context switching.',
      action: 'Set reminder ->'
    }
  },
  distracted: {
    label: 'Distracted',
    suggestion: {
      icon: '🧭',
      title: 'Attention drift',
      desc: 'Too many switches. Close one tab cluster and pick one next action.',
      action: 'Open focus plan ->'
    }
  },
  fatigued: {
    label: 'Fatigued',
    suggestion: {
      icon: '🫧',
      title: 'Energy is dropping',
      desc: 'Take a 5-minute break and hydrate before your next sprint.',
      action: 'Set reminder ->'
    }
  },
  idle: {
    label: 'Idle',
    suggestion: {
      icon: '🌙',
      title: 'Low activity',
      desc: 'System is mostly idle. Resume with a tiny first task.',
      action: 'Start quick task ->'
    }
  },
  normal: {
    label: 'Normal',
    suggestion: {
      icon: '🌊',
      title: 'Stable rhythm',
      desc: 'Good baseline. Push one high-impact task in the next 20 minutes.',
      action: 'Open dashboard ->'
    }
  },
  connecting: {
    label: 'Connecting...',
    suggestion: {
      icon: '💡',
      title: 'Connecting to engine',
      desc: 'Waiting for cognitive stream and signal confidence.',
      action: 'Set reminder ->'
    }
  }
};

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatMetric(value, suffix = '') {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(1)}${suffix}`;
}

function animateWidgetUpdate() {
  widget.classList.remove('state-updated');
  void widget.offsetWidth;
  widget.classList.add('state-updated');
}

function setSelectorState(stateKey) {
  selectorFocus.classList.toggle('active', stateKey === 'focused');
  selectorFatigue.classList.toggle('active', stateKey === 'fatigued');
  selectorConfused.classList.toggle('active', stateKey === 'distracted');
}

function computeConfidence(summary, stateKey) {
  const keyboard = summary.keyboard || {};
  const focus = summary.focus || {};
  const stateIndicators = summary.state_indicators || {};

  const typing = toNumber(keyboard.typing_speed);
  const switches = toNumber(focus.switches);
  const idleRatio = toNumber(stateIndicators.idle_ratio);

  let score = 58 + typing * 6 - switches * 4 - idleRatio * 38;

  if (stateKey === 'focused') {
    score += 12;
  } else if (stateKey === 'distracted') {
    score -= 10;
  } else if (stateKey === 'fatigued') {
    score -= 7;
  }

  return Math.round(clamp(score, 15, 99));
}

function applySuggestion(stateKey) {
  const cfg = stateConfig[stateKey] || stateConfig.normal;
  suggestionIcon.textContent = cfg.suggestion.icon;
  suggestionTitle.textContent = cfg.suggestion.title;
  suggestionDesc.textContent = cfg.suggestion.desc;
  suggestionAction.textContent = cfg.suggestion.action;
}

function setSessionStats(summary) {
  const keyboard = summary.keyboard || {};
  const focus = summary.focus || {};
  const stateIndicators = summary.state_indicators || {};

  const switches = toNumber(focus.switches);
  const keys = toNumber(keyboard.total_keys);
  const idleRatio = toNumber(stateIndicators.idle_ratio);

  const sessionMinutes = Math.max(1, Math.round(28 + switches * 1.4 + keys * 0.05));
  const inStateMinutes = Math.max(1, Math.round(sessionMinutes * (1 - idleRatio * 0.7)));
  const breakDueMinutes = Math.max(2, Math.round(45 - idleRatio * 30 - switches * 1.2));

  sessionStat.textContent = `${sessionMinutes}m`;
  inStateStat.textContent = `${inStateMinutes}m`;
  breakStat.textContent = `${breakDueMinutes}m`;
}

function applyState(data) {
  const summary = data?.summary || {};
  const backendState = String(data?.state || 'normal').toLowerCase();
  const stateKey = stateConfig[backendState] ? backendState : 'normal';
  const cfg = stateConfig[stateKey];

  const confidence = computeConfidence(summary, stateKey);

  widget.dataset.state = stateKey;
  stateText.textContent = cfg.label;
  confidenceText.textContent = `${confidence}%`;
  signalPercent.textContent = `${confidence}%`;
  signalFill.style.width = `${confidence}%`;
  statusPill.textContent = 'Active';

  const keyboard = summary.keyboard || {};
  const mouse = summary.mouse || {};
  const focus = summary.focus || {};
  const system = summary.system || {};

  typingSpeed.textContent = formatMetric(toNumber(keyboard.typing_speed), 'k/s');
  mouseSpeed.textContent = formatMetric(toNumber(mouse.avg_speed), 'px/s');
  focusSwitches.textContent = `${Math.round(toNumber(focus.switches))}`;
  cpuValue.textContent = formatMetric(toNumber(system.avg_cpu), '%');

  setSelectorState(stateKey);
  setSessionStats(summary);
  applySuggestion(stateKey);
  animateWidgetUpdate();
}

function setConnectingState() {
  widget.dataset.state = 'connecting';
  statusPill.textContent = 'Waiting';
  stateText.textContent = stateConfig.connecting.label;
  confidenceText.textContent = '--%';
  signalPercent.textContent = '0%';
  signalFill.style.width = '0%';

  typingSpeed.textContent = '-';
  mouseSpeed.textContent = '-';
  focusSwitches.textContent = '-';
  cpuValue.textContent = '-';
  sessionStat.textContent = '--m';
  inStateStat.textContent = '--m';
  breakStat.textContent = '--m';

  setSelectorState('connecting');
  applySuggestion('connecting');
}

async function fetchState() {
  const res = await fetch(API_URL, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function refresh() {
  try {
    const data = await fetchState();
    applyState(data);
  } catch (_) {
    setConnectingState();
  }
}

minBtn.addEventListener('click', () => {
  window.desktopWindow.minimize();
});

closeBtn.addEventListener('click', () => {
  window.desktopWindow.close();
});

suggestionAction.addEventListener('click', () => {
  animateWidgetUpdate();
});

selectorFocus.addEventListener('click', () => setSelectorState('focused'));
selectorFatigue.addEventListener('click', () => setSelectorState('fatigued'));
selectorConfused.addEventListener('click', () => setSelectorState('distracted'));

setConnectingState();
refresh();
setInterval(refresh, POLL_MS);
