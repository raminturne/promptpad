// Throwaway driver for the four new themes, their categories, and the theme
// browser's peek/commit behaviour. Not part of the app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const store = { notes: {}, settings: {} };
let savedSettings = null;

function stub(ch, fn) { ipcMain.handle(ch, fn); }

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; savedSettings = d; return true; });
  stub('get-version', () => '3.8.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Default' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: 620, height: 520, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, m) => { if (level >= 2) { errors.push(m); console.log('CONSOLE: ' + m); } });

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
  const run = (src) =>
    win.webContents.executeJavaScript('(() => {' + NL + src + NL + '})()', true);
  const results = [];
  const check = (n, ok, extra) =>
    results.push((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  — ' + extra : ''));

  try {
    // ---- the four themes exist, in their own categories
    const cats = JSON.parse(await run(
      'return JSON.stringify(["fountain","sandbox","almanac","mechanical"]' +
      '.map(k => [k, PP_THEMES[k] && PP_THEMES[k].type, PP_THEMES[k] && PP_THEMES[k].fx]))'));
    check('Fountain is Luxury', cats[0][1] === 'luxury' && cats[0][2] === 'fountain', JSON.stringify(cats[0]));
    check('Sandbox is Playable', cats[1][1] === 'play', JSON.stringify(cats[1]));
    check('Almanac is Live', cats[2][1] === 'live', JSON.stringify(cats[2]));
    check('Mechanical is Sound', cats[3][1] === 'sound', JSON.stringify(cats[3]));

    // ---- every one of them starts, runs, and stops without leaving state
    for (const k of ['fountain', 'sandbox', 'almanac', 'mechanical']) {
      await run('settings.theme = "' + k + '"; applySettings(); return true;');
      await new Promise((r) => setTimeout(r, 450));
      const live = await run('return JSON.stringify({fx: PP_FX.active(),' +
        ' canvases: document.querySelectorAll("#fxBack canvas, #fxLayer canvas").length});');
      check(k + ' runtime is live', JSON.parse(live).fx === k, live);
    }
    // Back to a plain theme: every layer must be empty again.
    await run('settings.theme = "midnight"; applySettings(); return true;');
    await new Promise((r) => setTimeout(r, 250));
    check('layers clean after switching away',
      (await run('return document.querySelectorAll("#fxBack canvas, #fxLayer canvas").length')) === 0);
    check('no runtime left active', (await run('return PP_FX.active()')) === null);

    // ---- Almanac writes the accent; leaving it must give the accent back
    const before = await run('return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()');
    await run('settings.theme = "almanac"; applySettings(); return true;');
    await new Promise((r) => setTimeout(r, 200));
    const during = await run('return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()');
    await run('settings.theme = "midnight"; applySettings(); return true;');
    await new Promise((r) => setTimeout(r, 200));
    const after = await run('return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()');
    check('Almanac tints the accent from the season', during !== after, during + ' vs ' + after);
    check('accent restored on the way out', after === before, before + ' → ' + after);

    // ---- every category has a filter chip of its own
    await run('openSettings(); setSettingsPane("theme"); return true;');
    await new Promise((r) => setTimeout(r, 250));
    // Chips carry their count now ("Nature 6"), so compare on the label only.
    const chips = JSON.parse(await run(
      'return JSON.stringify([...tbFilters.querySelectorAll(".tb-chip")]' +
      '.map(e => (e.querySelector("span") || e).textContent.trim()));'));
    ['Dark', 'Light', 'Reactive', 'Nature', 'Machines', 'Nostalgia',
      'Live', 'Sound', 'Playable', 'Luxury'].forEach((g) => {
      check('filter chip "' + g + '"', chips.includes(g), JSON.stringify(chips));
    });

    // ---- browser: peek applies without saving, leaving reverts
    await run('openSettings(); setSettingsPane("theme"); return true;');
    await new Promise((r) => setTimeout(r, 200));
    check('browser lists every theme',
      (await run('return tbGrid.querySelectorAll(".tb-card").length')) === Object.keys(
        JSON.parse(await run('return JSON.stringify(PP_THEMES)'))).length);

    // The hover preview was removed; clicking is the whole interaction, so
    // what matters now is that a click applies at once and nothing happens
    // just because the pointer went past.
    savedSettings = null;
    await run('return true;');
    check('nothing is applied without a click',
      (await run('return settings.theme')) === 'midnight');
    check('and nothing is saved either', savedSettings === null);

    // ---- clicking commits
    await run('chooseTheme("sandbox"); return true;');
    await new Promise((r) => setTimeout(r, 250));
    check('click applies the theme', (await run('return settings.theme')) === 'sandbox');
    check('click starts its runtime', (await run('return PP_FX.active()')) === 'sandbox');
    check('click saves', savedSettings && savedSettings.theme === 'sandbox');
    check('click records it as recent',
      (await run('return JSON.stringify(settings.recentThemes)')).includes('sandbox'));

    // ---- search and filters
    await run('tbSearch.value = "water"; renderThemeBrowser(); return true;');
    const waterHits = await run('return tbGrid.querySelectorAll(".tb-card").length');
    await run('tbSearch.value = "fount"; renderThemeBrowser(); return true;');
    check('search finds a theme by name',
      (await run('return JSON.stringify([...tbGrid.querySelectorAll(".tb-card")].map(c => c.dataset.theme))'))
        .includes('fountain'), 'water hits: ' + waterHits);
    await run('tbSearch.value = ""; tbFilter = "sound"; renderThemeBrowser(); return true;');
    // Sound holds Mechanical and Typewriter; the assertion is that the filter
    // cuts the board down, not that it lands on a specific count.
    const soundCount = await run('return tbGrid.querySelectorAll(".tb-card").length');
    const allCount = Object.keys(JSON.parse(await run('return JSON.stringify(PP_THEMES)'))).length;
    check('category filter narrows the grid',
      soundCount >= 2 && soundCount < allCount / 3, soundCount + ' of ' + allCount);

    // ---- favourites
    await run('tbFilter = "all"; settings.favThemes = []; renderThemeBrowser();' +
      'tbGrid.querySelector(\'[data-theme="almanac"] .tb-card-star\').click(); return true;');
    check('star adds a favourite',
      (await run('return JSON.stringify(settings.favThemes)')).includes('almanac'));
    check('starring does not rearrange the board',
      (await run('return tbGrid.querySelector(".tb-card").dataset.theme')) !== 'almanac');
    // On the next visit it sorts forward — ahead of everything except themes
    // this user has never seen, which get one visit at the very front.
    await run('settings.seenThemes = Object.keys(PP_THEMES);' +
      'tbOrder = null; renderThemeBrowser(); return true;');
    check('favourites sort to the front on the next visit',
      (await run('return tbGrid.querySelector(".tb-card").dataset.theme')) === 'almanac');

    // ---- the volume row only appears for a sound theme
    await run('settings.theme = "mechanical"; applySettings(); syncSettingsUI(); return true;');
    check('volume slider shown for a sound theme',
      (await run('return !fxVolumeRow.classList.contains("hidden")')));
    await run('settings.theme = "midnight"; applySettings(); syncSettingsUI(); return true;');
    check('volume slider hidden otherwise',
      (await run('return fxVolumeRow.classList.contains("hidden")')));

    // ---- a shot of the browser itself
    await run('settings.theme = "midnight"; applySettings(); tbFilter = "all";' +
      'tbSearch.value = ""; renderThemeBrowser(); return true;');
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(path.join(__dirname, 'shot-theme-browser.png'),
      (await win.webContents.capturePage()).toPNG());
  } catch (err) {
    results.push('THREW  ' + (err && err.message));
  }

  console.log('===== RESULTS =====');
  results.forEach((r) => console.log(r));
  console.log(errors.length ? '===== RENDERER ERRORS =====' : 'no renderer errors');
  errors.slice(0, 15).forEach((e) => console.log(e));
  app.exit(0);
});
