// Throwaway driver for the note lock. The assertions that matter are the ones
// about what reaches `save-notes` — a lock that decrypts fine but writes the
// plaintext beside the ciphertext is worse than no lock at all.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const store = { notes: {}, settings: {} };
let lastSaved = null;

function stub(ch, fn) { ipcMain.handle(ch, fn); }

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; lastSaved = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '3.8.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Default' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);

  const win = new BrowserWindow({
    width: 620, height: 500, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });

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
  const runAsync = (src) =>
    win.webContents.executeJavaScript('(async () => {' + NL + src + NL + '})()', true);
  const results = [];
  const check = (name, ok, extra) => {
    results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
  };

  const SECRET = 'my api key is sk-abcdef123456';

  // removeAllLocks() waits on the PIN dialog, so it has to be answered from
  // here rather than awaited straight through.
  await run([
    'window.removeAllLocks_test = async () => {',
    '  const p = removeAllLocks();',
    '  await new Promise(r => setTimeout(r, 120));',
    '  pinInput.value = "5678";',
    '  await confirmPinDialog();',
    '  return p;',
    '};',
    'return true;'
  ].join(NL));

  try {
    // ---- set up the vault and lock a note holding a recognisable secret
    await run([
      'switchTab(orderedTabs()[0].id);',
      'setEditorText(' + JSON.stringify(SECRET) + '); syncEditorToState();',
      'takeSnapshot(activeTab(), true);',
      'return true;'
    ].join(NL));

    const code = await runAsync('return await createVault("1234");');
    check('vault created', typeof code === 'string' && code.length === 29, JSON.stringify(code));
    check('recovery alphabet is unambiguous', !/[IOL01]/.test(code.replace(/-/g, '')), code);

    await runAsync('await lockNote(activeTab().id); return true;');
    check('note is marked locked', await run('return !!activeTab().locked'));
    check('ciphertext exists', await run('return !!(activeTab().enc && activeTab().enc.ct)'));

    // ---- what actually lands on disk
    await runAsync('await doSave(); return true;');
    const saved = JSON.stringify(lastSaved);
    check('no plaintext in the saved workspace', !saved.includes('sk-abcdef123456'),
      saved.length > 300 ? saved.slice(0, 200) + '…' : saved);
    check('saved tab content is empty',
      (await run('return JSON.stringify(' + JSON.stringify(lastSaved) + '.tabs[0].content)')) === '""');
    check('no snapshot of a locked note reached disk',
      !(lastSaved.tabs[0].snapshots || []).some((sn) => String(sn.content).includes('sk-abcdef')),
      JSON.stringify(lastSaved.tabs[0].snapshots || []));

    // ---- closing the vault drops the plaintext from memory too
    await runAsync('await closeVault(); return true;');
    check('vault shuts', (await run('return vaultOpen()')) === false);
    check('plaintext gone from memory', (await run('return activeTab().content')) === '');
    check('editor swapped for the lock pane',
      (await run('return !document.getElementById("lockPane").classList.contains("hidden")')));
    check('rail label does not leak the first line',
      (await run('return autoName(activeTab(), 0)')) === 'Locked note');

    // ---- wrong PIN, right PIN
    check('wrong PIN refused', (await runAsync('return await openVault("9999", "pin");')) === false);
    check('still shut after a wrong PIN', (await run('return vaultOpen()')) === false);
    check('right PIN opens it', (await runAsync('return await openVault("1234", "pin");')) === true);
    await runAsync('await revealLockedTabs(); return true;');
    check('text comes back intact', (await run('return activeTab().content')) === SECRET);

    // ---- recovery code opens it independently of the PIN
    await runAsync('await closeVault(); return true;');
    check('recovery code opens it',
      (await runAsync('return await openVault(normalizeRecoveryCode(' + JSON.stringify(code) + '), "recovery");')) === true);
    check('recovery code survives spacing and case',
      (await runAsync([
        'vaultKey = null;',
        'return await openVault(normalizeRecoveryCode(' +
          JSON.stringify(code.toLowerCase().replace(/-/g, ' ')) + '), "recovery");'
      ].join(NL))) === true);

    // ---- changing the PIN must not disturb the notes or the code
    await runAsync('await revealLockedTabs(); await rewrapVault("5678", false); return true;');
    await runAsync('await closeVault(); return true;');
    check('old PIN no longer works', (await runAsync('return await openVault("1234", "pin");')) === false);
    check('new PIN works', (await runAsync('return await openVault("5678", "pin");')) === true);
    await runAsync('await revealLockedTabs(); return true;');
    check('text still intact after a PIN change', (await run('return activeTab().content')) === SECRET);
    check('the same recovery code still works',
      (await runAsync([
        'vaultKey = null;',
        'return await openVault(normalizeRecoveryCode(' + JSON.stringify(code) + '), "recovery");'
      ].join(NL))) === true);

    // ---- a sealed note cannot be thrown away
    await runAsync('await closeVault(); return true;');
    const idBefore = await run('return activeTab().id');
    const nBefore = await run('return state.tabs.length');
    await run('closeTab(activeTab().id); return true;');
    check('a locked note cannot be closed',
      (await run('return state.tabs.length')) === nBefore
      && (await run('return state.tabs.some(t => t.id === ' + JSON.stringify(idBefore) + ')')));
    // Ctrl+W and the rail's close button both go through closeTab, so the one
    // guard covers every way in.
    check('and the guard reports why',
      (await run('return sealedGuard([' + JSON.stringify(idBefore) + '])')) === false);
    await runAsync('await openVault("5678", "pin"); await revealLockedTabs(); return true;');
    check('once unlocked the guard lets go',
      (await run('return sealedGuard([' + JSON.stringify(idBefore) + '])')) === true);

    // ---- undoing the lock asks for the PIN again, even while it is open
    check('confirming re-checks a wrong PIN', await (async () => {
      await run('openPinDialog("verify"); pinInput.value = "0000"; return true;');
      await runAsync('await confirmPinDialog(); return true;');
      const stillOpen = await run('return !pinDialog.classList.contains("hidden")');
      const shown = await run('return !pinError.classList.contains("hidden")');
      await run('closePinDialog(false); return true;');
      return stillOpen && shown;
    })());
    check('and accepts the right one', await (async () => {
      const p = run('return confirmPin();');
      await nap(150);
      await run('pinInput.value = "5678"; return true;');
      await runAsync('await confirmPinDialog(); return true;');
      return (await p) === true;
    })());

    // ---- unlocking everything clears the vault and keeps the text
    await runAsync('await removeAllLocks_test(); return true;');
    check('unlock-everything keeps the text',
      (await run('return activeTab().content')) === SECRET);
    check('and clears the PIN', (await run('return vaultExists()')) === false);
    check('so a new PIN can be set',
      typeof (await runAsync('return await createVault("4321");')) === 'string');
    await runAsync('await lockNote(activeTab().id); await closeVault(); return true;');

    // ---- and the way out when the PIN is gone
    check('forgetting the PIN says how much is at stake', await (async () => {
      await run('openLockResetDialog(); return true;');
      const txt = await run('return lockResetText.textContent');
      const armed = await run('return lockResetGo.disabled');
      await run('lockResetAck.checked = true; lockResetAck.dispatchEvent(new Event("change")); return true;');
      const nowArmed = await run('return !lockResetGo.disabled');
      return /still encrypted/.test(txt) && armed === true && nowArmed;
    })());
    await run('lockResetGo.click(); return true;');
    await nap(300);
    check('forgetting it clears the vault',
      (await run('return vaultExists()')) === false
      && (await run('return lockedTabs().length')) === 0);
    check('and leaves the tab in place, empty',
      (await run('return state.tabs.length')) === nBefore);

    // The text has to be in the note *before* it is locked, or the ciphertext
    // holds an empty note and revealLockedTabs faithfully restores nothing.
    await runAsync('await createVault("5678"); return true;');
    await run('setEditorText(' + JSON.stringify(SECRET) + '); syncEditorToState(); return true;');
    await runAsync('await lockNote(activeTab().id); return true;');

    // ---- removing the lock puts the note back as ordinary text
    await runAsync([
      'await revealLockedTabs();',
      'const p = removeLock(activeTab().id);',
      'await new Promise(r => setTimeout(r, 120));',
      'pinInput.value = "5678";',
      'await confirmPinDialog();',
      'await p;',
      'return true;'
    ].join(String.fromCharCode(10)));
    check('lock removed', (await run('return !activeTab().locked && !activeTab().enc')));
    check('content restored', (await run('return activeTab().content')) === SECRET);
    await runAsync('await doSave(); return true;');
    check('unlocked note saves as plain text again',
      JSON.stringify(lastSaved).includes('sk-abcdef123456'));
  } catch (err) {
    results.push('THREW  ' + (err && err.message));
  }

  try {
    await run([
      'settings.theme = "midnight"; applySettings();',
      'state.tabs[0].locked = true; state.tabs[0].content = ""; vaultKey = null;',
      'renderTabs(); applyLockView(); return true;'
    ].join(NL));
    await new Promise((r) => setTimeout(r, 300));
    require('fs').writeFileSync(path.join(__dirname, 'shot-lock.png'),
      (await win.webContents.capturePage()).toPNG());
    await run('openPinDialog("setup"); return true;');
    await new Promise((r) => setTimeout(r, 300));
    require('fs').writeFileSync(path.join(__dirname, 'shot-pin.png'),
      (await win.webContents.capturePage()).toPNG());
    console.log('shots written');
  } catch (e) { console.log('shot failed', e && e.message); }

  console.log('===== RESULTS =====');
  results.forEach((r) => console.log(r));
  console.log(errors.length ? '===== RENDERER ERRORS =====' : 'no renderer errors');
  errors.slice(0, 15).forEach((e) => console.log(e));
  app.exit(0);
});
