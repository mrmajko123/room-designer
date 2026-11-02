/* Gives the web app access to the phone link (and nothing else) from the desktop app. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roomDesktop', {
  platform: process.platform,
  phoneLink: {
    start: () => ipcRenderer.invoke('phone-link:start'),
    stop: () => ipcRenderer.invoke('phone-link:stop'),
    on: (cb) => {
      const fn = (_e, ev) => cb(ev);
      ipcRenderer.on('phone-link:event', fn);
      return () => ipcRenderer.removeListener('phone-link:event', fn);
    },
  },
});
