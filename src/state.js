// 运行时共享状态：设置、连接状态、积木工作区与本次运行上下文。
// 说明：workspace / lastGenerated / currentExecId 会被整体替换，因此放在 runtime 容器里。

import { DEFAULTS, STORAGE_KEY } from './config.js';

function loadSettings() {
  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
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
