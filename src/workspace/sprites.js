// Blockly 内置 sprites.png 的内联补丁。
// media 设为 '#' 后，部分图标（菜单复选框、垃圾桶）仍会请求 sprites.png，
// 这里统一替换为内联 data URI，保证单文件离线运行。
import { SPRITE_DATA_URI } from './sprite-data.js';

// 垃圾桶的绘制尺寸由 Blockly 常量决定，这里把两张 sprite 图片
// 包进一个以右下角为锚点的缩放层，视觉缩小但保留原有点击区域。
var TRASH_SCALE = 0.8;
var TRASH_WIDTH = 47;
var TRASH_HEIGHT = 60;

function shrinkTrashcan() {
  var trash = document.querySelector('#blocklyDiv .blocklyTrash');
  if (!trash || trash.querySelector('.puppet-trash-scale')) return;

  var images = Array.prototype.filter.call(trash.children, function (node) {
    return node.tagName && node.tagName.toLowerCase() === 'image';
  });
  if (!images.length) return;

  var wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  wrapper.setAttribute('class', 'puppet-trash-scale');
  wrapper.setAttribute('transform',
    'translate(' + TRASH_WIDTH + ',' + TRASH_HEIGHT + ') '
    + 'scale(' + TRASH_SCALE + ') '
    + 'translate(-' + TRASH_WIDTH + ',-' + TRASH_HEIGHT + ')');
  trash.insertBefore(wrapper, images[0]);
  images.forEach(function (image) { wrapper.appendChild(image); });
}

export function patchBlocklySprites() {
  document.querySelectorAll('image').forEach(function (image) {
    var href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    if (href.indexOf('sprites.png') >= 0) {
      image.setAttribute('href', SPRITE_DATA_URI);
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', SPRITE_DATA_URI);
    }
  });

  shrinkTrashcan();

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
