// 通信设置弹窗：读取/保存表单、模式切换面板、打开与关闭。
import { settings, saveSettings } from '../state.js';
import { DEFAULTS } from '../config.js';
import { openModal, closeModal } from './modal.js';

// 端口必须在 1-65535 内，非法输入回退默认值，避免把无效端口静默存进设置。
function readPort(id, fallback) {
  var port = parseInt(document.getElementById(id).value, 10);
  return isFinite(port) && port >= 1 && port <= 65535 ? port : fallback;
}

export function readSettingsUI() {
  settings.baudRate = parseInt(document.getElementById('baudRate').value, 10) || 115200;
  settings.apIp = document.getElementById('apIp').value.trim();
  settings.apPort = readPort('apPort', DEFAULTS.apPort);
  settings.apSsid = document.getElementById('apSsid').value.trim();
  settings.apPassword = document.getElementById('apPassword').value;
}

export function syncSettingsUI() {
  document.getElementById('baudRate').value = String(settings.baudRate);
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
    serialHint.textContent = '这个浏览器不能直接连接 USB，请用 Chrome / Edge 打开，或改用 WiFi / 蓝牙模式。';
  } else {
    serialHint.classList.remove('warn');
    serialHint.textContent = '点「连接」后，浏览器会让你选择串口。机器人会重启一次，等两秒就好。';
  }

  var bleHint = document.getElementById('bleHint');
  if (bleHint) {
    if (!('bluetooth' in navigator)) {
      bleHint.classList.add('warn');
      bleHint.textContent = '当前浏览器不支持蓝牙，请用 Chrome / Edge 桌面或 Android Chrome；iOS 不支持 Web Bluetooth。';
    } else {
      bleHint.classList.remove('warn');
      bleHint.textContent = '点「连接」后，浏览器会弹出蓝牙设备选择；请选择设备 puppet。首次使用可能需要系统蓝牙权限。';
    }
  }
}

export function openSettings() {
  syncSettingsUI();
  // 统一模态管理负责背景失活、Esc 与焦点，详情见 ui/modal.js
  openModal(document.getElementById('settingsMask'), {
    onClose: closeSettings,
    initialFocus: document.getElementById('settingsClose')
  });
}

export function closeSettings() {
  readSettingsUI();
  saveSettings();
  closeModal(document.getElementById('settingsMask'));
}

// 弹窗自身的事件：关闭按钮、遮罩点击、输入变更自动保存。Esc 由模态管理统一处理。
export function bindSettingsPanel() {
  document.getElementById('settingsClose').addEventListener('click', closeSettings);

  document.getElementById('settingsMask').addEventListener('click', function (event) {
    if (event.target === this) closeSettings();
  });

  document.querySelectorAll('.modal-body input, .modal-body select').forEach(function (input) {
    input.addEventListener('change', function () {
      readSettingsUI();
      saveSettings();
    });
  });
}
