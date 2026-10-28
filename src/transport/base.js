// 通信层抽象基类。
// 串口与 WebSocket 共用 JSON 报文：串口按行分隔，WebSocket 单帧一条。
// 后续原生 APP 可实现同样的报文格式直接接入。
export class Transport {
  constructor() {
    this._connected = false;
    this._messageHandler = function () {};
    this._statusHandler = function () {};
  }

  onMessage(handler) { this._messageHandler = handler; }
  onStatus(handler) { this._statusHandler = handler; }
  emitMessage(message) { this._messageHandler(message); }
  emitStatus(state, detail) { this._statusHandler(state, detail || ''); }
  get connected() { return this._connected; }
  connect() { return Promise.reject(new Error('未实现的通信方式')); }
  disconnect() { return Promise.resolve(); }
  send() { return Promise.reject(new Error('未实现的通信方式')); }
}
