// 菜单栏：文件（F）、查看（V）、运行（R）、帮助（H）下拉菜单与快捷键。
// 下拉打开/关闭只维护 hidden 与 aria-expanded，不引入第三方组件。

import { newProject, openProject, saveProjectPrompt } from '../project/index.js';
import { showLog, toggleLog } from './layout.js';
import { openSettings } from './settings.js';
import { runCode, stopCode } from '../connection/index.js';

function closeMenus() {
  document.querySelectorAll('.menu-root').forEach(function (root) {
    root.classList.remove('open');
    var button = root.querySelector('.menu-btn');
    var list = root.querySelector('.menu-list');
    if (button) button.setAttribute('aria-expanded', 'false');
    if (list) list.hidden = true;
  });
}

function runAction(action) {
  if (action === 'new') newProject();
  else if (action === 'open') openProject();
  else if (action === 'save') saveProjectPrompt();
  else if (action === 'log') toggleLog();
  else if (action === 'settings') openSettings();
  else if (action === 'run') {
    showLog();
    runCode();
  } else if (action === 'stop') stopCode();
  else if (action === 'about') openAbout();
}

function bindMenus() {
  document.querySelectorAll('.menu-root').forEach(function (root) {
    var button = root.querySelector('.menu-btn');
    var list = root.querySelector('.menu-list');
    if (!button || !list) return;

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var wasOpen = !list.hidden;
      closeMenus();
      if (wasOpen) return;
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      root.classList.add('open');
    });

    list.addEventListener('click', function (event) {
      var item = event.target.closest('.menu-item');
      if (!item) return;
      closeMenus();
      runAction(item.dataset.action);
    });
  });

  document.addEventListener('mousedown', function (event) {
    if (!event.target.closest('.menu-root')) closeMenus();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenus();
    if (!(event.ctrlKey || event.metaKey)) return;
    var key = event.key.toLowerCase();
    if (key === 'n') {
      event.preventDefault();
      newProject();
    } else if (key === 'o') {
      event.preventDefault();
      openProject();
    } else if (key === 's') {
      event.preventDefault();
      saveProjectPrompt();
    }
  });
}

function openAbout() {
  var mask = document.getElementById('aboutMask');
  if (mask) mask.hidden = false;
}

function closeAbout() {
  var mask = document.getElementById('aboutMask');
  if (mask) mask.hidden = true;
}

function bindAbout() {
  var mask = document.getElementById('aboutMask');
  if (!mask) return;
  ['aboutClose', 'aboutOk'].forEach(function (id) {
    var button = document.getElementById(id);
    if (button) button.addEventListener('click', closeAbout);
  });
  mask.addEventListener('click', function (event) {
    if (event.target === mask) closeAbout();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !mask.hidden) closeAbout();
  });
}

export function bindMenu() {
  bindMenus();
  bindAbout();
}
