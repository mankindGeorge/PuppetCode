// WiFi 通信（WebSocket）：STA 与 AP 两种模式共用，单帧一条 JSON 报文。
import { Transport } from './base.js';

export class WebSocketTransport extends Transport {
  constructor() {
    super();
    this.ws = null;
    this.url = '';
  }

  connect(config) {
    var self = this;
    var url = 'ws://' + config.ip + ':' + config.port;

    return new Promise(function (resolve, reject) {
      var settled = false;
      var ws = new WebSocket(url);
      var timer = null;
      self.ws = ws;
      self.url = url;

      // 不论成功、失败还是被 close，都只结算一次连接 Promise。
      function fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }

      timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (error) {}
        reject(new Error('连接超时'));
      }, 6000);

      ws.onopen = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        self._connected = true;
        self.emitStatus('connected', url);
        resolve();
      };

      ws.onerror = function () {
        if (!settled) {
          fail(new Error('无法连接 ' + url));
          return;
        }
        if (self._connected) self.emitStatus('error', 'WebSocket 发生错误');
      };

      ws.onclose = function () {
        // 浏览器只触发 close 而不触发 error 时，也要结算连接 Promise，避免永久挂起。
        fail(new Error('连接已关闭'));
        var wasConnected = self._connected;
        self._connected = false;
        self.ws = null;
        if (wasConnected) self.emitStatus('disconnected', '连接已关闭');
      };

      ws.onmessage = function (event) {
        self.handleRaw(event.data);
      };
    });
  }

  handleRaw(data) {
    if (typeof data !== 'string') return;
    var self = this;
    data.split('\n').forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      try {
        self.emitMessage(JSON.parse(line));
      } catch (error) {
        self.emitMessage({ type: 'log', level: 'device', message: line });
      }
    });
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket 未连接'));
    }
    this.ws.send(JSON.stringify(message));
    return Promise.resolve();
  }

  disconnect() {
    var wasConnected = this._connected;
    if (this.ws) {
      try { this.ws.close(); } catch (error) {}
      this.ws = null;
    }
    this._connected = false;
    if (wasConnected) this.emitStatus('disconnected', '已断开');
    return Promise.resolve();
  }
}
