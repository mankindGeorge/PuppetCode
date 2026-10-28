// 连接控制器：建立/断开连接、处理传输层状态、下发运行与停止指令。
import { conn, runtime, settings, saveSettings } from '../state.js';
import { MODE_LABEL } from '../config.js';
import { createTransport } from '../transport/index.js';
import { generateOutput, updatePreview } from '../codegen/preview.js';
import { handleDeviceMessage } from '../protocol/messages.js';
import { addLog } from '../ui/log.js';
import { readSettingsUI, openSettings, syncSettingsUI } from '../ui/settings.js';
import { setModalStatus, updateConnUI, updateRunButtons } from '../ui/status.js';
import { startReadyProbe, stopReadyProbe } from './probe.js';

function bindTransport(transport) {
  transport.onMessage(handleDeviceMessage);
  transport.onStatus(handleTransportStatus);
}

function handleTransportStatus(state, detail) {
  if (state === 'connected') {
    conn.connected = true;
    conn.connecting = false;
    conn.deviceReady = false;
    addLog('success', '已连接 · ' + (detail || MODE_LABEL[conn.mode] || ''));
    updateConnUI();
  } else if (state === 'disconnected') {
    var wasConnected = conn.connected;
    conn.connected = false;
    conn.connecting = false;
    conn.running = false;
    conn.deviceReady = false;
    stopReadyProbe();
    if (wasConnected || detail) {
      addLog('warn', detail ? '连接已断开：' + detail : '连接已断开');
    }
    updateConnUI();
    updateRunButtons();
  } else if (state === 'error') {
    addLog('error', detail || '通信错误');
    updateConnUI();
  }
}

export async function connectDevice() {
  if (conn.connecting || conn.connected) return;

  readSettingsUI();
  saveSettings();

  var mode = settings.mode;

  if (mode === 'serial' && !('serial' in navigator)) {
    addLog('error', '当前浏览器不支持 Web Serial，请使用 Chrome / Edge，或切换到 WiFi 模式');
    setModalStatus('浏览器不支持 Web Serial', 'err');
    return;
  }

  var config = null;
  if (mode === 'serial') {
    config = { baudRate: settings.baudRate };
  } else {
    var ip = mode === 'sta' ? settings.staIp : settings.apIp;
    var port = mode === 'sta' ? settings.staPort : settings.apPort;
    if (!ip) {
      addLog('warn', '请填写设备 IP');
      setModalStatus('请填写设备 IP', 'err');
      (mode === 'sta' ? document.getElementById('staIp') : document.getElementById('apIp')).focus();
      return;
    }
    if (!(port >= 1 && port <= 65535)) {
      addLog('warn', '端口必须在 1-65535 之间');
      setModalStatus('端口无效', 'err');
      return;
    }
    config = { ip: ip, port: port };
  }

  var transport = createTransport(mode);
  conn.transport = transport;
  conn.mode = mode;
  conn.connecting = true;
  conn.deviceReady = false;
  bindTransport(transport);
  updateConnUI();

  addLog('info', '正在通过' + MODE_LABEL[mode] + '连接…');

  try {
    await transport.connect(config);
  } catch (error) {
    conn.connecting = false;
    conn.connected = false;
    conn.transport = null;
    addLog('error', '连接失败：' + (error && error.message ? error.message : error));
    setModalStatus('连接失败', 'err');
    try { await transport.disconnect(); } catch (ignored) {}
    updateConnUI();
    return;
  }

  conn.connecting = false;
  conn.connected = true;
  setModalStatus('已连接', 'on');
  updateConnUI();
  startReadyProbe();
}

export async function disconnectDevice(reason) {
  var transport = conn.transport;
  conn.transport = null;
  conn.connecting = false;
  conn.connected = false;
  conn.running = false;
  conn.deviceReady = false;
  stopReadyProbe();

  if (transport) {
    try { await transport.disconnect(); } catch (error) {
      addLog('error', '断开连接失败：' + (error && error.message ? error.message : error));
    }
  }
  if (reason) addLog('info', reason);
  setModalStatus('未连接', 'off');
  updateConnUI();
  updateRunButtons();
}

export async function runCode() {
  if (!conn.connected || !conn.transport) {
    addLog('warn', '未连接设备，请先在设置中连接');
    openSettings();
    return;
  }
  if (conn.running) {
    addLog('warn', '已有代码正在执行，请先停止或等待结束');
    return;
  }

  var output = generateOutput();
  updatePreview();

  if (!output.hasBlocks) {
    addLog('warn', '编辑区还没有积木，无法运行');
    return;
  }
  if (!conn.deviceReady) {
    addLog('warn', '尚未收到设备就绪消息，仍尝试下发代码');
  }

  runtime.currentExecId = 'run-' + Date.now();
  try {
    await conn.transport.send({
      type: 'run',
      id: runtime.currentExecId,
      code: output.runCode
    });
    addLog('tx', '已下发代码（' + output.lines + ' 行 / ' + output.runCode.length + ' 字符）');
    conn.running = true;
    updateRunButtons();
  } catch (error) {
    addLog('error', '代码下发失败：' + (error && error.message ? error.message : error));
  }
}

export async function stopCode() {
  if (!conn.connected || !conn.transport) {
    addLog('warn', '未连接设备，无法发送停止指令');
    return;
  }
  try {
    await conn.transport.send({ type: 'stop' });
    addLog('tx', '已发送停止指令');
  } catch (error) {
    addLog('error', '停止指令发送失败：' + (error && error.message ? error.message : error));
  }
}

// 设置弹窗内的连接相关交互：模式切换、连接、断开。
export function bindConnectionControls() {
  document.querySelectorAll('#modeTabs button').forEach(function (button) {
    button.addEventListener('click', function () {
      var mode = button.getAttribute('data-mode');
      if (settings.mode === mode) return;
      settings.mode = mode;
      saveSettings();
      syncSettingsUI();
      if (conn.connected || conn.connecting) {
        disconnectDevice('切换通信模式，已断开当前连接');
      }
      addLog('info', '通信模式已切换为 ' + MODE_LABEL[mode]);
      updateConnUI();
    });
  });

  document.getElementById('connectBtn').addEventListener('click', connectDevice);
  document.getElementById('disconnectBtn').addEventListener('click', function () {
    disconnectDevice('已断开连接');
  });
}
