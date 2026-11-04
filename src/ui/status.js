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
  // 连接状态在底部消息条里用文字直接说明，红绿指示灯只作辅助。
  var logState = conn.connected ? '已连接' : (conn.connecting ? '连接中' : '未连接');
  var logStatusText = document.getElementById('logStatusText');
  if (logStatusText) logStatusText.textContent = label + ' · ' + logState;

  var logStatus = document.getElementById('logStatus');
  if (logStatus) {
    logStatus.title = label + ' · ' + logState;
    logStatus.setAttribute('aria-label', label + '，' + logState);
  }

  var logDot = document.getElementById('logStatusDot');
  if (logDot) {
    logDot.className = 'log-status-dot'
      + (conn.connected ? ' on' : (conn.connecting ? ' wait' : ''));
  }

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
  // 同一个按钮在“运行/停止”两个状态间切换，避免并排两个按钮造成误点。
  var actionBtn = document.getElementById('runStopBtn');
  if (actionBtn) {
    actionBtn.classList.toggle('run', !conn.running);
    actionBtn.classList.toggle('stop', conn.running);
    actionBtn.textContent = conn.running ? '停止' : '运行';
    var label = conn.running ? '停止运行' : '运行';
    actionBtn.title = label;
    actionBtn.setAttribute('aria-label', label);
    actionBtn.disabled = false;
  }

  // 「运行（R）」菜单里的两项继续保留独立入口
  var runItem = document.getElementById('runMenuItem');
  var stopItem = document.getElementById('stopMenuItem');
  if (runItem) runItem.disabled = conn.running;
  if (stopItem) stopItem.disabled = !conn.connected;
}
