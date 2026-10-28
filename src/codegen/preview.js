// 代码生成结果与右侧预览区刷新。
import { Blockly } from '../vendor/index.js';
import { runtime } from '../state.js';

const CODE_HEADER = [
  '# 光影智编 · PuppetCode',
  '# 目标硬件：ESP32 + 4 路舵机',
  ''
].join('\n');

// 预览区高亮只影响显示，不改变生成或运行的代码。
// 顺序固定为注释 → 字符串 → 关键字 → 数字，先转义 HTML 再着色。
const TOKEN_PATTERN = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b|\b(\d+(?:\.\d+)?)\b/g;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightPython(source) {
  return escapeHtml(source).replace(TOKEN_PATTERN, function (match, comment, string, keyword) {
    var cls = comment ? 'tok-comment' : string ? 'tok-string' : keyword ? 'tok-keyword' : 'tok-number';
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

export function generateOutput() {
  var body = '';
  if (runtime.workspace) {
    body = Blockly.Python.workspaceToCode(runtime.workspace).replace(/\s+$/, '');
  }
  var hasBlocks = body.length > 0;
  var runCode = hasBlocks ? CODE_HEADER + '\n' + body + '\n' : '';
  var previewCode = hasBlocks
    ? runCode
    : CODE_HEADER + '\n# 把左边的积木拖进来\n# 代码会自动出现在这里\n';
  return {
    runCode: runCode,
    previewCode: previewCode,
    hasBlocks: hasBlocks,
    lines: runCode ? runCode.split('\n').length - 1 : 0
  };
}

export function updatePreview() {
  runtime.lastGenerated = generateOutput();
  var codeEl = document.getElementById('codeText');
  if (codeEl) codeEl.innerHTML = highlightPython(runtime.lastGenerated.previewCode);
}

export function schedulePreview() {
  if (schedulePreview.pending) return;
  schedulePreview.pending = true;
  window.requestAnimationFrame(function () {
    schedulePreview.pending = false;
    updatePreview();
  });
}
