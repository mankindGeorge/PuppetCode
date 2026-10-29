// 设备下行报文处理：ready / ack / log / done / error。
import { conn, runtime } from '../state.js';
import { addLog } from '../ui/log.js';
import { updateConnUI, updateRunButtons } from '../ui/status.js';
import { stopReadyProbe } from '../connection/probe.js';
import { clearRunWatchdogs, noteExecutionStarted } from '../connection/watchdog.js';

export function handleDeviceMessage(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'ready') {
    conn.deviceReady = true;
    stopReadyProbe();
    var mode = message.mode || (conn.mode === 'serial' ? 'SERIAL' : 'WS');
    addLog('success', '设备就绪 · ' + mode + ' · 协议 ' + (message.protocol || '-'));
    updateConnUI();
    return;
  }

  if (message.type === 'ack') {
    var ackText = {
      received: '设备已接收代码',
      started: '设备开始执行',
      stopping: '设备正在停止'
    };
    addLog('rx', ackText[message.stage] || ('确认：' + message.stage));
    if (message.stage === 'started' && (!message.id || message.id === runtime.currentExecId)) {
      noteExecutionStarted(message.id || runtime.currentExecId);
      conn.running = true;
      updateRunButtons();
    }
    return;
  }

  if (message.type === 'log') {
    var level = message.level;
    var mapped = level === 'error' ? 'error'
      : level === 'warn' ? 'warn'
        : level === 'print' ? 'print'
          : 'device';
    addLog(mapped, message.message == null ? '' : message.message);
    return;
  }

  if (message.type === 'done') {
    // 忽略上一次执行迟到的 done，避免误清新一轮运行的状态。
    if (message.id && message.id !== runtime.currentExecId) return;
    clearRunWatchdogs();
    conn.running = false;
    if (message.ok) {
      addLog('success', '执行结束');
    } else if (message.reason === 'stopped') {
      addLog('warn', '执行已停止');
    } else {
      addLog('error', '执行异常结束');
    }
    updateRunButtons();
    return;
  }

  if (message.type === 'error') {
    addLog('error', message.message || '设备返回错误');
    if (!message.id || message.id === runtime.currentExecId) {
      clearRunWatchdogs();
      conn.running = false;
      updateRunButtons();
    }
    return;
  }

  addLog('device', JSON.stringify(message));
}
