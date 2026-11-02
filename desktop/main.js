/* Room Designer desktop app: an Electron window around the web app in ./www, plus the phone link
 * (a small Wi-Fi server for scanning your things with your phone). */
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const { createPhoneLink } = require('./phone-link');

if (!app.requestSingleInstanceLock()) app.quit();

const WWW = path.join(__dirname, 'www');
let win = null;

const link = createPhoneLink({
  root: WWW,
  onEvent: (ev) => { if (win && !win.isDestroyed()) win.webContents.send('phone-link:event', ev); },
});
ipcMain.handle('phone-link:start', () => link.start());
ipcMain.handle('phone-link:stop', () => link.stop());

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 360,
    minHeight: 560,
    title: 'Room Designer',
    backgroundColor: '#f6f4ef',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(WWW, 'icons', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(WWW, 'index.html'));

  // Links to websites open in the normal browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.on('closed', () => { win = null; link.stop(); });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  link.stop();
  if (process.platform !== 'darwin') app.quit();
});
