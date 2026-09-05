// Regenerates the README screenshots.
//
//   electron tools/shoot-readme.js
//
// Six of them at 780x600, on the Mono theme, from synthetic data only — the
// user's real notes never go in a screenshot. Writes straight into
// screenshots/.
//
// The awkward part is seeding a tab. `switchTab()` runs `syncEditorToState()`
// first, which copies the *editor* into the tab — and right after seeding the
// editor is still empty, so switching wipes the content that was just put
// there. Set `state.activeId` directly and paint the editor by hand instead.
//
// The other trap is sample text: anything shaped like a placeholder gets
// detected as one and pops the fill panel open, so a code snippet with braces
// in it quietly changes the layout of the shot it appears in.
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const W = 780, H = 600;
const OUT = path.join(__dirname, '..', 'screenshots');
const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '4.0.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Default' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: W, height: H, show: true, alwaysOnTop: true, useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const NL = String.fromCharCode(10);
  const ev = (s) => win.webContents.executeJavaScript(s, true);
  const run = (s) => ev('(() => {' + NL + s + NL + '})()');

  for (let i = 0; i < 150; i++) {
    try { if (await ev('(() => typeof activeTab === "function" && !!settings)()')) break; }
    catch (e) { /* still parsing */ }
    await nap(120);
  }
  await nap(900);

  const shot = async (name) => {
    await nap(650);
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    console.log('  ' + name + '.png');
  };

  // ---- synthetic workspace -------------------------------------------------
  // No braces or ${} anywhere in the sample text: both are read as
  // placeholders and open the fill panel.
  await run(`
    const now = Date.now();
    settings.theme = 'mono';
    settings.animations = false;
    // A stand-in key, never used for a request: without one the chat shows
    // its setup card instead of a conversation, and the setup card is not
    // what the screenshot is for. The value is nonsense on purpose.
    settings.ai = Object.assign({}, settings.ai, {
      provider: 'openrouter',
      openrouterKey: 'sk-or-v1-screenshot-placeholder-not-a-real-key'
    });
    state.groups = [
      { id: 'g1', name: 'Client work', collapsed: false },
      { id: 'g2', name: 'Personal', collapsed: false }
    ];
    state.tabs = [
      { id: 't1', name: 'Landing page copy', custom: true, groupId: 'g1', color: '#3b82f6',
        content: 'Write a landing page for [product].' + String.fromCharCode(10) +
          'Audience: [who]. Tone: [tone|warm, plain, poetic].' + String.fromCharCode(10) +
          String.fromCharCode(10) +
          'Keep it under [words] words. No exclamation marks.' + String.fromCharCode(10) +
          'Give a Persian version after the English one.' + String.fromCharCode(10) +
          String.fromCharCode(10) +
          // A voice note, mid-line, which is the point of them. The file does
          // not exist and does not need to: the chip renders from the token
          // and only reaches for the audio when somebody presses play.
          'What the client actually said: ![voice](ppimg://brief.webm|17000)',
        dir: 'auto', align: 'auto', snapshots: [] },
      { id: 't2', name: 'System prompt v3', custom: true, groupId: 'g1', color: '#a855f7',
        content: 'You are a careful editor.', dir: 'auto', align: 'auto', snapshots: [] },
      { id: 't3', name: 'Release notes', custom: true, groupId: 'g1',
        content: 'Summarise the diff for a changelog.', dir: 'auto', align: 'auto', snapshots: [] },
      { id: 't4', name: 'Bug report template', custom: true, groupId: 'g2',
        content: 'Steps, expected, actual.', dir: 'auto', align: 'auto', snapshots: [] },
      { id: 't5', name: 'Weekly summary', custom: true, groupId: 'g2',
        content: 'Pull the week into six bullets.', dir: 'auto', align: 'auto', snapshots: [] }
    ];
    state.seq = 6;
    state.fastSave = { messages: [
      { id: 'f1', ts: now - 5400000, text: 'the phrase he used: "quietly competent"' },
      { id: 'f2', ts: now - 3200000, text: 'ask about the Sept invoice before Friday' },
      { id: 'f3', ts: now - 900000, text: 'prompt idea — rewrite as a telegram, then expand' },
      { id: 'f4', ts: now - 120000, text: 'tea company brief is in the shared drive' }
    ] };
    state.aiChat = { messages: [
      { id: 'a1', ts: now - 300000, role: 'user', text: 'Make this prompt shorter without losing the constraints.' },
      { id: 'a2', ts: now - 295000, role: 'assistant',
        text: 'Here it is at about half the length. I kept the three hard constraints — word count, no exclamation marks, and the Persian version — and dropped the restatements around them.' },
      { id: 'a3', ts: now - 60000, role: 'user', text: 'Now give me a version for a technical audience.' }
    ] };
    applySettings();
    renderTabs();
    return true;`);
  await nap(500);

  // 01 — the workspace. Paint the editor by hand; see the note at the top.
  await run(`
    state.activeId = 't1';
    showEditorView();
    setEditorText(state.tabs[0].content);
    if (typeof editorLines === 'function' && typeof highlightLine === 'function') {
      editorLines().forEach(highlightLine);
    }
    updatePlaceholderPanel();
    renderTabs();
    updateCounts();
    return true;`);
  console.log('writing:');
  await shot('01-workspace');

  // 02 — Fast Save
  await run('state.activeId = FS_ID; renderTabs(); showFastSaveView(); renderFsMessages(); return true;')
    .catch(() => run('openFastSave(); return true;'));
  await shot('02-fast-save');

  // 03 — AI Chat
  await run('state.activeId = AI_ID; renderTabs(); showAiChatView(); renderAiMessages(); return true;')
    .catch(() => run('openAiChat(); return true;'));
  await shot('03-ai-chat');

  // 04 — Markdown preview
  await run(`
    state.activeId = 't1';
    const t = state.tabs[0];
    t.content = '## Landing page brief' + String.fromCharCode(10) + String.fromCharCode(10) +
      'A short page for a tea company. Calm, unhurried.' + String.fromCharCode(10) + String.fromCharCode(10) +
      '- [x] tone agreed' + String.fromCharCode(10) +
      '- [ ] headline' + String.fromCharCode(10) +
      '- [ ] Persian version' + String.fromCharCode(10) + String.fromCharCode(10) +
      '\`\`\`' + String.fromCharCode(10) +
      'Rewrite the paragraph below in six words.' + String.fromCharCode(10) +
      'Keep the verb. Lose the adjectives.' + String.fromCharCode(10) +
      '\`\`\`' + String.fromCharCode(10);
    showEditorView();
    setEditorText(t.content);
    // setMdPreview is the switch the button itself uses: it flips the tab
    // flag, renders, and unhides the preview. Setting the flag alone leaves
    // the source on screen, which is the one thing this shot must not show.
    setMdPreview(true);
    updatePlaceholderPanel();
    renderTabs();
    updateCounts();
    return true;`);
  await shot('04-markdown');

  // 05 — the AI actions menu.
  //
  // It refuses to open while the markdown preview is up (there is no live
  // selection to act on), so the preview goes off first. Some saved custom
  // actions are seeded too — the menu is half empty without them and the
  // point of the shot is that you can add your own.
  await run(`
    setMdPreview(false);
    settings.aiActions = [
      { id: 'c1', name: 'Make it a checklist', prompt: 'Rewrite as a checklist.' },
      { id: 'c2', name: 'Tighten by a third', prompt: 'Cut a third of the words.' }
    ];
    setEditorText(state.tabs[0].content);
    showAiActionsMenu(250, 150);
    return true;`);
  await shot('05-ai-actions');
  await run('if (typeof hideAiActionsMenu === "function") hideAiActionsMenu(); return true;');

  // 06 — Settings, on the pane people actually change
  await run('openSettings(); setSettingsPane("general"); return true;');
  await shot('06-settings');

  // 08 — the theme browser, which is the headline of this release
  await run(`
    settings.favThemes = ['koi', 'silk'];
    settings.seenThemes = Object.keys(PP_THEMES);
    settings.animations = true;
    setSettingsPane('theme');
    return true;`);
  await nap(1400);
  await shot('08-themes');

  // 09 — the toolbar flyout. Worth its own shot now that it is where the
  // buttons that do not fit actually go.
  await run(`
    setSettingsPane('general');
    closeSettings();
    state.activeId = 't1';
    // Step 04 overwrote this tab with the markdown sample; put the prompt
    // back so the shot is not a wall of raw code fences behind the menu.
    state.tabs[0].content = 'Write a landing page for [product].' + String.fromCharCode(10) +
      'Audience: [who]. Tone: [tone|warm, plain, poetic].' + String.fromCharCode(10) +
      String.fromCharCode(10) +
      'Keep it under [words] words. No exclamation marks.';
    showEditorView();
    setEditorText(state.tabs[0].content);
    if (typeof editorLines === 'function' && typeof highlightLine === 'function') {
      editorLines().forEach(highlightLine);
    }
    renderTabs();
    updateCounts();
    return true;`);
  await nap(400);
  await run('toolbarOverflowBtnEl.click(); return true;');
  await nap(500);
  await shot('09-toolbar');

  app.exit(0);
});
