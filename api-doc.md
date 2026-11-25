# 光影智编（PuppetCode）· 接口与扩展开发文档

- 文档版本：1.0
- 协议版本：1.0（`PROTOCOL_VERSION = "1.0"`）
- 适用固件：`main.py`（ESP32 / MicroPython 标准固件）
- 适用前端：`index.html`（单文件，内联 Blockly 11.2.2 官方 UMD 构建与中文语言包）

本工具面向 ESP32 外设控制的图形化编程场景：通信协议不绑定具体硬件，设备端执行前端下发的 MicroPython。当前固件内置舵机控制作为首批能力，新增外设按「积木 → Python 生成器 → 固件执行环境」扩展，不引入任何第三方依赖库。

---

## 1. 系统组成与通信架构

```
┌──────────────────────────────┐        JSON 报文         ┌──────────────────────────┐
│  index.html（浏览器）          │  ──────────────────────▶ │  ESP32 main.py            │
│  Blockly → MicroPython 代码   │                          │  exec() 执行 / 外设控制    │
│  Transport 抽象层             │  ◀────────────────────── │  servo_set / action_*      │
└──────────────────────────────┘        ack / log / done   └──────────────────────────┘
        │                                                              ▲
        ├── USB 串口（Web Serial，换行分隔 JSON）                       │
        ├── WiFi AP （WebSocket，ws://192.168.4.1:8080）                 │
        └── 蓝牙 BLE（Web Bluetooth GATT，JSON+换行分片）                 │
```

三种通信方式共用同一套上层逻辑；固件在 `WIFI_AP` 模式下**同时开启 WiFi AP 与 BLE**：

- 代码下发：`run`
- 停止执行：`stop`
- 日志回传：`log` / `ack` / `done` / `error`
- 设备就绪：`ready`

底层只在“如何收发一条 JSON”上不同，因此**后续原生移动端 APP 可以直接复用本协议**。

---

## 2. 通用协议规范

### 2.1 报文封装

| 通信方式 | 封装方式 | 编码 | 分隔 |
| --- | --- | --- | --- |
| USB 串口 | NDJSON：一条 JSON 占一行 | UTF-8 | `\n`（容忍 `\r\n`） |
| WiFi AP | WebSocket 文本帧，一帧一条 JSON | UTF-8 | 无需分隔符；多行文本也可按行解析 |
| 蓝牙 BLE | GATT 分片：JSON + `\n`，默认 20 字节/片 | UTF-8 | `\n`（接收端按行重组） |

约定：

1. 所有报文都是 **UTF-8 编码的 JSON 对象**，顶层必须是对象（`{}`）。
2. 报文字段采用**只增不改**的原则扩展，未知字段接收方应忽略。
3. 未知 `type` 的报文接收方应静默忽略，不得因此断开连接。
4. 串口原始输出中不是 JSON 的行，前端按“设备原始输出”展示，不影响协议解析。
5. 串口单行报文上限为 256 KB，设备 WebSocket 单条消息上限为 512 KB；超限报文整条丢弃，并回传 `error`（`id` 可为 `null`），不再静默丢弃。

### 2.2 消息类型总表

| type | 方向 | 用途 |
| --- | --- | --- |
| `hello` | 前端 → 设备 | 串口握手，请求设备上报 `ready` |
| `ready` | 设备 → 前端 | 设备就绪、报告通信模式与协议版本 |
| `run` | 前端 → 设备 | 下发完整 MicroPython 代码（一次性 `exec`） |
| `stop` | 前端 → 设备 | 请求停止当前执行 |
| `ack` | 设备 → 前端 | 分阶段确认：已接收 / 开始执行 / 正在停止 |
| `log` | 设备 → 前端 | 打印信息、运行日志、告警、错误 |
| `done` | 设备 → 前端 | 一次执行结束（成功 / 停止 / 异常） |
| `error` | 设备 → 前端 | 请求被拒绝等协议级错误 |

### 2.3 完整数据结构

#### 2.3.1 hello（前端 → 设备）

```json
{
  "type": "hello",
  "protocol": "1.0"
}
```

- 仅 USB 串口模式需要主动发送；WiFi AP / BLE 模式设备在连接建立后立即推送 `ready`。
- 前端在串口打开后约 1.2 秒发送第 1 次，随后每 1.5 秒重试，最多 3 次。

#### 2.3.2 ready（设备 → 前端）

```json
{
  "type": "ready",
  "mode": "SERIAL",
  "protocol": "1.0"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | string | `SERIAL` / `WIFI_AP`（`WIFI_AP` 同时开启 BLE） |
| `protocol` | string | 协议版本，当前为 `1.0` |

#### 2.3.3 run（前端 → 设备）

```json
{
  "type": "run",
  "id": "run-1726999999999",
  "code": "# 光影智编 · PuppetCode\nservo_set(1, 90)\npuppet_delay(1)\n"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 本次执行标识，前端生成；设备原样回传 |
| `code` | string | 是 | **完整**的 MicroPython 源码字符串 |

设备收到后：

1. 立即返回 `ack(stage=received)`；
2. 执行代码：WiFi AP 模式在 WebSocket 主线程同步调用一次 `exec(code, env)`，BLE 在 BLE worker 中同步执行，串口模式在执行线程调用；**不是逐行 / 逐指令执行**；
3. 返回 `ack(stage=started)`，随后输出 `log`，结束时返回 `done`。

#### 2.3.4 stop（前端 → 设备）

```json
{ "type": "stop" }
```

设备返回 `ack(stage=stopping)`；串口模式会中断执行并返回 `done`，BLE 模式由 IRQ 置停止标志，WiFi AP 模式需等当前代码执行结束后才处理 stop（见 5.3）。

#### 2.3.5 ack（设备 → 前端）

```json
{ "type": "ack", "stage": "received", "id": "run-1726999999999" }
{ "type": "ack", "stage": "started",  "id": "run-1726999999999" }
{ "type": "ack", "stage": "stopping" }
```

| stage | 含义 |
| --- | --- |
| `received` | 代码报文已接收，准备执行 |
| `started` | 设备开始执行代码 |
| `stopping` | 停止请求已接收，正在中断 |

#### 2.3.6 log（设备 → 前端）

```json
{
  "type": "log",
  "level": "print",
  "message": "hello from puppet"
}
```

| level | 含义 | 前端展示 |
| --- | --- | --- |
| `print` | 串口模式下用户代码 `print()` 的一行输出 | 紫色“打印”标签 |
| `info` | 设备内部状态（开始执行、已停止等） | “设备”标签 |
| `warn` | 告警（如停止超时、即将软复位） | “警告”标签 |
| `error` | 运行异常摘要 | “错误”标签 |

说明：错误摘要以 `error` 级别回传。串口模式下异常堆栈通过 `sys.print_exception()` 逐行以 `print` 级别回传；WiFi AP 与 BLE 模式不替换 stdout，堆栈只输出到 USB 串口，不进入无线日志。

#### 2.3.7 done（设备 → 前端）

```json
{ "type": "done", "id": "run-1726999999999", "ok": true, "reason": null }
{ "type": "done", "id": "run-1726999999999", "ok": false, "reason": "stopped" }
{ "type": "done", "id": "run-1726999999999", "ok": false, "reason": "error" }
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 对应 `run.id` |
| `ok` | boolean | 是否完整执行成功 |
| `reason` | string \| null | `null` / `stopped` / `error` |

#### 2.3.8 error（设备 → 前端）

```json
{
  "type": "error",
  "id": "run-1726999999999",
  "message": "已有代码正在执行，请先发送停止指令"
}
```

`id` 可能为 `null`（与具体执行无关的错误，例如协议级异常、超限报文被丢弃）。超限示例：

```json
{
  "type": "error",
  "message": "单条指令超过 256 KB 上限，已丢弃，请精简代码后重试"
}
```

前端收到 `error` 后会结束本次运行状态；若回执完全丢失，则由前端看门狗兜底（见 5.3）。

### 2.4 典型时序

#### 串口执行

```
前端                                  设备
 │  hello                              │
 │ ──────────────────────────────────▶ │
 │  ready                              │
 │ ◀────────────────────────────────── │
 │  run {id, code}                     │
 │ ──────────────────────────────────▶ │
 │  ack received                       │
 │ ◀────────────────────────────────── │
 │  ack started                        │
 │ ◀────────────────────────────────── │
 │  log(print, "打印内容")              │
 │ ◀────────────────────────────────── │
 │  done {ok:true}                     │
 │ ◀────────────────────────────────── │
```

#### 中途停止

```
前端                                  设备
 │  stop                               │
 │ ──────────────────────────────────▶ │
 │  ack stopping                       │
 │ ◀────────────────────────────────── │
 │  log(warn, "执行已停止")             │
 │ ◀────────────────────────────────── │
 │  done {ok:false, reason:"stopped"}  │
 │ ◀────────────────────────────────── │
```

---

## 3. USB 串口模式

### 3.1 连接流程

1. ESP32 烧录 `main.py` 后复位；串口通信需把 `COMM_MODE` 改为 `"SERIAL"`（固件默认是 `"WIFI_AP"`）。
2. 浏览器用 Chrome / Edge 打开 `index.html`（`file://` 或 `https://`）。
3. 打开「设置」→「USB 串口」，选择波特率（默认 `115200`，需与固件 REPL 一致）。
4. 点击「连接」，浏览器弹出串口选择框（Web Serial `navigator.serial.requestPort()`）。
5. 串口打开后，前端等待设备 `ready`；若未收到，则发送 `hello` 重试。
6. 收到 `ready` 后即可「运行」。

### 3.2 注意事项

- Web Serial 仅 Chrome / Edge 支持；不支持时前端会提示，可改用 WiFi AP / 蓝牙模式。
- 部分 ESP32 开发板在打开串口时会因 DTR/RTS 自动复位，因此前端不会在打开瞬间下发代码，而是等待约 1.2 秒并重试握手。
- 串口同时承载 REPL 与协议报文；设备启动阶段的非 JSON 文本会在前端日志中显示为“设备原始输出”。
- 串口与 WebSocket 的 JSON 结构完全一致，方便后续 APP 复用。

---

## 4. WiFi AP 与蓝牙 BLE

### 4.1 蓝牙 BLE（Web Bluetooth）

固件在 `WIFI_AP` 模式下同时启动 BLE，不单独提供 BLE-only 模式。

- 设备名：`puppet`
- 服务（NUS 风格）：`6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX（写入）：`6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX（通知）：`6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

前端使用 Web Bluetooth `requestDevice` → GATT 连接 → 获取 RX/TX 特征值；发送时把 `JSON + "\n"` 按默认 20 字节分片写入 RX，接收时订阅 TX 通知并按 `\n` 重组。默认 MTU 23（20 字节负载），协商更大 MTU 时固件按 `mtu-3` 分片。BLE 同一时间只服务一个中心设备。

Electron 主进程处理 `select-bluetooth-device` 并允许 `bluetooth` 权限。

BLE 与 WiFi AP 同时开启，共用同一套 JSON 报文；前端可任选一种连接。两个通道同时连接时，`_running` 保证同一时间只执行一段代码，建议只让一个通道发起运行。

### 4.2 WiFi AP（设备创建热点，同时开启 BLE）

固件配置：

```python
COMM_MODE = "WIFI_AP"
AP_SSID = "puppet"
AP_PASSWORD = "12345678"
AP_IP = "192.168.4.1"
WS_PORT = 8080
BLE_ENABLED = True
BLE_NAME = "puppet"
```

连接流程：

1. 复位设备，等待约 3 秒启动，开启热点 `puppet`（密码 `12345678`）与 BLE 设备 `puppet`。
2. 电脑连接该热点，或在前端选择「蓝牙」连接 BLE。
3. 前端「设置」→「WiFi AP」，设备 IP 默认 `192.168.4.1`、端口 `8080`。
4. 点击「连接」，建立 WebSocket 并等待 `ready`。

固件启动时会先等待 3 秒（便于 Thonny / 串口连接），AP 会先关闭再开启，并尝试 `txpower=12`；部分固件不支持该参数时会忽略。

### 4.3 WebSocket 协议细节

- 设备使用标准库 `socket` 实现 RFC 6455 服务端，**不依赖第三方 WebSocket 库**。
- 仅接受文本帧（opcode `0x1`）与分片文本；二进制帧忽略。
- 支持 `ping` / `pong`（opcode `0x9` / `0xA`）与 `close`（`0x8`）。
- 同一时间只服务一个客户端；客户端断开后自动回到监听状态。
- 服务端 → 客户端帧不加掩码；客户端 → 服务端必须加掩码（浏览器自动完成）。

### 4.4 混合内容提示

如果页面以 `https://` 方式部署，浏览器可能阻止 `ws://` 明文连接。此时请：

- 直接以 `file://` 打开单文件前端，或
- 使用 `http://` 本地页面访问，或
- 让设备与页面处于浏览器允许的上下文中。

---

## 5. 执行与停止语义

### 5.1 一次性执行

WiFi AP 模式在 WebSocket 主线程同步执行，BLE 在 BLE worker 中同步执行，串口模式在执行线程中执行：

```python
exec(code, env)
```

- `code` 是前端下发的**完整源码字符串**，一次性执行。
- `env` 仅注入硬件函数：`servo_set`、`puppet_delay`、`action_bow`、`action_wave`、`action_nod`；内置函数（`print` 等）由 MicroPython 提供。
- 不逐行下发、不逐指令解释、不做代码改写。
- WiFi AP 与 BLE 均为同步执行，避免 MicroPython 线程栈过小与跨线程 socket 发送失败；`_running` 保证两个通道不会并发执行。长延时/死循环需要等代码结束或复位设备。

### 5.2 输出回传

串口模式执行期间 `sys.stdout` 被替换为 `_LogStream`，`print()` 的每一行转换为：

```json
{ "type": "log", "level": "print", "message": "..." }
```

执行结束后恢复原始 `stdout`。

没有换行符的残留输出最多保留 4096 字符（`MAX_LOG_BUFFER_CHARS`）；超限时丢弃较早内容并只回传一次 `warn` 日志，避免 `print()` 持续无换行输出耗尽内存。执行结束时的 `drain()` 仍会输出当前残留内容。

WiFi AP 与 BLE 模式不替换 `sys.stdout`：用户代码的 `print()` 输出到 USB 串口，不进入无线日志；固件自身的 `info` / `warn` / `error` 日志仍会回传。

### 5.3 停止

停止行为按通信模式区分：

**串口模式（协作式中断 + 超时强制恢复）**

1. 前端发送 `{ "type": "stop" }`。
2. 串口读取线程置位 `_stop_flag`，返回 `ack(stopping)`。
3. `puppet_delay()` 每 20 ms 检查一次停止标志；`servo_set()` 在入口检查一次；命中时抛出内部 `_StopRequested`，执行线程退出。
4. 若 3 秒（`STOP_TIMEOUT_MS`）内执行线程仍未退出（例如用户代码是没有任何延时/舵机调用的死循环），设备执行 `machine.soft_reset()`，强制回到待机状态。
5. 前端收到 `done` 后恢复「运行」按钮；若 8 秒内仍未收到 `done`（如软复位导致回执丢失），前端看门狗会强制恢复按钮并提示重新连接。

**WiFi AP 模式（主线程同步执行）**

代码在 WebSocket 会话主线程中同步执行，执行期间不会读取 `stop`。停止指令要等当前代码执行完才会被处理（此时已没有正在执行的代码，只回 `ack(stopping)` 与一条提示）。运行期间的「停止」按钮由前端 8 秒看门狗恢复界面，设备会在代码结束后回到待机；长延时或死循环需要复位设备。

**蓝牙 BLE 模式（BLE worker）**

代码在 BLE worker 线程中同步执行。BLE IRQ 收到 `{"type":"stop"}` 会立即置位 `_stop_flag`，`puppet_delay()` / `servo_set()` 命中后抛出 `_StopRequested`，执行线程退出并回 `done(reason=stopped)`；停止报文本身会在执行结束后再被 worker 处理一次，只回 `ack(stopping)` 与提示。纯计算死循环仍无法中断，需要复位设备。

另外，下发 `run` 后若 10 秒内没有收到 `ack(started)`（报文丢失、设备忙或超过长度上限），前端同样会恢复运行按钮并给出警告；若该次执行的 `ack(started)` 在此之后才迟到，前端会忽略它，不会重新进入运行态。

限制说明：MicroPython 无法从外部异步杀死任意 Python 字节码。串口模式下的“纯计算死循环”只能靠软复位恢复；WiFi AP 模式执行期间无法读取停止指令，BLE 模式只能依赖协作检查，两者都需要等待代码结束或手动复位。软复位后：

- WiFi AP / BLE：连接断开，需要重新连接；
- 串口模式：设备重新运行 `main.py`，串口链路通常保持，可重新握手。

### 5.4 上电行为

固件上电先等待 3 秒（便于 Thonny / 串口连接），然后初始化通信与硬件。之后只做三件事：

1. 初始化内置执行器 PWM（占空比 0，不输出脉冲，不产生动作）；
2. 初始化所选通信模块（`WIFI_AP` 时同时开启 AP 与 BLE）；
3. 等待前端指令。

**不会自动执行任何积木或动作。**

---

## 6. 前端积木与底层函数映射

### 6.1 映射表

下表为当前内置的舵机控制示例，不代表硬件边界；新增外设按「积木 → Python 生成器 → 固件执行环境」同一方式接入。

| 积木（Blockly type） | 生成代码 | 底层实现 | 说明 |
| --- | --- | --- | --- |
| `controls_repeat_ext` | `for count in range(N):` | MicroPython 原生 | 标准重复 N 次 |
| `puppet_delay` | `puppet_delay(秒)` | `main.py: puppet_delay()` | 分片睡眠，可被停止 |
| `variables_set` | `变量 = 值` | MicroPython 原生 | 变量定义 / 赋值 |
| `variables_get` | `变量` | MicroPython 原生 | 读取变量 |
| `controls_if` | `if 条件:` / `else:` | MicroPython 原生 | 条件判断 |
| `logic_compare` | `a == b`、`a < b` 等 | MicroPython 原生 | 为 `if` 提供布尔条件 |
| `math_number` | 数字字面量 | MicroPython 原生 | 数字 |
| `math_arithmetic` | `(a + b)` 等 | MicroPython 原生 | 加减乘除 |
| `puppet_servo_set` | `servo_set(id, angle)` | `main.py: servo_set()` | 1-4 号舵机，0-180 度 |
| `puppet_action_bow` | `action_bow()` | `main.py: action_bow()` | 预留，空实现 |
| `puppet_action_wave` | `action_wave()` | `main.py: action_wave()` | 预留，空实现 |
| `puppet_action_nod` | `action_nod()` | `main.py: action_nod()` | 预留，空实现 |

说明：

- `logic_compare` 是让 `if` 条件可用所必需的比较积木，与条件判断同属一类。
- 组合动作积木显示「开发中」，只生成空函数调用；固件函数体只有 `# TODO: 填充实际动作逻辑` 与 `pass`。
- 代码生成器复用 Blockly 内置的 Python 生成器（MicroPython 属于 Python 3 方言），仅追加自定义积木的 `forBlock` 映射。

### 6.2 生成示例

积木组合：

```
重复 3 次
    舵机 1 号 转到 90 度
    等待 1 秒
皮影挥手（开发中）
```

生成：

```python
# 光影智编 · PuppetCode
# 目标硬件：ESP32 外设控制

for count in range(3):
  servo_set(1, 90)
  puppet_delay(1)
action_wave()
```

### 6.3 舵机函数参数

```python
servo_set(servo_id, angle)
```

| 参数 | 类型 | 范围 | 说明 |
| --- | --- | --- | --- |
| `servo_id` | int | 1-4 | 对应 `SERVO_PINS = (2, 4, 13, 14)` |
| `angle` | number | 0-180 | 自动裁剪到边界 |

底层参数：

```python
SERVO_FREQ = 50            # 50Hz
SERVO_MIN_PULSE_US = 500   # 0 度
SERVO_MAX_PULSE_US = 2500  # 180 度
```

角度换算为 16 位 PWM 占空比后写入 `duty_u16()`。

---

## 7. 扩展开发步骤

以下扩展均不破坏现有协议与函数签名。

### 7.1 新增一个自定义积木

以“设置舵机速度”为例（仅示意如何接入，本工具当前未实现该功能）：

1. **定义积木外观**：在 `index.html` 的 `defineCustomBlocks()` 中追加 JSON 定义。

```js
{
  type: 'puppet_servo_speed',
  message0: '舵机 %1 速度设为 %2',
  args0: [
    { type: 'field_dropdown', name: 'SERVO', options: [['1 号','1'],['2 号','2'],['3 号','3'],['4 号','4']] },
    { type: 'input_value', name: 'SPEED', check: 'Number' }
  ],
  previousStatement: null,
  nextStatement: null,
  colour: '#2F8F7F'
}
```

2. **加入工具箱**：在 `TOOLBOX_XML` 的「舵机控制」分类中增加对应 `<block>`。

3. **添加代码生成映射**：在 `setupGenerator()` 中追加。

```js
Blockly.Python.forBlock['puppet_servo_speed'] = function (block, generator) {
  var servo = block.getFieldValue('SERVO');
  var speed = generator.valueToCode(block, 'SPEED', Blockly.Python.ORDER_NONE) || '1';
  return 'servo_speed(' + servo + ', ' + speed + ')\n';
};
```

4. **在固件中实现同名函数**：在 `main.py` 的硬件区增加 `servo_speed(servo_id, speed)`，并保持参数顺序与代码生成一致。

5. **在本文档「映射表」中登记**，并更新协议版本说明（如需）。

> 注意：新增积木的 `type`、生成的函数名、固件函数名必须一一对应；不得修改已有积木的 `type`。

### 7.2 新增一个组合动作函数

1. 在 `main.py` 的组合动作预留区追加函数，保持空实现与注释：

```python
def action_turn():
    # TODO: 填充实际动作逻辑
    pass
```

2. 在 `defineCustomBlocks()` 增加积木，文本带「（开发中）」。

3. 在 `setupGenerator()` 增加映射：

```js
Blockly.Python.forBlock['puppet_action_turn'] = function () {
  return 'action_turn()\n';
};
```

4. 在 `TOOLBOX_XML` 的「组合动作」分类中加入积木。

5. 保持现有 `action_bow / action_wave / action_nod` 的函数名与参数不变。

### 7.3 新增一种通信方式

前端：

1. 继承 `Transport` 抽象类，实现：

```js
class MyTransport extends Transport {
  connect(config) { /* 建立连接，并 emitStatus('connected', 描述) */ }
  disconnect() { /* 关闭连接，并 emitStatus('disconnected', '') */ }
  send(message) { /* 发送一条 JSON；串口补 '\n'，WebSocket 文本帧，BLE JSON+'\n' 分片 */ }
}
```

2. 在 `connectDevice()` 中按模式实例化新的 Transport，并复用 `bindTransport()`、`handleDeviceMessage()`、`runCode()`、`stopCode()`。

固件：

1. 在 `main.py` 顶部的 `COMM_MODE` 增加新的枚举值。
2. 编写对应的初始化函数与收报循环，最终调用 `_handle_message(message)`。
3. 发送统一走 `_send(message)`，不要另建报文格式。

约束：

- 必须保持 JSON 报文结构不变；
- 必须支持 `hello` / `run` / `stop`；
- 日志必须使用 `type=log` 回传。

### 7.4 向后兼容规则

1. `PROTOCOL_VERSION` 为 `1.0`；新增字段只增不改，接收方忽略未知字段。
2. 不得删除或重命名已有 `type` / `stage` / `level` 枚举值。
3. 不得修改 `servo_set(id, angle)`、`puppet_delay(seconds)`、`action_*()` 的参数顺序。
4. 新增积木使用新的 `type`，不要覆盖已有积木定义。
5. 前端忽略未知报文类型；固件忽略未知报文类型。

---

## 8. 移动端 APP 预留

通信层与网页没有强绑定，APP 可按以下方式复用：

1. **WiFi AP / BLE 模式**：直接实现 WebSocket 或 BLE GATT 客户端，发送/接收同样的 JSON 报文。
2. **USB / OTG 模式**：按 NDJSON 发送（每条 JSON + `\n`），波特率与固件一致。
3. **其他新链路**：在 APP 内实现 `Transport` 等价层即可，无需改变设备协议；BLE 已作为 `src/transport/ble.js` 实现。

APP 最小接入流程：

```
connect() → 等待 ready（或发 hello）
→ 发送 run {id, code}
→ 渲染 ack / log / done 消息
→ 需要中断时发送 stop
```

由于 `code` 字段就是完整源码字符串，APP 只需具备 Blockly（或任意积木引擎）生成 Python 的能力，无需了解设备内部实现。

---

## 9. 固件配置项速查（main.py）

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMM_MODE` | `"WIFI_AP"` | `SERIAL` / `WIFI_AP`（AP 与 BLE 同时开启） |
| `AP_SSID` | `puppet` | AP 热点名称 |
| `AP_PASSWORD` | `12345678` | AP 热点密码（≥8 位） |
| `AP_IP` | `192.168.4.1` | AP 模式设备 IP |
| `WS_PORT` | `8080` | WebSocket 端口 |
| `BLE_ENABLED` | `True` | 是否同时开启 BLE |
| `BLE_NAME` | `puppet` | BLE 设备名 |
| `BLE_SERVICE_UUID` / `BLE_RX_UUID` / `BLE_TX_UUID` | NUS 风格 128 位 UUID | 见 `main.py`；RX 写入、TX 通知 |
| `SERVO_PINS` | `(2, 4, 13, 14)` | 当前内置舵机控制 GPIO |
| `STOP_TIMEOUT_MS` | `3000` | 串口模式停止超时后软复位 |
| `MAX_LOG_BUFFER_CHARS` | `4096` | 串口模式无换行日志残留上限 |

切换通信模式：修改 `COMM_MODE` → 保存 `main.py` → 复位设备。`WIFI_AP` 模式同时开启 AP 与 BLE，前端可选择任一种连接；`SERIAL` 模式关闭无线。前端设置中的 WiFi 名称/密码不会写入设备。

---

## 10. 已知限制

1. **Web Serial 浏览器支持**：仅 Chromium 系浏览器；不支持时请使用 WiFi AP / BLE。
2. **停止的强制恢复**：串口模式纯计算死循环依赖软复位，软复位会中断 WiFi 连接；WiFi AP 模式执行期间不处理 stop，BLE 模式只能依赖协作检查，两者都需要等待代码结束或手动复位。
3. **单客户端**：WiFi WebSocket 与 BLE 各自同一时间只服务一个客户端，便于单操作者场景；两个通道同时连接时由 `_running` 串行化执行。
4. **无云端 / 无账号 / 无多设备管理**：本工具按需求边界未实现这些能力。
5. **舵机供电**：当前内置舵机控制应使用独立电源并共地，ESP32 仅提供信号；本工具不涉及电源管理。
6. **WiFi AP / BLE print 不进入前端日志**：用户代码的 `print()` 输出到 USB 串口，不进入无线日志；固件协议日志仍会回传。
7. **BLE 吞吐与共存**：BLE 默认 20 字节分片，代码较大时上传明显慢于 WiFi；ESP32 的 WiFi AP 与 BLE 共用 2.4GHz 射频，同时开启会降低吞吐并增加内存压力，需实机确认稳定性。
