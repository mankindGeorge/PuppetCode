// Blockly 内置 sprites.png 的内联补丁。
// media 设为 '#' 后，部分图标（菜单复选框、垃圾桶）仍会请求 sprites.png，
// 这里统一替换为内联 data URI，保证单文件离线运行。
import { SPRITE_DATA_URI } from './sprite-data.js';

export function patchBlocklySprites() {
  document.querySelectorAll('image').forEach(function (image) {
    var href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    if (href.indexOf('sprites.png') >= 0) {
      image.setAttribute('href', SPRITE_DATA_URI);
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', SPRITE_DATA_URI);
    }
  });

  if (document.getElementById('sprite-checkbox-style')) return;
  var style = document.createElement('style');
  style.id = 'sprite-checkbox-style';
  style.textContent =
    '.blocklyMenuItemSelected .blocklyMenuItemCheckbox{' +
    'background-image:url("' + SPRITE_DATA_URI + '") !important;' +
    'background-repeat:no-repeat !important;' +
    'background-position:-48px -16px !important;' +
    '}';
  document.head.appendChild(style);
}

// 垃圾桶的图片在 inject 时同步创建，这里做一次兜底补丁，防止延迟渲染。
export function patchBlocklySpritesPending() {
  var times = 0;
  var timer = setInterval(function () {
    patchBlocklySprites();
    times += 1;
    if (times >= 5) clearInterval(timer);
  }, 500);
}
