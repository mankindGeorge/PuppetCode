// 积木工程的保存与导入：
//   1. 关闭窗口时，若画布有改动，弹窗提示保存（可改名，也可不保存）；
//   2. 「导入」按钮读取之前保存的 .xml，恢复整块画布。
// 桌面版通过 preload 暴露的 window.PuppetCodeBridge 落盘；纯浏览器环境退化为
// beforeunload 原生提示 + 下载，因为浏览器不允许自定义退出弹窗。

import { Blockly } from '../vendor/index.js';
import { runtime } from '../state.js';
import { updatePreview } from '../codegen/preview.js';
import { addLog } from '../ui/log.js';
import { openModal, closeModal } from '../ui/modal.js';

const EXT = '.xml';
const SEQ_KEY = 'puppetcode.savedSeq';

const bridge = window.PuppetCodeBridge || null;

var suggestedName = 'puppetcode01' + EXT;
var saveFolder = '';
// 上次保存或导入时的画布快照；退出时与当前快照比对，判断是否有改动。
var baselineXml = '';

function currentXml() {
  return runtime.workspace ? workspaceXml() : '';
}

function hasUnsavedChanges() {
  return currentXml() !== baselineXml;
}

function hasBlocks() {
  return !!(runtime.lastGenerated && runtime.lastGenerated.hasBlocks);
}

function workspaceXml() {
  return Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(runtime.workspace));
}

// 浏览器环境没有目录概念，用本地计数保证编号递增。
function browserNextName() {
  var seq = 0;
  try {
    seq = parseInt(window.localStorage.getItem(SEQ_KEY) || '0', 10) || 0;
  } catch (error) {}
  return 'puppetcode' + String(seq + 1).padStart(2, '0') + EXT;
}

function bumpBrowserSeq() {
  var seq = 0;
  try {
    seq = parseInt(window.localStorage.getItem(SEQ_KEY) || '0', 10) || 0;
    window.localStorage.setItem(SEQ_KEY, String(seq + 1));
  } catch (error) {}
}

// 每次保存后重新取下一个可用编号，避免同名覆盖。
async function refreshSuggestion() {
  if (bridge) {
    try {
      var info = await bridge.nextFileName();
      if (info && info.name) {
        suggestedName = info.name;
        saveFolder = info.folder || '';
      }
    } catch (error) {}
  } else {
    suggestedName = browserNextName();
  }
}

function sanitizeName(raw) {
  var name = String(raw || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '');
  if (!name) return suggestedName;
  if (!new RegExp(EXT.replace('.', '\\.') + '$', 'i').test(name)) {
    name = name.replace(/\.(py|txt|json|xml)$/i, '') + EXT;
  }
  return name;
}

function showSaveError(message) {
  var errorEl = document.getElementById('saveError');
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

async function saveProject() {
  var input = document.getElementById('saveName');
  var name = sanitizeName(input.value);
  input.value = name;

  var xml = workspaceXml();
  try {
    if (bridge) {
      var result = await bridge.saveProject(name, xml);
      if (!result || !result.ok) {
        showSaveError((result && result.error) || '保存失败');
        return false;
      }
      addLog('success', '已保存：' + result.path);
    } else {
      downloadFile(name, xml);
      bumpBrowserSeq();
      addLog('success', '已保存：' + name);
    }
    baselineXml = xml;
    await refreshSuggestion();
    return true;
  } catch (error) {
    showSaveError('保存失败：' + (error && error.message ? error.message : error));
    return false;
  }
}

function downloadFile(name, content) {
  var blob = new Blob([content], { type: 'application/xml' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// mode = 'save'：菜单里的「保存」，成功后留在应用里；
// mode = 'exit'：关闭窗口时的提示，保存成功后退出。
var promptMode = 'exit';

async function openSavePrompt(mode) {
  promptMode = mode === 'save' ? 'save' : 'exit';
  await refreshSuggestion();

  var input = document.getElementById('saveName');
  input.value = suggestedName;
  document.getElementById('saveHint').textContent = saveFolder
    ? '保存位置：' + saveFolder
    : '保存位置：浏览器下载文件夹';
  document.getElementById('saveSkipBtn').hidden = promptMode !== 'exit';
  document.getElementById('saveSaveBtn').textContent = promptMode === 'exit' ? '保存并退出' : '保存';
  showSaveError('');
  openModal(document.getElementById('saveMask'), {
    onClose: closePrompt,
    initialFocus: input
  });

  var dot = input.value.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
}

function closePrompt() {
  closeModal(document.getElementById('saveMask'));
}

function finishExit() {
  closePrompt();
  if (bridge && bridge.closeConfirmed) bridge.closeConfirmed();
}

function bindSavePrompt() {
  document.getElementById('saveSaveBtn').addEventListener('click', async function () {
    if (!(await saveProject())) return;
    if (promptMode === 'exit') finishExit();
    else closePrompt();
  });
  document.getElementById('saveSkipBtn').addEventListener('click', finishExit);
  document.getElementById('saveCancelBtn').addEventListener('click', closePrompt);

  document.getElementById('saveName').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('saveSaveBtn').click();
    }
  });
}

function bindExitGuard() {
  if (bridge && bridge.onCloseRequest) {
    bridge.onCloseRequest(function () {
      if (!hasUnsavedChanges()) {
        bridge.closeConfirmed();
        return;
      }
      openSavePrompt();
    });
    return;
  }

  // 没有 preload 时只能用浏览器自带的离开确认，无法自定义文件名。
  window.addEventListener('beforeunload', function (event) {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

// Blockly.utils.xml.textToDom 解析失败时会退化为 HTML 解析，截断的 XML
// （如 <xml><block）也能返回 <xml> 元素，因此这里自己做严格校验。
function parseProjectXml(text) {
  var doc;
  try {
    doc = new DOMParser().parseFromString(String(text || ''), 'text/xml');
  } catch (error) {
    throw new Error('XML 解析失败');
  }
  if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('XML 内容不完整或格式错误');
  }
  var root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'xml') {
    throw new Error('根节点不是 <xml>');
  }
  return root;
}

// 先确认所有积木类型都可用，再在离屏工作区完整加载一遍，
// 提前暴露连接、字段等结构错误，避免清空画布后才发现问题。
function validateProjectXml(root) {
  var nodes = root.getElementsByTagName('*');
  for (var i = 0; i < nodes.length; i++) {
    var nodeName = nodes[i].nodeName.toLowerCase();
    if (nodeName !== 'block' && nodeName !== 'shadow') continue;
    var type = nodes[i].getAttribute('type');
    if (!type) throw new Error('存在未指定类型的积木');
    if (!Blockly.Blocks[type]) {
      throw new Error('未知积木类型：' + String(type).slice(0, 40));
    }
  }

  var probe = new Blockly.Workspace();
  try {
    Blockly.Xml.domToWorkspace(root.cloneNode(true), probe);
  } finally {
    probe.dispose();
  }
}

function importXml(text, fileName) {
  var workspace = runtime.workspace;
  if (!workspace) return;

  var dom;
  try {
    dom = parseProjectXml(text);
    validateProjectXml(dom);
  } catch (error) {
    addLog('error', '打开失败：' + fileName + ' 不是有效的积木工程文件'
      + (error && error.message ? '（' + error.message + '）' : ''));
    return;
  }

  if (hasUnsavedChanges() && hasBlocks() && !window.confirm('打开会替换当前的积木，继续吗？')) return;

  // 校验已通过，仍保留回滚兜底：加载中途出错时恢复导入前的快照。
  var snapshot = workspaceXml();
  var failure = null;

  Blockly.Events.disable();
  try {
    Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, workspace);
  } catch (error) {
    failure = error;
    try {
      Blockly.Xml.clearWorkspaceAndLoadFromXml(Blockly.utils.xml.textToDom(snapshot), workspace);
    } catch (restoreError) {}
  } finally {
    Blockly.Events.enable();
  }

  Blockly.svgResize(workspace);
  updatePreview();

  if (failure) {
    addLog('error', '打开失败：' + fileName
      + '（' + (failure && failure.message ? failure.message : failure) + '），已恢复原有积木');
    return;
  }

  if (workspace.clearUndo) workspace.clearUndo();
  baselineXml = workspaceXml();
  addLog('success', '已打开：' + fileName);
}

function bindFileInput() {
  var input = document.getElementById('projectFileInput');
  if (!input) return;

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      importXml(String(reader.result || ''), file.name);
    };
    reader.onerror = function () {
      addLog('error', '读取文件失败：' + file.name);
    };
    reader.readAsText(file);
  });
}

// 「文件 → 新建」：清空画布，回到空白工程。
export function newProject() {
  var workspace = runtime.workspace;
  if (!workspace) return;
  if (hasUnsavedChanges() && hasBlocks() && !window.confirm('新建会清空当前积木，继续吗？')) return;

  workspace.clear();
  if (workspace.clearUndo) workspace.clearUndo();
  updatePreview();
  baselineXml = workspaceXml();
  addLog('info', '已新建空白工程');
}

// 「文件 → 打开」：走隐藏的 file input，读取 .xml 工程。
export function openProject() {
  var input = document.getElementById('projectFileInput');
  if (!input) return;
  input.value = '';
  input.click();
}

// 「文件 → 保存」：弹保存窗但不退出。
export function saveProjectPrompt() {
  openSavePrompt('save');
}

export function initProjectFiles() {
  if (!runtime.workspace) return;
  baselineXml = workspaceXml();
  bindFileInput();
  bindSavePrompt();
  bindExitGuard();
  refreshSuggestion();
}
