// Generates marketing screenshots of the app via Electron capturePage().
// Uses seeded sample data (does NOT touch the user's real notes).
// Run: electron build/screenshot.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// ---- sample prompts ----
const tabs = [
  { id: 't1', name: '', custom: false, pinned: true,
    content: 'Rewrite this email to sound professional, warm, and concise. Keep it under 120 words and end with a clear call to action:\n\n{{email}}' },
  { id: 't2', name: '', custom: false, pinned: false,
    content: 'You are a senior software engineer. Review the following code for bugs, security issues, and readability. Give concise, specific, actionable feedback grouped by severity:\n\n```\n{{code}}\n```' },
  { id: 't3', name: '', custom: false, pinned: false,
    content: 'Write a detailed outline for a blog post about {{topic}}.\nInclude: a hook, 5 sections with 3 subpoints each, and a closing CTA.' },
  { id: 't4', name: '', custom: false, pinned: false,
    content: 'یک خلاصه‌ی سه‌خطی از متن زیر بنویس و سه نکته‌ی کلیدی را به‌صورت فهرست‌وار استخراج کن:\n\n{{متن}}' },
  { id: 't5', name: '', custom: false, pinned: false,
    content: 'Given this stack trace, list the 3 most likely root causes and how to verify each one quickly:\n\n{{error}}' }
];

const seedState = { tabs, activeId: 't2', seq: 6 };

let currentSettings = {
  theme: 'forest', tabPosition: 'left', pinningEnabled: true,
  railResizable: true, railWidth: 180, launchAtStartup: false
};

// ---- IPC stubs (mirror main.js) ----
ipcMain.handle('load-notes', () => seedState);
ipcMain.handle('save-notes', () => true);
ipcMain.handle('load-settings', () => currentSettings);
ipcMain.handle('save-settings', () => true);
ipcMain.handle('toggle-always-on-top', () => true);
ipcMain.handle('get-always-on-top', () => true);
ipcMain.handle('set-startup', () => false);
ipcMain.handle('get-startup', () => false);
ipcMain.on('set-bg-color', () => {});
ipcMain.on('window-minimize', () => {});
ipcMain.on('window-close', () => {});
ipcMain.on('open-external', () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const INDEX = path.join(__dirname, '..', 'src', 'index.html');

let win = null;

async function loadWithRetry() {
  for (let i = 0; i < 3; i++) {
    try {
      await win.loadFile(INDEX);
      return;
    } catch (e) {
      console.log('load retry', i + 1, e.message);
      await wait(400);
    }
  }
}

async function shot(name, settings, { w, h, openSettings, activeId } = {}) {
  currentSettings = { ...currentSettings, ...settings };
  if (activeId) seedState.activeId = activeId;
  win.setContentSize(w || 520, h || 460);
  await loadWithRetry();
  await wait(700);
  if (openSettings) {
    await win.webContents.executeJavaScript(
      "document.getElementById('settingsBtn').click();");
    await wait(450);
  }
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('saved', name + '.png');
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 520,
    height: 460,
    frame: false,
    show: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1
    }
  });

  await shot('01-default', { theme: 'forest', tabPosition: 'left' },
    { w: 520, h: 460, activeId: 't2' });
  await shot('02-top-layout', { theme: 'forest', tabPosition: 'top' },
    { w: 580, h: 430, activeId: 't3' });
  await shot('03-settings', { theme: 'forest', tabPosition: 'left' },
    { w: 520, h: 500, openSettings: true });
  await shot('04-midnight', { theme: 'midnight', tabPosition: 'left' },
    { w: 520, h: 460, activeId: 't4' });
  await shot('05-plum', { theme: 'plum', tabPosition: 'left' },
    { w: 520, h: 460, activeId: 't1' });
  app.quit();
});
