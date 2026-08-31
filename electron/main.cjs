/**
 * Windows desktop shell.
 *
 * Deliberately thin: no native modules, no auto-updater, no network. The web
 * bundle is the whole application, and IndexedDB inside the Electron profile
 * is the whole database. Keeping it this thin is what lets the identical
 * bundle run on iOS under Capacitor.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

// `electron . --dev` points the shell at the running Vite dev server instead
// of the built bundle. A flag rather than an env var so the same command works
// in PowerShell, cmd, and bash without a cross-env dependency.
const devServerUrl = process.argv.includes('--dev')
  ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
  : null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f6f7f9',
    title: 'SiteCheck QC',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // No remote content is ever loaded, but leaving this on costs nothing.
      sandbox: true,
    },
  });

  if (devServerUrl) {
    window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Plans and reports occasionally contain links. Open them in the real
  // browser rather than letting them navigate the app shell away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
