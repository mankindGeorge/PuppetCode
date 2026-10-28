// 预加载脚本：在 contextIsolation 开启的前提下，只把「退出确认 + 保存工程」
// 这几个能力暴露给页面，页面拿不到 Node 的其它接口。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('PuppetCodeBridge', {
  // 用户点了关闭窗口，主进程询问是否保存
  onCloseRequest: (callback) => {
    ipcRenderer.on('app:request-close', () => callback());
  },
  // 取下一个可用文件名（扫描「文档\PuppetCode」里已有的 puppetcodeNN.xml）
  nextFileName: () => ipcRenderer.invoke('project:next-name'),
  // 写入文件，返回 { ok, path } 或 { ok: false, error }
  saveProject: (name, content) => ipcRenderer.invoke('project:save', { name, content }),
  // 确认可以关闭了
  closeConfirmed: () => ipcRenderer.send('app:close-confirmed')
});
