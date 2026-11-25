# -*- coding: utf-8 -*-
"""
光影智编 · ESP32 MicroPython 固件（内置执行器控制）

功能说明：
    1. 执行前端下发的 MicroPython 代码；当前内置舵机控制作为首批能力，可按扩展点增加其他外设。
    2. 上电只初始化硬件与通信模块，不自动执行任何动作，仅等待前端指令。
    3. 接收前端下发的完整 Python 代码字符串，通过 exec() 一次性执行。
    4. 执行过程中的 print / 报错信息实时回传给前端日志区。
    5. 停止指令通过协作式中断实现；若用户代码长时间不响应，则软复位恢复待机。

通信方式：
    修改下方 COMM_MODE 常量后重新烧录 / 复位即可切换：
        "SERIAL"    USB 串口（Web Serial 直连）
        "WIFI_AP"   设备热点 + WebSocket，同时开启 BLE（默认）

    WiFi AP 与 BLE 共用同一套 JSON 报文；前端可以任选一种连接。
    依赖：仅使用 MicroPython 标准固件内置模块，无任何第三方库。
"""

import sys
import json
import time
import _thread
import machine
import binascii
import hashlib
import socket
import network

try:
    import bluetooth
except ImportError:
    try:
        import ubluetooth as bluetooth
    except ImportError:
        bluetooth = None

# =============================================================================
# 一、顶部配置常量（修改后复位生效）
# =============================================================================

# 通信模式："SERIAL" | "WIFI_AP"（WIFI_AP 同时开启 BLE）
COMM_MODE = "WIFI_AP"

# WiFi AP 模式：设备创建的热点
AP_SSID = "puppet"
AP_PASSWORD = "12345678"
AP_IP = "192.168.4.1"

# WebSocket 服务端口（AP 模式）
WS_PORT = 8080

# 蓝牙（BLE）：与 AP 同时开启，使用 Nordic UART 风格服务
BLE_ENABLED = True
BLE_NAME = "puppet"
BLE_SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
BLE_RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
BLE_TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
BLE_DEFAULT_MTU = 23

# 蓝牙 IRQ 事件编号（MicroPython ubluetooth）
_BLE_IRQ_CENTRAL_CONNECT = 1
_BLE_IRQ_CENTRAL_DISCONNECT = 2
_BLE_IRQ_GATTS_WRITE = 3
_BLE_IRQ_MTU_EXCHANGED = 21

# 协议版本：前端与设备仅做兼容性提示，不强制校验
PROTOCOL_VERSION = "1.0"

# 内置舵机控制所接 GPIO（可按实际接线修改）
SERVO_PINS = (2, 4, 13, 14)

# 舵机 PWM 参数
SERVO_FREQ = 50            # 50Hz（20ms 周期）
SERVO_MIN_PULSE_US = 500   # 0 度对应脉宽
SERVO_MAX_PULSE_US = 2500  # 180 度对应脉宽
SERVO_MIN_ANGLE = 0
SERVO_MAX_ANGLE = 180

# 停止指令的最长等待时间：超时后软复位恢复待机
STOP_TIMEOUT_MS = 3000

# 单条报文上限：超出后整条丢弃并回传 error，避免静默丢包导致前端卡在运行中
MAX_SERIAL_LINE_BYTES = 256 * 1024   # 串口单行（NDJSON）
MAX_WS_MESSAGE_BYTES = 512 * 1024    # WebSocket 单条消息

# print 无换行残留缓冲上限：超限只保留最新内容并告警一次，防止耗尽内存
MAX_LOG_BUFFER_CHARS = 4096

# WebSocket 握手固定字符串（RFC 6455）
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# =============================================================================
# 二、运行时状态
# =============================================================================

_servo_pwm = []
_servo_ready = False

_stop_flag = False
_running = False
_state_lock = _thread.allocate_lock()
_send_lock = _thread.allocate_lock()

_transport = None      # "SERIAL" | "WS"
_out = None            # 原始 stdout（协议输出通道）
_stdin = None          # 原始 stdin（串口输入）
_ws_client = None      # 当前 WebSocket 客户端 socket

_ble = None
_ble_conn = None
_ble_rx_handle = None
_ble_tx_handle = None
_ble_mtu = BLE_DEFAULT_MTU
_ble_rx_buffer = bytearray()
_ble_rx_lock = _thread.allocate_lock()
_ble_ready_pending = False
_ble_overflow = False


class _StopRequested(Exception):
    """内部异常：用户代码被停止指令中断。"""
    pass


class _LogStream:
    """把 print() 的输出按行转换成协议日志，回传给前端。"""

    def __init__(self):
        self._buffer = ""
        self._warned = False

    def write(self, text):
        if text is None:
            return 0
        self._buffer += str(text)
        while True:
            index = self._buffer.find("\n")
            if index < 0:
                break
            line = self._buffer[:index].replace("\r", "")
            self._buffer = self._buffer[index + 1:]
            if line:
                _emit_log("print", line)
        if not self._buffer:
            self._warned = False
        elif len(self._buffer) > MAX_LOG_BUFFER_CHARS:
            # 只保留最新尾部，避免无换行输出无限累积耗尽内存
            self._buffer = self._buffer[-MAX_LOG_BUFFER_CHARS:]
            if not self._warned:
                self._warned = True
                _emit_log("warn", "打印输出过长，已截断无换行残留内容")
        return len(str(text))

    def drain(self):
        """执行结束时，输出没有换行符的残留内容。"""
        if self._buffer:
            line = self._buffer.replace("\r", "")
            self._buffer = ""
            self._warned = False
            if line:
                _emit_log("print", line)

    def flush(self):
        pass


# =============================================================================
# 三、底层硬件：内置舵机控制
# =============================================================================

def servo_init():
    """初始化内置舵机 PWM。

    说明：初始化时占空比为 0（不输出脉冲），舵机不会自动动作；
    首次调用 servo_set() 后才开始输出对应角度。
    """
    global _servo_ready
    if _servo_ready:
        return
    for pin_number in SERVO_PINS:
        pwm = machine.PWM(machine.Pin(pin_number), freq=SERVO_FREQ)
        pwm.duty_u16(0)
        _servo_pwm.append(pwm)
    _servo_ready = True


def servo_set(servo_id, angle):
    """单舵机控制函数（与前端积木 servo_set(id, angle) 严格对应）。

    servo_id: 1-4，对应 SERVO_PINS 中的舵机通道
    angle:    0-180 度，超出范围自动裁剪
    """
    _check_stop()
    try:
        index = int(servo_id)
    except (TypeError, ValueError):
        raise ValueError("舵机编号必须是 1-4 的整数")
    if index < 1 or index > len(_servo_pwm):
        raise ValueError("舵机编号必须在 1-4 之间")
    try:
        value = float(angle)
    except (TypeError, ValueError):
        raise ValueError("舵机角度必须是数字")
    if value < SERVO_MIN_ANGLE:
        value = SERVO_MIN_ANGLE
    if value > SERVO_MAX_ANGLE:
        value = SERVO_MAX_ANGLE

    pulse_us = SERVO_MIN_PULSE_US + (
        SERVO_MAX_PULSE_US - SERVO_MIN_PULSE_US
    ) * value / SERVO_MAX_ANGLE
    period_us = 1000000.0 / SERVO_FREQ
    duty = int(pulse_us / period_us * 65535)
    if duty < 0:
        duty = 0
    if duty > 65535:
        duty = 65535
    _servo_pwm[index - 1].duty_u16(duty)


def puppet_delay(seconds):
    """等待指定秒数（与前端"等待 X 秒"积木对应）。

    使用 20ms 分片睡眠，期间检查停止标志，因此可被前端停止指令中断。
    注意：stdin 的串口指令处理运行在独立线程中，不会阻塞这里的等待。
    """
    try:
        total_ms = int(float(seconds) * 1000)
    except (TypeError, ValueError):
        raise ValueError("等待时间必须是数字")
    if total_ms < 0:
        total_ms = 0

    start = time.ticks_ms()
    while True:
        _check_stop()
        elapsed = time.ticks_diff(time.ticks_ms(), start)
        remaining = total_ms - elapsed
        if remaining <= 0:
            break
        time.sleep_ms(20 if remaining > 20 else remaining)
    _check_stop()


# =============================================================================
# 四、组合动作预留函数
#    前端"组合动作（开发中）"积木分别生成 action_bow() / action_wave() / action_nod()。
#    当前仅保留空实现，后续在函数体内填充实际动作逻辑即可，函数名与参数保持不变。
# =============================================================================

def action_bow():
    # TODO: 填充实际动作逻辑
    pass


def action_wave():
    # TODO: 填充实际动作逻辑
    pass


def action_nod():
    # TODO: 填充实际动作逻辑
    pass


# =============================================================================
# 五、协议发送与日志
# =============================================================================

def _emit_log(level, message):
    _send({"type": "log", "level": level, "message": message})


def _send_ready():
    _send({
        "type": "ready",
        "mode": COMM_MODE,
        "protocol": PROTOCOL_VERSION,
    })


def _send(message):
    """统一发送入口：串口、WebSocket 与 BLE 共用同一套 JSON 报文。"""
    try:
        data = json.dumps(message)
    except Exception:
        data = '{"type":"log","level":"error","message":"日志序列化失败"}'

    _send_lock.acquire()
    try:
        if _transport == "SERIAL":
            if _out is not None:
                _out.write(data + "\n")
        elif _transport == "WS":
            # AP 与 BLE 同时开启：向已连接的通道广播，单通道失败不影响另一个。
            if _ws_client is not None:
                _ws_send_text(data)
            _ble_send_text(data)
    except Exception:
        # 通信中断时不允许日志发送异常影响执行线程
        pass
    finally:
        _send_lock.release()


def _debug(text):
    """WiFi 模式下通过 USB 串口打印启动诊断信息（不进入 WebSocket 协议）。"""
    if _transport != "SERIAL" and _out is not None:
        try:
            _out.write("[puppet] " + text + "\n")
        except Exception:
            pass


# =============================================================================
# 六、代码执行与停止
# =============================================================================

def _check_stop():
    if _stop_flag:
        raise _StopRequested()


def _handle_line(line):
    line = line.strip()
    if not line or not line.startswith("{"):
        return
    try:
        message = json.loads(line)
    except Exception:
        return
    if isinstance(message, dict):
        _handle_message(message)


def _handle_message(message):
    kind = message.get("type")
    if kind == "hello":
        _send_ready()
    elif kind == "run":
        _start_execution(message)
    elif kind == "stop":
        _handle_stop()


def _start_execution(message):
    global _running, _stop_flag

    code = message.get("code")
    exec_id = message.get("id")
    if not isinstance(code, str) or not code.strip():
        _send({"type": "error", "id": exec_id, "message": "代码为空，无法执行"})
        return

    _state_lock.acquire()
    try:
        busy = _running
        if not busy:
            _running = True
            _stop_flag = False
    finally:
        _state_lock.release()

    if busy:
        _send({
            "type": "error",
            "id": exec_id,
            "message": "已有代码正在执行，请先发送停止指令",
        })
        return

    _send({"type": "ack", "stage": "received", "id": exec_id})
    if _transport == "WS":
        # WiFi 模式在主线程同步执行：避免 MicroPython 线程栈过小、
        # 以及从第二个线程向同一个 WebSocket 发送导致的静默失败。
        # 代价：执行期间不会读取 stop 帧，停止依赖前端看门狗兜底。
        _run_user_code(code, exec_id, False)
        return
    try:
        _thread.start_new_thread(_executor, (code, exec_id))
    except Exception as error:
        _running = False
        _send({
            "type": "error",
            "id": exec_id,
            "message": "无法启动执行线程: " + str(error),
        })


def _run_user_code(code, exec_id, capture_output):
    """执行一次用户代码；WS 模式由主线程调用，串口模式由执行线程调用。"""
    global _running

    # 先回 started，再做可能失败/耗时的输出重定向，确保前端能离开“等待开始”状态。
    _send({"type": "ack", "stage": "started", "id": exec_id})
    _emit_log("info", "开始执行代码")

    old_stdout = None
    log_stream = None
    if capture_output:
        try:
            old_stdout = sys.stdout
            log_stream = _LogStream()
            sys.stdout = log_stream
        except Exception:
            # 部分固件不允许替换 sys.stdout，此时放弃捕获，继续执行。
            old_stdout = None
            log_stream = None

    ok = True
    reason = None
    try:
        env = {
            "__name__": "__main__",
            "servo_set": servo_set,
            "puppet_delay": puppet_delay,
            "action_bow": action_bow,
            "action_wave": action_wave,
            "action_nod": action_nod,
        }
        # 一次性执行前端下发的完整代码字符串（非逐行 / 逐指令执行）
        exec(code, env)
        _emit_log("info", "执行完成")
    except _StopRequested:
        ok = False
        reason = "stopped"
        _emit_log("warn", "执行已停止")
    except Exception as error:
        ok = False
        reason = "error"
        _emit_log("error", "运行错误: " + str(error))
        try:
            sys.print_exception(error)
        except Exception:
            pass
    finally:
        if log_stream is not None:
            try:
                log_stream.drain()
            except Exception:
                pass
        if old_stdout is not None:
            try:
                sys.stdout = old_stdout
            except Exception:
                pass
        _send({
            "type": "done",
            "id": exec_id,
            "ok": ok,
            "reason": reason,
        })
        _running = False


def _executor(code, exec_id):
    """串口模式执行线程：捕获 print 并回传日志。"""
    _run_user_code(code, exec_id, True)


def _handle_stop():
    """接收停止指令：置位标志并等待执行线程退出，超时则软复位。"""
    global _stop_flag

    _stop_flag = True
    _send({"type": "ack", "stage": "stopping"})

    if not _running:
        _emit_log("info", "当前没有正在执行的代码")
        return

    deadline = time.ticks_add(time.ticks_ms(), STOP_TIMEOUT_MS)
    while _running:
        if time.ticks_diff(time.ticks_ms(), deadline) >= 0:
            _emit_log("warn", "用户代码未响应停止指令，执行软复位恢复待机")
            time.sleep_ms(150)
            try:
                machine.soft_reset()
            except Exception:
                machine.reset()
        time.sleep_ms(30)
    _emit_log("info", "已停止，恢复待机")


# =============================================================================
# 七、USB 串口通信（Web Serial 直连）
# =============================================================================

def _serial_reader():
    """串口读取线程：按换行符切分 JSON 报文。

    逐字节累积原始字节，凑满一行后一次性按 UTF-8 解码，
    避免中文等多字节字符被逐字节解码拆散损坏。
    """
    buffer = bytearray()
    discarded = False
    while True:
        try:
            chunk = _stdin.read(1)
        except Exception:
            time.sleep_ms(10)
            continue
        if not chunk:
            time.sleep_ms(5)
            continue
        if isinstance(chunk, str):
            chunk = chunk.encode()
        if chunk == b"\n":
            line = bytes(buffer)
            buffer = bytearray()
            if discarded:
                # 超限行剩余部分一直丢弃到换行，避免误解析半截报文
                discarded = False
                continue
            if line.endswith(b"\r"):
                line = line[:-1]
            _handle_line(line.decode("utf-8", "replace"))
        elif not discarded:
            buffer += chunk
            # 上限按字节计，与 MAX_SERIAL_LINE_BYTES 名义一致
            if len(buffer) > MAX_SERIAL_LINE_BYTES:
                buffer = bytearray()
                discarded = True
                _send({
                    "type": "error",
                    "message": "单条指令超过 256 KB 上限，已丢弃，请精简代码后重试",
                })


def _run_serial():
    global _out, _stdin, _transport

    _out = sys.stdout
    _stdin = sys.stdin
    _transport = "SERIAL"
    sys.stdout = _LogStream()

    _thread.start_new_thread(_serial_reader, ())
    _send_ready()

    # 主线程保持待机，只等待前端指令；如被 Ctrl-C 中断则直接退出
    while True:
        time.sleep_ms(1000)


# =============================================================================
# 八、WiFi AP 与 BLE 初始化
# =============================================================================

def _wifi_ap():
    ap = network.WLAN(network.AP_IF)
    # 先关闭再开启，保证复位后热点配置重新生效（给 Thonny/串口留出启动窗口）
    ap.active(False)
    time.sleep_ms(500)
    ap.active(True)
    # 显式指定 WPA2-PSK：部分固件缺省 authmode 为 OPEN，会把热点变成开放网络
    ap.config(essid=AP_SSID, password=AP_PASSWORD, authmode=network.AUTH_WPA2_PSK)
    # 降低发射功率，热点更稳定；部分固件不支持该参数时忽略
    try:
        ap.config(txpower=12)
    except Exception:
        pass
    time.sleep_ms(1500)
    # 孤立热点没有外网，DNS 指向设备自身，避免客户端去等不可达的公共 DNS
    ap.ifconfig((AP_IP, "255.255.255.0", AP_IP, AP_IP))
    _debug("热点已开启: " + AP_SSID + "，设备 IP: " + AP_IP)
    return AP_IP


# =============================================================================
# 八点五、蓝牙 BLE（与 AP 同时开启）
# =============================================================================

def _ble_advertise():
    if _ble is None:
        return
    try:
        payload = bluetooth.advertising_payload(
            name=BLE_NAME,
            services=[bluetooth.UUID(BLE_SERVICE_UUID)],
        )
        _ble.gap_advertise(100000, adv_data=payload)
    except Exception:
        try:
            _ble.gap_advertise(100000)
        except Exception:
            pass


def _ble_irq(event, data):
    global _ble_conn, _ble_ready_pending, _ble_mtu, _stop_flag, _ble_overflow

    if event == _BLE_IRQ_CENTRAL_CONNECT:
        _ble_conn = data[0]
        _ble_ready_pending = True
        try:
            _ble.gap_advertise(None)
        except Exception:
            pass
    elif event == _BLE_IRQ_CENTRAL_DISCONNECT:
        _ble_conn = None
        _ble_rx_lock.acquire()
        try:
            del _ble_rx_buffer[:]
        finally:
            _ble_rx_lock.release()
        _ble_advertise()
    elif event == _BLE_IRQ_GATTS_WRITE:
        attr = data[1]
        if attr != _ble_rx_handle:
            return
        try:
            chunk = _ble.gatts_read(_ble_rx_handle)
        except Exception:
            return
        if not chunk:
            return
        _ble_rx_lock.acquire()
        try:
            _ble_rx_buffer.extend(chunk)
            if len(_ble_rx_buffer) > MAX_WS_MESSAGE_BYTES:
                del _ble_rx_buffer[:]
                _ble_overflow = True
        finally:
            _ble_rx_lock.release()
        # BLE 执行期间主线程/工作线程被占用，IRQ 直接置停止标志以支持协作停止。
        if b'"type":"stop"' in chunk or b'"type": "stop"' in chunk:
            _stop_flag = True
    elif event == _BLE_IRQ_MTU_EXCHANGED:
        try:
            _ble_mtu = data[1]
        except Exception:
            _ble_mtu = BLE_DEFAULT_MTU


def _ble_take_line():
    _ble_rx_lock.acquire()
    try:
        index = _ble_rx_buffer.find(b"\n")
        if index < 0:
            return None
        line = bytes(_ble_rx_buffer[:index])
        del _ble_rx_buffer[:index + 1]
    finally:
        _ble_rx_lock.release()
    if line.endswith(b"\r"):
        line = line[:-1]
    return line.decode("utf-8", "replace")


def _ble_worker():
    global _ble_ready_pending, _ble_overflow

    while True:
        if _ble_ready_pending and _ble_conn is not None:
            _ble_ready_pending = False
            _send_ready()
        if _ble_overflow:
            _ble_overflow = False
            _send({
                "type": "error",
                "message": "蓝牙消息超过 512 KB 上限，已丢弃，请精简代码后重试",
            })
        line = _ble_take_line()
        if line is None:
            time.sleep_ms(10)
            continue
        _handle_line(line)


def _ble_send_text(text):
    if _ble is None or _ble_conn is None or _ble_tx_handle is None:
        return
    data = text.encode()
    size = 20 if _ble_mtu <= BLE_DEFAULT_MTU else max(20, _ble_mtu - 3)
    for offset in range(0, len(data), size):
        try:
            _ble.gatts_notify(_ble_conn, _ble_tx_handle, data[offset:offset + size])
        except Exception:
            break


def _ble_start():
    global _ble, _ble_rx_handle, _ble_tx_handle

    if not BLE_ENABLED:
        return
    if bluetooth is None:
        _debug("蓝牙不可用：固件未包含 bluetooth 模块")
        return

    try:
        _ble = bluetooth.BLE()
        _ble.active(True)
        _ble.config(gap_name=BLE_NAME)

        service = (
            bluetooth.UUID(BLE_SERVICE_UUID),
            (
                (bluetooth.UUID(BLE_RX_UUID), 0x0008 | 0x0004),  # write + write_no_response
                (bluetooth.UUID(BLE_TX_UUID), 0x0010),             # notify
            ),
        )
        ((_ble_rx_handle, _ble_tx_handle),) = _ble.gatts_register_services((service,))
        try:
            _ble.gatts_set_buffer(_ble_rx_handle, 512, False)
        except Exception:
            pass
        _ble.irq(_ble_irq)
        _ble_advertise()
        _thread.start_new_thread(_ble_worker, ())
        _debug("蓝牙已启动: " + BLE_NAME)
    except Exception as error:
        _debug("蓝牙启动失败: " + repr(error))
        _ble = None


# =============================================================================
# 九、WebSocket 服务（标准库 socket 实现，RFC 6455）
# =============================================================================

def _set_ws_client(client):
    global _ws_client
    _ws_client = client


def _ws_server(ip):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", WS_PORT))
    server.listen(1)
    _debug("WebSocket 服务已启动: ws://" + ip + ":" + str(WS_PORT))

    while True:
        client = None
        try:
            client, address = server.accept()
            _debug("客户端已连接: " + str(address))
            if not _ws_handshake(client):
                client.close()
                continue
            _ws_session(client)
        except Exception as error:
            _debug("WebSocket 异常: " + repr(error))
        finally:
            if client is not None:
                _set_ws_client(None)
                try:
                    client.close()
                except Exception:
                    pass


def _ws_handshake(client):
    client.settimeout(5)
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = client.recv(256)
        if not chunk:
            return False
        data += chunk
        if len(data) > 4096:
            return False

    try:
        text = data.decode()
    except Exception:
        return False

    key = None
    for line in text.split("\r\n")[1:]:
        if ":" in line:
            name, value = line.split(":", 1)
            if name.strip().lower() == "sec-websocket-key":
                key = value.strip()
                break
    if not key:
        return False

    source = key + WS_GUID
    digest = hashlib.sha1(source.encode()).digest()
    accept = binascii.b2a_base64(digest).strip().decode()

    response = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
    )
    client.send(response.encode())
    client.settimeout(None)
    return True


def _ws_session(client):
    _set_ws_client(client)
    _send_ready()

    fragments = b""
    dropping = False
    while True:
        fin, opcode, payload = _ws_read_frame(client)

        if opcode == 0x8:          # close
            break
        elif opcode == 0x9:        # ping -> pong
            _send_lock.acquire()
            try:
                _ws_send_frame(client, 0xA, payload)
            except Exception:
                pass
            finally:
                _send_lock.release()
            continue
        elif opcode == 0xA:        # pong
            continue
        elif opcode == 0x1 or opcode == 0x0:
            if dropping:
                # 超限消息剩余分片丢弃到 fin，再恢复接收
                if fin:
                    dropping = False
                continue
            fragments += payload
            if len(fragments) > MAX_WS_MESSAGE_BYTES:
                fragments = b""
                dropping = not fin
                _send({
                    "type": "error",
                    "message": "单条消息超过 512 KB 上限，已丢弃，请精简代码后重试",
                })
                continue
            if fin:
                try:
                    text = fragments.decode()
                except Exception:
                    text = ""
                fragments = b""
                for line in text.split("\n"):
                    _handle_line(line)
        else:
            # 二进制帧不在协议范围内，直接忽略
            if not fin:
                continue


def _recv_exact(client, size):
    data = b""
    while len(data) < size:
        chunk = client.recv(size - len(data))
        if not chunk:
            raise OSError("连接已关闭")
        data += chunk
    return data


def _ws_read_frame(client):
    header = _recv_exact(client, 2)
    first = header[0]
    second = header[1]

    fin = (first & 0x80) != 0
    opcode = first & 0x0F
    masked = (second & 0x80) != 0
    length = second & 0x7F

    if length == 126:
        length = int.from_bytes(_recv_exact(client, 2), "big")
    elif length == 127:
        length = int.from_bytes(_recv_exact(client, 8), "big")

    if length > 1048576:
        raise OSError("WebSocket 帧过大")

    mask = _recv_exact(client, 4) if masked else None
    payload = _recv_exact(client, length) if length else b""
    if mask is not None:
        payload = bytes([payload[i] ^ mask[i % 4] for i in range(len(payload))])
    return fin, opcode, payload


def _ws_send_frame(client, opcode, payload):
    header = bytearray()
    header.append(0x80 | opcode)
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header += length.to_bytes(2, "big")
    else:
        header.append(127)
        header += length.to_bytes(8, "big")
    client.send(bytes(header) + payload)


def _ws_send_text(text):
    client = _ws_client
    if client is None:
        return
    try:
        _ws_send_frame(client, 0x1, text.encode())
    except Exception:
        _set_ws_client(None)


# =============================================================================
# 十、启动入口：不执行任何动作，仅初始化并等待前端指令
# =============================================================================

def main():
    global _out, _stdin, _transport

    # 开机等待 3 秒，给 Thonny 留连接窗口
    time.sleep_ms(3000)

    _out = sys.stdout
    _stdin = sys.stdin

    try:
        _thread.stack_size(32 * 1024)
    except Exception:
        pass

    servo_init()

    if COMM_MODE == "WIFI_AP":
        _transport = "WS"
        _wifi_ap()
        _ble_start()
        _ws_server(AP_IP)
    else:
        # 默认及非法配置均回退到 USB 串口模式
        _run_serial()


if __name__ == "__main__":
    main()
