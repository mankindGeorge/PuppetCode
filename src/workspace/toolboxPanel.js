// 左侧「积木」分类区：独立面板，按钮由工具箱 XML 生成。
// 点击按钮调用 Blockly 原生工具箱的 setSelectedItem，由 Blockly 打开 flyout；
// 积木拖出、连接匹配、吸附全部沿用官方逻辑，和原生分类栏行为一致。
import { Blockly } from '../vendor/index.js';
import { runtime } from '../state.js';
import { TOOLBOX_XML } from '../blocks/toolbox.js';
import ariesIcon from '../assets/toolbox/aries.svg?raw';
import taurusIcon from '../assets/toolbox/taurus.svg?raw';
import geminiIcon from '../assets/toolbox/gemini.svg?raw';
import cancerIcon from '../assets/toolbox/cancer.svg?raw';
import leoIcon from '../assets/toolbox/leo.svg?raw';
import virgoIcon from '../assets/toolbox/virgo.svg?raw';

// 分类图标：沿用上传的线条图标，按约定顺序对应六个分类
var CATEGORY_ICONS = {
  '基础控制': ariesIcon,
  '条件判断': taurusIcon,
  '数字运算': geminiIcon,
  '变量': cancerIcon,
  '舵机控制': leoIcon,
  '组合动作': virgoIcon
};

var entries = [];

function syncSelection(toolbox) {
  var selected = toolbox.getSelectedItem();
  entries.forEach(function (entry) {
    entry.button.setAttribute('aria-pressed', entry.item === selected ? 'true' : 'false');
  });
}

export function initToolboxPanel() {
  var list = document.getElementById('toolboxList');
  var workspace = runtime.workspace;
  if (!list || !workspace) return;

  var toolbox = workspace.getToolbox();
  if (!toolbox) return;

  var dom = Blockly.utils.xml.textToDom(TOOLBOX_XML);
  var categories = Array.prototype.slice.call(dom.getElementsByTagName('category'));
  var items = toolbox.getToolboxItems() || [];

  list.textContent = '';
  entries = [];

  categories.forEach(function (category, index) {
    var item = items[index];
    if (!item) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'toolbox-item';
    button.setAttribute('aria-pressed', 'false');

    var icon = document.createElement('span');
    icon.className = 'toolbox-item-icon';
    icon.setAttribute('aria-hidden', 'true');

    var categoryName = category.getAttribute('name') || '';
    var iconMarkup = CATEGORY_ICONS[categoryName];
    if (iconMarkup) {
      icon.innerHTML = iconMarkup
        .replace(/^<\?xml[^>]*\?>\s*/, '')
        .replace(/(stroke|fill)="#333"/g, '$1="currentColor"');
    }

    var label = document.createElement('span');
    label.className = 'toolbox-item-label';
    label.textContent = categoryName;

    button.appendChild(icon);
    button.appendChild(label);
    button.addEventListener('click', function () {
      if (toolbox.getSelectedItem() === item) {
        toolbox.clearSelection();
      } else {
        toolbox.setSelectedItem(item);
      }
      syncSelection(toolbox);
    });

    list.appendChild(button);
    entries.push({ item: item, button: button });
  });

  // 分类选中状态可能被 Blockly 内部清掉（缩放、点画布等），这里跟着同步按钮外观
  workspace.addChangeListener(function (event) {
    if (event && event.type === 'toolbox_item_select') syncSelection(toolbox);
  });

  syncSelection(toolbox);
}
