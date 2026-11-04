// 可拖动分栏：代码预览区宽度、运行日志高度。积木分类栏宽度固定，不可调。
// 尺寸保存在 localStorage，双击手柄恢复默认值；日志可收起，运行时自动展开。

import { Blockly } from '../vendor/index.js';
import { runtime } from '../state.js';

var STORAGE_KEY = 'puppetcode-layout-v1';
var LAYOUT_VERSION = 2;
var DEFAULTS = { logHeight: 150 };
var CODE_MIN = 240;
var LOG_MIN = 90;
var LOG_MAX = 520;
var MIN_EDITOR = 320;
var MIN_TOP = 260;
// 与 workspace.css 中分隔条的 grid 尺寸保持一致（10px 间距即拖拽命中区）
var SPLITTER_SIZE = 10;

var appEl = null;
var logToggleEl = null;
var codeToggleEl = null;
var codeIconEl = null;
var codeSwitching = false;
var codeSwitchTimer = 0;
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
  // 旧版本没有 layoutVersion：代码区宽度退回“与舞台等宽”，
  // 但保留用户已经调过的日志高度。
  return {
    codeWidth: saved.layoutVersion === LAYOUT_VERSION && typeof saved.codeWidth === 'number'
      ? saved.codeWidth
      : null,
    logHeight: typeof saved.logHeight === 'number' ? saved.logHeight : DEFAULTS.logHeight
  };
}

function persist(sizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      layoutVersion: LAYOUT_VERSION,
      codeWidth: sizes.codeWidth,
      logHeight: sizes.logHeight
    }));
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
  if (logToggleEl) {
    var label = visible ? '收起机器人消息' : '展开机器人消息';
    logToggleEl.setAttribute('aria-expanded', visible ? 'true' : 'false');
    logToggleEl.title = label;
    logToggleEl.setAttribute('aria-label', label);
  }
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

function updateCodeLabels(visible) {
  var label = visible ? '收起代码面板' : '展开代码面板';
  if (codeToggleEl) {
    codeToggleEl.setAttribute('aria-expanded', visible ? 'true' : 'false');
    codeToggleEl.title = label;
    codeToggleEl.setAttribute('aria-label', label);
  }
  if (codeIconEl) {
    codeIconEl.setAttribute('aria-expanded', visible ? 'true' : 'false');
    codeIconEl.title = label;
    codeIconEl.setAttribute('aria-label', label);
  }
}

function setCodeVisible(visible, immediate) {
  if (!appEl || codeSwitching) return;
  var wasVisible = !appEl.classList.contains('code-hidden');
  var iconHadFocus = !visible && document.activeElement === codeIconEl;
  updateCodeLabels(visible);
  if (wasVisible === visible) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (immediate || reduceMotion) {
    appEl.classList.remove('code-switching');
    appEl.classList.toggle('code-hidden', !visible);
    if (iconHadFocus && codeToggleEl) codeToggleEl.focus();
    if (runtime.workspace) requestAnimationFrame(function () { Blockly.svgResize(runtime.workspace); });
    return;
  }

  // 极短的交叉淡入淡出：内容先淡出，换布局后再淡入，不做位移。
  codeSwitching = true;
  window.clearTimeout(codeSwitchTimer);
  appEl.classList.add('code-switching');

  codeSwitchTimer = window.setTimeout(function () {
    appEl.classList.toggle('code-hidden', !visible);
    if (iconHadFocus && codeToggleEl) codeToggleEl.focus();
    if (runtime.workspace) requestAnimationFrame(function () { Blockly.svgResize(runtime.workspace); });

    // 先让新布局以 opacity: 0 渲染一帧，再移除类触发淡入。
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        appEl.classList.remove('code-switching');
        codeSwitching = false;
      });
    });
  }, 80);
}

function toggleCode() {
  if (appEl) setCodeVisible(appEl.classList.contains('code-hidden'));
}

export function initLayout() {
  var app = document.querySelector('.app');
  var codeHandle = document.getElementById('codeSplitter');
  var logHandle = document.getElementById('logSplitter');
  if (!app || !codeHandle || !logHandle) return;

  appEl = app;
  logToggleEl = document.getElementById('logToggleBtn');
  codeToggleEl = document.getElementById('codeToggleBtn');
  codeIconEl = document.getElementById('codeIconBtn');
  // 首屏默认收起日志，只保留消息条；同步菜单文案与展开按钮状态。
  setLogVisible(!app.classList.contains('log-hidden'));
  setCodeVisible(!app.classList.contains('code-hidden'), true);
  if (codeToggleEl) codeToggleEl.addEventListener('click', toggleCode);
  if (codeIconEl) {
    codeIconEl.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleCode();
    });
  }

  // 收起后的整条代码导轨都可以点击展开；按钮本身仍由上面的切换逻辑处理。
  var codeHeadEl = document.querySelector('.code-panel .panel-head');
  if (codeHeadEl) {
    codeHeadEl.addEventListener('click', function (event) {
      if (event.target.closest('.code-collapse, .code-head-toggle')) return;
      if (app.classList.contains('code-hidden')) setCodeVisible(true);
    });
  }

  var sizes = loadSizes();
  var resizeFrame = 0;

  function scheduleBlocklyResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(function () {
      resizeFrame = 0;
      if (runtime.workspace) Blockly.svgResize(runtime.workspace);
    });
  }

  // 代码区与编辑区共享除分类栏、间距外的宽度；未手动拖过时默认各占一半。
  function codeLimits() {
    var total = app.clientWidth - metrics.padX - metrics.toolbox - SPLITTER_SIZE * 2;
    var max = Math.max(CODE_MIN, total - MIN_EDITOR);
    return {
      max: max,
      equal: clamp(Math.round(total / 2), CODE_MIN, max)
    };
  }

  // 窗口变窄/变矮时只压缩显示尺寸，不覆盖用户拖出来的偏好值；窗口放大可恢复
  function applyCodeWidth() {
    var limits = codeLimits();
    var width = sizes.codeWidth == null
      ? limits.equal
      : clamp(sizes.codeWidth, CODE_MIN, limits.max);
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
    var limits = codeLimits();
    sizes.codeWidth = clamp(Math.round(width), CODE_MIN, limits.max);
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
        // 双击分隔条恢复“舞台与代码区等宽”的默认布局
        sizes.codeWidth = null;
        applyCodeWidth();
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
        // 默认等宽时 sizes.codeWidth 为 null，用当前等宽值作为基准。
        var current = sizes.codeWidth == null ? codeLimits().equal : sizes.codeWidth;
        setCodeWidth(current - step);
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

  // 首帧后重新量一次：页面初次布局时滚动条/字体度量可能还没稳定，
  // 等尺寸落定后再确认“舞台与代码区等宽”。
  requestAnimationFrame(function () {
    measureLayout();
    applyCodeWidth();
    applyLogHeight();
    if (runtime.workspace) Blockly.svgResize(runtime.workspace);
  });

  // 开发服务器注入样式、或滚动条出现/消失时，应用容器会再变一次尺寸；
  // 监听自身尺寸，保证等宽默认值不会被首次测量误差带偏。
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      measureLayout();
      applyCodeWidth();
      applyLogHeight();
      if (runtime.workspace) Blockly.svgResize(runtime.workspace);
    }).observe(app);
  }

  if (logToggleEl) logToggleEl.addEventListener('click', toggleLog);

  window.addEventListener('resize', function () {
    measureLayout();
    applyCodeWidth();
    applyLogHeight();
    if (runtime.workspace) Blockly.svgResize(runtime.workspace);
  });
}
