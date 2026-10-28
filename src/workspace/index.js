// 积木工作区初始化：注入 Blockly、绑定变更监听、处理尺寸自适应。
// 左侧分类栏使用 Blockly 原生工具箱，拖拽沿用官方 flyout 逻辑，连接匹配由 Blockly 负责。
import { Blockly } from '../vendor/index.js';
import { runtime } from '../state.js';
import { TOOLBOX_XML } from '../blocks/toolbox.js';
import { createTheme } from '../blocks/theme.js';
import { schedulePreview, updatePreview } from '../codegen/preview.js';
import { patchBlocklySprites, patchBlocklySpritesPending } from './sprites.js';

export function initWorkspace() {
  // 滚动条默认 15px（触屏设备 25px）。Blockly 的滑块比总高度还要小 5px，
  // 且轨道不接收点击，只能拖滑块，所以这里把总高度提到 16px（滑块 11px），兼顾易抓取与观感。
  // 该值为静态属性，必须在 inject 前设置，滚动条创建时才会读取。
  Blockly.Scrollbar.scrollbarThickness = 16;

  var workspace = Blockly.inject('blocklyDiv', {
    toolbox: TOOLBOX_XML,
    theme: createTheme(),
    renderer: 'zelos',
    media: '#',
    sounds: false,
    comments: false,
    collapse: false,
    disable: false,
    trashcan: true,
    // 工作区点阵：细小的淡蓝点，和页面底纹呼应
    grid: { spacing: 22, length: 1, colour: '#B8DFFF', snap: true },
    // 滚轮平移 + Ctrl/⌘+滚轮缩放：
    // move.wheel 与 zoom.wheel 同为 true 时，Blockly 只在按住 Ctrl/⌘ 时缩放，
    // 否则按 deltaX/deltaY 平移，触控板双指滑动（含横向）因此可直接生效。
    move: {
      scrollbars: { horizontal: true, vertical: true },
      wheel: true,
      drag: true
    },
    zoom: { controls: false, wheel: true, startScale: 0.95, maxScale: 2, minScale: 0.35, speed: 1.1 }
  });
  runtime.workspace = workspace;

  // 缩放会调用 Blockly 内部 setScale() → hideChaff()，把工具箱选中项清空，导致已展开的
  // 积木分类面板被收起。这里在捕获阶段先记下当前选中的分类，缩放后再恢复，使面板保持展开。
  var blocklyDiv = document.getElementById('blocklyDiv');
  if (blocklyDiv) {
    blocklyDiv.addEventListener('wheel', function (event) {
      if (!event.ctrlKey && !event.metaKey) return;
      var toolbox = workspace.getToolbox();
      var item = toolbox && toolbox.getSelectedItem ? toolbox.getSelectedItem() : null;
      if (!item) return;
      requestAnimationFrame(function () {
        if (!toolbox.getSelectedItem()) toolbox.setSelectedItem(item);
      });
    }, true);
  }

  patchBlocklySprites();
  patchBlocklySpritesPending();

  workspace.addChangeListener(function (event) {
    if (event && event.isUiEvent) return;
    schedulePreview();
  });

  updatePreview();

  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      Blockly.svgResize(workspace);
    }).observe(document.querySelector('.workspace-wrap'));
  }
  window.addEventListener('resize', function () {
    Blockly.svgResize(workspace);
  });

  return workspace;
}
