// Throwaway driver for the settings Theme tab, the rail-rebuild fix, and the
// new-theme marks. Not part of the app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '3.8.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'D' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: 640, height: 520, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, l, m) => { if (l >= 2) errors.push(m); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  // Boot is not a fixed length of time, and waiting for the first render is not
  // enough: a later step of bootstrap() replaces the whole `settings` object,
  // which silently discards anything the driver has written and made these
  // runs fail about half the time. So plant a sentinel on `settings` and only
  // start once it has survived a beat — if the object was swapped, it is gone.
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
      } catch (e) { /* renderer still parsing */ }
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
    // ---- the rail is no longer rebuilt on a plain tab switch
    await run('addTab(); addTab(); addTab(); return true;');
    await new Promise((r) => setTimeout(r, 200));
    const ids = JSON.parse(await run(
      'return JSON.stringify(orderedTabs().map(t => t.id));'));
    // Stamp the live DOM nodes; if the rail is rebuilt they come back missing.
    await run('tabListEl.querySelectorAll(".tab").forEach((e, i) => e.dataset.stamp = "s" + i);' +
      'return true;');
    await run('switchTab(' + JSON.stringify(ids[0]) + '); return true;');
    await new Promise((r) => setTimeout(r, 150));
    const stamps = JSON.parse(await run(
      'return JSON.stringify([...tabListEl.querySelectorAll(".tab")].map(e => e.dataset.stamp || null));'));
    check('tab switch does not rebuild the rail',
      stamps.every((x) => x !== null), JSON.stringify(stamps));
    check('the highlight still moves',
      (await run('return tabListEl.querySelector(".tab.active").dataset.id')) === ids[0]);

    // Adding a tab does rebuild, and the new row gets its entrance.
    await run('addTab(); return true;');
    await new Promise((r) => setTimeout(r, 60));
    check('a new tab animates in',
      (await run('return !!tabListEl.querySelector(".tab.tab-entering")')));

    // ---- new-theme marks
    await run('settings.seenThemes = Object.keys(PP_THEMES).filter(k => k !== "fountain");' +
      'applyNewBadges(); return true;');
    check('an unseen theme is flagged',
      (await run('return JSON.stringify(unseenThemes())')) === '["fountain"]');
    check('the Theme tab carries the dot',
      (await run('return document.querySelector(\'.set-tab[data-pane="theme"]\')' +
        '.classList.contains("has-new-badge")')));
    await run('openSettings(); setSettingsPane("theme"); return true;');
    await new Promise((r) => setTimeout(r, 250));
    check('an unseen theme sorts to the front',
      (await run('return tbGrid.querySelector(".tb-card").dataset.theme')) === 'fountain');
    check('and is marked NEW',
      (await run('return !!tbGrid.querySelector(".tb-card .tb-card-new")')));
    // The mark is cleared per theme, when that theme is tried — not for the
    // whole board on the way out. Two new themes and one click used to bank
    // both, so the other lost its mark without ever being looked at.
    await run('chooseTheme("fountain"); return true;');
    await nap(250);
    check('trying a theme clears only its own mark',
      (await run('return JSON.stringify(unseenThemes())')) === '[]');
    await run('settings.seenThemes = Object.keys(PP_THEMES)' +
      '.filter(k => k !== "fountain" && k !== "sandbox");' +
      'tbOrder = null; renderThemeBrowser(); return true;');
    check('two unseen themes are both marked',
      (await run('return tbGrid.querySelectorAll(".tb-card .tb-card-new").length')) === 2);
    await run('chooseTheme("sandbox"); return true;');
    await nap(250);
    check('and clicking one leaves the other marked',
      (await run('return JSON.stringify(unseenThemes())')) === '["fountain"]');
    await run('settings.seenThemes = Object.keys(PP_THEMES); return true;');
    check('a fresh install is not told everything is new',
      (await run('settings.seenThemes = []; return JSON.stringify(unseenThemes())')) === '[]');

    // ---- the miniature is a real scaled window, not a diagram
    const mini = JSON.parse(await run(
      'const m = tbGrid.querySelector(".tb-mini-app");' +
      'return JSON.stringify({' +
      ' w: m.getBoundingClientRect().width | 0, h: m.getBoundingClientRect().height | 0,' +
      ' hasBar: !!m.querySelector(".tb-mini-bar"),' +
      ' hasRail: !!m.querySelector(".tb-mini-rail"),' +
      ' hasFoot: !!m.querySelector(".tb-mini-foot"),' +
      ' text: m.querySelector(".tb-mini-note").textContent.slice(0, 24) });'));
    check('miniature has the real chrome',
      mini.hasBar && mini.hasRail && mini.hasFoot, JSON.stringify(mini));
    // 300x196 is the shape of the real window; the card must keep it.
    check('miniature keeps the window aspect',
      Math.abs((mini.w / mini.h) - (300 / 196)) < 0.06, mini.w + 'x' + mini.h);

    // ---- the hover preview was removed, so a theme can only change on a
    //      click, and leaving the pane can no longer strand the window in one
    //      nobody chose.
    await run('settings.theme = "midnight"; applySettings(); return true;');
    await new Promise((r) => setTimeout(r, 250));
    await run('setSettingsPane("theme"); return true;');
    await new Promise((r) => setTimeout(r, 400));
    check('opening the board changes nothing on its own',
      (await run('return settings.theme')) === 'midnight');
    await run('chooseTheme("crt"); return true;');
    await new Promise((r) => setTimeout(r, 300));
    check('a click applies the theme', (await run('return settings.theme')) === 'crt');
    await run('setSettingsPane("general"); return true;');
    await new Promise((r) => setTimeout(r, 200));
    check('and leaving the pane keeps it', (await run('return settings.theme')) === 'crt');
    await run('closeSettings(); return true;');
    await new Promise((r) => setTimeout(r, 200));
    check('so does closing settings', (await run('return settings.theme')) === 'crt');
    await run('settings.theme = "midnight"; applySettings(); return true;');

    await run('openSettings(); setSettingsPane("theme"); return true;');
    await new Promise((r) => setTimeout(r, 350));
    fs.writeFileSync(path.join(__dirname, 'shot-theme-pane.png'),
      (await win.webContents.capturePage()).toPNG());
  } catch (err) {
    results.push('THREW  ' + (err && err.message));
  }

  console.log('===== RESULTS =====');
  results.forEach((r) => console.log(r));
  console.log(errors.length ? '===== RENDERER ERRORS =====' : 'no renderer errors');
  errors.slice(0, 10).forEach((e) => console.log(e));
  app.exit(0);
});
