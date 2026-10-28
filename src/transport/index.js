// 通信方式工厂：根据当前模式创建对应 Transport 实例。
import { SerialTransport } from './serial.js';
import { WebSocketTransport } from './websocket.js';

export function createTransport(mode) {
  return mode === 'serial' ? new SerialTransport() : new WebSocketTransport();
}
