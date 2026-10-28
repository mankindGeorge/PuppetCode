// USB 串口通信（Web Serial）：NDJSON 收发，按行切分报文。
import { Transport } from './base.js';

export class SerialTransport extends Transport {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readLoop = null;
    this.buffer = '';
    this.closing = false;
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
    this.reader = this.port.readable.getReader();

    this.readLoop = (async function () {
      try {
        while (true) {
          var result = await self.reader.read();
          if (result.done) break;
          self.buffer += decoder.decode(result.value, { stream: true });
          self.flushLines();
        }
      } catch (error) {
        if (!self.closing) {
          self._connected = false;
          self.emitStatus('error', '串口读取失败：' + (error && error.message ? error.message : error));
          self.emitStatus('disconnected', '');
        }
      } finally {
        try { self.reader.releaseLock(); } catch (error) {}
      }
    })();
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
