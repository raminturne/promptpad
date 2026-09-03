// Throwaway driver for the motion pass: the rail sliding shut, panels leaving
// through an exit animation instead of blinking out, and the master switch
// actually switching it all off. Not part of the app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', () => true);
  stub('load-settings', () => store.settings);
  stub('save-settings', () => true);
  stub('get-version', () => '3.8.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'D' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: 680, height: 520, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, l, m) => { if (l >= 2) errors.push(m); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = (src) => win.webContents.executeJavaScript(src, true);
  const ready = async () => {
    for (let i = 0; i < 150; i++) {
      try {
        const up = await evalJs(
          '(() => (typeof activeTab === "function" && !!activeTab()' +
          ' && !!settings && typeof settings.theme === "string"' +
          ' && document.querySelectorAll(".tab").length > 0))()');
        if (up) {
          await evalJs('(() => { settings.__driverReady = 1; return true; })()');
          await nap(700);
          if (await evalJs('(() => settings.__driverReady === 1)()')) return;
        }
      } catch (e) { /* still parsing */ }
      await nap(120);
    }
    throw new Error('renderer never settled');
  };
  await ready();

  const NL = String.fromCharCode(10);
  const run = (s) => win.webContents.executeJavaScript('(() => {' + NL + s + NL + '})()', true);
  const results = [];
  const check = (n, ok, extra) =>
    results.push((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  — ' + extra : ''));

  try {
    await run('settings.animations = true; applySettings(); return true;');

    // ---- the rail closes by narrowing, not by leaving the layout
    await run('settings.railHidden = false; applySettings(); return true;');
    await nap(300);
    const railOpen = await run('return document.querySelector(".rail").getBoundingClientRect().width | 0');
    check('rail starts open', railOpen > 40, String(railOpen));
    await run('toggleRail(); return true;');
    await nap(80);
    const railMid = await run('return document.querySelector(".rail").getBoundingClientRect().width | 0');
    check('rail slides shut', railMid > 0 && railMid < railOpen,
      'mid-flight ' + railMid + ' of ' + railOpen);
    await nap(350);
    check('rail ends closed',
      (await run('return document.querySelector(".rail").getBoundingClientRect().width | 0')) === 0);
    await run('toggleRail(); return true;');
    await nap(80);
    const backMid = await run('return document.querySelector(".rail").getBoundingClientRect().width | 0');
    check('rail slides back open', backMid > 0 && backMid < railOpen, String(backMid));
    await nap(350);
    check('rail reopens fully',
      (await run('return document.querySelector(".rail").getBoundingClientRect().width | 0')) === railOpen);

    // ---- the find bar leaves through an animation
    await run('openFind(false); return true;');
    await nap(250);
    check('find bar is open',
      (await run('return !findBarEl.classList.contains("hidden")')));
    await run('closeFind(); return true;');
    const closing = await run('return findBarEl.classList.contains("closing")');
    check('find bar animates out rather than blinking', closing === true,
      'classes right after close: ' + await run('return findBarEl.className'));
    check('and is still on screen mid-animation',
      (await run('return !findBarEl.classList.contains("hidden")')));
    await nap(400);
    check('find bar is gone once the animation ends',
      (await run('return findBarEl.classList.contains("hidden") && !findBarEl.classList.contains("closing")')));

    // Reopening mid-exit must not leave the closing class behind.
    await run('openFind(false); closeFind(); openFind(false); return true;');
    await nap(50);
    check('reopening cancels the exit',
      (await run('return !findBarEl.classList.contains("closing") && !findBarEl.classList.contains("hidden")')));
    await run('closeFind(); return true;');
    await nap(400);

    // ---- settings leaves the same way
    await run('openSettings(); return true;');
    await nap(300);
    await run('closeSettings(); return true;');
    check('settings animates out',
      (await run('return settingsOverlay.classList.contains("closing")')));
    await nap(400);
    check('settings is gone afterwards',
      (await run('return settingsOverlay.classList.contains("hidden") && !settingsOverlay.classList.contains("closing")')));

    // ---- the master switch
    await run('settings.animations = false; applySettings(); return true;');
    check('switching motion off marks the document',
      (await run('return document.documentElement.classList.contains("no-anim")')));
    await run('openFind(false); return true;');
    await nap(80);
    await run('closeFind(); return true;');
    check('with motion off the find bar goes at once',
      (await run('return findBarEl.classList.contains("hidden") && !findBarEl.classList.contains("closing")')));
    await run('settings.railHidden = false; applySettings(); toggleRail(); return true;');
    await nap(60);
    check('with motion off the rail goes at once',
      (await run('return document.querySelector(".rail").getBoundingClientRect().width | 0')) === 0);
    await run('settings.animations = true; settings.railHidden = false; applySettings(); return true;');
    check('turning it back on clears the mark',
      (await run('return !document.documentElement.classList.contains("no-anim")')));
  } catch (err) {
    results.push('THREW  ' + (err && err.message));
  }

  console.log('===== RESULTS =====');
  results.forEach((r) => console.log(r));
  console.log(errors.length ? '===== RENDERER ERRORS =====' : 'no renderer errors');
  errors.slice(0, 10).forEach((e) => console.log(e));
  app.exit(0);
});
