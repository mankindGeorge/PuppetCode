// 应用入口：装配样式、Blockly、积木定义、工作区与各类交互绑定。
// 拆分后的模块职责：
//   blocks/     积木定义、工具箱、主题
//   codegen/    MicroPython 生成器与预览刷新
//   workspace/  Blockly 工作区与精灵图补丁
//   transport/  串口 / WebSocket 通信实现
//   protocol/   设备报文处理
//   connection/ 连接、运行、停止与握手探测
//   ui/         日志、状态、设置面板、工具栏

import './styles/base.css';
import './styles/topbar.css';
import './styles/workspace.css';
import './styles/code.css';
import './styles/log.css';
import './styles/settings.css';
import './styles/responsive.css';

import './vendor/index.js';
import { defineCustomBlocks } from './blocks/definitions.js';
import { setupGenerator } from './codegen/python.js';
import { initWorkspace } from './workspace/index.js';
import { initStage } from './workspace/stage.js';
import { initCanvasTools } from './workspace/canvasTools.js';
import { initToolboxPanel } from './workspace/toolboxPanel.js';
import { addLog } from './ui/log.js';
import { syncSettingsUI, bindSettingsPanel } from './ui/settings.js';
import { updateConnUI, updateRunButtons } from './ui/status.js';
import { bindToolbar } from './ui/toolbar.js';
import { bindMenu } from './ui/menu.js';
import { initLayout } from './ui/layout.js';
import { initCodeZoom } from './ui/codeZoom.js';
import { initProjectFiles } from './project/index.js';
import { bindConnectionControls } from './connection/index.js';

function init() {
  // Electron 桌面版使用无系统标题栏的窗口，需启用拖拽区并给窗口按钮留位
  document.body.classList.toggle('is-desktop', !!window.PuppetCodeBridge);

  defineCustomBlocks();
  setupGenerator();
  initWorkspace();
  initStage();
  initCanvasTools();
  initToolboxPanel();
  initLayout();
  initCodeZoom();
  initProjectFiles();

  bindToolbar();
  bindMenu();
  bindSettingsPanel();
  bindConnectionControls();

  syncSettingsUI();
  updateConnUI();
  updateRunButtons();

  addLog('success', '界面已准备好');
  addLog('info', '先在「设置」里连接机器人，再点「运行」');
  if (!('serial' in navigator)) {
    addLog('warn', '这个浏览器不能直接连接 USB，请用 Chrome / Edge 打开，或改用 WiFi');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
