// Generates the guide's screenshots from the running app into
// src/guide-images/. Re-run it after a UI change so the pictures in the guide
// can't drift away from what the app actually looks like.
//
//   electron tools/shoot-guide.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'src', 'guide-images');
const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);

const NL = String.fromCharCode(10);
const S = (...lines) => lines.join(NL);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '3.9.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Work' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: 720, height: 470, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, l, m) => { if (l >= 2) errors.push(m); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = (src) => win.webContents.executeJavaScript(src, true);
  for (let i = 0; i < 150; i++) {
    try {
      const up = await evalJs(
        '(() => (typeof activeTab === "function" && !!activeTab() && !!settings' +
        ' && document.querySelectorAll(".tab").length > 0))()');
      if (up) {
        await evalJs('(() => { settings.__driverReady = 1; return true; })()');
        await nap(700);
        if (await evalJs('(() => settings.__driverReady === 1)()')) break;
      }
    } catch (e) { /* still parsing */ }
    await nap(120);
  }

  const run = (src) => evalJs('(() => {' + NL + src + NL + '})()');
  fs.mkdirSync(OUT, { recursive: true });

  // A believable workspace, so the pictures look like somebody's notes rather
  // than an empty app.
  console.log('  workspace: ' + await run(S(
    'settings.theme = "midnight"; settings.animations = false; applySettings();',
    'state.tabs = [];',
    'const mk = (name, content, extra) => Object.assign(',
    '  { id: uid(), name, custom: true, content, dir: "auto", align: "auto", color: null }, extra || {});',
    'state.groups = [{ id: "g1", name: "Client work", collapsed: false, color: "#5ea8e0" }];',
    'state.tabs.push(mk("Tea landing page",',
    '  "Write a landing page for a tea company." + String.fromCharCode(10) +',
    '  "Calm, unhurried, and it should smell like the shop." + String.fromCharCode(10) +',
    '  "Audience: [who]. Tone: [tone|warm, plain, poetic]. Date: [date]",',
    '  { groupId: "g1", color: "#5ea8e0" }));',
    'state.tabs.push(mk("Release notes", "Summarise these commits for people who do not read code.", { groupId: "g1" }));',
    'state.tabs.push(mk("Interview questions", "Ten questions for a [role] candidate."));',
    'state.tabs.push(mk("Scratch", "ideas, unsorted"));',
    'state.activeId = state.tabs[0].id;',
    // Not switchTab(): it flushes the editor into the active tab first, and
    // the active tab is already the one being set up — so it wrote the empty
    // editor straight over the note it was about to display.
    'renderTabs(); setEditorText(state.tabs[0].content);',
    'updateCounts(); updatePlaceholderPanel(); applyEditorAlign();',
    'return getEditorText().length + " chars";'
  )));
  await nap(400);

  const shot = async (name) => {
    await nap(320);
    fs.writeFileSync(path.join(OUT, name), (await win.webContents.capturePage()).toPNG());
    console.log('  ' + name);
  };

  console.log('writing guide images:');

  // 1. the workspace
  await shot('basics.png');

  // 2. placeholders — the fill bar with a dropdown and a prefilled date.
  // switchTab() rather than trusting the editor to still hold the note: the
  // previous shot's shot came out with an empty editor, and a guide picture
  // of an empty app teaches the wrong thing.
  console.log('  placeholders step: ' + await run(S(
    'settings.placeholderBarPosition = "right"; applySettings();',
    'setEditorText(state.tabs[0].content); syncEditorToState();',
    'updatePlaceholderPanel();',
    'const ins = placeholderFieldsEl.querySelector("input");',
    'if (ins) ins.value = "small independent shops";',
    'const n = placeholderFieldsEl.children.length;',
    'return getEditorText().length + " chars, " + n + " fields";'
  )));
  await shot('placeholders.png');

  // 3. blocks — the "@" picker open over the note
  await run(S(
    'settings.placeholderBarPosition = "top"; applySettings();',
    'setEditorText("You are helping me write a product page." + String.fromCharCode(10) + "@");',
    'const ln = editorLines()[1];',
    'placeCaretInLine(ln, 1);',
    'refreshInlinePop();',
    'return true;'
  ));
  await shot('blocks.png');

  // 4. AI — the actions menu
  // showAiActionsMenu() rather than poking the element: it is the path the app
  // itself uses, so the picture cannot show a menu the app would never draw.
  console.log('  ai step: ' + await run(S(
    'closeInlinePop();',
    'setEditorText("Write a launch announcement for our new pricing.");',
    'syncEditorToState(); updateCounts();',
    'showAiActionsMenu(210, 96);',
    'return aiActionsMenu.classList.contains("hidden") ? "menu did not open" : "ok";'
  )));
  await shot('ai.png');

  // 5. Fast Save
  await run(S(
    'aiActionsMenu.classList.add("hidden");',
    'settings.fastSaveEnabled = true;',
    'state.fastSave = { messages: [',
    '  { id: uid(), ts: Date.now() - 5400000, text: "check the Figma link before Thursday" },',
    '  { id: uid(), ts: Date.now() - 3200000, text: "prompt that worked: ask for the objection first, then the answer" },',
    '  { id: uid(), ts: Date.now() - 600000, text: "https://example.com/pricing-teardown" }',
    '] };',
    'renderTabs(); switchToFastSave();',
    'return true;'
  ));
  await shot('fastsave.png');

  // 6. themes — the board
  await run(S(
    'switchTab(state.tabs[0].id);',
    'openSettings(); setSettingsPane("theme");',
    'return true;'
  ));
  await shot('themes.png');

  // 7. lock — the pane over a locked note
  await run(S(
    'closeSettings();',
    'state.tabs[3].locked = true; state.tabs[3].content = ""; vaultKey = null;',
    'renderTabs(); switchTab(state.tabs[3].id); applyLockView();',
    'return true;'
  ));
  await shot('lock.png');

  // 8. out of the way — the command palette
  await run(S(
    'state.tabs[3].locked = false; delete state.tabs[3].enc;',
    'switchTab(state.tabs[0].id); applyLockView();',
    'openCommandPalette(); cmdInput.value = "int"; renderCmdResults();',
    'return true;'
  ));
  await shot('handy.png');

  // 9. sharing — the tab menu with Share on it
  await run(S(
    'closeCommandPalette();',
    'const el = tabListEl.querySelector(".tab");',
    'const r = el.getBoundingClientRect();',
    'showCtxMenu({ preventDefault() {}, clientX: r.right + 6, clientY: r.top },',
    '  state.tabs[0].id);',
    'return true;'
  ));
  await shot('share.png');

  await run('hideCtxMenu(); return true;');
  console.log(errors.length ? 'ERRORS: ' + errors.slice(0, 6).join(' | ') : 'no renderer errors');
  app.exit(0);
});
