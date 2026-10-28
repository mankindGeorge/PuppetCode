// 设备就绪探测：串口模式下主动发送 hello 握手；WiFi 模式仅做超时提示。
import { conn } from '../state.js';
import { PROTOCOL_VERSION } from '../config.js';
import { addLog } from '../ui/log.js';

var readyProbeTimer = null;
var readyProbeAttempts = 0;

function sendRaw(message) {
  if (!conn.transport) return Promise.reject(new Error('未连接'));
  return conn.transport.send(message);
}

export function stopReadyProbe() {
  if (readyProbeTimer) {
    clearInterval(readyProbeTimer);
    readyProbeTimer = null;
  }
  readyProbeAttempts = 0;
}

export function startReadyProbe() {
  stopReadyProbe();

  if (conn.mode === 'serial') {
    addLog('info', '串口已打开，等待设备就绪（发送握手 hello）');
    var sendHello = function () {
      if (!conn.connected || conn.deviceReady) return;
      readyProbeAttempts += 1;
      sendRaw({ type: 'hello', protocol: PROTOCOL_VERSION }).catch(function () {});
    };
    setTimeout(sendHello, 1200);
    readyProbeTimer = setInterval(function () {
      if (!conn.connected || conn.deviceReady) {
        stopReadyProbe();
        return;
      }
      if (readyProbeAttempts >= 3) {
        stopReadyProbe();
        addLog('warn', '未收到设备就绪消息，请确认 main.py 已运行');
        return;
      }
      sendHello();
    }, 1500);
  } else {
    readyProbeTimer = setInterval(function () {
      if (!conn.connected || conn.deviceReady) {
        stopReadyProbe();
        return;
      }
      stopReadyProbe();
      addLog('warn', '未收到设备就绪消息，请检查设备 IP、端口与固件配置');
    }, 4000);
  }
}
