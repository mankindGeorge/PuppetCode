// 代码预览区缩放：Ctrl/⌘ + 滚轮调整代码字号，普通滚轮仍是原生滚动。
const MIN_FONT = 9;
const MAX_FONT = 24;
const DEFAULT_FONT = 12.5;

export function initCodeZoom() {
  var body = document.querySelector('.code-body');
  var codeEl = document.getElementById('codeText');
  if (!body || !codeEl) return;

  var size = DEFAULT_FONT;

  body.addEventListener('wheel', function (event) {
    if (!event.ctrlKey && !event.metaKey) return;
    // 阻止浏览器/Electron 把整个页面一起缩放
    event.preventDefault();
    size = Math.min(MAX_FONT, Math.max(MIN_FONT, size * Math.pow(1.0015, -event.deltaY)));
    codeEl.style.fontSize = size.toFixed(2) + 'px';
  }, { passive: false });
}
