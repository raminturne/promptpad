// ---------- State ----------
let state = {
  tabs: [],      // { id, name, custom (bool), content }
  activeId: null,
  seq: 1
};

let saveTimer = null;

// ---------- Themes & settings ----------
const THEMES = {
  forest:   { label: 'Forest',   bg: '#1B211A', text: '#D3DAD9', sidebar: '#161b15', elevated: '#222a21', elevatedHi: '#2a332a', accent: '#7fbf8b', danger: '#e08a7a' },
  midnight: { label: 'Midnight', bg: '#0f1620', text: '#cdd6e3', sidebar: '#0b121b', elevated: '#18222f', elevatedHi: '#1f2b3a', accent: '#5ea8e0', danger: '#e08a7a' },
  slate:    { label: 'Slate',    bg: '#14181c', text: '#cdd5da', sidebar: '#0f1316', elevated: '#1d242a', elevatedHi: '#262f36', accent: '#79c6c0', danger: '#e08a7a' },
  carbon:   { label: 'Carbon',   bg: '#161616', text: '#dad9d6', sidebar: '#101010', elevated: '#202020', elevatedHi: '#2a2a2a', accent: '#d9a566', danger: '#e08a7a' },
  plum:     { label: 'Plum',     bg: '#1a141f', text: '#e2d8e8', sidebar: '#150f1a', elevated: '#241a2b', elevatedHi: '#2e2236', accent: '#b88ad9', danger: '#e08a8a' },
  ember:    { label: 'Ember',    bg: '#1f1517', text: '#ecdad6', sidebar: '#190f11', elevated: '#2a1c1d', elevatedHi: '#341f22', accent: '#e0907a', danger: '#e0707a' }
};

const DEFAULT_SETTINGS = {
  theme: 'forest',
  tabPosition: 'left',
  pinningEnabled: true,
  railResizable: true,
  railWidth: 166,
  launchAtStartup: false
};

let settings = { ...DEFAULT_SETTINGS };

// ---------- DOM ----------
const tabListEl = document.getElementById('tabList');
const editorEl = document.getElementById('editor');
const charCountEl = document.getElementById('charCount');
const tokenCountEl = document.getElementById('tokenCount');
const copyBtn = document.getElementById('copyBtn');
const copyLabel = document.getElementById('copyLabel');
const addBtn = document.getElementById('addBtn');
const pinBtn = document.getElementById('pinBtn');
const minBtn = document.getElementById('minBtn');
const closeBtn = document.getElementById('closeBtn');
const appEl = document.querySelector('.app');
const railEl = document.getElementById('rail');
const railResizer = document.getElementById('railResizer');
// settings panel
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsClose = document.getElementById('settingsClose');
const themeRow = document.getElementById('themeRow');
const layoutSeg = document.getElementById('layoutSeg');
const togglePinEl = document.getElementById('togglePin');
const toggleResizeEl = document.getElementById('toggleResize');
const toggleStartupEl = document.getElementById('toggleStartup');
const resetBtn = document.getElementById('resetBtn');
const resizeRow = document.getElementById('resizeRow');

// ---------- Helpers ----------
function uid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null;
}

// Any Hebrew/Arabic/Persian character → treat as RTL
const RTL_RE = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;

function detectDir(text) {
  return RTL_RE.test(text || '') ? 'rtl' : 'ltr';
}

// ---------- Editor (contenteditable, per-line direction) ----------
function makeLine(line) {
  const d = document.createElement('div');
  d.className = 'ln';
  if (line === '') d.appendChild(document.createElement('br'));
  else d.textContent = line;
  return d;
}

// All top-level line elements (divs). Browser-created lines (from Enter)
// won't carry our .ln class, so we key off direct element children.
function editorLines() {
  return Array.from(editorEl.children).filter((n) => n.nodeType === 1);
}

function getEditorText() {
  // Defensive: a stray top-level text node means structure was flattened.
  const strayText = Array.from(editorEl.childNodes)
    .some((n) => n.nodeType === 3 && n.textContent !== '');
  if (strayText) return editorEl.innerText.replace(/\n$/, '');
  const els = editorLines();
  if (!els.length) return '';
  return els.map((d) => d.textContent).join('\n');
}

function setEditorText(text) {
  editorEl.innerHTML = '';
  const lines = (text || '').split('\n');
  for (const line of lines) editorEl.appendChild(makeLine(line));
  updateLineDirs();
  updateEmptyState();
}

// Wrap any stray top-level text node / <br> (which can't carry a dir) into a
// line div, so every line is a stylable element. Preserves the moved node so
// the caret stays valid.
function normalizeStrayNodes() {
  Array.from(editorEl.childNodes).forEach((n) => {
    if (n.nodeType === 3) {
      if (n.textContent === '') { n.remove(); return; }
      const d = document.createElement('div');
      d.className = 'ln';
      editorEl.insertBefore(d, n);
      d.appendChild(n);
    } else if (n.nodeType === 1 && n.tagName === 'BR') {
      const d = document.createElement('div');
      d.className = 'ln';
      editorEl.insertBefore(d, n);
      d.appendChild(n);
    }
  });
}

// Place the caret inside a line element at a given character offset.
function placeCaretInLine(el, offset) {
  const node = el.firstChild;
  const r = document.createRange();
  if (node && node.nodeType === 3) {
    r.setStart(node, Math.min(offset, node.textContent.length));
  } else {
    r.setStart(el, 0); // empty line (<br>)
  }
  r.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

// In a plaintext-only contenteditable with pre-wrap, pressing Enter inserts a
// "\n" *inside* the current line div instead of creating a new line element.
// That means a single block can hold two visual lines, and per-line direction
// can't apply (the whole block takes one direction). Here we split any line
// that contains a newline back into separate .ln divs, keeping the caret put,
// so each visual line is its own element again. Runs only when a "\n" is
// present (Enter / multi-line paste), so normal typing keeps native editing.
function splitMultilineLines() {
  for (const el of editorLines()) {
    if (el.textContent.indexOf('\n') === -1) continue;

    // Caret offset within this element (if the caret is inside it).
    let caretInEl = null;
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (el === r.endContainer || el.contains(r.endContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(el);
        pre.setEnd(r.endContainer, r.endOffset);
        caretInEl = pre.toString().length;
      }
    }

    const parts = el.textContent.split('\n');
    const newEls = parts.map((p) => makeLine(p));
    el.replaceWith(...newEls);

    if (caretInEl != null) {
      let acc = 0;
      let target = newEls[0];
      let offsetInPart = caretInEl;
      for (let i = 0; i < parts.length; i++) {
        if (caretInEl <= acc + parts[i].length) {
          target = newEls[i];
          offsetInPart = caretInEl - acc;
          break;
        }
        acc += parts[i].length + 1; // +1 for the consumed "\n"
      }
      placeCaretInLine(target, offsetInPart);
    }
    return true;
  }
  return false;
}

// Direction per line: each line that contains any Persian/Arabic char is RTL.
// A manual override on the tab (tab.dir) forces every line one direction.
//
// We set the direction via inline style (not just the `dir` attribute) on
// purpose: Blink skips re-layout when the `dir` *attribute* of the
// contenteditable line holding the caret changes, so the flip wouldn't show
// until another event (e.g. a tab switch) rebuilt the DOM. Mutating inline
// style is always invalidated, so the line re-renders live as you type.
function updateLineDirs() {
  normalizeStrayNodes();
  splitMultilineLines();
  const t = activeTab();
  const forced = t && (t.dir === 'rtl' || t.dir === 'ltr') ? t.dir : null;
  let changed = false;
  editorLines().forEach((d) => {
    if (!d.classList.contains('ln')) d.classList.add('ln');
    const want = forced || detectDir(d.textContent);
    if (d.getAttribute('dir') !== want) {
      d.setAttribute('dir', want);
      d.style.direction = want;
      d.style.textAlign = want === 'rtl' ? 'right' : 'left';
      changed = true;
    }
  });
  // Flush the pending layout so the new direction paints this frame.
  if (changed) void editorEl.offsetHeight;
}

function updateEmptyState() {
  editorEl.classList.toggle('is-empty', getEditorText() === '');
}

// kept as a single entry point used around the app
function applyEditorDir() {
  updateLineDirs();
  updateEmptyState();
}

function placeCaretEnd() {
  const r = document.createRange();
  r.selectNodeContents(editorEl);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

// Auto-name a tab from its first non-empty line, else "Prompt N"
function autoName(tab, index) {
  if (tab.custom && tab.name) return tab.name;
  const firstLine = (tab.content || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) {
    return firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine;
  }
  return 'Prompt ' + (index + 1);
}

// Rough token estimate (~4 chars per token)
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(Math.ceil(text.trim().length / 4), text.trim() ? 1 : 0);
}

function updateCounts() {
  const t = activeTab();
  const text = t ? t.content : '';
  const chars = text.length;
  charCountEl.textContent = chars.toLocaleString('en-US') + (chars === 1 ? ' char' : ' chars');
  tokenCountEl.textContent = '~' + estimateTokens(text).toLocaleString('en-US') + ' tokens';
}

// ---------- Render ----------
function renderTabs() {
  tabListEl.innerHTML = '';

  if (state.tabs.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No prompts yet. Hit "new" to start.';
    tabListEl.appendChild(hint);
    return;
  }

  const pinsOn = settings.pinningEnabled;
  const ordered = orderedTabs();
  let lastPinnedId = null;
  if (pinsOn) ordered.forEach((t) => { if (t.pinned) lastPinnedId = t.id; });

  ordered.forEach((tab) => {
    const i = state.tabs.indexOf(tab);
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeId ? ' active' : '') +
      (pinsOn && tab.pinned ? ' pinned' : '') +
      (pinsOn && tab.id === lastPinnedId ? ' pin-divider' : '');
    el.dataset.id = tab.id;
    el.draggable = true;

    // pin toggle (tiny icon)
    const pinEl = document.createElement('button');
    pinEl.className = 'tab-pin';
    pinEl.title = tab.pinned ? 'Unpin' : 'Pin';
    pinEl.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<path d="M14 3l7 7-3 1-1 4-4 4-2-6-6-2 4-4 4-1 1-3z" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    el.appendChild(pinEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'tab-name';
    const dispName = autoName(tab, i);
    nameEl.setAttribute('dir', detectDir(dispName));
    nameEl.textContent = dispName;
    el.appendChild(nameEl);

    const closeEl = document.createElement('button');
    closeEl.className = 'tab-close';
    closeEl.innerHTML = '&times;';
    closeEl.title = 'Close';
    el.appendChild(closeEl);

    // switch tab
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close') || e.target.closest('.tab-pin')) return;
      switchTab(tab.id);
    });

    // rename on double click
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(tab, el, nameEl, i);
    });

    // close
    closeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    // pin
    pinEl.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(tab.id);
    });

    // drag & drop
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tab.id); } catch {}
    });
    el.addEventListener('dragend', onDragEnd);

    tabListEl.appendChild(el);
  });
}

// Pinned tabs first (preserving their order), then unpinned (stable)
function orderedTabs() {
  if (!settings.pinningEnabled) return state.tabs.slice();
  const pinned = state.tabs.filter((t) => t.pinned);
  const rest = state.tabs.filter((t) => !t.pinned);
  return [...pinned, ...rest];
}

function togglePin(id) {
  const t = state.tabs.find((x) => x.id === id);
  if (!t) return;
  t.pinned = !t.pinned;
  renderTabs();
  scheduleSave();
}

// ---------- Drag & drop reorder ----------
function getDragAfterElement(x, y) {
  const horizontal = settings.tabPosition === 'top';
  const els = [...tabListEl.querySelectorAll('.tab:not(.dragging)')];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = horizontal
      ? x - box.left - box.width / 2
      : y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}

tabListEl.addEventListener('dragover', (e) => {
  const dragging = tabListEl.querySelector('.dragging');
  if (!dragging) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const after = getDragAfterElement(e.clientX, e.clientY);
  if (after == null) {
    tabListEl.appendChild(dragging);
  } else {
    tabListEl.insertBefore(dragging, after);
  }
});

function onDragEnd() {
  const dragging = tabListEl.querySelector('.dragging');
  if (dragging) dragging.classList.remove('dragging');
  // rebuild order from DOM
  const domOrder = [...tabListEl.querySelectorAll('.tab')].map((el) => el.dataset.id);
  state.tabs.sort((a, b) => domOrder.indexOf(a.id) - domOrder.indexOf(b.id));
  renderTabs(); // re-applies pinned-on-top grouping + divider
  scheduleSave();
}

function startRename(tab, tabEl, nameEl, index) {
  const input = document.createElement('input');
  input.className = 'tab-name-input';
  input.value = tab.custom && tab.name ? tab.name : autoName(tab, index);
  input.setAttribute('dir', detectDir(input.value));
  input.addEventListener('input', () => {
    input.setAttribute('dir', detectDir(input.value));
  });
  tabEl.replaceChild(input, nameEl);
  input.focus();
  input.select();

  const commit = () => {
    const v = input.value.trim();
    if (v) {
      tab.name = v;
      tab.custom = true;
    } else {
      tab.custom = false;
      tab.name = '';
    }
    renderTabs();
    scheduleSave();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
  });
}

// ---------- Actions ----------
function switchTab(id) {
  // flush current editor into state first
  syncEditorToState();
  state.activeId = id;
  const t = activeTab();
  setEditorText(t ? t.content : '');
  renderTabs();
  updateCounts();
  editorEl.focus();
  placeCaretEnd();
  scheduleSave();
}

function addTab(focus = true) {
  syncEditorToState();
  const tab = { id: uid(), name: '', custom: false, content: '', dir: 'auto' };
  state.tabs.push(tab);
  state.activeId = tab.id;
  setEditorText('');
  renderTabs();
  updateCounts();
  if (focus) editorEl.focus();
  scheduleSave();
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  state.tabs.splice(idx, 1);

  if (state.activeId === id) {
    const next = state.tabs[idx] || state.tabs[idx - 1] || null;
    state.activeId = next ? next.id : null;
    setEditorText(next ? next.content : '');
  }
  renderTabs();
  updateCounts();
  scheduleSave();
}

function syncEditorToState() {
  const t = activeTab();
  if (t) t.content = getEditorText();
}

// ---------- Persistence ----------
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 350);
}

async function doSave() {
  syncEditorToState();
  try {
    await window.api.saveNotes(state);
  } catch (e) {
    console.error('save failed', e);
  }
}

async function loadState() {
  const saved = await window.api.loadNotes();
  if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
    state = {
      tabs: saved.tabs,
      activeId: saved.activeId && saved.tabs.some((t) => t.id === saved.activeId)
        ? saved.activeId
        : saved.tabs[0].id,
      seq: saved.seq || 1
    };
  } else {
    state.tabs = [{ id: uid(), name: '', custom: false, content: '', dir: 'auto' }];
    state.activeId = state.tabs[0].id;
  }
  const t = activeTab();
  setEditorText(t ? t.content : '');
  renderTabs();
  updateCounts();
}

// ---------- Events ----------
editorEl.addEventListener('input', () => {
  updateLineDirs();
  updateEmptyState();
  const t = activeTab();
  if (t) {
    t.content = getEditorText();
    // live update auto-name if not custom
    if (!t.custom) renderTabs();
  }
  updateCounts();
  scheduleSave();
});

addBtn.addEventListener('click', () => addTab());

copyBtn.addEventListener('click', async () => {
  const t = activeTab();
  if (!t || !t.content) return;
  try {
    await navigator.clipboard.writeText(t.content);
    copyBtn.classList.add('copied');
    copyLabel.textContent = 'copied!';
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyLabel.textContent = 'copy';
    }, 1300);
  } catch (e) {
    console.error('copy failed', e);
  }
});

pinBtn.addEventListener('click', async () => {
  const on = await window.api.toggleAlwaysOnTop();
  pinBtn.classList.toggle('active', on);
});

minBtn.addEventListener('click', () => window.api.minimize());
closeBtn.addEventListener('click', () => window.api.close());

// keyboard shortcuts — use e.code (physical key) so they work on any
// keyboard layout, including Persian.
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (!e.shiftKey && e.code === 'KeyT') {
    e.preventDefault();
    addTab();
  } else if (e.shiftKey && e.code === 'KeyC') {
    e.preventDefault();
    copyBtn.click();
  } else if (!e.shiftKey && e.code === 'KeyW') {
    e.preventDefault();
    if (state.activeId) closeTab(state.activeId);
  } else if (e.code === 'Tab') {
    e.preventDefault();
    cycleTab(e.shiftKey ? -1 : 1);
  } else if (e.code === 'PageDown') {
    e.preventDefault();
    cycleTab(1);
  } else if (e.code === 'PageUp') {
    e.preventDefault();
    cycleTab(-1);
  }
});

// ---- Per-tab text direction via Windows Ctrl+Shift gesture ----
// Ctrl + Right-Shift = RTL, Ctrl + Left-Shift = LTR. We persist the choice
// on the active tab so it doesn't leak to other tabs.
let chordUsedOtherKey = false;
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight' &&
      e.code !== 'ControlLeft' && e.code !== 'ControlRight') {
    chordUsedOtherKey = true;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    if (e.ctrlKey && !chordUsedOtherKey) {
      const t = activeTab();
      if (t) {
        t.dir = e.code === 'ShiftRight' ? 'rtl' : 'ltr';
        applyEditorDir();
        scheduleSave();
      }
    }
    chordUsedOtherKey = false;
  } else if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
    chordUsedOtherKey = false;
  }
});

function cycleTab(dir) {
  const ordered = orderedTabs();
  if (ordered.length < 2) return;
  const idx = ordered.findIndex((t) => t.id === state.activeId);
  const next = (idx + dir + ordered.length) % ordered.length;
  switchTab(ordered[next].id);
}

// ---------- Settings: apply ----------
function applyTheme(name) {
  const t = THEMES[name] || THEMES.forest;
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg);
  r.setProperty('--text', t.text);
  r.setProperty('--sidebar', t.sidebar);
  r.setProperty('--elevated', t.elevated);
  r.setProperty('--elevated-hi', t.elevatedHi);
  r.setProperty('--accent', t.accent);
  r.setProperty('--danger', t.danger);
  window.api.setBgColor(t.bg);
}

function applySettings() {
  applyTheme(settings.theme);
  appEl.classList.toggle('layout-top', settings.tabPosition === 'top');
  appEl.classList.toggle('pins-off', !settings.pinningEnabled);
  appEl.classList.toggle('resize-off',
    !settings.railResizable || settings.tabPosition === 'top');
  document.documentElement.style.setProperty(
    '--rail-width', (settings.railWidth || 166) + 'px');
}

async function saveSettingsNow() {
  try { await window.api.saveSettings(settings); } catch (e) { console.error(e); }
}

// ---------- Settings: panel ----------
function buildThemeSwatches() {
  themeRow.innerHTML = '';
  Object.entries(THEMES).forEach(([key, t]) => {
    const sw = document.createElement('button');
    sw.className = 'theme-swatch' + (settings.theme === key ? ' active' : '');
    sw.title = t.label;
    sw.style.background =
      'linear-gradient(135deg, ' + t.elevated + ' 0 55%, ' + t.sidebar + ' 55% 100%)';
    const dot = document.createElement('span');
    dot.className = 'sw-dot';
    dot.style.background = t.accent;
    sw.appendChild(dot);
    sw.addEventListener('click', () => {
      settings.theme = key;
      applySettings();
      buildThemeSwatches();
      saveSettingsNow();
    });
    themeRow.appendChild(sw);
  });
}

function syncSettingsUI() {
  buildThemeSwatches();
  layoutSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === settings.tabPosition);
  });
  togglePinEl.checked = settings.pinningEnabled;
  toggleResizeEl.checked = settings.railResizable;
  toggleStartupEl.checked = settings.launchAtStartup;
  resizeRow.classList.toggle('disabled', settings.tabPosition === 'top');
}

function openSettings() {
  syncSettingsUI();
  settingsOverlay.classList.remove('hidden');
}
function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

layoutSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.tabPosition = btn.dataset.layout;
  applySettings();
  syncSettingsUI();
  renderTabs();
  saveSettingsNow();
});

togglePinEl.addEventListener('change', () => {
  settings.pinningEnabled = togglePinEl.checked;
  applySettings();
  renderTabs();
  saveSettingsNow();
});

toggleResizeEl.addEventListener('change', () => {
  settings.railResizable = toggleResizeEl.checked;
  applySettings();
  saveSettingsNow();
});

toggleStartupEl.addEventListener('change', async () => {
  settings.launchAtStartup = toggleStartupEl.checked;
  const real = await window.api.setStartup(settings.launchAtStartup);
  settings.launchAtStartup = real;
  toggleStartupEl.checked = real;
  saveSettingsNow();
});

resetBtn.addEventListener('click', async () => {
  settings = { ...DEFAULT_SETTINGS };
  await window.api.setStartup(false);
  applySettings();
  syncSettingsUI();
  renderTabs();
  saveSettingsNow();
});

// about links
document.querySelectorAll('.about-link').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const url = a.dataset.url;
    if (url) window.api.openExternal(url);
  });
});

// ---------- Rail resizer ----------
let resizing = false;
railResizer.addEventListener('mousedown', (e) => {
  if (!settings.railResizable || settings.tabPosition === 'top') return;
  resizing = true;
  railResizer.classList.add('active');
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const left = railEl.getBoundingClientRect().left;
  let w = Math.round(e.clientX - left);
  w = Math.max(120, Math.min(340, w));
  settings.railWidth = w;
  document.documentElement.style.setProperty('--rail-width', w + 'px');
});
window.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  railResizer.classList.remove('active');
  document.body.style.cursor = '';
  saveSettingsNow();
});

// ---------- Init ----------
(async function init() {
  const savedSettings = await window.api.loadSettings();
  settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  // reflect real OS startup state
  try { settings.launchAtStartup = await window.api.getStartup(); } catch {}
  applySettings();

  await loadState();

  const onTop = await window.api.getAlwaysOnTop();
  pinBtn.classList.toggle('active', onTop);

  // close settings with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) {
      closeSettings();
    }
  });

  editorEl.focus();
})();
