// USB 串口通信（Web Serial）：NDJSON 收发，按行切分报文。
import { Transport } from './base.js';

// 未换行数据的缓冲上限。正常报文远小于此值；波特率不匹配或设备持续输出
// 乱码时，超限片段直接丢弃，避免缓冲无限增长耗尽内存。
const MAX_BUFFER_CHARS = 64 * 1024;

export class SerialTransport extends Transport {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readLoop = null;
    this.buffer = '';
    this.closing = false;
    this.dropWarned = false;
  }

  describePort(port) {
    var info = port && port.getInfo ? port.getInfo() : {};
    if (info && info.usbVendorId != null) {
      var vid = info.usbVendorId.toString(16).padStart(4, '0');
      var pid = (info.usbProductId == null ? 0 : info.usbProductId).toString(16).padStart(4, '0');
      return 'USB 串口 ' + vid + ':' + pid;
    }
    return 'USB 串口';
  }

  connect(config) {
    var self = this;
    if (!('serial' in navigator)) {
      return Promise.reject(new Error('当前浏览器不支持 Web Serial，请使用 Chrome / Edge'));
    }
    return navigator.serial.requestPort().then(function (port) {
      return port.open({ baudRate: config.baudRate }).then(function () {
        self.port = port;
        self.closing = false;
        self._connected = true;
        self.writer = port.writable.getWriter();
        self.startReadLoop();
        self.emitStatus('connected', self.describePort(port));
      });
    });
  }

  startReadLoop() {
    var self = this;
    var decoder = new TextDecoder();
    var reader = this.port.readable.getReader();
    this.reader = reader;

    this.readLoop = (async function () {
      try {
        while (true) {
          var result = await reader.read();
          if (result.done) break;
          self.buffer += decoder.decode(result.value, { stream: true });
          self.flushLines();
          // 完整行都消费完说明回到了行边界，允许下次溢出重新告警。
          if (!self.buffer) self.dropWarned = false;
          if (self.buffer.length > MAX_BUFFER_CHARS) {
            self.buffer = '';
            decoder = new TextDecoder();
            self.warnBufferOverflow();
          }
        }
      } catch (error) {
        if (!self.closing) {
          self.emitStatus('error', '串口读取失败：' + (error && error.message ? error.message : error));
        }
      } finally {
        try { reader.releaseLock(); } catch (error) {}
        if (self.reader === reader) self.reader = null;
        // 流正常结束（done）或读取报错都会走到这里。只要不是主动断开，
        // 就按断连处理并释放端口，否则界面会一直显示“已连接”，重连也会卡在旧端口上。
        if (!self.closing) {
          self.buffer = '';
          self.dropWarned = false;
          self._connected = false;
          self.teardownPort();
          self.emitStatus('disconnected', '串口数据流已结束');
        }
      }
    })();
  }

  warnBufferOverflow() {
    if (this.dropWarned) return;
    this.dropWarned = true;
    this.emitMessage({
      type: 'log',
      level: 'warn',
      message: '串口收到超过 64KB 的无换行数据，已丢弃这段内容；请检查波特率是否与设备一致'
    });
  }

  // 非主动断开时尽力释放端口，保证下次「连接」可以重新打开。
  teardownPort() {
    if (this.writer) {
      try { this.writer.releaseLock(); } catch (error) {}
      this.writer = null;
    }
    if (this.port) {
      var port = this.port;
      this.port = null;
      try { port.close().catch(function () {}); } catch (error) {}
    }
  }

  flushLines() {
    var index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      var line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line.trim());
    }
  }

  handleLine(line) {
    if (!line) return;
    if (line.charAt(0) === '{' && line.charAt(line.length - 1) === '}') {
      try {
        this.emitMessage(JSON.parse(line));
        return;
      } catch (error) {
        // 非协议报文，按设备原始输出显示
      }
    }
    this.emitMessage({ type: 'log', level: 'device', message: line });
  }

  send(message) {
    if (!this.writer) return Promise.reject(new Error('串口未连接'));
    var data = JSON.stringify(message) + '\n';
    return this.writer.write(new TextEncoder().encode(data));
  }

  disconnect() {
    var self = this;
    this.closing = true;
    this._connected = false;

    var stopReader = this.reader ? this.reader.cancel().catch(function () {}) : Promise.resolve();

    return stopReader.then(function () {
      return self.readLoop || Promise.resolve();
    }).catch(function () {}).then(function () {
      if (self.writer) {
        try { self.writer.releaseLock(); } catch (error) {}
        self.writer = null;
      }
      self.reader = null;
      self.buffer = '';
      self.dropWarned = false;
      if (self.port) {
        return self.port.close().catch(function () {}).then(function () {
          self.port = null;
          self.emitStatus('disconnected', '');
        });
      }
      self.emitStatus('disconnected', '');
    });
  }
}
