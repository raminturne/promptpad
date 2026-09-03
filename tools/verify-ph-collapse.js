// Throwaway driver for the placeholder panel's collapse: checks the strip
// isn't overstuffed when narrow, that the slide actually animates rather than
// snapping, and shoots both positions. Not part of the app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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

  const win = new BrowserWindow({
    width: 640, height: 460, show: true,
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
  const shot = async (name) => {
    fs.writeFileSync(path.join(__dirname, 'shot-ph-' + name + '.png'),
      (await win.webContents.capturePage()).toPNG());
  };

  try {
    await run([
      'settings.theme = "midnight"; applySettings();',
      'switchTab(orderedTabs()[0].id);',
      'setEditorText("Write about [topic] for [audience] in a [tone|warm, plain, funny] voice.");',
      'syncEditorToState(); updatePlaceholderPanel();',
      'settings.placeholderBarPosition = "right";',
      'settings.placeholderBarCollapsed = false; applySettings();',
      'return true;'
    ].join(NL));
    await new Promise((r) => setTimeout(r, 300));
    await shot('right-open');
    const openW = await run('return placeholderBarEl.getBoundingClientRect().width | 0');
    check('side panel opens at its set width', openW > 150, String(openW));

    // Collapse, and sample the width mid-flight: a snap would already be at 26.
    await run('placeholderCollapseEl.click(); return true;');
    await new Promise((r) => setTimeout(r, 90));
    const midW = await run('return placeholderBarEl.getBoundingClientRect().width | 0');
    check('side panel slides rather than snapping', midW > 30 && midW < openW,
      'mid-flight width ' + midW + ' of ' + openW + '  state=' + await run(
        'return JSON.stringify({set: settings.placeholderBarCollapsed,' +
        ' cls: placeholderBarEl.className, pos: settings.placeholderBarPosition,' +
        ' hidden: placeholderBarEl.classList.contains("hidden"),' +
        ' inline: placeholderBarEl.getAttribute("style")})'));
    await new Promise((r) => setTimeout(r, 400));
    const endW = await run('return placeholderBarEl.getBoundingClientRect().width | 0');
    check('side panel lands on the strip', endW <= 28, String(endW));
    await shot('right-collapsed');

    // The strip is 26px wide: only the arrow belongs in it.
    const strip = JSON.parse(await run(
      'const head = placeholderBarEl.querySelector(".placeholder-head");' +
      'const vis = [...head.children].filter(e => e.getBoundingClientRect().width > 0);' +
      'return JSON.stringify({' +
      ' shown: vis.map(e => e.id || e.className),' +
      ' headW: head.getBoundingClientRect().width | 0,' +
      ' barW: placeholderBarEl.getBoundingClientRect().width | 0 });'));
    check('nothing overflows the collapsed strip', strip.headW <= strip.barW,
      JSON.stringify(strip));
    check('presets button is out of the strip',
      !strip.shown.includes('phPresetBtn'), JSON.stringify(strip.shown));

    // Expand again.
    await run('placeholderCollapseEl.click(); return true;');
    await new Promise((r) => setTimeout(r, 400));
    check('side panel reopens to the same width',
      (await run('return placeholderBarEl.getBoundingClientRect().width | 0')) === openW);

    // ---- top position: the height is what animates there
    await run('settings.placeholderBarPosition = "top"; applySettings();' +
      'settings.placeholderBarCollapsed = false; applyPlaceholderCollapsed(); return true;');
    await new Promise((r) => setTimeout(r, 250));
    await shot('top-open');
    const openH = await run('return placeholderFieldsEl.getBoundingClientRect().height | 0');
    await run('placeholderCollapseEl.click(); return true;');
    await new Promise((r) => setTimeout(r, 90));
    const midH = await run('return placeholderFieldsEl.getBoundingClientRect().height | 0');
    check('top bar slides rather than snapping', midH > 0 && midH < openH,
      'mid-flight height ' + midH + ' of ' + openH);
    await new Promise((r) => setTimeout(r, 400));
    check('top bar closes fully',
      (await run('return placeholderFieldsEl.getBoundingClientRect().height | 0')) === 0);
    await shot('top-collapsed');

    await run('placeholderCollapseEl.click(); return true;');
    await new Promise((r) => setTimeout(r, 450));
    check('top bar reopens to its full height',
      (await run('return placeholderFieldsEl.getBoundingClientRect().height | 0')) === openH);
    // The cap has to be released, or a note that gains a placeholder later
    // stays clipped to the height it had when it was reopened.
    check('height cap released after reopening',
      (await run('return placeholderFieldsEl.style.maxHeight')) === '');
  } catch (err) {
    results.push('THREW  ' + (err && err.message));
  }

  console.log('===== RESULTS =====');
  results.forEach((r) => console.log(r));
  console.log(errors.length ? '===== RENDERER ERRORS =====' : 'no renderer errors');
  errors.slice(0, 10).forEach((e) => console.log(e));
  app.exit(0);
});
