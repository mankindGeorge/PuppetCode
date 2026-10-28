// 积木编辑区右上角的运行/停止按钮。
import { showLog } from './layout.js';
import { runCode, stopCode } from '../connection/index.js';

export function bindToolbar() {
  document.getElementById('runBtn').addEventListener('click', function () {
    // 运行时自动展开日志，便于看到发送与设备回传
    showLog();
    runCode();
  });
  document.getElementById('stopBtn').addEventListener('click', stopCode);
}
