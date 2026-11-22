// 通信方式工厂：根据当前模式创建对应 Transport 实例。
import { SerialTransport } from './serial.js';
import { WebSocketTransport } from './websocket.js';
import { BleTransport } from './ble.js';

export function createTransport(mode) {
  if (mode === 'serial') return new SerialTransport();
  if (mode === 'ble') return new BleTransport();
  return new WebSocketTransport();
}
