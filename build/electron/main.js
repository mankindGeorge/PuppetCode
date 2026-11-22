// 光影智编（PuppetCode）· 图形化编程工具 —— Electron 桌面应用主进程
//
// 将单文件前端 index.html 装入独立桌面窗口，不再依赖浏览器标签页。
// 关键点：Web Serial（USB 串口模式）在 Electron 中需要由主进程接管端口选择，
// 见下方 select-serial-port / 权限处理器；WebSocket 两种 WiFi 模式无需额外处理。
//
// 打包（Windows x64）：运行 build\build-desktop.ps1，等价于：
//   cd build\electron
//   $env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'   # 网络受限时使用镜像
//   node_modules\.bin\electron-packager.cmd . PuppetCode --platform=win32 --arch=x64 ^
//       --out=..\..\dist --overwrite --asar --ignore=node_modules

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, session, ipcMain } = require('electron');

let mainWindow = null;
// 页面在「保存 / 不保存」里给出答复后置为 true，此时才真正允许窗口关闭。
let allowClose = false;

// 积木工程统一存到「文档\PuppetCode」，避免用户找不着文件。
function projectDir() {
  const dir = path.join(app.getPath('documents'), 'PuppetCode');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function nextProjectName() {
  const dir = projectDir();
  const used = new Set(fs.readdirSync(dir).map((name) => name.toLowerCase()));
  for (let index = 1; index < 10000; index += 1) {
    const candidate = 'puppetcode' + String(index).padStart(2, '0') + '.xml';
    if (!used.has(candidate)) return { name: candidate, folder: dir };
  }
  return { name: 'puppetcode.xml', folder: dir };
}

function safeFileName(raw) {
  const base = path.basename(String(raw || '').trim()).replace(/[\\/:*?"<>|]/g, '');
  if (!base) return '';
  return /\.xml$/i.test(base) ? base : base.replace(/\.(py|txt|json)$/i, '') + '.xml';
}

ipcMain.handle('project:next-name', () => nextProjectName());

ipcMain.handle('project:save', (event, payload) => {
  try {
    const name = safeFileName(payload && payload.name);
    if (!name) return { ok: false, error: '文件名无效' };
    const target = path.join(projectDir(), name);
    if (fs.existsSync(target)) return { ok: false, error: '同名文件已存在，请换个名字' };
    fs.writeFileSync(target, String((payload && payload.content) || ''), 'utf8');
    return { ok: true, path: target };
  } catch (error) {
    return { ok: false, error: error.message || '写入失败' };
  }
});

ipcMain.on('app:close-confirmed', () => {
  allowClose = true;
  if (mainWindow) mainWindow.close();
});

function installSerialSupport(targetSession) {
  // 允许页面使用 Web Serial、Web Bluetooth 与剪贴板写入（代码预览区「复制代码」）
  targetSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'serial' || permission === 'bluetooth' || permission === 'clipboard-sanitized-write';
  });

  targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'serial' || permission === 'bluetooth' || permission === 'clipboard-sanitized-write');
  });

  targetSession.setDevicePermissionHandler((details) => {
    return details.deviceType === 'serial' || details.deviceType === 'bluetooth';
  });

  // 页面调用 navigator.serial.requestPort() 时触发；由本进程决定用哪个端口
  targetSession.on('select-serial-port', async (event, portList, webContents, callback) => {
    event.preventDefault();

    if (!portList || portList.length === 0) {
      callback('');
      return;
    }

    let selected = portList[0];

    if (portList.length > 1) {
      const labels = portList.map((port) => {
        return port.displayName || port.portName || port.portId;
      });

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: '选择串口',
        message: '检测到多个串口，请选择要连接的 ESP32：',
        buttons: labels.concat(['取消']),
        defaultId: 0,
        cancelId: labels.length,
        noLink: true
      });

      if (result.response >= labels.length) {
        callback('');
        return;
      }
      selected = portList[result.response];
    }

    callback(selected.portId);
  });
}

// Web Bluetooth 的设备选择由主进程接管，页面只负责 requestDevice。
function installBluetoothSupport(webContents) {
  webContents.on('select-bluetooth-device', async (event, deviceList, callback) => {
    event.preventDefault();

    if (!deviceList || deviceList.length === 0) {
      callback('');
      return;
    }

    let selected = deviceList[0];

    if (deviceList.length > 1) {
      const labels = deviceList.map((device) => {
        return device.deviceName || device.deviceId;
      });

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: '选择蓝牙设备',
        message: '检测到多个蓝牙设备，请选择 PuppetCode 机器人：',
        buttons: labels.concat(['取消']),
        defaultId: 0,
        cancelId: labels.length,
        noLink: true
      });

      if (result.response >= labels.length) {
        callback('');
        return;
      }
      selected = deviceList[result.response];
    }

    callback(selected.deviceId);
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.ico');
  const isWindows = process.platform === 'win32';

  // 每个新窗口都要重新走一次退出确认
  allowClose = false;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: '光影智编 · 图形化编程工具',
    backgroundColor: '#EAF5FF',
    autoHideMenuBar: true,
    // 桌面版隐藏系统标题栏（应用图标 + 标题），只保留右上角的原生
    // 最小化 / 最大化 / 关闭按钮，使品牌、菜单与窗口按钮处于同一行。
    // 按钮区颜色取菜单栏渐变末端色并同步高度，避免右侧出现白底接缝。
    ...(isWindows ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#45C5F5',
        symbolColor: '#FFFFFF',
        height: 52
      }
    } : {}),
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 关窗前先问页面要不要保存积木；页面答复（保存或放弃）后再真正关闭。
  mainWindow.on('close', (event) => {
    if (allowClose) return;
    if (!mainWindow || mainWindow.webContents.isLoading() || mainWindow.webContents.isCrashed()) {
      allowClose = true;
      return;
    }
    event.preventDefault();
    mainWindow.webContents.send('app:request-close');
  });

  // 单文件前端不使用弹窗，禁止页面自行打开新窗口
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Web Bluetooth：由主进程选择 BLE 设备
  installBluetoothSupport(mainWindow.webContents);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 保留最小编辑菜单：Windows 上若完全移除菜单，Ctrl+C / Ctrl+V 等快捷键会失效。
// 菜单栏默认隐藏（autoHideMenuBar），按 Alt 才出现。
function installMenu() {
  const template = [{
    label: '编辑',
    submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' }
    ]
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    installMenu();
    installSerialSupport(session.defaultSession);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
