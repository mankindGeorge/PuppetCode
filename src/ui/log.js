// 运行日志区渲染：统一时间戳、类型徽标与滚动到底部。

var LOG_META = {
  info: { tag: '系统', cls: 'info' },
  tx: { tag: '发送', cls: 'tx' },
  rx: { tag: '接收', cls: 'rx' },
  success: { tag: '完成', cls: 'success' },
  warn: { tag: '警告', cls: 'warn' },
  error: { tag: '错误', cls: 'error' },
  print: { tag: '打印', cls: 'print' },
  device: { tag: '设备', cls: 'device' }
};

function timestamp() {
  var d = new Date();
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export function addLog(level, message) {
  var list = document.getElementById('logList');
  if (!list) return;
  var meta = LOG_META[level] || LOG_META.info;

  var line = document.createElement('div');
  line.className = 'log-line ' + meta.cls;

  var ts = document.createElement('span');
  ts.className = 'log-ts';
  ts.textContent = timestamp();

  var badge = document.createElement('span');
  badge.className = 'log-badge';
  badge.textContent = meta.tag;

  var msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = String(message);

  line.appendChild(ts);
  line.appendChild(badge);
  line.appendChild(msg);
  list.appendChild(line);

  while (list.children.length > 400) {
    list.removeChild(list.firstChild);
  }
  list.scrollTop = list.scrollHeight;
}
