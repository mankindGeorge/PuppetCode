// 蓝牙 BLE 通信（Web Bluetooth）：Nordic UART 风格服务，JSON 按行分片收发。
// 桌面版由 Electron 主进程处理蓝牙设备选择。
import { Transport } from './base.js';

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const CHUNK_SIZE = 20;
const MAX_BUFFER = 256 * 1024;

export class BleTransport extends Transport {
  constructor() {
    super();
    this.device = null;
    this.rx = null;
    this.tx = null;
    this.decoder = null;
    this.buffer = '';
    this.manualClose = false;
  }

  connect() {
    var self = this;
    if (!('bluetooth' in navigator)) {
      return Promise.reject(new Error('当前环境不支持蓝牙，请使用桌面版 PuppetCode（或 Chrome / Edge）'));
    }

    this.manualClose = false;
    this.buffer = '';
    this.decoder = new TextDecoder();

    return navigator.bluetooth.requestDevice({
      filters: [
        { services: [SERVICE_UUID] },
        { namePrefix: 'puppet' }
      ],
      optionalServices: [SERVICE_UUID]
    }).catch(function (error) {
      if (error && error.name === 'NotFoundError') {
        throw new Error('未选择蓝牙设备');
      }
      throw error;
    }).then(function (device) {
      self.device = device;
      device.addEventListener('gattserverdisconnected', function () {
        self.handleDisconnected();
      });
      return device.gatt.connect();
    }).then(function (server) {
      return server.getPrimaryService(SERVICE_UUID);
    }).then(function (service) {
      return Promise.all([
        service.getCharacteristic(RX_UUID),
        service.getCharacteristic(TX_UUID)
      ]);
    }).then(function (characteristics) {
      self.rx = characteristics[0];
      self.tx = characteristics[1];
      self.tx.addEventListener('characteristicvaluechanged', function (event) {
        self.handleChunk(event.target.value);
      });
      return self.tx.startNotifications();
    }).then(function () {
      self._connected = true;
      self.emitStatus('connected', (self.device && self.device.name) || '蓝牙');
      return self;
    });
  }

  handleChunk(dataView) {
    if (!dataView) return;
    this.buffer += this.decoder.decode(dataView, { stream: true });
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = '';
      this.emitMessage({
        type: 'log',
        level: 'warn',
        message: '蓝牙接收缓冲超限，已丢弃一段数据'
      });
      return;
    }

    var index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      var line = this.buffer.slice(0, index).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        this.emitMessage(JSON.parse(line));
      } catch (error) {
        this.emitMessage({ type: 'log', level: 'device', message: line });
      }
    }
  }

  send(message) {
    if (!this._connected || !this.rx) {
      return Promise.reject(new Error('蓝牙未连接'));
    }
    var data = new TextEncoder().encode(JSON.stringify(message) + '\n');
    return this.writeChunks(data);
  }

  async writeChunks(data) {
    // 默认 MTU 23，单次写 20 字节；Web Bluetooth 不暴露协商后的 MTU。
    for (var offset = 0; offset < data.length; offset += CHUNK_SIZE) {
      await this.rx.writeValue(data.slice(offset, offset + CHUNK_SIZE));
    }
  }

  handleDisconnected() {
    var wasConnected = this._connected;
    this._connected = false;
    this.rx = null;
    this.tx = null;
    this.buffer = '';
    if (this.manualClose) return;
    if (wasConnected) this.emitStatus('disconnected', '蓝牙连接已断开');
  }

  disconnect() {
    this.manualClose = true;
    this._connected = false;
    this.rx = null;
    this.tx = null;
    this.buffer = '';
    var device = this.device;
    this.device = null;
    if (device) {
      try {
        if (device.gatt && device.gatt.connected) device.gatt.disconnect();
      } catch (error) {
        // 已断开时忽略
      }
    }
    this.emitStatus('disconnected', '');
    return Promise.resolve();
  }
}