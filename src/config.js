// 全局常量：本地存储键、协议版本、通信模式名称与默认参数。
// 修改默认参数时需与 main.py 顶部常量保持一致。

export const STORAGE_KEY = 'puppetcode-settings-v1';
export const PROTOCOL_VERSION = '1.0';

export const MODE_LABEL = {
  serial: 'USB 串口',
  sta: 'WiFi STA',
  ap: 'WiFi AP'
};

export const DEFAULTS = {
  mode: 'serial',
  baudRate: 115200,
  staIp: '',
  staPort: 8080,
  staSsid: '',
  staPassword: '',
  apIp: '192.168.4.1',
  apPort: 8080,
  apSsid: 'puppet',
  apPassword: '12345678'
};
