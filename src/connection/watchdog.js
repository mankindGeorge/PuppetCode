// 运行 / 停止看门狗：设备回执丢失时兜底恢复界面状态，避免永久停在「运行中」。
//   1. 下发运行后若迟迟收不到 ack(started)，说明报文可能被丢弃或设备忙；
//   2. 下发停止后若迟迟收不到 done（固件超时软复位也不会回 done），同样兜底。
import { conn } from '../state.js';
import { addLog } from '../ui/log.js';
import { updateRunButtons } from '../ui/status.js';

var START_ACK_TIMEOUT_MS = 10000;
var STOP_DONE_TIMEOUT_MS = 8000;

var startTimer = null;
var stopTimer = null;
// 当前已收到 started 回执的执行 id，避免下发完成后再重复计时。
var startedExecId = null;
// 启动看门狗超时后放弃的执行 id：迟到的 started 回执必须忽略，不能重新进入运行态。
var abandonedExecId = null;

function clearStartWatchdog() {
  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
}

function clearStopWatchdog() {
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
}

function recover(message) {
  clearRunWatchdogs();
  conn.running = false;
  updateRunButtons();
  addLog('warn', message);
}

// 断开连接、收到 done/error 时调用：停止所有计时并忘记本次执行。
export function clearRunWatchdogs() {
  clearStartWatchdog();
  clearStopWatchdog();
  startedExecId = null;
  abandonedExecId = null;
}

// 收到 ack(started) 时调用：确认设备已开始执行，取消启动看门狗。
export function noteExecutionStarted(execId) {
  startedExecId = execId || null;
  abandonedExecId = null;
  clearStartWatchdog();
}

// 判断某次执行是否已被启动看门狗放弃，用于丢弃迟到的 started 回执。
export function isExecutionAbandoned(execId) {
  return !!execId && execId === abandonedExecId;
}

export function armStartWatchdog(execId) {
  clearStartWatchdog();
  if (!conn.running || !execId || startedExecId === execId) return;
  abandonedExecId = null;

  startTimer = setTimeout(function () {
    startTimer = null;
    if (!conn.running || startedExecId === execId) return;
    // recover() 内部的 clearRunWatchdogs() 会重置 abandonedExecId，
    // 因此在恢复之后再记录本次被放弃的执行，供迟到回执判断。
    recover('等待设备开始执行超时（' + START_ACK_TIMEOUT_MS / 1000
      + ' 秒未收到 started 回执），已恢复运行按钮；请检查连接与设备固件');
    abandonedExecId = execId;
  }, START_ACK_TIMEOUT_MS);
}

export function armStopWatchdog() {
  clearStopWatchdog();
  if (!conn.running) return;

  stopTimer = setTimeout(function () {
    stopTimer = null;
    if (!conn.running) return;
    recover('停止指令发出后 ' + STOP_DONE_TIMEOUT_MS / 1000
      + ' 秒仍未收到执行结束回执，已恢复运行按钮；设备可能已软复位，请重新连接');
  }, STOP_DONE_TIMEOUT_MS);
}
