// 通信设置弹窗：读取/保存表单、模式切换面板、打开与关闭。
import { settings, saveSettings } from '../state.js';

export function readSettingsUI() {
  settings.baudRate = parseInt(document.getElementById('baudRate').value, 10) || 115200;
  settings.staIp = document.getElementById('staIp').value.trim();
  settings.staPort = parseInt(document.getElementById('staPort').value, 10) || 8080;
  settings.staSsid = document.getElementById('staSsid').value.trim();
  settings.staPassword = document.getElementById('staPassword').value;
  settings.apIp = document.getElementById('apIp').value.trim();
  settings.apPort = parseInt(document.getElementById('apPort').value, 10) || 8080;
  settings.apSsid = document.getElementById('apSsid').value.trim();
  settings.apPassword = document.getElementById('apPassword').value;
}

export function syncSettingsUI() {
  document.getElementById('baudRate').value = String(settings.baudRate);
  document.getElementById('staIp').value = settings.staIp;
  document.getElementById('staPort').value = String(settings.staPort);
  document.getElementById('staSsid').value = settings.staSsid;
  document.getElementById('staPassword').value = settings.staPassword;
  document.getElementById('apIp').value = settings.apIp;
  document.getElementById('apPort').value = String(settings.apPort);
  document.getElementById('apSsid').value = settings.apSsid;
  document.getElementById('apPassword').value = settings.apPassword;

  document.querySelectorAll('#modeTabs button').forEach(function (button) {
    var active = button.getAttribute('data-mode') === settings.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  document.querySelectorAll('.mode-pane').forEach(function (pane) {
    pane.hidden = pane.getAttribute('data-pane') !== settings.mode;
  });

  var serialHint = document.getElementById('serialHint');
  if (!('serial' in navigator)) {
    serialHint.classList.add('warn');
    serialHint.textContent = '这个浏览器不能直接连接 USB，请用 Chrome / Edge 打开，或改用 WiFi 模式。';
  } else {
    serialHint.classList.remove('warn');
    serialHint.textContent = '点「连接」后，浏览器会让你选择串口。机器人会重启一次，等两秒就好。';
  }
}

export function openSettings() {
  syncSettingsUI();
  document.getElementById('settingsMask').hidden = false;
  // 弹窗打开时让编辑区彻底失活，避免点击或键盘操作穿透到 Blockly
  document.querySelector('.app').inert = true;
  document.getElementById('settingsClose').focus();
}

export function closeSettings() {
  readSettingsUI();
  saveSettings();
  document.getElementById('settingsMask').hidden = true;
  document.querySelector('.app').inert = false;
}

// 弹窗自身的事件：关闭按钮、遮罩点击、Esc、输入变更自动保存。
export function bindSettingsPanel() {
  document.getElementById('settingsClose').addEventListener('click', closeSettings);

  document.getElementById('settingsMask').addEventListener('click', function (event) {
    if (event.target === this) closeSettings();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !document.getElementById('settingsMask').hidden) {
      closeSettings();
    }
  });

  document.querySelectorAll('.modal-body input, .modal-body select').forEach(function (input) {
    input.addEventListener('change', function () {
      readSettingsUI();
      saveSettings();
    });
  });
}
