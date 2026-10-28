// 连接状态与按钮状态同步（日志栏状态、设置弹窗状态）。
import { conn, settings } from '../state.js';
import { MODE_LABEL } from '../config.js';

export function setModalStatus(text, dotClass) {
  document.getElementById('modalStatus').textContent = text;
  var dot = document.getElementById('modalDot');
  dot.className = 'dot' + (dotClass ? ' ' + dotClass : '');
}

export function updateConnUI() {
  var mode = conn.mode || settings.mode;
  var label = MODE_LABEL[mode] || '通信';
  // 连接状态只在运行日志的标题栏显示；文字只保留通信方式，
  // 已连接/未连接由后面的红绿指示灯表达。
  var logState = conn.connected ? '已连接' : (conn.connecting ? '连接中' : '未连接');
  var logStatusText = document.getElementById('logStatusText');
  if (logStatusText) logStatusText.textContent = label;

  var logStatus = document.getElementById('logStatus');
  if (logStatus) {
    // 悬浮提示不显示“已连接/未连接”，状态只通过指示灯传达
    logStatus.title = label;
    logStatus.setAttribute('aria-label', label + '，' + logState);
  }

  var logDot = document.getElementById('logStatusDot');
  if (logDot) logDot.className = 'log-status-dot' + (conn.connected ? ' on' : '');

  if (!conn.connecting) {
    setModalStatus(conn.connected ? '已连接 · ' + label : '未连接', conn.connected ? 'on' : 'off');
  }

  var connectBtn = document.getElementById('connectBtn');
  var disconnectBtn = document.getElementById('disconnectBtn');
  connectBtn.disabled = conn.connected || conn.connecting;
  disconnectBtn.disabled = !conn.connected && !conn.connecting;
  connectBtn.textContent = conn.connecting ? '连接中…' : '连接';
}

export function updateRunButtons() {
  var runBtn = document.getElementById('runBtn');
  var stopBtn = document.getElementById('stopBtn');
  runBtn.disabled = conn.running;
  stopBtn.disabled = !conn.connected;

  // 「运行（R）」菜单里的两项跟随按钮一起启用/禁用
  var runItem = document.getElementById('runMenuItem');
  var stopItem = document.getElementById('stopMenuItem');
  if (runItem) runItem.disabled = conn.running;
  if (stopItem) stopItem.disabled = !conn.connected;
}
