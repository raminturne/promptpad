// Throwaway driver for the in-app guide: every topic has both languages and a
// picture that actually loads, the switch flips direction, and the overlay
// behaves like the others. Not part of the app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);
const NL = String.fromCharCode(10);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', () => true);
  stub('load-settings', () => store.settings);
  stub('save-settings', () => true);
  stub('get-version', () => '3.9.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'D' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: 820, height: 660, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, l, m) => { if (l >= 2) errors.push(m); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 150; i++) {
    try {
      const up = await evalJs('(() => (typeof activeTab === "function" && !!activeTab() && !!settings))()');
      if (up) {
        await evalJs('(() => { settings.__driverReady = 1; return true; })()');
        await nap(700);
        if (await evalJs('(() => settings.__driverReady === 1)()')) break;
      }
    } catch (e) { /* still parsing */ }
    await nap(120);
  }
  const run = (s) => evalJs('(() => {' + NL + s + NL + '})()');
  const results = [];
  const check = (n, ok, extra) =>
    results.push((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  — ' + extra : ''));

  try {
    // ---- content: nothing may be missing in either language
    const audit = JSON.parse(await run(
      'return JSON.stringify((window.PP_GUIDE || []).map(t => ({' +
      ' id: t.id, img: t.img,' +
      ' en: !!(t.title && t.title.en) && Array.isArray(t.body.en) && t.body.en.length,' +
      ' fa: !!(t.title && t.title.fa) && Array.isArray(t.body.fa) && t.body.fa.length })));'));
    check('the guide has topics', audit.length >= 8, String(audit.length));
    check('every topic has English', audit.every((t) => t.en), JSON.stringify(audit.filter((t) => !t.en)));
    check('every topic has Persian', audit.every((t) => t.fa), JSON.stringify(audit.filter((t) => !t.fa)));

    // A referenced picture that isn't on disk is the failure mode that would
    // otherwise only show up as a blank space for the user.
    const missing = audit.filter((t) => t.img &&
      !fs.existsSync(path.join(__dirname, '..', 'src', 'guide-images', t.img)));
    check('every screenshot exists on disk', missing.length === 0,
      missing.map((t) => t.img).join(', '));

    // ---- opens, lists, renders
    await run('settings.language = "en"; openGuide(); return true;');
    await nap(350);
    check('guide opens', (await run('return !guideOverlay.classList.contains("hidden")')));
    check('every topic is listed',
      (await run('return guideNav.querySelectorAll(".guide-nav-item").length')) === audit.length);
    const en = JSON.parse(await run(
      'return JSON.stringify({ dir: guideArticle.getAttribute("dir"),' +
      ' h: guideArticle.querySelector("h4").textContent,' +
      ' paras: guideArticle.querySelectorAll("p").length,' +
      ' img: !!guideArticle.querySelector("img.guide-shot") });'));
    check('article renders in English', en.dir === 'ltr' && en.paras > 0, JSON.stringify(en));
    check('article shows its screenshot', en.img === true);

    // The picture has to have actually decoded, not just been referenced.
    await nap(400);
    check('the screenshot loaded',
      (await run('const i = guideArticle.querySelector("img.guide-shot");' +
        'return !!i && i.complete && i.naturalWidth > 100;')));

    // ---- language switch
    await run('guideLang = "fa"; renderGuideNav(); renderGuideArticle(); return true;');
    await nap(250);
    const fa = JSON.parse(await run(
      'return JSON.stringify({ dir: guideArticle.getAttribute("dir"),' +
      ' navDir: guideNav.getAttribute("dir"),' +
      ' h: guideArticle.querySelector("h4").textContent,' +
      ' paras: guideArticle.querySelectorAll("p").length });'));
    check('Persian switches direction', fa.dir === 'rtl' && fa.navDir === 'rtl', JSON.stringify(fa));
    check('Persian is actually Persian', /[؀-ۿ]/.test(fa.h), fa.h);
    check('and the English is not', !/[؀-ۿ]/.test(en.h), en.h);

    // ---- markup in the prose is rendered, not printed
    check('bold and code render as elements',
      (await run('return guideArticle.querySelectorAll("b, code").length')) > 0);
    check('no raw markers leak through',
      !(await run('return guideArticle.textContent')).includes('**'));

    // ---- navigation
    await run('guideNav.querySelectorAll(".guide-nav-item")[3].click(); return true;');
    await nap(200);
    check('picking a topic changes the article',
      (await run('return guideArticle.querySelector("h4").textContent')) !== fa.h);
    check('and marks it in the list',
      (await run('return guideNav.querySelectorAll(".guide-nav-item.active").length')) === 1);

    // ---- closes like every other overlay
    await run('settings.animations = true; applySettings(); closeGuide(); return true;');
    check('guide animates out',
      (await run('return guideOverlay.classList.contains("closing")')));
    await nap(400);
    check('guide is gone afterwards',
      (await run('return guideOverlay.classList.contains("hidden") && !guideOverlay.classList.contains("closing")')));

    // ---- opens on the interface language
    await run('settings.language = "fa"; openGuide(); return true;');
    await nap(300);
    check('opens in Persian for a Persian interface',
      (await run('return guideLang')) === 'fa');
    fs.writeFileSync(path.join(__dirname, 'shot-guide-fa.png'),
      (await win.webContents.capturePage()).toPNG());
    await run('guideLang = "en"; renderGuideNav(); renderGuideArticle(); return true;');
    await nap(350);
    fs.writeFileSync(path.join(__dirname, 'shot-guide-en.png'),
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
