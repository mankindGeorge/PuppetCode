// 运行时共享状态：设置、连接状态、积木工作区与本次运行上下文。
// 说明：workspace / lastGenerated / currentExecId 会被整体替换，因此放在 runtime 容器里。

import { DEFAULTS, MODE_LABEL, STORAGE_KEY } from './config.js';

// 仅接受落在 [min, max] 内的有限整数，否则回退默认值。
function useInteger(value, fallback, min, max) {
  var number = typeof value === 'number' ? value : Number(value);
  if (!isFinite(number) || number % 1 !== 0 || number < min || number > max) {
    return fallback;
  }
  return number;
}

function loadSettings() {
  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    if (!Object.prototype.hasOwnProperty.call(MODE_LABEL, parsed.mode)) {
      parsed.mode = DEFAULTS.mode;
    }
    parsed.baudRate = useInteger(parsed.baudRate, DEFAULTS.baudRate, 1, Infinity);
    parsed.staPort = useInteger(parsed.staPort, DEFAULTS.staPort, 1, 65535);
    parsed.apPort = useInteger(parsed.apPort, DEFAULTS.apPort, 1, 65535);
    return parsed;
  } catch (error) {
    return {};
  }
}

export const settings = Object.assign({}, DEFAULTS, loadSettings());

export function saveSettings() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {}
}

export const conn = {
  transport: null,
  mode: null,
  connecting: false,
  connected: false,
  deviceReady: false,
  running: false
};

export const runtime = {
  workspace: null,
  lastGenerated: { previewCode: '', runCode: '', hasBlocks: false, lines: 0 },
  currentExecId: null
};
