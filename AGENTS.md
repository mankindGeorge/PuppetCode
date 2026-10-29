# AGENTS.md

光影智编（PuppetCode）：4 路舵机皮影机器人图形化编程工具。前端用 Blockly 拖拽生成 MicroPython 代码，通过 USB 串口或 WiFi WebSocket 下发到 ESP32，由设备端 `exec()` 一次性执行。

三层组成：

- 前端界面（`src/` + `index.html`，原生 ES 模块，无框架）
- Electron 桌面壳（`build/electron/`）
- ESP32 固件（`main.py`，标准 MicroPython，无第三方库）

协议与扩展说明以 [api-doc.md](api-doc.md) 为准；本文件只记录开发时需要知道的结构与约定。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | Vite 开发服务器，源码分文件调试 |
| `npm run build` | 构建单文件 `dist-single/index.html`（Electron 打包用，也可直接双击打开） |
| `npm run build:web` | 构建多文件静态站点 `dist-web/` |
| `powershell -ExecutionPolicy Bypass -File build\build-desktop.ps1` | 完整性构建桌面版，输出 `dist\PuppetCode-win32-x64\PuppetCode.exe` |

项目没有测试、Lint 与类型检查配置。改动后至少执行 `npm run build` 确认构建通过，并在浏览器/Electron 中手工验证积木、代码生成与连接流程。

## 目录结构

```text
src/
  main.js             应用入口：装配样式与各模块
  config.js           存储键、协议版本、模式名称、默认参数
  state.js            settings / conn / runtime 共享状态
  blocks/             definitions.js 自定义积木、toolbox.js 工具箱、theme.js 主题
  codegen/            python.js 生成器映射、preview.js 代码生成与预览刷新
  workspace/          index.js 工作区注入、toolboxPanel.js 左侧分类按钮、sprites.js + sprite-data.js 内联补丁
  transport/          base.js 抽象、serial.js 串口、websocket.js WiFi、index.js 工厂
  protocol/           messages.js 设备报文分发（ready/ack/log/done/error）
  connection/         index.js 连接/运行/停止控制、probe.js 就绪握手探测、
                      watchdog.js 运行/停止回执超时兜底
  ui/                 log.js 日志、status.js 状态与按钮、settings.js 设置弹窗、modal.js 模态栈、
                      toolbar.js 顶部栏、layout.js 分栏拖拽、codeZoom.js 代码字号缩放、menu.js 顶部菜单
  project/            index.js 新建/打开/保存/退出提示（桌面写「文档\PuppetCode」，浏览器下载 .xml）
  assets/             页面装饰图（decor/）与工具箱分类图标（toolbox/*.svg，按 ?raw 内联）
  styles/             按区域拆分的 CSS，responsive.css 为窄屏适配
  vendor/             Blockly 11.2.2 UMD 产物；index.js 统一导出 window.Blockly
build/
  electron/           主进程 main.js、preload.js 上下文桥、图标、package.json
  build-desktop.ps1   前端构建 → 同步单文件 → electron-packager
index.html            前端页面骨架（开发与多文件构建入口）
main.py               ESP32 MicroPython 固件
api-doc.md            接口协议、积木映射、扩展步骤、已知限制
```

`build/electron/index.html` 由脚本从 `dist-single/index.html` 复制而来，**不要手工编辑**。`dist/`、`dist-single/`、`dist-web/` 均为构建产物。

## 工程文件与桌面桥

- 工程为 Blockly XML（`.xml`），新建 / 打开 / 保存 / 退出提示集中在 `src/project/index.js`。
- 打开工程必须先严格校验（parsererror、根节点、积木类型、离屏工作区试载），通过后才清空画布；加载失败回滚到导入前快照，失败路径不得清空撤销栈。`Blockly.utils.xml.textToDom` 解析失败会退化为 HTML 解析，不能用来判断文件是否合法。
- 桌面版经 `preload.js` 暴露的 `window.PuppetCodeBridge`（`nextFileName / saveProject / onCloseRequest / closeConfirmed`）落盘，统一写入「文档\PuppetCode」；主进程拒绝覆盖同名文件。
- 无 `PuppetCodeBridge` 时（浏览器 / 开发服务器）退化为下载文件 + `beforeunload` 提示，编号存于 `localStorage` 的 `puppetcode.savedSeq`。
- 退出流程：主进程拦截 `close` → 发 `app:request-close` → 页面弹保存框 → 保存或放弃后调 `app:close-confirmed` 才真正关闭。改动此处需同时改 `project/index.js`、`preload.js`、`electron/main.js`。
- `main.js` 依据 `window.PuppetCodeBridge` 给 `body` 加 `is-desktop`（无系统标题栏布局），不要改成按 User-Agent 判断。

## 数据流

1. 积木变更 → `workspace/index.js` 监听 → `codegen/preview.js` 生成并刷新右侧预览。
2. 点击运行 → `connection/index.js` 取代码，发送 `{type:'run', id, code}`。
3. `transport/*` 负责封装：串口为按行分隔的 NDJSON，WebSocket 为单帧 JSON。
4. 设备端 `main.py` 在独立线程 `exec` 代码，回传 `ack` / `log` / `done` / `error`。
5. `protocol/messages.js` 分发到日志区并同步 `conn.running` 与按钮状态。

积木到函数映射：

| 积木 | 生成代码 | 固件实现 |
| --- | --- | --- |
| `puppet_servo_set` | `servo_set(id, angle)` | `servo_set()`，角度裁剪到 0–180 |
| `puppet_delay` | `puppet_delay(seconds)` | 20ms 分片睡眠，可被停止中断 |
| `puppet_action_bow/wave/nod` | `action_bow()` 等 | 空函数，仅保留 TODO |

## 硬性约定

- 硬件边界固定为 4 路舵机，不新增其他传感器、电机、外设。
- 固件只依赖 MicroPython 内置模块；前端不引入第三方 Blockly for MicroPython 仓库，复用官方 `Blockly.Python` 生成器。
- 三种通信模式共用同一套 JSON 报文与上层逻辑，差异只在 `transport/` 实现。
- 报文扩展遵循“只增不改”：未知字段忽略，未知 `type` 静默忽略，不得因此断连。
- 组合动作积木必须保持可见并标注「开发中」，生成空函数调用，函数体保留 TODO。
- 前端默认参数（`src/config.js` 的 `DEFAULTS`）与固件顶部常量（`main.py` 配置区）必须保持一致；同时同步 `index.html` 中设置表单的默认值与 `ui/settings.js` 的读取逻辑。
- USB 串口依赖 Web Serial，仅 Chromium 可用。桌面版必须用 Electron（WebView2 不支持 Web Serial），串口选择由主进程 `select-serial-port` 接管。
- 桌面版交付需分发整个 `PuppetCode-win32-x64` 文件夹，单独拷贝 exe 无法运行。

## 修改指引

**新增积木**

1. 在 `src/blocks/definitions.js` 中用 Blockly JSON 定义积木。
2. 在 `src/codegen/python.js` 的 `Blockly.Python.forBlock` 中补齐生成逻辑。
3. 在 `src/blocks/toolbox.js` 对应分类加入积木；如需固件函数，在 `main.py` 实现并注入 `_executor` 的 `env`。
4. 新增分类时，在 `src/workspace/toolboxPanel.js` 的 `CATEGORY_ICONS` 按分类名补图标（左侧按钮由该文件按工具箱顺序生成）。

**新增组合动作**：沿用 `puppet_action_*` 命名与 `action_*()` 函数签名，同步更新生成器映射、工具箱、`main.py` 的函数与 `env`。

**新增通信方式**：继承 `src/transport/base.js` 的 `Transport`，实现 `connect / send / disconnect` 并触发 `emitStatus / emitMessage`，然后在 `src/transport/index.js` 注册，设置面板与 `state.js` 增加对应参数。

## 常见陷阱

- `src/vendor/blockly/*.js` 是官方 UMD 产物，文件顶部有 ES 模块垫片（`var define, module, exports;`）。缺少垫片时 Vite 构建会误走 CommonJS 分支，导致 `window.Blockly` 为空。
- 单文件构建需保留 sprites 内联补丁（`workspace/sprites.js`），否则菜单复选框、垃圾桶图标会请求外部 `sprites.png`。
- 用户代码中裸 `except Exception` 会吞掉停止用的 `_StopRequested`，只能等待 `STOP_TIMEOUT_MS`（3 秒）后软复位；软件复位后设备不会回 `done`，运行按钮由 `watchdog.js` 在停止后 8 秒兜底恢复。
- WiFi WebSocket 为单客户端，异常断开可能残留死连接；同时仅成功连接时才会回 `ready`，前端 `probe.js` 只做超时提示。
- 运行 / 停止回执由 `connection/watchdog.js` 兜底：运行后 10 秒无 `ack started`、停止后 8 秒无 `done` 会自动恢复按钮并提示。固件对超限报文（串口单行 256 KB / WebSocket 单条 512 KB）回传 `error`，不再静默丢弃；修改这两个上限需同步 `main.py` 顶部常量与 `api-doc.md`。
- 串口非 JSON 行会作为「设备日志」展示，设备启动打印内容同理，属于预期行为。
- Electron 主进程启用 `contextIsolation` + `sandbox`，不要为图方便关闭；页面禁止自行打开新窗口。
- 左侧分类按钮由 `workspace/toolboxPanel.js` 自绘，图标按分类名映射 `CATEGORY_ICONS`；分类改名或调整顺序时需同步，否则按钮只剩文字。
- Ctrl/⌘ + 滚轮有两处自定义行为：画布缩放会清空 Blockly 工具箱选中项，`workspace/index.js` 在捕获阶段做了恢复；代码区调整字号（`ui/codeZoom.js`，`passive: false` 阻止页面整体缩放）。
- 桌面版保存同名文件直接报错、不覆盖；浏览器每次保存都下载新文件且序号 +1，属预期差异。
- 新增图片放 `src/assets/`，CSS 用相对 `url()` 引用；单文件构建按 `vite.config.js` 的 `assetsInlineLimit`（1MB）内联，过大图片会破坏单文件离线分发。
- 设置存于 `localStorage` 键 `puppetcode-settings-v1`；修改结构时考虑旧数据兼容。
- 布局尺寸存于 `localStorage` 键 `puppetcode-layout-v1`（`src/ui/layout.js`）。拖动分类栏手柄前会收起 Blockly 弹出面板，避免面板重排后尺寸错乱；如需恢复默认宽度，双击手柄即可。
- 运行日志高度可上下拖动，`×` 或顶部「日志」按钮收起；点「运行」时 `showLog()` 会自动展开。日志收起状态不持久化，刷新后恢复显示。
- 应用图标：`build/electron/icon.ico` 存在时打包自动使用，不存在则用 Electron 默认图标；图标生成脚本已移除，后续直接替换该文件即可。

## 已知限制

见 [api-doc.md](api-doc.md) 第 10 节：Web Serial 浏览器限制、纯计算死循环需软复位、WiFi 单客户端、无云端/账号/多设备管理、舵机需独立供电。
