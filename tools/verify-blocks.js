// Throwaway driver: loads the real renderer and exercises the new @-blocks,
// slash commands and typed placeholders end to end. Not part of the app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const store = { notes: {}, settings: {} };

function stub(ch, fn) { ipcMain.handle(ch, fn); }

app.whenReady().then(async () => {
  // Minimal versions of every channel bootstrap() touches.
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '3.8.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Default' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);

  const win = new BrowserWindow({
    width: 900, height: 700, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('RENDERER GONE', JSON.stringify(d));
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

  // executeJavaScript shares one global scope between calls, so a top-level
  // `const` in one snippet collides with the next. Each runs in its own body.
  const NL = String.fromCharCode(10);
  const run = (src) =>
    win.webContents.executeJavaScript('(() => {' + NL + src + NL + '})()', true);
  const results = [];
  const check = (name, ok, extra) => {
    results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : ''));
  };

  try {
    // ---- 1. blocks were seeded
    const seeded = await run('return JSON.stringify(blocks().map(b => b.name))');
    check('blocks seeded', JSON.parse(seeded).length === 4, seeded);

    // ---- 2. typing "@js" opens the popup and filters to the json block
    await run([
      'switchTab(orderedTabs()[0].id);',
      'setEditorText("");',
      'const ln = editorLines()[0];',
      'ln.textContent = "@js";',
      'placeCaretInLine(ln, 3);',
      'refreshInlinePop();',
      'true'
    ].join('\n'));
    const popOpen = await run('return JSON.stringify({open: inlineOpen(), n: inlineItems.length, first: inlineItems[0] && inlineItems[0].name})');
    check('@ popup filters', JSON.parse(popOpen).first === 'json', popOpen);

    // ---- 3. picking it replaces "@js" with the multi-line body
    await run('runInlineActive(); return true;');
    const afterBlock = await run('return JSON.stringify(activeTab().content)');
    check('@ insert is multi-line', JSON.parse(afterBlock).split('\n').length === 4, afterBlock.slice(0, 90));
    check('@ trigger consumed', !JSON.parse(afterBlock).includes('@js'));

    // ---- 4. $0 caret marker is stripped and the caret lands on it
    await run([
      'blocks().push({ id: uid(), name: "sig", body: "Dear $0,\\nBest," });',
      'setEditorText("");',
      'const ln = editorLines()[0];',
      'ln.textContent = "@sig";',
      'placeCaretInLine(ln, 4);',
      'refreshInlinePop(); runInlineActive(); true'
    ].join('\n'));
    const sig = await run('return JSON.stringify({txt: activeTab().content, col: getCaretOffsetIn(currentLine())})');
    const sigO = JSON.parse(sig);
    check('$0 stripped', !sigO.txt.includes('$0'), sig);
    check('$0 places caret', sigO.col === 5, sig);

    // ---- 5. "/" popup lists commands, and running one consumes the trigger
    await run([
      'setEditorText("");',
      'const ln = editorLines()[0];',
      'ln.textContent = "/todo";',
      'placeCaretInLine(ln, 5);',
      'refreshInlinePop(); true'
    ].join('\n'));
    const slashOpen = await run('return JSON.stringify({open: inlineOpen(), first: inlineItems[0] && inlineItems[0].name})');
    check('/ popup filters', JSON.parse(slashOpen).first === 'todo', slashOpen);
    await run('runInlineActive(); return true;');
    const afterSlash = await run('return JSON.stringify(activeTab().content)');
    check('/ runs command, trigger gone', JSON.parse(afterSlash) === '- [ ] ', afterSlash);

    // ---- 6. no trigger mid-word (URLs, emails must not open it)
    await run([
      'setEditorText("");',
      'const ln = editorLines()[0];',
      'ln.textContent = "see https://x.com/y";',
      'placeCaretInLine(ln, 18);',
      'refreshInlinePop(); true'
    ].join('\n'));
    check('no trigger inside a URL', (await run('return inlineOpen()')) === false);

    // ---- 7. typed placeholder becomes a <select>
    await run([
      'setEditorText("Write in a [tone|formal, casual, funny] voice about [topic]");',
      'syncEditorToState(); updatePlaceholderPanel(); true'
    ].join('\n'));
    const fields = await run(
      'return JSON.stringify(Array.from(placeholderFieldsEl.children).map(r => ({' +
      'token: r.dataset.token, tag: r.querySelector("input,select").tagName,' +
      'label: r.querySelector("label").textContent })))'
    );
    const f = JSON.parse(fields);
    check('typed placeholder is a select', f[0].tag === 'SELECT', fields);
    check('typed label is trimmed', f[0].label === 'tone', fields);
    check('plain placeholder stays an input', f[1].tag === 'INPUT', fields);

    // ---- 8. [date] prefills itself
    await run('setEditorText("on [date]"); syncEditorToState(); updatePlaceholderPanel(); return true;');
    const dateVal = await run('return placeholderFieldsEl.querySelector("input").value');
    check('[date] prefills', /\d/.test(dateVal), JSON.stringify(dateVal));

    // ---- 9. presets: capture the drafts, then apply to a fresh note
    await run([
      'setEditorText("Hi [name], about [subject]."); syncEditorToState(); updatePlaceholderPanel();',
      'const ins = placeholderFieldsEl.querySelectorAll("input");',
      'ins[0].value = "Sara"; ins[1].value = "the budget";',
      'state.phPresets = []; _phPendingDraft = currentPhDraft();',
      'phPresetNameInput.value = "Client A"; confirmPhPresetDialog();',
      'true'
    ].join('\n'));
    const preset = await run('return JSON.stringify(state.phPresets)');
    check('preset captured both fields',
      Object.keys(JSON.parse(preset)[0].values).length === 2, preset);
    await run([
      'setEditorText("Hi [name], about [subject]."); syncEditorToState(); updatePlaceholderPanel();',
      'applyPhPreset(state.phPresets[0]); true'
    ].join('\n'));
    const applied = await run('return JSON.stringify(activeTab().content)');
    check('preset applies in one step',
      JSON.parse(applied) === 'Hi Sara, about the budget.', applied);
    check('preset is one undo step',
      JSON.parse(await run('undo(); return JSON.stringify(activeTab().content);')) === 'Hi [name], about [subject].');
  } catch (err) {
    results.push('THREW  ' + (err && err.message));
  }

  // A shot of the popup actually open, since CSS bugs are invisible to the
  // assertions above.
  try {
    win.setSize(560, 460);
    await run([
      'settings.theme = "midnight"; applySettings();',
      'setEditorText("Write a landing page for [product]");',
      'syncEditorToState(); updatePlaceholderPanel();',
      'const ln = editorLines()[0];',
      'ln.textContent = "Write a landing page for [product]  @";',
      'placeCaretInLine(ln, ln.textContent.length);',
      'refreshInlinePop(); return true;'
    ].join(NL));
    await new Promise((r) => setTimeout(r, 400));
    console.log('popup state: ' + await run(
      'const b = inlinePop.getBoundingClientRect();' +
      'return JSON.stringify({open: inlineOpen(), n: inlineItems.length,' +
      ' hidden: inlinePop.classList.contains("hidden"),' +
      ' op: getComputedStyle(inlinePop).opacity,' +
      ' box: [b.left|0, b.top|0, b.width|0, b.height|0]});'));
    const img = await win.webContents.capturePage();
    require('fs').writeFileSync(
      require('path').join(__dirname, 'shot-blocks.png'), img.toPNG());
    console.log('shot written');
  } catch (e) { console.log('shot failed', e && e.message); }

  console.log('\n===== RESULTS =====');
  results.forEach((r) => console.log(r));
  if (errors.length) {
    console.log('\n===== RENDERER ERRORS =====');
    errors.slice(0, 20).forEach((e) => console.log(e));
  } else {
    console.log('\nno renderer errors');
  }
  app.exit(0);
});
