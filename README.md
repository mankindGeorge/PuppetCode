# 光影智编（PuppetCode）

面向儿童的 4 路舵机皮影机器人图形化编程工具。拖拽积木生成 MicroPython，通过 USB 串口或 WiFi 发送到 ESP32 执行。

当前为 **v1.0.1 预发布**；真实硬件路径尚未实机验证，组合动作积木仍在开发中。

## 下载桌面版

Windows 10 / 11（x64）：

- [下载 PuppetCode-v1.0.1-win32-x64.zip](https://github.com/mankindGeorge/PuppetCode/releases/download/v1.0.1/PuppetCode-v1.0.1-win32-x64.zip)
- [Release 页面](https://github.com/mankindGeorge/PuppetCode/releases/tag/v1.0.1)

解压后运行 `PuppetCode.exe`，不要单独拷贝 exe，需保留整个文件夹。桌面版未签名，SmartScreen 可能提示；SHA256 见 Release 说明。机器人端需烧录 `main.py`，并按实际接线修改 `SERVO_PINS` 与 `COMM_MODE`；默认 AP 热点为 `puppet`（密码 `12345678`，设备 IP `192.168.4.1`）。

## 通信协议

完整字段和时序见 [api-doc.md](api-doc.md)。

- USB 串口：NDJSON，一行一条 JSON，默认 115200；需 Chromium 系浏览器或 Electron
- WiFi STA / AP：WebSocket 单帧 JSON，默认端口 8080；WiFi 模式代码在主线程同步执行，执行期间不处理停止指令
- UTF-8 编码，协议版本 1.0
- 消息类型：`hello`、`ready`、`run`、`stop`、`ack`、`log`、`done`、`error`
- 报文只增不改；未知字段和未知类型忽略；串口单行 256 KB、WebSocket 单条 512 KB
- 固件：ESP32 MicroPython，4 路舵机默认 GPIO 2 / 4 / 13 / 14

## 从源码运行

需要 Node.js 20+（桌面打包依赖 glob 14 / minimatch 11）。

```bash
npm install
npm run dev
npm run build       # 单文件 dist-single/index.html
npm run build:web   # 多文件站点 dist-web/
```

Windows 桌面版：

```powershell
powershell -ExecutionPolicy Bypass -File build/build-desktop.ps1
```

## 参与贡献

1. Fork 后克隆并新建分支：

```bash
git clone https://github.com/<你的用户名>/PuppetCode.git
cd PuppetCode
git checkout -b feat/my-change
npm install
```

2. 修改后在浏览器或 Electron 中手工验证，至少运行 `npm run build`。

3. 提交并推送：

```bash
git add <改动的文件>
git commit -m "说明改动目的"
git push origin feat/my-change
```

4. 向 `mankindGeorge/PuppetCode` 的 `main` 分支发起 Pull Request，说明改了什么、如何验证。

约束：硬件边界固定为 4 路舵机；协议只增不改；不要提交 `dist/`、`node_modules/`、`build/electron/index.html`。开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文档

- [接口与扩展文档](api-doc.md)
- [开发约定](CONTRIBUTING.md)
- [Releases](https://github.com/mankindGeorge/PuppetCode/releases)
