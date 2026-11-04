# -*- coding: utf-8 -*-
"""
皮影机器人 · ESP32 MicroPython 固件（4 路舵机）

功能边界：
    1. 仅驱动 4 路舵机，不包含任何其他传感器 / 外设。
    2. 上电只初始化硬件与通信模块，不自动执行任何动作，仅等待前端指令。
    3. 接收前端下发的完整 Python 代码字符串，通过 exec() 一次性执行。
    4. 执行过程中的 print / 报错信息实时回传给前端日志区。
    5. 停止指令通过协作式中断实现；若用户代码长时间不响应，则软复位恢复待机。

通信方式：
    修改下方 COMM_MODE 常量后重新烧录 / 复位即可切换：
        "SERIAL"    USB 串口（Web Serial 直连）
        "WIFI_STA"  设备与前端处于同一局域网，WebSocket 通信
        "WIFI_AP"   前端连接设备热点，WebSocket 通信（默认）

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

# =============================================================================
# 一、顶部配置常量（修改后复位生效）
# =============================================================================

# 通信模式："SERIAL" | "WIFI_STA" | "WIFI_AP"
COMM_MODE = "WIFI_AP"

# WiFi STA 模式：设备作为客户端连接的路由器
WIFI_SSID = "YOUR_WIFI_SSID"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"

# WiFi AP 模式：设备创建的热点
AP_SSID = "PuppetRobot"
AP_PASSWORD = "12345678"
AP_IP = "192.168.4.1"

# WebSocket 服务端口（STA / AP 共用）
WS_PORT = 8080

# 协议版本：前端与设备仅做兼容性提示，不强制校验
PROTOCOL_VERSION = "1.0"

# 4 路舵机所接 GPIO（可按实际接线修改）
SERVO_PINS = (13, 14, 25, 26)

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


class _StopRequested(Exception):
    """内部异常：用户代码被停止指令中断。"""
    pass


class _LogStream:
    """把 print() 的输出按行转换成协议日志，回传给前端。"""

    def __init__(self):
        self._buffer = ""

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
        return len(str(text))

    def drain(self):
        """执行结束时，输出没有换行符的残留内容。"""
        if self._buffer:
            line = self._buffer.replace("\r", "")
            self._buffer = ""
            if line:
                _emit_log("print", line)

    def flush(self):
        pass


# =============================================================================
# 三、底层硬件：4 路舵机
# =============================================================================

def servo_init():
    """初始化 4 路舵机 PWM。

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

    servo_id: 1-4，对应 SERVO_PINS 中的 4 路舵机
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
#    当前仅保留空实现，后续在函数体内填充实际皮影动作逻辑即可，函数名与参数保持不变。
# =============================================================================

def action_bow():
    # TODO: 填充实际皮影动作逻辑
    pass


def action_wave():
    # TODO: 填充实际皮影动作逻辑
    pass


def action_nod():
    # TODO: 填充实际皮影动作逻辑
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
    """统一发送入口：串口与 WebSocket 共用同一套 JSON 报文。"""
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
            _ws_send_text(data)
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
    try:
        _thread.start_new_thread(_executor, (code, exec_id))
    except Exception as error:
        _running = False
        _send({
            "type": "error",
            "id": exec_id,
            "message": "无法启动执行线程: " + str(error),
        })


def _executor(code, exec_id):
    """执行线程：一次性 exec 完整代码，并捕获输出与异常。"""
    global _running

    old_stdout = sys.stdout
    log_stream = _LogStream()
    sys.stdout = log_stream

    _send({"type": "ack", "stage": "started", "id": exec_id})
    _emit_log("info", "开始执行代码")

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
        try:
            log_stream.drain()
        except Exception:
            pass
        sys.stdout = old_stdout
        _send({
            "type": "done",
            "id": exec_id,
            "ok": ok,
            "reason": reason,
        })
        _running = False


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
    """串口读取线程：按换行符切分 JSON 报文。"""
    buffer = ""
    discarded = False
    while True:
        try:
            char = _stdin.read(1)
        except Exception:
            time.sleep_ms(10)
            continue
        if not char:
            time.sleep_ms(5)
            continue
        if isinstance(char, bytes):
            try:
                char = char.decode()
            except Exception:
                continue
        if char == "\r":
            continue
        if char == "\n":
            line = buffer
            buffer = ""
            if discarded:
                # 超限行剩余部分一直丢弃到换行，避免误解析半截报文
                discarded = False
                continue
            _handle_line(line)
        elif not discarded:
            buffer += char
            if len(buffer) > MAX_SERIAL_LINE_BYTES:
                buffer = ""
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
# 八、WiFi 初始化（STA / AP）
# =============================================================================

def _wifi_sta():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        _debug("正在连接 WiFi: " + WIFI_SSID)
        try:
            wlan.connect(WIFI_SSID, WIFI_PASSWORD)
        except Exception as error:
            _debug("WiFi 连接调用失败: " + repr(error))

        start = time.ticks_ms()
        while not wlan.isconnected():
            if time.ticks_diff(time.ticks_ms(), start) > 30000:
                _debug("WiFi 连接超时，5 秒后重试")
                time.sleep_ms(5000)
                start = time.ticks_ms()
                try:
                    wlan.disconnect()
                except Exception:
                    pass
                try:
                    wlan.connect(WIFI_SSID, WIFI_PASSWORD)
                except Exception:
                    pass
            time.sleep_ms(300)

    ip = wlan.ifconfig()[0]
    _debug("WiFi 已连接，设备 IP: " + ip)
    return ip


def _wifi_ap():
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    ap.config(essid=AP_SSID, password=AP_PASSWORD)
    ap.ifconfig((AP_IP, "255.255.255.0", AP_IP, "8.8.8.8"))
    _debug("热点已开启: " + AP_SSID + "，设备 IP: " + AP_IP)
    return AP_IP


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

    _out = sys.stdout
    _stdin = sys.stdin

    try:
        _thread.stack_size(16 * 1024)
    except Exception:
        pass

    servo_init()

    if COMM_MODE == "WIFI_STA":
        _transport = "WS"
        ip = _wifi_sta()
        _ws_server(ip)
    elif COMM_MODE == "WIFI_AP":
        _transport = "WS"
        _wifi_ap()
        _ws_server(AP_IP)
    else:
        # 默认及非法配置均回退到 USB 串口模式
        _run_serial()


if __name__ == "__main__":
    main()
