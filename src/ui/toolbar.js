// 编辑舞台右上角的运行/停止合并按钮与快捷保存按钮。
import { conn } from '../state.js';
import { showLog } from './layout.js';
import { runCode, stopCode } from '../connection/index.js';
import { saveProjectPrompt } from '../project/index.js';

export function bindToolbar() {
  var actionBtn = document.getElementById('runStopBtn');
  if (actionBtn) {
    actionBtn.addEventListener('click', function () {
      if (conn.running) {
        stopCode();
        return;
      }
      // 运行时自动展开日志，便于看到发送与设备回传
      showLog();
      runCode();
    });
  }

  var saveBtn = document.getElementById('quickSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveProjectPrompt);
}
