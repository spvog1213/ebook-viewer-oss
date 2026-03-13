const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('APP', {
  openDevTools: () => ipcRenderer.send('open-dev-tools'),
  open: (url, target, properties) => ipcRenderer.send('open-window', url, target, properties),
  viewer: (url, target, properties) => ipcRenderer.send('open-viewer', url, target, properties),
  openBrowser: (url) => ipcRenderer.send('open-link', url),
  openFile: (args) => ipcRenderer.send('open-file', args),
  openFolder: (args) => ipcRenderer.send('open-folder', args),
  capture: (properties) => ipcRenderer.send('capture', properties),
  saveProgress: (classNumber) => ipcRenderer.send('save-progress', classNumber),
  movePageOnTextbook: (page) => ipcRenderer.send('move-page-textbook', page),
  print: () => ipcRenderer.send('print'),
  requestUpdateInfo: () => ipcRenderer.send('request-update-info'),
  update: (result) => ipcRenderer.send('update', result),
  close: (name) => ipcRenderer.send('close-window', name)
});

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  }
  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type]);
  }
});