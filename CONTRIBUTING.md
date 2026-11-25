# 开发约定

本文档记录当前有效的目录、关键变量、数据流和开发准则。过期功能不要保留；协议细节以 [api-doc.md](api-doc.md) 为准。

## 项目约定

- 不预设硬件种类；新增外设按「积木 → Python 生成器 → 固件执行环境」三层扩展点接入，通信协议与桌面壳保持不变。当前固件内置舵机控制作为首批能力。
- 固件只使用 MicroPython 内置模块；前端使用官方 Blockly 11.2.2，不引入第三方 Blockly for MicroPython。
- USB 串口、WiFi AP、蓝牙 BLE 共用同一套 JSON 报文与上层逻辑，差异只在 `src/transport/`。固件在 `WIFI_AP` 模式下同时开启 AP 与 BLE。
- 组合动作积木保持可见并标注「开发中」，生成空函数调用。
- 前端默认参数（`src/config.js`）、固件常量（`main.py`）和设置表单默认值必须一致。

## 目录结构

```text
src/
  main.js             应用入口，装配样式与模块
  config.js           存储键、协议版本、模式名、默认参数
  state.js            settings / conn / runtime 共享状态
  blocks/             definitions.js 积木定义、toolbox.js 工具箱、theme.js 主题
  codegen/            python.js 生成器、preview.js 代码预览
  workspace/          index.js 工作区；stage.js 首屏引导与示例
                      canvasTools.js 撤销/重做/缩放/看全图
                      toolboxPanel.js 分类按钮与图标；sprites.js 内联补丁与垃圾桶缩放
  transport/          base.js 抽象、serial.js 串口、websocket.js WiFi、ble.js 蓝牙、index.js 工厂
  protocol/           messages.js 设备报文分发
  connection/         index.js 连接/运行/停止；probe.js 握手；watchdog.js 回执兜底
  ui/                 toolbar.js 标题栏按钮、log.js 消息条、status.js 状态
                      settings.js 设置、modal.js 模态栈、layout.js 布局
                      codeZoom.js 代码字号、menu.js 顶部菜单
  project/            index.js 新建/打开/保存/退出提示
  assets/             装饰图 decor/、分类图标 toolbox/*.svg
  styles/             分区 CSS，responsive.css 为窄屏适配
  vendor/             Blockly 11.2.2 UMD 产物
build/
  electron/           主进程、preload 桥、图标、Electron package.json
  build-desktop.ps1   前端构建 → 同步单文件 → electron-packager
index.html            页面骨架
main.py               ESP32 MicroPython 固件
api-doc.md            完整协议、积木映射、扩展步骤、已知限制
README.md             用户入口：介绍、下载、协议概览、Fork/PR
```

`build/electron/index.html` 由打包脚本生成，`dist/`、`dist-single/`、`dist-web/` 都是构建产物，不提交。

## 关键变量与存储

前端：

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `PROTOCOL_VERSION` | `src/config.js` | 协议版本，当前 `1.0` |
| `DEFAULTS` | `src/config.js` | 串口 115200、WS 8080、AP `192.168.4.1:8080` 等默认参数 |
| `STORAGE_KEY` | `src/config.js` | 设置存储键 `puppetcode-settings-v1` |
| `settings` | `src/state.js` | 持久化设置，修改结构时兼容旧数据 |
| `conn` | `src/state.js` | `transport / mode / connecting / connected / deviceReady / running` |
| `runtime` | `src/state.js` | `workspace / lastGenerated / currentExecId` |
| 布局 | `localStorage` | `puppetcode-layout-v1`；`LAYOUT_VERSION = 2`，保存代码区宽度与日志高度；代码/日志收起状态不持久化 |
| 浏览器保存序号 | `localStorage` | `puppetcode.savedSeq` |

固件（`main.py` 顶部配置区）：

| 常量 | 默认值 |
| --- | --- |
| `COMM_MODE` | `"WIFI_AP"`（AP + BLE 同时开启） |
| `AP_SSID` / `AP_PASSWORD` | `puppet` / `12345678` |
| `AP_IP` / `WS_PORT` | `192.168.4.1` / `8080` |
| `BLE_ENABLED` / `BLE_NAME` | `True` / `puppet` |
| `BLE_SERVICE_UUID` / `BLE_RX_UUID` / `BLE_TX_UUID` | NUS 风格 128 位 UUID，见 `main.py` / api-doc |
| `PROTOCOL_VERSION` | `"1.0"` |
| `SERVO_PINS` | `(2, 4, 13, 14)` |
| `STOP_TIMEOUT_MS` | `3000`（仅串口模式） |
| `MAX_SERIAL_LINE_BYTES` | 256 KB |
| `MAX_WS_MESSAGE_BYTES` | 512 KB |
| `MAX_LOG_BUFFER_CHARS` | 4096（串口模式日志残留上限） |

修改默认值时要同步 `src/config.js`、`main.py`、`index.html` 设置表单和 README 中的对应说明。

`COMM_MODE` 仅保留 `SERIAL` / `WIFI_AP`；`WIFI_AP` 模式会同时启动 AP 与 BLE。Electron 主进程负责 `select-bluetooth-device`。

WiFi AP 模式在 WebSocket 主线程同步执行代码，执行期间不会读取 `stop`，停止按钮由前端看门狗兜底恢复；BLE 在独立 worker 中执行，`stop` 可由 BLE IRQ 置标志中断；串口模式仍使用执行线程，支持协作停止与 3 秒超时软复位。

## 数据流

1. 积木变更 → `workspace/index.js` 监听 → `codegen/preview.js` 生成右侧代码。
2. 点击 `#runStopBtn` → `ui/toolbar.js` 判断 `conn.running`：空闲时发送 `run`，运行中发送 `stop`；`#quickSaveBtn` 打开现有保存弹窗。
3. `transport/*` 发送：串口为按行 NDJSON，WiFi 为单帧 JSON，BLE 为 JSON+换行并按 20 字节分片。
4. ESP32 `main.py` 执行代码：WiFi AP 在 WebSocket 主线程同步 `exec`，BLE 在 BLE worker 同步 `exec`，串口在执行线程 `exec`；回传 `ack / log / done / error`。
5. `protocol/messages.js` 分发报文，更新日志、`conn.running` 和按钮状态；`ui/log.js` 同步消息条摘要。

积木映射：

| 积木 | 生成代码 | 固件 |
| --- | --- | --- |
| `puppet_servo_set` | `servo_set(id, angle)` | 角度裁剪到 0–180 |
| `puppet_delay` | `puppet_delay(seconds)` | 20ms 分片睡眠；串口/BLE 可被停止中断，WiFi AP 同步执行期间不处理 stop |
| `puppet_action_bow/wave/nod` | `action_bow()` 等 | 空函数，保留 TODO |

## 通信协议

- UTF-8 JSON；串口 NDJSON，WiFi WebSocket 单帧，BLE JSON+换行分片；协议版本 1.0。
- 消息：`hello`、`ready`、`run`、`stop`、`ack`、`log`、`done`、`error`。
- 只增不改：未知字段和未知类型忽略，不得断连。
- 串口单行 256 KB、WS 单条 512 KB；超限回传 `error`。
- 改协议同步更新前端、`main.py` 和 [api-doc.md](api-doc.md)。

## 界面约定

- 首屏空画布显示 `#stageEmpty` 三步引导与示例；出现第一块积木后隐藏。卡片本身不挡拖拽，仅示例按钮可点。
- 代码预览默认收起为右侧 46px 导轨：静态只显示代码图标，鼠标悬浮或键盘聚焦时显示竖排「代码预览」与 `Python`，整条导轨可点击展开。展开/收起是固定宽度内容层 + 网格列宽过渡，代码内容不重排，别改成外部「看代码」按钮或整块快照动画；窄屏使用 48px 横向信息条，文字常驻。
- 代码区切换由 `src/ui/layout.js` 的 `CODE_EXPAND_MS`（240ms）和 `CODE_COLLAPSE_MS`（200ms）控制；`code-animating` 只在切换期间存在，拖动分隔条时不得启用宽度过渡。
- 日志保持「机器人消息」信息条：`#logToggleBtn`、浅色标题栏、默认收起，运行或 `error` 自动展开。
- 运行/停止使用 `#runStopBtn` 单按钮；保存使用 `#quickSaveBtn`，打开现有保存弹窗。
- 画布工具 `.canvas-tools` 在右上角；空画布引导显示时隐藏。看全图最多放大到 1 倍。
- 日志与代码区的收起状态不持久化，刷新后恢复默认收起。

## 构建与验证

```bash
npm install
npm run dev
npm run build       # 单文件 dist-single/index.html
npm run build:web   # 多文件站点 dist-web/
```

桌面版：

```powershell
powershell -ExecutionPolicy Bypass -File build/build-desktop.ps1
```

- 项目暂无自动化测试、Lint 和类型检查；改动后至少 `npm run build`，并手工验证积木、代码、连接、运行和停止。
- 桌面交付必须保留整个 `PuppetCode-win32-x64` 文件夹；不要提交 `dist/`、`node_modules/`、`build/electron/index.html`。
- 布局改动至少检查 1440、1024、505 宽窗口。

## 提交与 PR

1. 从 `main` 新建分支，保持一个 PR 只解决一类问题。
2. 修改后同步相关文档，删除过期说明，只保留当前有效信息。
3. PR 描述写清改动、验证方式、是否涉及协议/固件/桌面桥；界面改动附截图。
4. 不提交凭据、构建产物或本地配置。
