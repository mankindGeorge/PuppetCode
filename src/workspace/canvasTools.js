// 画布悬浮工具：撤销、重做、缩放与看全图。
// 按钮状态跟随 Blockly 的撤销/重做栈和画布内容更新。
import { runtime } from '../state.js';

export function initCanvasTools() {
  var workspace = runtime.workspace;
  if (!workspace) return;

  var undoBtn = document.getElementById('undoBtn');
  var redoBtn = document.getElementById('redoBtn');
  var zoomInBtn = document.getElementById('zoomInBtn');
  var zoomOutBtn = document.getElementById('zoomOutBtn');
  var fitBtn = document.getElementById('fitBtn');
  if (!undoBtn || !redoBtn || !zoomInBtn || !zoomOutBtn || !fitBtn) return;

  var frame = 0;

  function stackSize(getter) {
    try {
      var stack = workspace[getter]();
      return stack ? stack.length : 0;
    } catch (error) {
      return 0;
    }
  }

  function sync() {
    undoBtn.disabled = stackSize('getUndoStack') === 0;
    redoBtn.disabled = stackSize('getRedoStack') === 0;
    fitBtn.disabled = workspace.getAllBlocks(false).length === 0;
  }

  function scheduleSync() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      sync();
    });
  }

  undoBtn.addEventListener('click', function () { workspace.undo(false); });
  redoBtn.addEventListener('click', function () { workspace.undo(true); });
  zoomInBtn.addEventListener('click', function () { workspace.zoomCenter(1); });
  zoomOutBtn.addEventListener('click', function () { workspace.zoomCenter(-1); });
  fitBtn.addEventListener('click', function () {
    // 「看全图」只负责把内容收进视野，不把少量积木放大到占满画布。
    workspace.zoomToFit();
    if (workspace.scale > 1) {
      workspace.setScale(1);
      workspace.scrollCenter();
    }
  });

  workspace.addChangeListener(function (event) {
    if (event && event.isUiEvent) return;
    scheduleSync();
  });

  sync();
}
