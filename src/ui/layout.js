// 可拖动分栏：代码预览区宽度、运行日志高度。积木分类栏宽度固定，不可调。
// 尺寸保存在 localStorage，双击手柄恢复默认值；日志可收起，运行时自动展开。

import { Blockly } from '../vendor/index.js';
import { runtime } from '../state.js';

var STORAGE_KEY = 'puppetcode-layout-v1';
var DEFAULTS = { codeWidth: 400, logHeight: 150 };
var CODE_MIN = 240;
var CODE_MAX = 760;
var LOG_MIN = 90;
var LOG_MAX = 520;
var MIN_EDITOR = 320;
var MIN_TOP = 260;
// 与 workspace.css 中分隔条的 grid 尺寸保持一致（10px 间距即拖拽命中区）
var SPLITTER_SIZE = 10;

var appEl = null;
var logCloseEl = null;
var metrics = { padX: 0, padY: 0, toolbox: 0 };

function measureLayout() {
  var styles = window.getComputedStyle(appEl);
  metrics.padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
  metrics.padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  metrics.toolbox = parseFloat(styles.getPropertyValue('--toolbox-width')) || 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadSizes() {
  var saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch (error) {
    saved = {};
  }
  return {
    codeWidth: typeof saved.codeWidth === 'number' ? saved.codeWidth : DEFAULTS.codeWidth,
    logHeight: typeof saved.logHeight === 'number' ? saved.logHeight : DEFAULTS.logHeight
  };
}

function persist(sizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch (error) {
    // 隐私模式等场景写入失败时忽略，布局仍可当前会话使用
  }
}

function setLogVisible(visible) {
  if (!appEl) return;
  appEl.classList.toggle('log-hidden', !visible);
  // 「查看 → 日志」右侧同步显示当前状态
  var menuState = document.getElementById('logMenuState');
  if (menuState) menuState.textContent = visible ? '显示中' : '已收起';
  if (visible) {
    var list = document.getElementById('logList');
    if (list) list.scrollTop = list.scrollHeight;
  }
  if (runtime.workspace) requestAnimationFrame(function () { Blockly.svgResize(runtime.workspace); });
}

export function showLog() {
  setLogVisible(true);
}

export function toggleLog() {
  if (appEl) setLogVisible(appEl.classList.contains('log-hidden'));
}

export function initLayout() {
  var app = document.querySelector('.app');
  var codeHandle = document.getElementById('codeSplitter');
  var logHandle = document.getElementById('logSplitter');
  if (!app || !codeHandle || !logHandle) return;

  appEl = app;
  logCloseEl = document.getElementById('logCloseBtn');

  var sizes = loadSizes();
  var resizeFrame = 0;

  function scheduleBlocklyResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(function () {
      resizeFrame = 0;
      if (runtime.workspace) Blockly.svgResize(runtime.workspace);
    });
  }

  // 窗口变窄/变矮时只压缩显示尺寸，不覆盖用户拖出来的偏好值；窗口放大可恢复
  function applyCodeWidth() {
    var available = app.clientWidth - metrics.padX - metrics.toolbox - SPLITTER_SIZE * 2 - MIN_EDITOR;
    var max = Math.max(CODE_MIN, Math.min(CODE_MAX, available));
    var width = clamp(sizes.codeWidth, CODE_MIN, max);
    app.style.setProperty('--code-width', width + 'px');
    codeHandle.setAttribute('aria-valuenow', String(Math.round(width)));
  }

  function applyLogHeight() {
    var available = app.clientHeight - metrics.padY - SPLITTER_SIZE - MIN_TOP;
    var max = Math.max(LOG_MIN, Math.min(LOG_MAX, available));
    var height = clamp(sizes.logHeight, LOG_MIN, max);
    app.style.setProperty('--log-height', height + 'px');
    logHandle.setAttribute('aria-valuenow', String(Math.round(height)));
  }

  function setCodeWidth(width) {
    sizes.codeWidth = clamp(width, CODE_MIN, CODE_MAX);
    applyCodeWidth();
  }

  function setLogHeight(height) {
    sizes.logHeight = clamp(height, LOG_MIN, LOG_MAX);
    applyLogHeight();
  }

  function bindDrag(handle, mode) {
    var isRow = mode === 'log';

    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      var rect = app.getBoundingClientRect();

      document.body.classList.add('is-resizing', isRow ? 'is-resizing-h' : 'is-resizing-v');
      handle.classList.add('active');
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (error) {
        // 指针已被释放时捕获会失败，退回普通事件监听
      }

      function onMove(moveEvent) {
        if (isRow) {
          setLogHeight(rect.bottom - moveEvent.clientY);
        } else {
          setCodeWidth(rect.right - moveEvent.clientX);
        }
        scheduleBlocklyResize();
      }

      function onEnd() {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
        handle.classList.remove('active');
        document.body.classList.remove('is-resizing', 'is-resizing-v', 'is-resizing-h');
        if (handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) {
          try {
            handle.releasePointerCapture(event.pointerId);
          } catch (error) {
            // 同上，捕获已失效时无需处理
          }
        }
        persist(sizes);
        if (runtime.workspace) Blockly.svgResize(runtime.workspace);
      }

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });

    handle.addEventListener('dblclick', function () {
      if (mode === 'log') {
        setLogHeight(DEFAULTS.logHeight);
      } else {
        setCodeWidth(DEFAULTS.codeWidth);
      }
      if (runtime.workspace) Blockly.svgResize(runtime.workspace);
      persist(sizes);
    });

    handle.addEventListener('keydown', function (event) {
      var step;
      if (isRow) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        step = event.key === 'ArrowUp' ? 16 : -16;
        setLogHeight(sizes.logHeight + step);
      } else {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        step = event.key === 'ArrowRight' ? 16 : -16;
        setCodeWidth(sizes.codeWidth - step);
      }
      event.preventDefault();
      if (runtime.workspace) Blockly.svgResize(runtime.workspace);
      persist(sizes);
    });
  }

  measureLayout();
  applyCodeWidth();
  applyLogHeight();
  bindDrag(codeHandle, 'code');
  bindDrag(logHandle, 'log');
  scheduleBlocklyResize();

  if (logCloseEl) logCloseEl.addEventListener('click', function () { setLogVisible(false); });

  window.addEventListener('resize', function () {
    measureLayout();
    applyCodeWidth();
    applyLogHeight();
    if (runtime.workspace) Blockly.svgResize(runtime.workspace);
  });
}
