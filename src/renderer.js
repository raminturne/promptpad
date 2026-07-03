// ---------- State ----------
let state = {
  tabs: [],      // { id, name, custom, content, dir, pinned, color, groupId, snapshots }
  activeId: null,
  seq: 1,
  templates: [], // { id, name, content }
  groups: [],    // { id, name, collapsed }
  phValues: {}   // { '[token]': ['recent', 'values'] } — MRU, max 8
};

const TAB_COLORS = [null, '#e05252', '#e07a52', '#e0c852', '#52b05a', '#5290e0', '#9052e0', '#e052b8'];

let saveTimer = null;
let _previewToken = null;   // token currently being live-previewed
let _previewBase  = null;   // snapshot of t.content before preview started

// ---------- Themes & settings ----------
const THEMES = {
  // === Dark (7) ===
  forest:   { label: 'Forest',   type: 'dark', bg: '#1B211A', text: '#D3DAD9', sidebar: '#161b15', elevated: '#222a21', elevatedHi: '#2a332a', accent: '#7fbf8b', danger: '#e08a7a' },
  midnight: { label: 'Midnight', type: 'dark', bg: '#0f1620', text: '#cdd6e3', sidebar: '#0b121b', elevated: '#18222f', elevatedHi: '#1f2b3a', accent: '#5ea8e0', danger: '#e08a7a' },
  carbon:   { label: 'Carbon',   type: 'dark', bg: '#161616', text: '#dad9d6', sidebar: '#101010', elevated: '#202020', elevatedHi: '#2a2a2a', accent: '#d9a566', danger: '#e08a7a' },
  plum:     { label: 'Plum',     type: 'dark', bg: '#1a141f', text: '#e2d8e8', sidebar: '#150f1a', elevated: '#241a2b', elevatedHi: '#2e2236', accent: '#b88ad9', danger: '#e08a8a' },
  ember:    { label: 'Ember',    type: 'dark', bg: '#1f1517', text: '#ecdad6', sidebar: '#190f11', elevated: '#2a1c1d', elevatedHi: '#341f22', accent: '#e0907a', danger: '#e0707a' },
  dracula:  { label: 'Dracula',  type: 'dark', bg: '#282a36', text: '#f8f8f2', sidebar: '#21222c', elevated: '#313341', elevatedHi: '#414354', accent: '#bd93f9', danger: '#ff5555' },
  mono:     { label: 'Mono',     type: 'dark', bg: '#0a0a0a', text: '#f0f0f0', sidebar: '#050505', elevated: '#141414', elevatedHi: '#1e1e1e', accent: '#888888', danger: '#cc3333' },

  // === Light (7) ===
  paper:    { label: 'Paper',    type: 'light', cssClass: 'theme-light', bg: '#f7f7f5', text: '#1a1a1a', sidebar: '#eeecea', elevated: '#ffffff', elevatedHi: '#e8e6e4', accent: '#5472d4', danger: '#d94040' },
  sky:      { label: 'Sky',      type: 'light', cssClass: 'theme-light', bg: '#e8f0fb', text: '#1a2540', sidebar: '#dce8f8', elevated: '#f2f7ff', elevatedHi: '#ccddf5', accent: '#2563eb', danger: '#dc2626' },
  sage:     { label: 'Sage',     type: 'light', cssClass: 'theme-light', bg: '#eef5f0', text: '#182418', sidebar: '#e2ede6', elevated: '#f5faf6', elevatedHi: '#d4e8da', accent: '#2d7a50', danger: '#c04040' },
  rose:     { label: 'Rose',     type: 'light', cssClass: 'theme-light', bg: '#fdf0f4', text: '#2a1020', sidebar: '#f8e4ec', elevated: '#fff5f8', elevatedHi: '#f0d4e0', accent: '#d0406a', danger: '#c02050' },
  latte:    { label: 'Latte',    type: 'light', cssClass: 'theme-light', bg: '#f5ede0', text: '#2a1e10', sidebar: '#ede3d4', elevated: '#fdf6ed', elevatedHi: '#e4d8c8', accent: '#b06030', danger: '#c03030' },
  lavender: { label: 'Lavender', type: 'light', cssClass: 'theme-light', bg: '#f0ecfa', text: '#1e1830', sidebar: '#e6e0f5', elevated: '#f8f5ff', elevatedHi: '#d8d0ee', accent: '#7050c0', danger: '#c02050' },
  snow:     { label: 'Snow',     type: 'light', cssClass: 'theme-light', bg: '#ffffff', text: '#111111', sidebar: '#f5f5f5', elevated: '#ffffff', elevatedHi: '#e8e8e8', accent: '#333333', danger: '#cc0000' },
};

// ---------- Fonts ----------
const FONTS = {
  cascadia: { label: 'Cascadia',  stack: '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace' },
  consolas: { label: 'Consolas',  stack: 'Consolas, "Cascadia Code", ui-monospace, monospace' },
  jetbrains:{ label: 'JetBrains', stack: '"JetBrains Mono", Consolas, ui-monospace, monospace' },
  lucida:   { label: 'Lucida',    stack: '"Lucida Console", "Lucida Sans Typewriter", Consolas, monospace' },
  courier:  { label: 'Courier',   stack: '"Courier New", Courier, monospace' },
  system:   { label: 'System UI', stack: '"Segoe UI", Inter, system-ui, sans-serif' },
};

const DEFAULT_SETTINGS = {
  theme: 'forest',
  font: 'cascadia',
  fontSize: 13.5,
  tabPosition: 'left',
  pinningEnabled: true,
  closeButtonEnabled: true,
  railResizable: true,
  railWidth: 166,
  launchAtStartup: false,
  autoCheckUpdates: true,
  windowOpacity: 100,
  closeToTray: false,
  placeholdersEnabled: true,
  placeholderBarPosition: 'right', // 'top' | 'right'
  placeholderBarWrap: 'line', // 'line' | 'stack'
  placeholderBarWidth: 220
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
const toggleCloseEl = document.getElementById('toggleClose');
const toggleResizeEl = document.getElementById('toggleResize');
const toggleStartupEl = document.getElementById('toggleStartup');
const togglePlaceholdersEl = document.getElementById('togglePlaceholders');
const placeholderPositionSeg = document.getElementById('placeholderPositionSeg');
const placeholderWrapSeg = document.getElementById('placeholderWrapSeg');
const placeholderWrapRow = document.getElementById('placeholderWrapRow');
const resetBtn = document.getElementById('resetBtn');
const resizeRow = document.getElementById('resizeRow');
const fontSizeDownEl = document.getElementById('fontSizeDown');
const fontSizeUpEl = document.getElementById('fontSizeUp');
const fontSizeValueEl = document.getElementById('fontSizeValue');
const opacityRangeEl = document.getElementById('opacityRange');
const opacityValueEl = document.getElementById('opacityValue');
const toggleTrayEl = document.getElementById('toggleTray');
// placeholder fill bar
const editorBodyEl = document.getElementById('editorBody');
const placeholderBarEl = document.getElementById('placeholderBar');
const placeholderCountEl = document.getElementById('placeholderCount');
const placeholderFieldsEl = document.getElementById('placeholderFields');
const placeholderResizerEl = document.getElementById('placeholderResizer');
// context menu
const ctxMenuEl = document.getElementById('tabContextMenu');
const ctxPinItem = ctxMenuEl.querySelector('[data-action="pin"]');
const ctxPinGroup = document.getElementById('ctxPinGroup');
const ctxColorRowEl = ctxMenuEl.querySelector('.ctx-color-row');
const ctxGroupListEl = document.getElementById('ctxGroupList');
// group name dialog
const groupNameDialog = document.getElementById('groupNameDialog');
const groupNameInput = document.getElementById('groupNameInput');
const groupNameCancel = document.getElementById('groupNameCancel');
const groupNameSave = document.getElementById('groupNameSave');
// templates
const templatesBtn = document.getElementById('templatesBtn');
const templatesOverlay = document.getElementById('templatesOverlay');
const templatesClose = document.getElementById('templatesClose');
const templatesListEl = document.getElementById('templatesList');
const templatesEmptyEl = document.getElementById('templatesEmpty');
// find & replace
const findBarEl = document.getElementById('findBar');
const findInputEl = document.getElementById('findInput');
const findPrevEl = document.getElementById('findPrev');
const findNextEl = document.getElementById('findNext');
const findCountEl = document.getElementById('findCount');
const findCloseEl = document.getElementById('findClose');
const replaceRowEl = document.getElementById('replaceRow');
const replaceInputEl = document.getElementById('replaceInput');
const replaceOneEl = document.getElementById('replaceOne');
const replaceAllEl = document.getElementById('replaceAll');
const findAllTabsEl = document.getElementById('findAllTabs');
const findResultsEl = document.getElementById('findResults');
// markdown preview
const mdBtn = document.getElementById('mdBtn');
const mdPreviewEl = document.getElementById('mdPreview');
// history (snapshots)
const historyOverlay = document.getElementById('historyOverlay');
const historyClose = document.getElementById('historyClose');
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');
// update check
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const checkUpdateLabel = document.getElementById('checkUpdateLabel');
const toggleAutoUpdateEl = document.getElementById('toggleAutoUpdate');
const updateBannerEl = document.getElementById('updateBanner');
const updateBannerTextEl = document.getElementById('updateBannerText');
const updateBannerLinkEl = document.getElementById('updateBannerLink');
const updateBannerCloseEl = document.getElementById('updateBannerClose');
// save-as-template dialog
const saveTemplateDialog = document.getElementById('saveTemplateDialog');
const templateNameInput = document.getElementById('templateNameInput');
const templateNameCancel = document.getElementById('templateNameCancel');
const templateNameSave = document.getElementById('templateNameSave');

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

// Prompt-template blanks like [topic] or {name} — single line only.
const PLACEHOLDER_RE = /\[[^\[\]\r\n]+\]|\{[^{}\r\n]+\}/g;

function findPlaceholderTokens(text) {
  const seen = new Set();
  const tokens = [];
  for (const m of (text || '').matchAll(PLACEHOLDER_RE)) {
    if (!seen.has(m[0])) { seen.add(m[0]); tokens.push(m[0]); }
  }
  return tokens;
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

// Keep each line div as a single visual row. Blink likes to leave a trailing
// <br> behind when you start typing into an empty line (one we created as
// <div><br></div>), which renders a phantom blank row *below* the text. So:
//   - a line that has text must carry no <br>
//   - an empty line must carry exactly one <br> (so it stays selectable/tall)
// The caret lives in the text node while typing, so dropping a trailing <br>
// never disturbs it.
function cleanLineBreaks() {
  editorLines().forEach((d) => {
    const hasText = d.textContent.length > 0;
    const brs = d.getElementsByTagName('br');
    if (hasText) {
      while (brs.length) brs[0].remove();
    } else if (brs.length === 0) {
      d.appendChild(document.createElement('br'));
    } else {
      while (brs.length > 1) brs[brs.length - 1].remove();
    }
  });
}

// Place the caret inside a line element at a given character offset. Walks
// all text nodes (a line can hold several once placeholder spans split it
// up), falling back to the end of the line for empty (<br>-only) content.
function placeCaretInLine(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  let acc = 0;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (acc + len >= offset) {
      const r = document.createRange();
      r.setStart(node, Math.max(0, offset - acc));
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    acc += len;
  }
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

// Caret's character offset within `el`, or null if the caret isn't inside it.
function getCaretOffsetIn(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (el !== r.endContainer && !el.contains(r.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}

// Top-level .ln line element that currently holds the caret, if any.
function currentLine() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).endContainer;
  while (node && node !== editorEl && node.parentNode !== editorEl) node = node.parentNode;
  return node && node !== editorEl ? node : null;
}

// Rebuild a line's children as plain text interleaved with .placeholder-tag
// spans around [bracket] / {brace} matches, preserving the caret offset.
function highlightLine(el) {
  const text = el.textContent;
  const hadTags = !!el.querySelector('.placeholder-tag');
  const matches = [...text.matchAll(PLACEHOLDER_RE)];
  if (!matches.length && !hadTags) return;

  const offset = getCaretOffsetIn(el);
  el.innerHTML = '';
  if (text === '') {
    el.appendChild(document.createElement('br'));
  } else {
    let last = 0;
    for (const m of matches) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'placeholder-tag';
      span.textContent = m[0];
      el.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }
  if (offset != null) placeCaretInLine(el, offset);
}

let highlightTimer = null;
function scheduleHighlight(line) {
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    if (line && line.isConnected) highlightLine(line);
  }, 300);
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
    const caretInEl = getCaretOffsetIn(el);

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
  cleanLineBreaks();
  const t = activeTab();
  const forced = t && (t.dir === 'rtl' || t.dir === 'ltr') ? t.dir : null;
  const activeLine = currentLine();
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
    // Re-highlight lines you're not actively typing on immediately; the line
    // under the caret is debounced below so spans don't fight the caret
    // mid-keystroke.
    if (settings.placeholdersEnabled && d !== activeLine) highlightLine(d);
  });
  if (settings.placeholdersEnabled) scheduleHighlight(activeLine);
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

// ---------- Placeholder fill bar ----------
// Replace every occurrence of `token` (e.g. "[topic]") in the active tab's
// content with `value` — filling one occurrence fills them all.
// Remember a used placeholder value (MRU per token, capped)
function rememberPhValue(token, value) {
  if (!value || value.length > 200) return;
  if (!state.phValues) state.phValues = {};
  const list = state.phValues[token] || [];
  const next = [value, ...list.filter((v) => v !== value)].slice(0, 8);
  state.phValues[token] = next;
}

function fillPlaceholder(token, value) {
  const t = activeTab();
  if (!t) return;
  syncEditorToState();
  commitCheckpoint(t);
  rememberPhValue(token, value);
  const prevContent = t.content;
  t.content = t.content.split(token).join(value);
  t.undoStack = t.undoStack || [];
  t.undoStack.push(prevContent);
  if (t.undoStack.length > UNDO_LIMIT) t.undoStack.shift();
  t.redoStack = [];
  setEditorText(t.content);
  updateCounts();
  scheduleSave();
  updatePlaceholderPanel();
}

function buildPlaceholderField(token) {
  const row = document.createElement('div');
  row.className = 'placeholder-field';
  row.dataset.token = token;

  const label = document.createElement('label');
  label.textContent = token;
  label.setAttribute('dir', detectDir(token));

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type value…';

  // suggest previously used values for this token
  const dl = document.createElement('datalist');
  dl.id = 'ph-dl-' + uid();
  const refreshSuggestions = () => {
    dl.innerHTML = '';
    ((state.phValues && state.phValues[token]) || []).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      dl.appendChild(opt);
    });
  };
  refreshSuggestions();
  input.setAttribute('list', dl.id);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'placeholder-confirm';
  confirmBtn.title = 'Apply';
  confirmBtn.disabled = true;
  confirmBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
    '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const startPreview = () => {
    const t = activeTab();
    if (!t) return;
    _previewToken = token;
    _previewBase  = t.content;
  };
  const updatePreview = () => {
    if (_previewToken !== token || !_previewBase) return;
    const val = input.value;
    const preview = val ? _previewBase.split(token).join(val) : _previewBase;
    setEditorText(preview);
  };
  const endPreview = (restore) => {
    if (_previewToken !== token) return;
    _previewToken = null;
    _previewBase  = null;
    if (restore) {
      const t = activeTab();
      if (t) setEditorText(t.content);
    }
  };

  const commit = () => {
    const val = input.value.trim();
    endPreview(false); // fillPlaceholder will setEditorText with final content
    if (!val) {
      const t = activeTab();
      if (t) setEditorText(t.content);
      return;
    }
    fillPlaceholder(token, val);
  };

  input.addEventListener('focus', () => {
    refreshSuggestions();
    startPreview();
    updatePreview();
  });
  input.addEventListener('input', () => {
    confirmBtn.disabled = !input.value.trim();
    updatePreview();
  });
  input.addEventListener('blur', () => {
    // Small delay so confirm-button click can fire first
    setTimeout(() => { endPreview(true); }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!input.value.trim()) return;
      const idx = Array.from(placeholderFieldsEl.querySelectorAll('input')).indexOf(input);
      commit();
      const newInputs = Array.from(placeholderFieldsEl.querySelectorAll('input'));
      if (idx !== -1 && idx < newInputs.length) newInputs[idx].focus();
    }
  });
  // Prevent blur when clicking the confirm button
  confirmBtn.addEventListener('mousedown', (e) => e.preventDefault());
  confirmBtn.addEventListener('click', commit);

  const inputRow = document.createElement('div');
  inputRow.className = 'placeholder-field-row';
  inputRow.appendChild(input);
  inputRow.appendChild(dl);
  inputRow.appendChild(confirmBtn);

  row.appendChild(label);
  row.appendChild(inputRow);
  return row;
}

// Rebuilds the fill bar from the active tab's current placeholder tokens.
// Reuses existing field rows (instead of wiping innerHTML) so a row the user
// is mid-typing into doesn't lose focus/value just because another field
// elsewhere got filled.
function updatePlaceholderPanel() {
  const t = activeTab();
  const tokens = settings.placeholdersEnabled && t ? findPlaceholderTokens(t.content) : [];

  if (!tokens.length) {
    placeholderBarEl.classList.add('hidden');
    placeholderFieldsEl.innerHTML = '';
    return;
  }

  placeholderBarEl.classList.remove('hidden');
  placeholderCountEl.textContent =
    tokens.length + (tokens.length === 1 ? ' placeholder' : ' placeholders');

  const existing = new Map();
  Array.from(placeholderFieldsEl.children).forEach((row) => existing.set(row.dataset.token, row));

  tokens.forEach((token) => {
    const row = existing.get(token) || buildPlaceholderField(token);
    placeholderFieldsEl.appendChild(row);
    existing.delete(token);
  });
  existing.forEach((row) => row.remove());
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

  const ordered = orderedTabs();
  let lastPinnedId = null;
  ordered.forEach((t) => { if (t.pinned) lastPinnedId = t.id; });

  const makeTabEl = (tab) => {
    const i = state.tabs.indexOf(tab);
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeId ? ' active' : '') +
      (tab.pinned ? ' pinned' : '') +
      (tab.id === lastPinnedId ? ' pin-divider' : '');
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

    if (tab.color) {
      const colorDot = document.createElement('span');
      colorDot.className = 'tab-color-dot';
      colorDot.style.background = tab.color;
      el.appendChild(colorDot);
    }

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

    // right-click context menu
    el.addEventListener('contextmenu', (e) => { showCtxMenu(e, tab.id); });

    return el;
  };

  // Groups only apply in the left layout; top layout stays a flat strip.
  const groups = state.groups || [];
  const grouping = settings.tabPosition !== 'top' && groups.length > 0;

  if (!grouping) {
    ordered.forEach((tab) => tabListEl.appendChild(makeTabEl(tab)));
    return;
  }

  const inKnownGroup = (t) => t.groupId && groups.some((g) => g.id === t.groupId);

  // 1) pinned tabs always on top, regardless of group
  ordered.filter((t) => t.pinned).forEach((t) => tabListEl.appendChild(makeTabEl(t)));

  // 2) each group: header + members (hidden when collapsed)
  groups.forEach((g) => {
    const members = ordered.filter((t) => !t.pinned && t.groupId === g.id);
    tabListEl.appendChild(makeGroupHeader(g, members.length));
    if (!g.collapsed) members.forEach((t) => tabListEl.appendChild(makeTabEl(t)));
  });

  // 3) ungrouped tabs at the bottom
  ordered.filter((t) => !t.pinned && !inKnownGroup(t))
    .forEach((t) => tabListEl.appendChild(makeTabEl(t)));
}

function makeGroupHeader(group, count) {
  const el = document.createElement('div');
  el.className = 'tab-group-header' + (group.collapsed ? ' collapsed' : '');
  el.dataset.groupId = group.id;

  const chev = document.createElement('span');
  chev.className = 'tab-group-chevron';
  chev.innerHTML =
    '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">' +
    '<polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  el.appendChild(chev);

  const nameEl = document.createElement('span');
  nameEl.className = 'tab-group-name';
  nameEl.textContent = group.name;
  nameEl.setAttribute('dir', detectDir(group.name));
  el.appendChild(nameEl);

  const countEl = document.createElement('span');
  countEl.className = 'tab-group-count';
  countEl.textContent = count;
  el.appendChild(countEl);

  const delEl = document.createElement('button');
  delEl.className = 'tab-group-del';
  delEl.innerHTML = '&times;';
  delEl.title = 'Ungroup (tabs are kept)';
  el.appendChild(delEl);

  el.addEventListener('click', (e) => {
    if (e.target.closest('.tab-group-del')) return;
    group.collapsed = !group.collapsed;
    renderTabs();
    scheduleSave();
  });

  nameEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startGroupRename(group, nameEl);
  });

  delEl.addEventListener('click', (e) => {
    e.stopPropagation();
    dissolveGroup(group.id);
  });

  return el;
}

function startGroupRename(group, nameEl) {
  const input = document.createElement('input');
  input.className = 'tab-name-input';
  input.value = group.name;
  input.setAttribute('dir', detectDir(group.name));
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v) group.name = v;
    renderTabs();
    scheduleSave();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = group.name; input.blur(); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

function dissolveGroup(groupId) {
  state.tabs.forEach((t) => { if (t.groupId === groupId) t.groupId = null; });
  state.groups = (state.groups || []).filter((g) => g.id !== groupId);
  renderTabs();
  scheduleSave();
}

function setTabGroup(tabId, groupId) {
  const t = state.tabs.find((x) => x.id === tabId);
  if (!t) return;
  t.groupId = groupId;
  const g = groupId && (state.groups || []).find((x) => x.id === groupId);
  if (g) g.collapsed = false; // reveal where the tab landed
  renderTabs();
  scheduleSave();
}

// Group picker inside the tab context menu
function buildCtxGroupList(tab) {
  ctxGroupListEl.innerHTML = '';
  const mk = (label, active, cb) => {
    const b = document.createElement('button');
    b.className = 'ctx-group-item' + (active ? ' active' : '');
    b.textContent = label;
    b.setAttribute('dir', detectDir(label));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      hideCtxMenu();
      cb();
    });
    ctxGroupListEl.appendChild(b);
  };
  mk('None', !tab.groupId, () => setTabGroup(tab.id, null));
  (state.groups || []).forEach((g) => {
    mk(g.name, tab.groupId === g.id, () => setTabGroup(tab.id, g.id));
  });
  mk('+ New…', false, () => openGroupDialog(tab.id));
}

function openGroupDialog(tabId) {
  groupNameDialog.dataset.tabId = tabId;
  groupNameInput.value = '';
  groupNameDialog.classList.remove('hidden');
  groupNameInput.focus();
}

function closeGroupDialog() {
  groupNameDialog.classList.add('hidden');
  groupNameDialog.dataset.tabId = '';
}

function confirmGroupDialog() {
  const tabId = groupNameDialog.dataset.tabId;
  const name = groupNameInput.value.trim();
  if (!name) { closeGroupDialog(); return; }
  if (!state.groups) state.groups = [];
  const group = { id: uid(), name, collapsed: false };
  state.groups.push(group);
  closeGroupDialog();
  if (tabId) setTabGroup(tabId, group.id);
  else { renderTabs(); scheduleSave(); }
}

groupNameCancel.addEventListener('click', closeGroupDialog);
groupNameSave.addEventListener('click', confirmGroupDialog);
groupNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmGroupDialog(); }
  if (e.key === 'Escape') { closeGroupDialog(); }
});

// Pinned tabs first (preserving their order), then unpinned (stable)
function orderedTabs() {
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

  // when group sections are shown, the drop position also decides the group
  const draggedTab = dragging && state.tabs.find((t) => t.id === dragging.dataset.id);
  if (dragging && draggedTab && !draggedTab.pinned &&
      settings.tabPosition !== 'top' && (state.groups || []).length) {
    let el = dragging.previousElementSibling;
    let newGroup, decided = false;
    if (!el) { newGroup = null; decided = true; } // dropped at the very top
    while (el && !decided) {
      if (el.classList.contains('tab-group-header')) {
        newGroup = el.dataset.groupId;
        decided = true;
      } else if (el.classList.contains('tab')) {
        const prev = state.tabs.find((t) => t.id === el.dataset.id);
        if (prev && !prev.pinned) { newGroup = prev.groupId || null; decided = true; }
        break; // pinned neighbour → keep current group
      } else {
        el = el.previousElementSibling;
      }
    }
    if (decided) draggedTab.groupId = newGroup;
  }

  // rebuild order from DOM
  const domOrder = [...tabListEl.querySelectorAll('.tab')].map((el) => el.dataset.id);
  state.tabs.sort((a, b) => domOrder.indexOf(a.id) - domOrder.indexOf(b.id));
  renderTabs(); // re-applies pinned-on-top + group sections
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
  _previewToken = null; _previewBase = null;
  clearFindHL();
  // flush current editor into state first
  syncEditorToState();
  state.activeId = id;
  const t = activeTab();
  setEditorText(t ? t.content : '');
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  if (mdOn) renderMdPreview();
  else {
    editorEl.focus();
    placeCaretEnd();
  }
  scheduleSave();
}

function addTab(focus = true) {
  syncEditorToState();
  const tab = { id: uid(), name: '', custom: false, content: '', dir: 'auto', color: null };
  state.tabs.push(tab);
  state.activeId = tab.id;
  setEditorText('');
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
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
  updatePlaceholderPanel();
  scheduleSave();
}

function syncEditorToState() {
  const t = activeTab();
  if (t) t.content = getEditorText();
}

// ---------- Undo / redo ----------
// The editor manually rewrites contenteditable DOM on every keystroke
// (custom Enter handling, line normalization, placeholder highlighting), so
// Chromium's native undo history doesn't track real edits and Ctrl+Z stops
// working. We keep our own per-tab undo/redo stack of content checkpoints
// instead, coalesced so a whole burst of typing undoes in one step.
const CHECKPOINT_DELAY = 600;
const UNDO_LIMIT = 100;

function commitCheckpoint(tab) {
  clearTimeout(tab.checkpointTimer);
  tab.checkpointTimer = null;
  if (tab.pendingCheckpoint != null && tab.pendingCheckpoint !== tab.content) {
    tab.undoStack = tab.undoStack || [];
    tab.undoStack.push(tab.pendingCheckpoint);
    if (tab.undoStack.length > UNDO_LIMIT) tab.undoStack.shift();
    tab.redoStack = [];
  }
  tab.pendingCheckpoint = null;
}

// Called right after a tab's content changes; remembers what it looked like
// before this burst of edits and commits that as an undo step once typing
// pauses for CHECKPOINT_DELAY.
function noteEditForUndo(tab, prevContent) {
  if (tab.pendingCheckpoint == null) tab.pendingCheckpoint = prevContent;
  clearTimeout(tab.checkpointTimer);
  tab.checkpointTimer = setTimeout(() => commitCheckpoint(tab), CHECKPOINT_DELAY);
}

function restoreContent(tab, content) {
  tab.content = content;
  setEditorText(content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  editorEl.focus();
  placeCaretEnd();
  scheduleSave();
}

function undo() {
  const t = activeTab();
  if (!t) return;
  commitCheckpoint(t); // flush any in-progress burst as its own undo step first
  if (!t.undoStack || !t.undoStack.length) return;
  t.redoStack = t.redoStack || [];
  t.redoStack.push(t.content);
  restoreContent(t, t.undoStack.pop());
}

function redo() {
  const t = activeTab();
  if (!t || !t.redoStack || !t.redoStack.length) return;
  t.undoStack = t.undoStack || [];
  t.undoStack.push(t.content);
  restoreContent(t, t.redoStack.pop());
}

// ---------- Tab colors ----------
function setTabColor(id, color) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.color = color || null;
  renderTabs();
  scheduleSave();
}

// ---------- Duplicate ----------
function duplicateTab(id) {
  syncEditorToState();
  const src = state.tabs.find((t) => t.id === id);
  if (!src) return;
  const tab = {
    id: uid(), name: src.name, custom: src.custom,
    content: src.content, dir: src.dir, color: src.color || null
  };
  const idx = state.tabs.indexOf(src);
  state.tabs.splice(idx + 1, 0, tab);
  state.activeId = tab.id;
  setEditorText(tab.content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
}

// ---------- Copy tab content ----------
async function copyTabContent(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || !tab.content) return;
  try { await navigator.clipboard.writeText(tab.content); } catch (e) { console.error(e); }
}

// ---------- Context menu ----------
let ctxTabId = null;

function buildCtxColorRow() {
  TAB_COLORS.forEach((color) => {
    const sw = document.createElement('span');
    sw.className = 'ctx-swatch' + (color === null ? ' ctx-swatch--none' : '');
    sw.dataset.color = color || '';
    if (color) sw.style.background = color;
    sw.title = color || 'None';
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctxTabId) setTabColor(ctxTabId, color);
      hideCtxMenu();
    });
    ctxColorRowEl.appendChild(sw);
  });
}

function showCtxMenu(e, tabId) {
  e.preventDefault();
  ctxTabId = tabId;
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  ctxPinItem.textContent = tab.pinned ? 'Unpin' : 'Pin';
  ctxPinGroup.style.display = '';

  ctxColorRowEl.querySelectorAll('.ctx-swatch').forEach((sw) => {
    sw.classList.toggle('active', sw.dataset.color === (tab.color || ''));
  });

  buildCtxGroupList(tab);

  ctxMenuEl.style.left = e.clientX + 'px';
  ctxMenuEl.style.top = e.clientY + 'px';
  ctxMenuEl.classList.remove('hidden');

  requestAnimationFrame(() => {
    const rect = ctxMenuEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (rect.right > vw - 4) ctxMenuEl.style.left = Math.max(4, vw - rect.width - 4) + 'px';
    if (rect.bottom > vh - 4) ctxMenuEl.style.top = Math.max(4, vh - rect.height - 4) + 'px';
  });
}

function hideCtxMenu() {
  ctxMenuEl.classList.add('hidden');
  ctxTabId = null;
}

ctxMenuEl.addEventListener('click', (e) => {
  const item = e.target.closest('[data-action]');
  if (!item || !ctxTabId) return;
  const id = ctxTabId;
  const action = item.dataset.action;
  hideCtxMenu();

  switch (action) {
    case 'rename': {
      const tabEl = tabListEl.querySelector('[data-id="' + id + '"]');
      const nameEl = tabEl && tabEl.querySelector('.tab-name');
      const tab = state.tabs.find((t) => t.id === id);
      const i = state.tabs.indexOf(tab);
      if (tabEl && nameEl && tab) startRename(tab, tabEl, nameEl, i);
      break;
    }
    case 'duplicate': duplicateTab(id); break;
    case 'history': openHistory(id); break;
    case 'copy': copyTabContent(id); break;
    case 'save-template': openSaveTemplateDialog(id); break;
    case 'pin': togglePin(id); break;
    case 'close': closeTab(id); break;
  }
});

document.addEventListener('click', (e) => {
  if (!ctxMenuEl.classList.contains('hidden') && !ctxMenuEl.contains(e.target)) {
    hideCtxMenu();
  }
});

// ---------- Templates ----------
function openTemplates() {
  renderTemplatesList();
  templatesOverlay.classList.remove('hidden');
}

function closeTemplates() {
  templatesOverlay.classList.add('hidden');
}

function renderTemplatesList() {
  templatesListEl.innerHTML = '';
  const empty = !state.templates || !state.templates.length;
  templatesEmptyEl.classList.toggle('hidden', !empty);
  if (empty) return;

  state.templates.forEach((tmpl) => {
    const row = document.createElement('div');
    row.className = 'template-row';

    const nameEl = document.createElement('div');
    nameEl.className = 'template-row-name';
    nameEl.textContent = tmpl.name;
    nameEl.setAttribute('dir', detectDir(tmpl.name));
    nameEl.title = 'Double-click to rename';

    const preview = document.createElement('div');
    preview.className = 'template-row-preview';
    const firstLine = (tmpl.content || '').split('\n').find((l) => l.trim()) || '';
    const previewText = firstLine.length > 64 ? firstLine.slice(0, 64) + '…' : firstLine;
    preview.textContent = previewText || '(empty)';
    preview.setAttribute('dir', detectDir(firstLine));

    const actions = document.createElement('div');
    actions.className = 'template-row-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'template-use-btn';
    useBtn.textContent = 'Use';
    useBtn.addEventListener('click', () => { createFromTemplate(tmpl); closeTemplates(); });

    const delBtn = document.createElement('button');
    delBtn.className = 'template-del-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteTemplate(tmpl.id));

    actions.appendChild(useBtn);
    actions.appendChild(delBtn);

    nameEl.addEventListener('dblclick', () => startTemplateRename(tmpl, nameEl));

    row.addEventListener('click', (e) => {
      if (e.target.closest('.template-del-btn')) return;
      createFromTemplate(tmpl);
      closeTemplates();
    });

    row.appendChild(nameEl);
    row.appendChild(preview);
    row.appendChild(actions);
    templatesListEl.appendChild(row);
  });
}

function startTemplateRename(tmpl, nameEl) {
  const input = document.createElement('input');
  input.className = 'template-name-input';
  input.value = tmpl.name;
  input.setAttribute('dir', detectDir(tmpl.name));
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const v = input.value.trim();
    if (v) tmpl.name = v;
    renderTemplatesList();
    scheduleSave();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = tmpl.name; input.blur(); }
  });
}

function createFromTemplate(tmpl) {
  syncEditorToState();
  const tab = { id: uid(), name: tmpl.name, custom: true, content: tmpl.content, dir: 'auto', color: null };
  state.tabs.push(tab);
  state.activeId = tab.id;
  setEditorText(tab.content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  editorEl.focus();
  scheduleSave();
}

function deleteTemplate(id) {
  state.templates = (state.templates || []).filter((t) => t.id !== id);
  renderTemplatesList();
  scheduleSave();
}

function openSaveTemplateDialog(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  syncEditorToState();
  saveTemplateDialog.dataset.tabId = tabId;
  const suggested = autoName(tab, state.tabs.indexOf(tab));
  templateNameInput.value = suggested;
  templateNameInput.setAttribute('dir', detectDir(suggested));
  saveTemplateDialog.classList.remove('hidden');
  templateNameInput.focus();
  templateNameInput.select();
}

function closeSaveTemplateDialog() {
  saveTemplateDialog.classList.add('hidden');
  saveTemplateDialog.dataset.tabId = '';
}

function confirmSaveTemplate() {
  const tabId = saveTemplateDialog.dataset.tabId;
  const name = templateNameInput.value.trim();
  if (!name || !tabId) { closeSaveTemplateDialog(); return; }
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) { closeSaveTemplateDialog(); return; }
  if (!state.templates) state.templates = [];
  state.templates.push({ id: uid(), name, content: tab.content });
  closeSaveTemplateDialog();
  scheduleSave();
}

templatesBtn.addEventListener('click', openTemplates);
templatesClose.addEventListener('click', closeTemplates);
templatesOverlay.addEventListener('click', (e) => {
  if (e.target === templatesOverlay) closeTemplates();
});

// ---------- Tab history (snapshots) panel ----------
let historyTabId = null;

function relTime(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function openHistory(tabId) {
  historyTabId = tabId;
  renderHistoryList();
  historyOverlay.classList.remove('hidden');
}

function closeHistory() {
  historyOverlay.classList.add('hidden');
  historyTabId = null;
}

function renderHistoryList() {
  historyListEl.innerHTML = '';
  const tab = state.tabs.find((t) => t.id === historyTabId);
  const snaps = (tab && tab.snapshots) || [];
  historyEmptyEl.classList.toggle('hidden', snaps.length > 0);
  if (!tab || !snaps.length) return;

  snaps.forEach((snap, idx) => {
    const row = document.createElement('div');
    row.className = 'template-row';

    const nameEl = document.createElement('div');
    nameEl.className = 'template-row-name';
    nameEl.textContent = relTime(snap.ts) + ' · ' + snap.content.length.toLocaleString('en-US') + ' chars';

    const firstLine = (snap.content.split('\n').find((l) => l.trim()) || '').slice(0, 80);
    const preview = document.createElement('div');
    preview.className = 'template-row-preview';
    preview.textContent = firstLine;
    preview.setAttribute('dir', detectDir(firstLine));

    const actions = document.createElement('div');
    actions.className = 'template-row-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'template-use-btn';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => restoreSnapshot(tab, idx));

    actions.appendChild(restoreBtn);
    row.appendChild(nameEl);
    row.appendChild(preview);
    row.appendChild(actions);
    historyListEl.appendChild(row);
  });
}

function restoreSnapshot(tab, idx) {
  const snap = tab.snapshots && tab.snapshots[idx];
  if (!snap) return;
  if (tab.id === state.activeId) syncEditorToState();
  takeSnapshot(tab, true); // keep the pre-restore content recoverable
  commitCheckpoint(tab);
  tab.undoStack = tab.undoStack || [];
  tab.undoStack.push(tab.content);
  if (tab.undoStack.length > UNDO_LIMIT) tab.undoStack.shift();
  tab.redoStack = [];
  tab.content = snap.content;
  if (tab.id === state.activeId) {
    setEditorText(tab.content);
    updateCounts();
    updatePlaceholderPanel();
    if (mdOn) renderMdPreview();
  }
  renderTabs();
  scheduleSave();
  closeHistory();
}

historyClose.addEventListener('click', closeHistory);
historyOverlay.addEventListener('click', (e) => {
  if (e.target === historyOverlay) closeHistory();
});

templateNameCancel.addEventListener('click', closeSaveTemplateDialog);
templateNameSave.addEventListener('click', confirmSaveTemplate);
templateNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmSaveTemplate(); }
  if (e.key === 'Escape') { closeSaveTemplateDialog(); }
});

// ---------- Persistence ----------
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 350);
}

// ---------- Snapshots (per-tab history) ----------
const SNAPSHOT_MAX = 15;
const SNAPSHOT_MIN_GAP = 5 * 60 * 1000; // at most one auto-snapshot per 5 min

function takeSnapshot(t, force = false) {
  if (!t || !t.content || !t.content.trim()) return;
  t.snapshots = t.snapshots || [];
  const newest = t.snapshots[0];
  if (newest && newest.content === t.content) return;
  if (!force && newest && Date.now() - newest.ts < SNAPSHOT_MIN_GAP) return;
  t.snapshots.unshift({ ts: Date.now(), content: t.content });
  if (t.snapshots.length > SNAPSHOT_MAX) t.snapshots.length = SNAPSHOT_MAX;
}

async function doSave() {
  syncEditorToState();
  takeSnapshot(activeTab());
  try {
    await window.api.saveNotes(state);
  } catch (e) {
    console.error('save failed', e);
  }
}

async function loadState() {
  const saved = await window.api.loadNotes();
  const hadSaved = !!(saved && Array.isArray(saved.tabs) && saved.tabs.length > 0);
  if (hadSaved) {
    state = {
      tabs: saved.tabs,
      activeId: saved.activeId && saved.tabs.some((t) => t.id === saved.activeId)
        ? saved.activeId
        : saved.tabs[0].id,
      seq: saved.seq || 1,
      templates: saved.templates || [],
      groups: saved.groups || [],
      phValues: saved.phValues || {},
      lastVersion: saved.lastVersion || null
    };
  } else {
    state.tabs = [{ id: uid(), name: '', custom: false, content: '', dir: 'auto', color: null }];
    state.activeId = state.tabs[0].id;
    state.templates = [];
    state.groups = [];
    state.phValues = {};
    state.lastVersion = null;
  }
  const t = activeTab();
  setEditorText(t ? t.content : '');
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  return hadSaved;
}

// ---------- Events ----------
function handleEditorChanged() {
  if (_previewToken) return; // skip sync while live-previewing a placeholder
  updateLineDirs();
  updateEmptyState();
  const t = activeTab();
  if (t) {
    const prevContent = t.content;
    t.content = getEditorText();
    if (t.content !== prevContent) noteEditForUndo(t, prevContent);
    // live update auto-name if not custom
    if (!t.custom) renderTabs();
  }
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
}

editorEl.addEventListener('input', handleEditorChanged);

// Take full control of Enter. Left to Blink, a plaintext-only + pre-wrap
// contenteditable inserts *two* "\n" per Enter (so the caret can sit on a
// visible empty row), which our line-splitter then turns into an extra blank
// line. Instead we split the current line into two .ln divs ourselves and put
// the caret at the start of the new one — exactly one new line, every time.
editorEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let r = sel.getRangeAt(0);
  if (!r.collapsed) { r.deleteContents(); r = sel.getRangeAt(0); }

  // Find the top-level line div holding the caret.
  normalizeStrayNodes();
  let line = currentLine();
  if (!line) {
    line = editorLines()[0];
    if (!line) { line = makeLine(''); editorEl.appendChild(line); }
  }

  // Caret offset (in characters) within this line.
  const pre = document.createRange();
  pre.selectNodeContents(line);
  try { pre.setEnd(r.endContainer, r.endOffset); } catch {}
  const offset = pre.toString().length;

  const text = line.textContent;
  const firstLine = makeLine(text.slice(0, offset));
  const secondLine = makeLine(text.slice(offset));
  line.replaceWith(firstLine, secondLine);

  updateLineDirs();
  placeCaretInLine(secondLine, 0);
  // Keep the new line in view as the caret moves past the viewport bottom.
  secondLine.scrollIntoView({ block: 'nearest' });

  handleEditorChanged();
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
  } else if (!e.shiftKey && e.code === 'KeyZ') {
    e.preventDefault();
    undo();
  } else if ((e.shiftKey && e.code === 'KeyZ') || (!e.shiftKey && e.code === 'KeyY')) {
    e.preventDefault();
    redo();
  } else if (!e.shiftKey && e.code === 'KeyF') {
    e.preventDefault();
    openFind(false);
  } else if (!e.shiftKey && e.code === 'KeyH') {
    e.preventDefault();
    openFind(true);
  } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
    e.preventDefault();
    stepFontSize(1);
  } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
    e.preventDefault();
    stepFontSize(-1);
  } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
    e.preventDefault();
    stepFontSize(0);
  } else if (!e.shiftKey && e.code === 'KeyM') {
    e.preventDefault();
    setMdPreview(!mdOn);
  }
});

// Ctrl+wheel over the editor zooms the font
editorEl.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  stepFontSize(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

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
  Object.values(THEMES).forEach(th => { if (th.cssClass) appEl.classList.remove(th.cssClass); });
  if (t.cssClass) appEl.classList.add(t.cssClass);
  window.api.setBgColor(t.bg);
}

function applyFont(id) {
  const f = FONTS[id] || FONTS.cascadia;
  document.documentElement.style.setProperty('--font', f.stack);
}

const FONT_SIZE_MIN = 10, FONT_SIZE_MAX = 24;

function applyFontSize() {
  const v = settings.fontSize || DEFAULT_SETTINGS.fontSize;
  document.documentElement.style.setProperty('--editor-font-size', v + 'px');
}

// Step the editor font size (dir: +1 / -1, or 0 to reset) and persist.
function stepFontSize(dir) {
  const cur = settings.fontSize || DEFAULT_SETTINGS.fontSize;
  const next = dir === 0
    ? DEFAULT_SETTINGS.fontSize
    : Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, cur + dir * 0.5));
  if (next === cur && dir !== 0) return;
  settings.fontSize = next;
  applyFontSize();
  updateFontSizeLabel();
  saveSettingsNow();
}

function updateFontSizeLabel() {
  if (fontSizeValueEl) fontSizeValueEl.textContent = (settings.fontSize || DEFAULT_SETTINGS.fontSize) + 'px';
}

function applySettings() {
  applyTheme(settings.theme);
  applyFont(settings.font);
  applyFontSize();
  window.api.setOpacity((settings.windowOpacity || 100) / 100);
  appEl.classList.toggle('layout-top', settings.tabPosition === 'top');
  appEl.classList.toggle('pins-off', !settings.pinningEnabled);
  appEl.classList.toggle('close-off', !settings.closeButtonEnabled);
  appEl.classList.toggle('resize-off',
    !settings.railResizable || settings.tabPosition === 'top');
  document.documentElement.style.setProperty(
    '--rail-width', (settings.railWidth || 166) + 'px');

  const barRight = settings.placeholderBarPosition === 'right';
  editorBodyEl.classList.toggle('bar-right', barRight);
  placeholderBarEl.classList.toggle('pos-right', barRight);
  placeholderBarEl.classList.toggle('wrap-stack', !barRight && settings.placeholderBarWrap === 'stack');
  document.documentElement.style.setProperty(
    '--placeholder-width', (settings.placeholderBarWidth || 220) + 'px');
}

async function saveSettingsNow() {
  try { await window.api.saveSettings(settings); } catch (e) { console.error(e); }
}

// ---------- Settings: panel ----------
function buildThemeSwatches() {
  themeRow.innerHTML = '';
  const makeGroup = (label, entries) => {
    const grp = document.createElement('div');
    grp.className = 'theme-group';
    const lbl = document.createElement('div');
    lbl.className = 'theme-group-label';
    lbl.textContent = label;
    grp.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'theme-swatches';
    entries.forEach(([key, t]) => {
      const sw = document.createElement('button');
      sw.className = 'theme-swatch' + (settings.theme === key ? ' active' : '');
      sw.title = t.label;
      sw.style.background = 'linear-gradient(135deg, ' + t.elevated + ' 0 55%, ' + t.sidebar + ' 55% 100%)';
      if (t.type === 'light') sw.style.outline = '1px solid rgba(0,0,0,.14)';
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
      row.appendChild(sw);
    });
    grp.appendChild(row);
    themeRow.appendChild(grp);
  };
  const dark = Object.entries(THEMES).filter(([, t]) => t.type === 'dark');
  const light = Object.entries(THEMES).filter(([, t]) => t.type === 'light');
  makeGroup('Dark', dark);
  makeGroup('Light', light);
}

function buildFontPicker() {
  const row = document.getElementById('fontRow');
  if (!row) return;
  row.innerHTML = '';
  Object.entries(FONTS).forEach(([key, f]) => {
    const btn = document.createElement('button');
    btn.className = 'font-btn' + (settings.font === key ? ' active' : '');
    btn.title = f.label;
    btn.textContent = f.label;
    btn.style.fontFamily = f.stack;
    btn.addEventListener('click', () => {
      settings.font = key;
      applyFont(key);
      buildFontPicker();
      saveSettingsNow();
    });
    row.appendChild(btn);
  });
}

function syncSettingsUI() {
  buildThemeSwatches();
  buildFontPicker();
  updateFontSizeLabel();
  layoutSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === settings.tabPosition);
  });
  togglePinEl.checked = settings.pinningEnabled;
  toggleCloseEl.checked = settings.closeButtonEnabled;
  toggleResizeEl.checked = settings.railResizable;
  toggleStartupEl.checked = settings.launchAtStartup;
  toggleAutoUpdateEl.checked = settings.autoCheckUpdates;
  opacityRangeEl.value = settings.windowOpacity || 100;
  opacityValueEl.textContent = (settings.windowOpacity || 100) + '%';
  toggleTrayEl.checked = !!settings.closeToTray;
  togglePlaceholdersEl.checked = settings.placeholdersEnabled;
  resizeRow.classList.toggle('disabled', settings.tabPosition === 'top');
  placeholderPositionSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.pos === settings.placeholderBarPosition);
  });
  placeholderWrapSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.wrap === settings.placeholderBarWrap);
  });
  placeholderWrapRow.classList.toggle('disabled', settings.placeholderBarPosition === 'right');
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

toggleCloseEl.addEventListener('change', () => {
  settings.closeButtonEnabled = toggleCloseEl.checked;
  applySettings();
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

toggleAutoUpdateEl.addEventListener('change', () => {
  settings.autoCheckUpdates = toggleAutoUpdateEl.checked;
  saveSettingsNow();
});

fontSizeDownEl.addEventListener('click', () => stepFontSize(-1));
fontSizeUpEl.addEventListener('click', () => stepFontSize(1));

opacityRangeEl.addEventListener('input', () => {
  settings.windowOpacity = Number(opacityRangeEl.value);
  opacityValueEl.textContent = settings.windowOpacity + '%';
  window.api.setOpacity(settings.windowOpacity / 100);
});
opacityRangeEl.addEventListener('change', () => saveSettingsNow());

toggleTrayEl.addEventListener('change', () => {
  settings.closeToTray = toggleTrayEl.checked;
  window.api.setCloseToTray(settings.closeToTray);
  saveSettingsNow();
});

togglePlaceholdersEl.addEventListener('change', () => {
  settings.placeholdersEnabled = togglePlaceholdersEl.checked;
  if (settings.placeholdersEnabled) updateLineDirs();
  else setEditorText(getEditorText()); // strip any existing placeholder spans
  updatePlaceholderPanel();
  saveSettingsNow();
});

placeholderPositionSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.placeholderBarPosition = btn.dataset.pos;
  applySettings();
  syncSettingsUI();
  saveSettingsNow();
});

placeholderWrapSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.placeholderBarWrap = btn.dataset.wrap;
  applySettings();
  syncSettingsUI();
  saveSettingsNow();
});

resetBtn.addEventListener('click', async () => {
  settings = { ...DEFAULT_SETTINGS };
  await window.api.setStartup(false);
  applySettings();
  syncSettingsUI();
  renderTabs();
  updateLineDirs();
  updatePlaceholderPanel();
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

// ---------- Placeholder panel resizer (right position only) ----------
let placeholderResizing = false;
placeholderResizerEl.addEventListener('mousedown', (e) => {
  if (settings.placeholderBarPosition !== 'right') return;
  placeholderResizing = true;
  placeholderResizerEl.classList.add('active');
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!placeholderResizing) return;
  const right = editorBodyEl.getBoundingClientRect().right;
  let w = Math.round(right - e.clientX);
  w = Math.max(160, Math.min(420, w));
  settings.placeholderBarWidth = w;
  document.documentElement.style.setProperty('--placeholder-width', w + 'px');
});
window.addEventListener('mouseup', () => {
  if (!placeholderResizing) return;
  placeholderResizing = false;
  placeholderResizerEl.classList.remove('active');
  document.body.style.cursor = '';
  saveSettingsNow();
});

// ---------- Find & Replace ----------
let findMatches = [];
let findIdx = 0;

const _findHL = CSS.highlights ? (() => { const h = new Highlight(); CSS.highlights.set('find-match', h); return h; })() : null;
const _curHL = CSS.highlights ? (() => { const h = new Highlight(); CSS.highlights.set('find-current', h); return h; })() : null;

function openFind(withReplace = false) {
  findBarEl.classList.remove('hidden');
  replaceRowEl.classList.toggle('hidden', !withReplace);
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    const txt = sel.toString().trim().replace(/\n/g, '').slice(0, 100);
    if (txt) findInputEl.value = txt;
  }
  findInputEl.focus();
  findInputEl.select();
  runFind();
}

function closeFind() {
  findBarEl.classList.add('hidden');
  clearFindHL();
  findMatches = [];
  findResultsEl.classList.add('hidden');
  findResultsEl.innerHTML = '';
  editorEl.focus();
}

function clearFindHL() {
  if (_findHL) _findHL.clear();
  if (_curHL) _curHL.clear();
}

function buildPosMap() {
  const map = [];
  const lines = [...editorEl.children].filter((c) => c.tagName === 'DIV');
  if (!lines.length) {
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      for (let i = 0; i < n.textContent.length; i++) map.push({ n, i });
    }
    return map;
  }
  for (let d = 0; d < lines.length; d++) {
    if (d > 0) map.push(null); // newline between divs
    const walker = document.createTreeWalker(lines[d], NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      for (let i = 0; i < n.textContent.length; i++) map.push({ n, i });
    }
  }
  return map;
}

function makeRange(posMap, pos, len) {
  let count = 0, startE = null, endE = null;
  for (let i = 0; i < posMap.length; i++) {
    const e = posMap[i];
    if (e === null) { count++; continue; }
    if (count === pos && !startE) startE = e;
    if (count === pos + len - 1) { endE = { n: e.n, i: e.i + 1 }; break; }
    count++;
  }
  if (!startE || !endE) return null;
  const r = new Range();
  r.setStart(startE.n, startE.i);
  r.setEnd(endE.n, endE.i);
  return r;
}

function runFind() {
  clearFindHL();
  findMatches = [];
  const q = findInputEl.value;
  findInputEl.classList.remove('no-match');
  renderFindResults(q);
  if (!q) { findCountEl.textContent = ''; return; }

  const posMap = buildPosMap();
  const fullText = posMap.map((e) => e === null ? '\n' : e.n.textContent[e.i]).join('');
  const lower = fullText.toLowerCase();
  const qLower = q.toLowerCase();
  let p = 0;
  while ((p = lower.indexOf(qLower, p)) !== -1) { findMatches.push(p); p++; }

  if (!findMatches.length) {
    findCountEl.textContent = 'No results';
    findInputEl.classList.add('no-match');
    return;
  }
  if (findIdx >= findMatches.length) findIdx = 0;

  if (_findHL && _curHL) {
    for (let i = 0; i < findMatches.length; i++) {
      const r = makeRange(posMap, findMatches[i], q.length);
      if (!r) continue;
      if (i === findIdx) _curHL.add(r);
      else _findHL.add(r);
    }
  }

  const curRange = makeRange(posMap, findMatches[findIdx], q.length);
  if (curRange) {
    try {
      const rect = curRange.getBoundingClientRect();
      const eRect = editorEl.getBoundingClientRect();
      if (rect.bottom > eRect.bottom || rect.top < eRect.top) {
        curRange.startContainer.parentElement?.scrollIntoView({ block: 'nearest' });
      }
    } catch {}
  }

  findCountEl.textContent = (findIdx + 1) + ' / ' + findMatches.length;
}

function findMove(dir) {
  if (!findMatches.length) { runFind(); return; }
  findIdx = (findIdx + dir + findMatches.length) % findMatches.length;
  runFind();
}

// ---------- Markdown preview ----------
let mdOn = false;

function renderMdPreview() {
  const t = activeTab();
  mdPreviewEl.innerHTML = window.renderMarkdown(t ? t.content : '');
  mdPreviewEl.querySelectorAll('p, h1, h2, h3, h4, li, blockquote').forEach((el) => {
    el.setAttribute('dir', detectDir(el.textContent));
  });
}

function setMdPreview(on) {
  if (on) {
    syncEditorToState();
    renderMdPreview();
  }
  mdOn = on;
  editorEl.classList.toggle('hidden', on);
  mdPreviewEl.classList.toggle('hidden', !on);
  mdBtn.classList.toggle('active', on);
  if (!on) editorEl.focus();
}

mdBtn.addEventListener('click', () => setMdPreview(!mdOn));

// ---- Search across all tabs ----
let findAllTabs = false;

findAllTabsEl.addEventListener('click', () => {
  findAllTabs = !findAllTabs;
  findAllTabsEl.classList.toggle('active', findAllTabs);
  runFind();
  findInputEl.focus();
});

// Lists matches from the other (non-active) tabs under the find bar.
function renderFindResults(q) {
  if (!findAllTabs || !q) {
    findResultsEl.classList.add('hidden');
    findResultsEl.innerHTML = '';
    return;
  }
  findResultsEl.innerHTML = '';
  const qLower = q.toLowerCase();
  let any = false;

  state.tabs.forEach((t) => {
    if (t.id === state.activeId) return;
    const content = t.content || '';
    const lower = content.toLowerCase();
    let p = 0, count = 0, first = -1;
    while ((p = lower.indexOf(qLower, p)) !== -1) {
      if (first === -1) first = p;
      count++;
      p++;
    }
    if (!count) return;
    any = true;

    const start = Math.max(0, first - 24);
    let snip = content.slice(start, first + q.length + 40).replace(/\s+/g, ' ').trim();
    if (start > 0) snip = '…' + snip;
    if (first + q.length + 40 < content.length) snip += '…';

    const row = document.createElement('div');
    row.className = 'find-result-row';

    const name = document.createElement('span');
    name.className = 'find-result-name';
    const dispName = autoName(t, state.tabs.indexOf(t));
    name.textContent = dispName;
    name.setAttribute('dir', detectDir(dispName));

    const badge = document.createElement('span');
    badge.className = 'find-result-count';
    badge.textContent = count;

    const prev = document.createElement('span');
    prev.className = 'find-result-snippet';
    prev.textContent = snip;
    prev.setAttribute('dir', detectDir(snip));

    row.appendChild(name);
    row.appendChild(badge);
    row.appendChild(prev);
    row.addEventListener('click', () => {
      switchTab(t.id);
      runFind();
      findInputEl.focus();
    });
    findResultsEl.appendChild(row);
  });

  if (!any) {
    findResultsEl.classList.add('hidden');
    return;
  }
  findResultsEl.classList.remove('hidden');
}

function doReplaceOne() {
  if (!findMatches.length) return;
  const t = activeTab();
  if (!t) return;
  const q = findInputEl.value;
  const repl = replaceInputEl.value;
  const pos = findMatches[findIdx];
  const newContent = t.content.slice(0, pos) + repl + t.content.slice(pos + q.length);
  t.content = newContent;
  setEditorText(newContent);
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
  runFind();
}

function doReplaceAll() {
  if (!findMatches.length) return;
  const t = activeTab();
  if (!t) return;
  takeSnapshot(t, true);
  const q = findInputEl.value;
  const repl = replaceInputEl.value;
  const lower = t.content.toLowerCase();
  const qLower = q.toLowerCase();
  let result = '', last = 0, p = 0;
  while ((p = lower.indexOf(qLower, last)) !== -1) {
    result += t.content.slice(last, p) + repl;
    last = p + q.length;
  }
  result += t.content.slice(last);
  t.content = result;
  setEditorText(result);
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
  findIdx = 0;
  runFind();
}

findInputEl.addEventListener('input', () => { findIdx = 0; runFind(); });
findInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findMove(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
replaceInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
findPrevEl.addEventListener('click', () => findMove(-1));
findNextEl.addEventListener('click', () => findMove(1));
findCloseEl.addEventListener('click', closeFind);
replaceOneEl.addEventListener('click', doReplaceOne);
replaceAllEl.addEventListener('click', doReplaceAll);

// ---------- Update Check ----------
const CURRENT_VERSION = document.getElementById('aboutVersion').textContent.replace('v', '');

// ---------- "What's new" tab (shown once after each update) ----------
const WHATS_NEW =
  "What's new in v" + CURRENT_VERSION + " ✨\n" +
  '\n' +
  '• Tab groups — right-click a tab → Group, collapse/expand from the sidebar\n' +
  '• Tab history — right-click a tab → History… to restore earlier versions\n' +
  '• Search all tabs — Ctrl+F, then hit the "all tabs" toggle\n' +
  '• Markdown preview — Ctrl+M or the "md" button in the status bar\n' +
  '• Font size — Ctrl + scroll on the editor, Ctrl+= / Ctrl+- / Ctrl+0, or Settings\n' +
  '• Window opacity — slider in Settings → System\n' +
  '• Close to tray — PromptPad can keep running in the system tray\n' +
  '• Placeholder suggestions — fields now remember your previous values\n' +
  '• Fixed — Pin from the right-click menu now always works\n' +
  '\n' +
  'You can close this tab — it won\'t come back until the next update.';

function maybeShowWhatsNew(hadSaved) {
  if (state.lastVersion === CURRENT_VERSION) return;
  state.lastVersion = CURRENT_VERSION;
  // fresh installs just record the version; updates get the tab
  if (hadSaved) {
    const tab = {
      id: uid(), name: "What's new ✨", custom: true,
      content: WHATS_NEW, dir: 'ltr', color: null
    };
    state.tabs.push(tab);
    state.activeId = tab.id;
    setEditorText(tab.content);
    renderTabs();
    updateCounts();
    updatePlaceholderPanel();
  }
  scheduleSave();
}

function showUpdateBanner(tag, url) {
  updateBannerTextEl.textContent = 'New version available: v' + tag.replace('v', '');
  updateBannerLinkEl.onclick = () => window.api.openExternal(url);
  updateBannerEl.classList.remove('hidden');
  // also update settings button
  checkUpdateBtn.classList.add('update-available');
  checkUpdateLabel.textContent = 'Update available: v' + tag.replace('v', '');
  checkUpdateBtn.onclick = () => window.api.openExternal(url);
}

// > 0 when a is newer than b (semver-ish "1.5.0" strings)
function cmpVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function runUpdateCheck(silent = false) {
  try {
    const result = await window.api.checkUpdate();
    if (!result || !result.tag) return;
    const latest = result.tag.replace('v', '');
    if (latest && cmpVersions(latest, CURRENT_VERSION) > 0) {
      showUpdateBanner(result.tag, result.url);
    } else if (!silent) {
      checkUpdateLabel.textContent = 'You\'re up to date ✓';
      setTimeout(() => { checkUpdateLabel.textContent = 'Check for updates'; }, 3000);
    }
  } catch {
    if (!silent) checkUpdateLabel.textContent = 'Check failed';
  }
}

updateBannerCloseEl.addEventListener('click', () => {
  updateBannerEl.classList.add('hidden');
});

checkUpdateBtn.addEventListener('click', async () => {
  if (checkUpdateBtn.classList.contains('checking')) return;
  checkUpdateBtn.classList.add('checking');
  checkUpdateLabel.textContent = 'Checking…';
  await runUpdateCheck(false);
  checkUpdateBtn.classList.remove('checking');
});

// ---------- Init ----------
(async function init() {
  const savedSettings = await window.api.loadSettings();
  settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  // reflect real OS startup state
  try { settings.launchAtStartup = await window.api.getStartup(); } catch {}
  applySettings();

  const hadSaved = await loadState();
  maybeShowWhatsNew(hadSaved);

  const onTop = await window.api.getAlwaysOnTop();
  pinBtn.classList.toggle('active', onTop);

  buildCtxColorRow();

  // close overlays with Escape (priority: ctx menu > find bar > save dialog > templates > settings)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!ctxMenuEl.classList.contains('hidden')) { hideCtxMenu(); return; }
    if (!findBarEl.classList.contains('hidden')) { closeFind(); return; }
    if (mdOn) { setMdPreview(false); return; }
    if (!saveTemplateDialog.classList.contains('hidden')) { closeSaveTemplateDialog(); return; }
    if (!groupNameDialog.classList.contains('hidden')) { closeGroupDialog(); return; }
    if (!historyOverlay.classList.contains('hidden')) { closeHistory(); return; }
    if (!templatesOverlay.classList.contains('hidden')) { closeTemplates(); return; }
    if (!settingsOverlay.classList.contains('hidden')) { closeSettings(); return; }
  });

  editorEl.focus();

  // auto-check for updates after short delay (silent — banner only if newer version found)
  if (settings.autoCheckUpdates) {
    setTimeout(() => runUpdateCheck(true), 3000);
  }
})();
