// ---------- State ----------
let state = {
  tabs: [],      // { id, name, custom, content, dir, pinned, color, groupId, snapshots }
  activeId: null,
  seq: 1,
  templates: [], // { id, name, content }
  groups: [],    // { id, name, collapsed }
  phValues: {},  // { '[token]': ['recent', 'values'] } — MRU, max 8
  fastSave: { messages: [] } // { id, ts, text } — chat-style quick notes
};

// Sentinel activeId for the Fast Save view (not a real tab).
const FS_ID = '__fastsave__';

function fsActive() {
  return state.activeId === FS_ID;
}

function fsMessages() {
  if (!state.fastSave || !Array.isArray(state.fastSave.messages)) {
    state.fastSave = { messages: [] };
  }
  return state.fastSave.messages;
}

const TAB_COLORS = [null, '#e05252', '#e07a52', '#e0c852', '#52b05a', '#5290e0', '#9052e0', '#e052b8'];

let saveTimer = null;
let _previewToken = null;   // token currently being live-previewed
let _previewBase  = null;   // snapshot of t.content before preview started

// ---------- Themes & fonts (shared with the quick-capture window) ----------
const THEMES = window.PP_THEMES;
const FONTS = window.PP_FONTS;

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
  placeholderBarWidth: 220,
  placeholderBarCollapsed: false,
  fastSaveEnabled: true,
  quickCaptureEnabled: true,
  imageResizable: true,
  imageDownloadEnabled: true,
  editorJustify: false,
  fastSaveName: 'Fast Save',
  // which status-bar buttons are shown (toggle in Settings → Toolbar)
  toolbar: {
    todo: true, emoji: true, link: true, justify: true, clean: true,
    md: true, paste: true, copy: true, img: true, files: true
  }
};

let settings = { ...DEFAULT_SETTINGS };

// Multi-select state (tab rail + Fast Save messages)
const selectedTabIds = new Set();
let lastClickedTabId = null;
const selectedMsgIds = new Set();

// ---------- DOM ----------
const tabListEl = document.getElementById('tabList');
const editorEl = document.getElementById('editor');
const charCountEl = document.getElementById('charCount');
const tokenCountEl = document.getElementById('tokenCount');
const copyBtn = document.getElementById('copyBtn');
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
// placeholder collapse
const placeholderCollapseEl = document.getElementById('placeholderCollapse');
// todo & image buttons
const todoBtn = document.getElementById('todoBtn');
const imgBtn = document.getElementById('imgBtn');
// fast save
const fastSaveViewEl = document.getElementById('fastSaveView');
const fsMessagesEl = document.getElementById('fsMessages');
const fsInputEl = document.getElementById('fsInput');
const fsSendBtn = document.getElementById('fsSend');
const toggleFastSaveEl = document.getElementById('toggleFastSave');
// quick capture
const toggleQuickCaptureEl = document.getElementById('toggleQuickCapture');
// storage
const storagePathValueEl = document.getElementById('storagePathValue');
const changeStorageBtn = document.getElementById('changeStorageBtn');
const changeStorageLabel = document.getElementById('changeStorageLabel');
const openStorageBtn = document.getElementById('openStorageBtn');
// backup
const exportDataBtn = document.getElementById('exportDataBtn');
const exportDataLabel = document.getElementById('exportDataLabel');
const importDataBtn = document.getElementById('importDataBtn');
const importDataLabel = document.getElementById('importDataLabel');
const importConfirmDialog = document.getElementById('importConfirmDialog');
const importCancelBtn = document.getElementById('importCancel');
const importConfirmBtn = document.getElementById('importConfirm');
// lightbox & drop hint
const lightboxEl = document.getElementById('lightbox');
const lightboxImgEl = document.getElementById('lightboxImg');
const dropHintEl = document.getElementById('dropHint');
// title-bar search
const searchBtn = document.getElementById('searchBtn');
// formatting toolbar
const emojiBtn = document.getElementById('emojiBtn');
const emojiPanel = document.getElementById('emojiPanel');
const linkBtn = document.getElementById('linkBtn');
const justifyBtn = document.getElementById('justifyBtn');
const cleanBtn = document.getElementById('cleanBtn');
const linkDialog = document.getElementById('linkDialog');
const linkTextInput = document.getElementById('linkTextInput');
const linkUrlInput = document.getElementById('linkUrlInput');
const linkCancel = document.getElementById('linkCancel');
const linkSave = document.getElementById('linkSave');
// image context menu
const imgContextMenu = document.getElementById('imgContextMenu');
const textContextMenu = document.getElementById('textContextMenu');
const toggleImageResizeEl = document.getElementById('toggleImageResize');
const toggleImageDownloadEl = document.getElementById('toggleImageDownload');
// fast save extras
const fsHeaderSearchBtn = document.getElementById('fsSearchBtn');
const fsGalleryBtn = document.getElementById('fsGalleryBtn');
const fsSearchBar = document.getElementById('fsSearchBar');
const fsSearchInput = document.getElementById('fsSearchInput');
const fsSearchCount = document.getElementById('fsSearchCount');
const fsSearchClose = document.getElementById('fsSearchClose');
const fsImgBtn = document.getElementById('fsImgBtn');
const fsEmojiBtn = document.getElementById('fsEmojiBtn');
const fsPending = document.getElementById('fsPending');
const fsPendingImg = document.getElementById('fsPendingImg');
const fsPendingRemove = document.getElementById('fsPendingRemove');
const fsEditBar = document.getElementById('fsEditBar');
const fsEditCancel = document.getElementById('fsEditCancel');
// quick capture overlay
const quickCaptureOverlay = document.getElementById('quickCaptureOverlay');
const qcInput = document.getElementById('qcInput');
const qcClose = document.getElementById('qcClose');
const qcPending = document.getElementById('qcPending');
const qcPendingImg = document.getElementById('qcPendingImg');
const qcPendingRemove = document.getElementById('qcPendingRemove');
// gallery overlay
const galleryOverlay = document.getElementById('galleryOverlay');
const galleryClose = document.getElementById('galleryClose');
const galleryGrid = document.getElementById('galleryGrid');
const galleryEmpty = document.getElementById('galleryEmpty');
// paste button
const pasteBtn = document.getElementById('pasteBtn');
// toolbar-buttons settings row
const toolbarRow = document.getElementById('toolbarRow');
// per-tab files
const filesBtn = document.getElementById('filesBtn');
const filesCountEl = document.getElementById('filesCount');
const filesOverlay = document.getElementById('filesOverlay');
const filesClose = document.getElementById('filesClose');
const filesAddBtn = document.getElementById('filesAddBtn');
const filesListEl = document.getElementById('filesList');
const filesEmptyEl = document.getElementById('filesEmpty');
// tab multi-select + group menus
const tabMultiMenu = document.getElementById('tabMultiMenu');
const tabMultiHead = document.getElementById('tabMultiHead');
const multiColorRow = document.getElementById('multiColorRow');
const multiGroupList = document.getElementById('multiGroupList');
const groupContextMenu = document.getElementById('groupContextMenu');
const groupColorRow = document.getElementById('groupColorRow');
const multiRenameDialog = document.getElementById('multiRenameDialog');
const multiRenameInput = document.getElementById('multiRenameInput');
const multiRenameCancel = document.getElementById('multiRenameCancel');
const multiRenameSave = document.getElementById('multiRenameSave');
// Fast Save file attach + header title + multi-select
const fsFileBtn = document.getElementById('fsFileBtn');
const fsPendingFile = document.getElementById('fsPendingFile');
const fsPendingFileName = document.getElementById('fsPendingFileName');
const fsPendingFileRemove = document.getElementById('fsPendingFileRemove');
const fsHeaderTitle = document.getElementById('fsHeaderTitle');
const fsSelectBar = document.getElementById('fsSelectBar');
const fsSelectCount = document.getElementById('fsSelectCount');
const fsSelectDelete = document.getElementById('fsSelectDelete');
const fsSelectClear = document.getElementById('fsSelectClear');

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

// Inline image token: ![img](ppimg://<filename>) with an optional stored
// display width: ![img](ppimg://<filename>|<px>)
const IMG_TOKEN_RE = /!\[img\]\(ppimg:\/\/([a-zA-Z0-9._-]+)(?:\|(\d+))?\)/g;

function imgToken(filename, width) {
  return '![img](ppimg://' + filename + (width ? '|' + Math.round(width) : '') + ')';
}

// Todo line prefix: "- [ ] " / "- [x] " (leading whitespace allowed)
const TODO_RE = /^(\s*)- \[( |x)\] /;

// Markdown link: [text](url) — its [text] must not be offered as a placeholder.
const MDLINK_RE = /\[[^\[\]\r\n]+\]\([^)\r\n]*\)/g;

// Inline bold: **text** — shown bold in the editor with dimmed ** markers.
const MD_BOLD_RE = /\*\*([^*\r\n]+)\*\*/g;

function findPlaceholderTokens(text) {
  const seen = new Set();
  const tokens = [];
  // image tokens contain "[img]", todo markers are "[ ]"/"[x]", and markdown
  // links start with "[text](" — none of these are fillable placeholders
  const cleaned = (text || '').replace(IMG_TOKEN_RE, '').replace(MDLINK_RE, '');
  for (const m of cleaned.matchAll(PLACEHOLDER_RE)) {
    if (m[0] === '[ ]' || m[0] === '[x]') continue;
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

// Rebuild a line's children as plain text interleaved with decoration spans:
// .placeholder-tag around [bracket]/{brace} matches, .todo-mark around a
// "- [ ] " prefix, .img-token around image tokens (plus an <img> thumbnail).
// Every decoration WRAPS the literal token text, so el.textContent always
// equals the raw line — getEditorText/caret logic never notice the spans.
// The <img> thumbnail is the one zero-textContent addition.
// updateLineDirs() re-highlights every line on every keystroke, so decorated
// lines (image thumbnails especially) must not rebuild their DOM unless the
// line's text actually changed — that rebuild is what made typing lag and
// thumbnails flicker in image-heavy tabs. hlEpoch invalidates the cache when
// a setting changes how lines decorate (e.g. placeholders on/off).
let hlEpoch = 0;
function invalidateHighlights() { hlEpoch++; }

function highlightLine(el) {
  const text = el.textContent;
  if (el._hlText === text && el._hlEpoch === hlEpoch) return;
  el._hlText = text;
  el._hlEpoch = hlEpoch;
  const hadDecor = !!el.querySelector('.placeholder-tag, .todo-mark, .img-token, .pp-img, .md-bold, .md-mark');
  const phMatches = settings.placeholdersEnabled ? [...text.matchAll(PLACEHOLDER_RE)] : [];
  const todoM = text.match(TODO_RE);
  const imgMatches = [...text.matchAll(IMG_TOKEN_RE)];
  const boldMatches = [...text.matchAll(MD_BOLD_RE)];
  el.classList.toggle('todo-done', !!(todoM && todoM[2] === 'x'));
  if (!phMatches.length && !todoM && !imgMatches.length && !boldMatches.length && !hadDecor) return;

  const offset = getCaretOffsetIn(el);
  el.innerHTML = '';
  if (text === '') {
    el.appendChild(document.createElement('br'));
  } else {
    // Merge all decoration ranges; on overlap the earliest start wins
    // (e.g. "[img]" inside an image token, "[ ]" inside a todo prefix).
    const ranges = [];
    if (todoM) ranges.push({ start: 0, end: todoM[0].length, cls: 'todo-mark' });
    for (const m of imgMatches) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'img-token',
        file: m[1], width: m[2] ? Number(m[2]) : null });
    }
    for (const m of boldMatches) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'md-bold' });
    }
    // Ranges of markdown-link [text] parts, so they aren't tagged as placeholders.
    const linkRanges = [...text.matchAll(MDLINK_RE)].map((m) => [m.index, m.index + m[0].length]);
    for (const m of phMatches) {
      const inLink = linkRanges.some(([a, b]) => m.index >= a && m.index < b);
      if (inLink) continue;
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'placeholder-tag' });
    }
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);

    const imgs = [];
    let last = 0;
    for (const r of ranges) {
      if (r.start < last) continue; // overlaps an earlier decoration
      if (r.start > last) el.appendChild(document.createTextNode(text.slice(last, r.start)));
      if (r.cls === 'md-bold') {
        // **text** → dimmed "**" marks + bold inner text (all literal, so the
        // raw "**text**" still round-trips through getEditorText).
        const inner = text.slice(r.start + 2, r.end - 2);
        const mk1 = document.createElement('span'); mk1.className = 'md-mark'; mk1.textContent = '**';
        const b = document.createElement('span'); b.className = 'md-bold'; b.textContent = inner;
        const mk2 = document.createElement('span'); mk2.className = 'md-mark'; mk2.textContent = '**';
        el.appendChild(mk1); el.appendChild(b); el.appendChild(mk2);
      } else {
        const span = document.createElement('span');
        span.className = r.cls;
        span.textContent = text.slice(r.start, r.end);
        el.appendChild(span);
        if (r.file) imgs.push({ file: r.file, width: r.width });
      }
      last = r.end;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));

    // thumbnails after the text (contribute no textContent). Wrapped so a
    // resize handle can sit in the corner without disturbing editor text.
    for (const im of imgs) {
      el.appendChild(makeImgThumb(im.file, im.width));
    }
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
      // Clean justify: fill both edges but let each line's last row end
      // naturally (no forced full-width stretch on short/last lines).
      d.style.textAlign = settings.editorJustify ? 'justify' : (want === 'rtl' ? 'right' : 'left');
      d.style.textAlignLast = '';
      changed = true;
    }
    // Re-highlight lines you're not actively typing on immediately; the line
    // under the caret is debounced below so spans don't fight the caret
    // mid-keystroke. (highlightLine itself skips placeholder tags when the
    // setting is off but still decorates todos and images.)
    if (d !== activeLine) highlightLine(d);
  });
  scheduleHighlight(activeLine);
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

// Refresh one tab's auto-name label in place (no rail rebuild). Used while
// typing; the tab may legitimately be absent (collapsed group, mid-rename).
function updateActiveTabName(tab) {
  const nameEl = tabListEl.querySelector('.tab[data-id="' + tab.id + '"] .tab-name');
  if (!nameEl) return;
  const dispName = autoName(tab, state.tabs.indexOf(tab));
  if (nameEl.textContent !== dispName) {
    nameEl.textContent = dispName;
    nameEl.setAttribute('dir', detectDir(dispName));
  }
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
  updateFilesButton();
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
// Fast Save rail entry — deliberately NOT class "tab" so the drag-reorder,
// group and context-menu machinery (which query ".tab") never touch it.
function makeFsTabEl() {
  const el = document.createElement('div');
  el.className = 'fs-tab' + (fsActive() ? ' active' : '');

  const icon = document.createElement('span');
  icon.className = 'fs-tab-icon';
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
    '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  el.appendChild(icon);

  const nameEl = document.createElement('span');
  nameEl.className = 'tab-name';
  nameEl.textContent = fsLabel();
  el.appendChild(nameEl);

  const count = fsMessages().length;
  if (count) {
    const badge = document.createElement('span');
    badge.className = 'fs-tab-count';
    badge.textContent = count;
    el.appendChild(badge);
  }

  el.addEventListener('click', (e) => {
    if (e.shiftKey) { e.stopPropagation(); startFsRename(el, nameEl); return; }
    switchToFastSave();
  });
  // double-click also renames
  nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startFsRename(el, nameEl); });
  return el;
}

function fsLabel() {
  return (settings.fastSaveName && settings.fastSaveName.trim()) || 'Fast Save';
}

// Inline-rename the Fast Save label (persists to settings.fastSaveName).
function startFsRename(el, nameEl) {
  const input = document.createElement('input');
  input.className = 'tab-name-input';
  input.value = fsLabel();
  input.setAttribute('dir', detectDir(input.value));
  input.addEventListener('input', () => input.setAttribute('dir', detectDir(input.value)));
  el.replaceChild(input, nameEl);
  input.focus();
  input.select();
  const commit = () => {
    const v = input.value.trim();
    settings.fastSaveName = v || 'Fast Save';
    saveSettingsNow();
    renderTabs();
    if (fsHeaderTitle) fsHeaderTitle.textContent = fsLabel();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = fsLabel(); input.blur(); }
    e.stopPropagation();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

function renderTabs() {
  tabListEl.innerHTML = '';

  if (settings.fastSaveEnabled) tabListEl.appendChild(makeFsTabEl());

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
      (tab.id === lastPinnedId ? ' pin-divider' : '') +
      (selectedTabIds.has(tab.id) ? ' selected' : '') +
      (tab.color ? ' has-color' : '');
    el.dataset.id = tab.id;
    el.draggable = true;
    // Full-tab tint (whole tab takes the color, not just a dot)
    if (tab.color) el.style.setProperty('--tab-color', tab.color);

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

    // switch / rename / multi-select
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close') || e.target.closest('.tab-pin')) return;
      // don't hijack clicks inside the inline rename box
      if (e.target.closest('.tab-name-input')) return;
      if (e.ctrlKey && e.shiftKey) { rangeSelectTo(tab.id); return; }
      if (e.ctrlKey) { toggleTabSelection(tab.id); return; }
      if (e.shiftKey) { startRename(tab, el, nameEl, i); return; }
      if (selectedTabIds.size) { selectedTabIds.clear(); }
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

    // drag & drop (not while renaming)
    el.addEventListener('dragstart', (e) => {
      if (e.target.closest('.tab-name-input')) { e.preventDefault(); return; }
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tab.id); } catch {}
    });
    el.addEventListener('dragend', onDragEnd);

    // right-click context menu — bulk menu when this tab is part of a
    // multi-selection, otherwise the normal single-tab menu.
    el.addEventListener('contextmenu', (e) => {
      if (selectedTabIds.size > 1 && selectedTabIds.has(tab.id)) {
        showTabMultiMenu(e);
      } else {
        if (selectedTabIds.size) { selectedTabIds.clear(); renderTabs(); }
        showCtxMenu(e, tab.id);
      }
    });

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

  // 2) each group: header + members (hidden when collapsed).
  //    Pinned groups sort to the top (stable within each bucket).
  const orderedGroups = [...groups].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  orderedGroups.forEach((g) => {
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
  el.className = 'tab-group-header' + (group.collapsed ? ' collapsed' : '') +
    (group.color ? ' has-color' : '');
  el.dataset.groupId = group.id;
  el.draggable = true;
  if (group.color) el.style.setProperty('--group-color', group.color);

  const chev = document.createElement('span');
  chev.className = 'tab-group-chevron';
  chev.innerHTML =
    '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">' +
    '<polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  el.appendChild(chev);

  if (group.pinned) {
    const pinEl = document.createElement('span');
    pinEl.className = 'tab-group-pin';
    pinEl.title = 'Pinned group';
    pinEl.innerHTML =
      '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">' +
      '<path d="M14 3l7 7-3 1-1 4-4 4-2-6-6-2 4-4 4-1 1-3z" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    el.appendChild(pinEl);
  }

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

  el.addEventListener('contextmenu', (e) => showGroupCtxMenu(e, group.id));

  // drag & drop — reorders groups relative to each other only (tabs keep
  // their own drag lane, see getDragAfterElement/.dragging above).
  el.addEventListener('dragstart', (e) => {
    e.stopPropagation(); // don't let the tab-list's own dragstart handling see this
    el.classList.add('dragging-group');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'group:' + group.id); } catch {}
  });
  el.addEventListener('dragend', onGroupDragEnd);

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
  groupNameDialog.dataset.multi = '';
  groupNameInput.value = '';
  groupNameDialog.classList.remove('hidden');
  groupNameInput.focus();
}

function closeGroupDialog() {
  groupNameDialog.classList.add('hidden');
  groupNameDialog.dataset.tabId = '';
  groupNameDialog.dataset.multi = '';
}

function confirmGroupDialog() {
  const tabId = groupNameDialog.dataset.tabId;
  const isMulti = groupNameDialog.dataset.multi === '1';
  const name = groupNameInput.value.trim();
  if (!name) { closeGroupDialog(); return; }
  if (!state.groups) state.groups = [];
  const group = { id: uid(), name, collapsed: false };
  state.groups.push(group);
  closeGroupDialog();
  if (isMulti) {
    selectedTabIds.forEach((id) => setTabGroupSilent(id, group.id));
    renderTabs();
    scheduleSave();
  } else if (tabId) {
    setTabGroup(tabId, group.id);
  } else { renderTabs(); scheduleSave(); }
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

// Group reordering — a separate "lane" that only looks at other group
// headers, independent of the individual-tab dragover above. Only the
// header node itself is moved during the drag (its member tabs stay put);
// renderTabs() rebuilds each group's header+members block correctly once
// state.groups is reordered on drop, so the brief visual mismatch during
// the drag itself is harmless.
function getGroupDragAfterElement(y) {
  const els = [...tabListEl.querySelectorAll('.tab-group-header:not(.dragging-group)')];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}

tabListEl.addEventListener('dragover', (e) => {
  const draggingGroup = tabListEl.querySelector('.dragging-group');
  if (!draggingGroup) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const after = getGroupDragAfterElement(e.clientY);
  if (after == null) tabListEl.appendChild(draggingGroup);
  else tabListEl.insertBefore(draggingGroup, after);
});

function onGroupDragEnd() {
  const dragging = tabListEl.querySelector('.dragging-group');
  if (dragging) dragging.classList.remove('dragging-group');
  const domOrder = [...tabListEl.querySelectorAll('.tab-group-header')].map((el) => el.dataset.groupId);
  state.groups.sort((a, b) => domOrder.indexOf(a.id) - domOrder.indexOf(b.id));
  renderTabs(); // re-applies pinned-groups-on-top + rebuilds header+members blocks
  scheduleSave();
}

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

// ---------- Fast Save view ----------
function showEditorView() {
  if (fsEditingId) cancelFsEdit();
  selectedMsgIds.clear();
  fsSelectBar.classList.add('hidden');
  appEl.classList.remove('fastsave-active');
  editorBodyEl.classList.remove('hidden');
  fastSaveViewEl.classList.add('hidden');
}

function showFastSaveView() {
  selectedTabIds.clear();
  appEl.classList.add('fastsave-active');
  editorBodyEl.classList.add('hidden');
  fastSaveViewEl.classList.remove('hidden');
  if (fsHeaderTitle) fsHeaderTitle.textContent = fsLabel();
  updateFsInputDir();
  updateFsSelectBar();
  renderFsMessages();
  fsInputEl.focus();
}

// Show whichever view matches state.activeId (used at startup).
function applyActiveView() {
  if (fsActive()) showFastSaveView();
  else showEditorView();
}

function switchToFastSave() {
  if (!settings.fastSaveEnabled) return;
  if (fsActive()) { fsInputEl.focus(); return; }
  _previewToken = null; _previewBase = null;
  clearFindHL();
  findBarEl.classList.add('hidden');
  syncEditorToState();
  state.activeId = FS_ID;
  showFastSaveView();
  renderTabs();
  scheduleSave();
}

function fmtMsgTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : d.toLocaleDateString() + ' ' + time;
}

// Message model: { id, ts, text, image? } — image is a saved ppimg filename.
let fsPendingImage = null; // filename staged for the next send (Telegram-style)
let fsPendingFileMeta = null; // {name, storedName, size, ext} staged for the next send
let fsFilterQuery = '';
let fsEditingId = null;    // id of the message currently being edited, if any

function fsMsgMatches(m, q) {
  return (m.text || '').toLowerCase().includes(q);
}

function renderFsMessages() {
  fsMessagesEl.innerHTML = '';
  const all = fsMessages();
  const q = fsFilterQuery.trim().toLowerCase();
  const msgs = q ? all.filter((m) => fsMsgMatches(m, q)) : all;

  if (q) {
    fsSearchCount.textContent = msgs.length + (msgs.length === 1 ? ' match' : ' matches');
  } else {
    fsSearchCount.textContent = '';
  }

  if (!msgs.length) {
    const empty = document.createElement('div');
    empty.className = 'fs-empty';
    empty.textContent = q ? 'No messages match your search.'
      : 'Saved messages appear here.\nType below and press Enter.';
    fsMessagesEl.appendChild(empty);
    return;
  }

  msgs.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'fs-msg' + (m.id === fsEditingId ? ' editing' : '') +
      (selectedMsgIds.has(m.id) ? ' selected' : '');
    row.dataset.msgId = m.id;

    // Ctrl+click anywhere on the bubble (not on a button/image) toggles select.
    row.addEventListener('click', (e) => {
      if (!e.ctrlKey) return;
      if (e.target.closest('button') || e.target.closest('img')) return;
      e.preventDefault();
      toggleMsgSelection(m.id);
    });

    if (m.image) {
      const img = document.createElement('img');
      img.className = 'fs-msg-img';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = 'ppimg://' + m.image;
      img.draggable = false;
      img.addEventListener('click', (e) => { if (e.ctrlKey) { toggleMsgSelection(m.id); return; } openLightbox('ppimg://' + m.image); });
      row.appendChild(img);
    }

    if (m.file) {
      const chip = document.createElement('div');
      chip.className = 'fs-msg-file';
      const ic = document.createElement('span');
      ic.className = 'fs-msg-file-icon';
      ic.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      const info = document.createElement('div');
      info.className = 'fs-msg-file-info';
      const nm = document.createElement('div');
      nm.className = 'fs-msg-file-name';
      nm.textContent = m.file.name;
      nm.setAttribute('dir', detectDir(m.file.name));
      const sz = document.createElement('div');
      sz.className = 'fs-msg-file-size';
      sz.textContent = fmtSize(m.file.size);
      info.appendChild(nm); info.appendChild(sz);
      const openB = document.createElement('button');
      openB.className = 'fs-msg-file-btn';
      openB.title = 'Open';
      openB.textContent = 'Open';
      openB.addEventListener('click', () => window.api.openFile(m.file.storedName));
      const saveB = document.createElement('button');
      saveB.className = 'fs-msg-file-btn';
      saveB.title = 'Save as…';
      saveB.textContent = 'Save';
      saveB.addEventListener('click', () => window.api.saveFileAs(m.file.storedName, m.file.name));
      chip.appendChild(ic); chip.appendChild(info); chip.appendChild(openB); chip.appendChild(saveB);
      row.appendChild(chip);
    }

    if (m.text) {
      const body = document.createElement('div');
      body.className = 'fs-msg-text';
      body.textContent = m.text;
      body.setAttribute('dir', detectDir(m.text));
      row.appendChild(body);
    }

    const meta = document.createElement('div');
    meta.className = 'fs-msg-meta';

    const copyB = document.createElement('button');
    copyB.className = 'fs-msg-btn';
    copyB.title = 'Copy';
    copyB.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M5 15V5a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    copyB.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(m.text || ''); } catch (e) { console.error(e); }
      copyB.classList.add('copied');
      setTimeout(() => copyB.classList.remove('copied'), 900);
    });

    const editB = document.createElement('button');
    editB.className = 'fs-msg-btn';
    editB.title = 'Edit';
    editB.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    editB.addEventListener('click', () => startFsEdit(m.id));

    const delB = document.createElement('button');
    delB.className = 'fs-msg-btn fs-msg-del';
    delB.title = 'Delete';
    delB.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    delB.addEventListener('click', () => {
      state.fastSave.messages = fsMessages().filter((x) => x.id !== m.id);
      if (fsEditingId === m.id) cancelFsEdit();
      renderFsMessages();
      renderTabs();
      scheduleSave();
    });

    const time = document.createElement('span');
    time.className = 'fs-msg-time';
    time.textContent = fmtMsgTime(m.ts) + (m.edited ? ' · edited' : '');

    // copy is only meaningful when there's text
    if (m.text) meta.appendChild(copyB);
    meta.appendChild(editB);
    meta.appendChild(delB);
    meta.appendChild(time);
    row.appendChild(meta);
    fsMessagesEl.appendChild(row);
  });

  if (!q) fsMessagesEl.scrollTop = fsMessagesEl.scrollHeight;
}

function fsAutoGrow() {
  fsInputEl.style.height = 'auto';
  fsInputEl.style.height = Math.min(120, fsInputEl.scrollHeight) + 'px';
}

function setFsPendingImage(filename) {
  fsPendingImage = filename || null;
  if (fsPendingImage) {
    fsPendingImg.src = 'ppimg://' + fsPendingImage;
    fsPending.classList.remove('hidden');
  } else {
    fsPendingImg.removeAttribute('src');
    fsPending.classList.add('hidden');
  }
}

function fsSendMessage() {
  const text = fsInputEl.value.replace(/\s+$/, '');

  // Editing an existing message rather than adding a new one.
  if (fsEditingId) {
    const m = fsMessages().find((x) => x.id === fsEditingId);
    if (m) {
      if (!text.trim() && !m.image) {
        // cleared a text-only message → delete it
        state.fastSave.messages = fsMessages().filter((x) => x.id !== m.id);
      } else {
        m.text = text;
        m.edited = true;
      }
    }
    cancelFsEdit();
    renderFsMessages();
    renderTabs();
    scheduleSave();
    return;
  }

  if (!text.trim() && !fsPendingImage && !fsPendingFileMeta) return;
  const msg = { id: uid(), ts: Date.now(), text };
  if (fsPendingImage) msg.image = fsPendingImage;
  if (fsPendingFileMeta) msg.file = fsPendingFileMeta;
  fsMessages().push(msg);
  fsInputEl.value = '';
  setFsPendingImage(null);
  setFsPendingFile(null);
  fsAutoGrow();
  updateFsInputDir();
  renderFsMessages();
  renderTabs(); // refresh the count badge
  scheduleSave();
  fsInputEl.focus();
}

// Stage / clear a file for the next Fast Save message.
function setFsPendingFile(meta) {
  fsPendingFileMeta = meta || null;
  if (fsPendingFileMeta) {
    fsPendingFileName.textContent = fsPendingFileMeta.name + '  ·  ' + fmtSize(fsPendingFileMeta.size);
    fsPendingFile.classList.remove('hidden');
  } else {
    fsPendingFileName.textContent = '';
    fsPendingFile.classList.add('hidden');
  }
}

// ---------- Fast Save: message multi-select ----------
function toggleMsgSelection(id) {
  if (selectedMsgIds.has(id)) selectedMsgIds.delete(id);
  else selectedMsgIds.add(id);
  updateFsSelectBar();
  renderFsMessages();
}
function clearMsgSelection() {
  if (!selectedMsgIds.size) return;
  selectedMsgIds.clear();
  updateFsSelectBar();
  renderFsMessages();
}
function updateFsSelectBar() {
  const n = selectedMsgIds.size;
  if (n) {
    fsSelectCount.textContent = n + (n === 1 ? ' selected' : ' selected');
    fsSelectBar.classList.remove('hidden');
  } else {
    fsSelectBar.classList.add('hidden');
  }
}
function deleteSelectedMsgs() {
  if (!selectedMsgIds.size) return;
  state.fastSave.messages = fsMessages().filter((m) => !selectedMsgIds.has(m.id));
  selectedMsgIds.clear();
  updateFsSelectBar();
  renderFsMessages();
  renderTabs();
  scheduleSave();
}

// ---------- Fast Save: edit a message in place ----------
function startFsEdit(id) {
  const m = fsMessages().find((x) => x.id === id);
  if (!m) return;
  fsEditingId = id;
  setFsPendingImage(null); // editing keeps the message's own image; don't stage a new one
  fsInputEl.value = m.text || '';
  fsEditBar.classList.remove('hidden');
  renderFsMessages(); // highlight the row being edited
  fsAutoGrow();
  updateFsInputDir();
  fsInputEl.focus();
  fsInputEl.setSelectionRange(fsInputEl.value.length, fsInputEl.value.length);
}

function cancelFsEdit() {
  fsEditingId = null;
  fsEditBar.classList.add('hidden');
  fsInputEl.value = '';
  fsAutoGrow();
  updateFsInputDir();
}

fsEditCancel.addEventListener('click', () => { cancelFsEdit(); renderFsMessages(); });

// Per-keystroke RTL/LTR for the chat input, matching the editor's behaviour.
function updateFsInputDir() {
  const dir = detectDir(fsInputEl.value);
  fsInputEl.setAttribute('dir', dir);
  fsInputEl.style.textAlign = dir === 'rtl' ? 'right' : 'left';
}

fsSendBtn.addEventListener('click', fsSendMessage);
fsInputEl.addEventListener('input', () => { fsAutoGrow(); updateFsInputDir(); });
fsInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    fsSendMessage();
  } else if (e.key === 'Escape' && fsEditingId) {
    e.preventDefault();
    cancelFsEdit();
    renderFsMessages();
  }
});

// Attach an image to the next Fast Save message (button + Ctrl+V paste).
fsImgBtn.addEventListener('click', async () => {
  const res = await window.api.pickImage();
  if (res && res.filename) { setFsPendingImage(res.filename); fsInputEl.focus(); }
});
fsInputEl.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const imgItem = [...items].find((it) => it.kind === 'file' && IMG_EXT_BY_MIME[it.type]);
  if (!imgItem) return;
  e.preventDefault();
  const file = imgItem.getAsFile();
  if (!file) return;
  saveImageBlob(file).then((r) => { if (r && r.filename) setFsPendingImage(r.filename); });
});
fsPendingRemove.addEventListener('click', () => { setFsPendingImage(null); fsInputEl.focus(); });

// Attach a file to the next Fast Save message (Telegram-style).
fsFileBtn.addEventListener('click', async () => {
  const picked = await window.api.pickFiles();
  if (picked && picked.length) { setFsPendingFile(picked[0]); fsInputEl.focus(); }
});
fsPendingFileRemove.addEventListener('click', () => { setFsPendingFile(null); fsInputEl.focus(); });

// Fast Save multi-select action bar
fsSelectDelete.addEventListener('click', deleteSelectedMsgs);
fsSelectClear.addEventListener('click', clearMsgSelection);

// ---------- Fast Save: message search / filter ----------
function openFsSearch() {
  fsSearchBar.classList.remove('hidden');
  fsSearchInput.focus();
  fsSearchInput.select();
}
function closeFsSearch() {
  fsSearchBar.classList.add('hidden');
  fsSearchInput.value = '';
  fsFilterQuery = '';
  renderFsMessages();
  fsInputEl.focus();
}
fsHeaderSearchBtn.addEventListener('click', () => {
  if (fsSearchBar.classList.contains('hidden')) openFsSearch();
  else closeFsSearch();
});
fsSearchClose.addEventListener('click', closeFsSearch);
fsSearchInput.addEventListener('input', () => {
  fsFilterQuery = fsSearchInput.value;
  renderFsMessages();
});
fsSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeFsSearch(); }
});

// ---------- Fast Save: media gallery ----------
function openGallery() {
  galleryGrid.innerHTML = '';
  const withImg = fsMessages().filter((m) => m.image);
  galleryEmpty.classList.toggle('hidden', withImg.length > 0);
  // newest first
  withImg.slice().reverse().forEach((m) => {
    const cell = document.createElement('button');
    cell.className = 'gallery-cell';
    cell.dataset.msgId = m.id;
    const img = document.createElement('img');
    img.className = 'gallery-img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = 'ppimg://' + m.image;
    img.draggable = false;
    cell.appendChild(img);
    cell.addEventListener('click', () => openLightbox('ppimg://' + m.image));
    galleryGrid.appendChild(cell);
  });
  galleryOverlay.classList.remove('hidden');
}
function closeGallery() { galleryOverlay.classList.add('hidden'); }
fsGalleryBtn.addEventListener('click', openGallery);
galleryClose.addEventListener('click', closeGallery);
galleryOverlay.addEventListener('click', (e) => {
  if (e.target === galleryOverlay) closeGallery();
});

// Jump from the gallery to the chat message an image belongs to (Telegram-style).
function gotoFsMessage(msgId) {
  closeGallery();
  switchToFastSave();
  // clear any active search so the target is visible
  fsFilterQuery = '';
  fsSearchInput.value = '';
  fsSearchBar.classList.add('hidden');
  renderFsMessages();
  requestAnimationFrame(() => {
    const el = fsMessagesEl.querySelector('[data-msg-id="' + msgId + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('fs-msg-flash');
    setTimeout(() => el.classList.remove('fs-msg-flash'), 1600);
  });
}

// ---------- Actions ----------
function switchTab(id) {
  if (id === FS_ID) { switchToFastSave(); return; }
  _previewToken = null; _previewBase = null;
  clearFindHL();
  // flush current editor into state first
  syncEditorToState();
  state.activeId = id;
  showEditorView();
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
  showEditorView();
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
  showEditorView();
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
    case 'export': {
      const tab = state.tabs.find((t) => t.id === id);
      if (tab) {
        if (tab.id === state.activeId) syncEditorToState();
        window.api.exportNote(autoName(tab, state.tabs.indexOf(tab)), tab.content, 'md');
      }
      break;
    }
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

// ---------- Tab multi-selection ----------
function toggleTabSelection(id) {
  if (selectedTabIds.has(id)) selectedTabIds.delete(id);
  else selectedTabIds.add(id);
  lastClickedTabId = id;
  renderTabs();
}

// Add every tab between the last-clicked one and this one (in rail order).
function rangeSelectTo(id) {
  const order = orderedTabs().map((t) => t.id);
  const a = order.indexOf(lastClickedTabId);
  const b = order.indexOf(id);
  if (b === -1) return;
  if (a === -1) { selectedTabIds.add(id); lastClickedTabId = id; renderTabs(); return; }
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  for (let k = lo; k <= hi; k++) selectedTabIds.add(order[k]);
  lastClickedTabId = id;
  renderTabs();
}

function clearTabSelection() {
  if (!selectedTabIds.size) return;
  selectedTabIds.clear();
  renderTabs();
}

// Position a floating menu at the cursor, clamped to the viewport.
function placeMenuAt(menuEl, e) {
  menuEl.style.left = e.clientX + 'px';
  menuEl.style.top = e.clientY + 'px';
  menuEl.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = menuEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (rect.right > vw - 4) menuEl.style.left = Math.max(4, vw - rect.width - 4) + 'px';
    if (rect.bottom > vh - 4) menuEl.style.top = Math.max(4, vh - rect.height - 4) + 'px';
  });
}

// Build a color swatch row into `container`; onPick(color) fires per swatch.
// `activeColor` (optional) marks the currently-selected swatch.
function buildColorRow(container, onPick, activeColor) {
  container.innerHTML = '';
  TAB_COLORS.forEach((color) => {
    const sw = document.createElement('span');
    sw.className = 'ctx-swatch' + (color === null ? ' ctx-swatch--none' : '') +
      (color === (activeColor || null) ? ' active' : '');
    if (color) sw.style.background = color;
    sw.title = color || 'None';
    sw.addEventListener('click', (e) => { e.stopPropagation(); onPick(color); });
    container.appendChild(sw);
  });
}

// Build a group picker into `container`; onPick(groupId|null) per option.
function buildGroupPicker(container, onPick, onNew) {
  container.innerHTML = '';
  const mk = (label, cb) => {
    const b = document.createElement('button');
    b.className = 'ctx-group-item';
    b.textContent = label;
    b.setAttribute('dir', detectDir(label));
    b.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    container.appendChild(b);
  };
  mk('None', () => onPick(null));
  (state.groups || []).forEach((g) => mk(g.name, () => onPick(g.id)));
  mk('+ New…', onNew);
}

function showTabMultiMenu(e) {
  e.preventDefault();
  const n = selectedTabIds.size;
  tabMultiHead.textContent = n + (n === 1 ? ' tab selected' : ' tabs selected');
  buildColorRow(multiColorRow, (color) => {
    selectedTabIds.forEach((id) => { const t = state.tabs.find((x) => x.id === id); if (t) t.color = color || null; });
    hideTabMultiMenu();
    renderTabs();
    scheduleSave();
  });
  buildGroupPicker(multiGroupList,
    (gid) => {
      selectedTabIds.forEach((id) => setTabGroupSilent(id, gid));
      if (gid) { const g = (state.groups || []).find((x) => x.id === gid); if (g) g.collapsed = false; }
      hideTabMultiMenu();
      renderTabs();
      scheduleSave();
    },
    () => { hideTabMultiMenu(); openMultiGroupDialog(); });
  placeMenuAt(tabMultiMenu, e);
}
function hideTabMultiMenu() { tabMultiMenu.classList.add('hidden'); }

// Assign group without re-rendering (used in bulk loops).
function setTabGroupSilent(tabId, groupId) {
  const t = state.tabs.find((x) => x.id === tabId);
  if (t) t.groupId = groupId;
}

tabMultiMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-multi-action]');
  if (!item) return;
  const action = item.dataset.multiAction;
  hideTabMultiMenu();
  if (action === 'rename') {
    multiRenameInput.value = '';
    multiRenameDialog.classList.remove('hidden');
    multiRenameInput.focus();
  } else if (action === 'close') {
    const ids = [...selectedTabIds];
    selectedTabIds.clear();
    ids.forEach((id) => closeTab(id));
  }
});

// Apply "1/base", "2/base" … to the selected tabs in rail order.
function applyMultiRename(base) {
  const order = orderedTabs().filter((t) => selectedTabIds.has(t.id));
  order.forEach((t, idx) => { t.name = (idx + 1) + '/' + base; t.custom = true; });
  renderTabs();
  scheduleSave();
}
multiRenameCancel.addEventListener('click', () => multiRenameDialog.classList.add('hidden'));
function confirmMultiRename() {
  const base = multiRenameInput.value.trim();
  multiRenameDialog.classList.add('hidden');
  if (base) applyMultiRename(base);
}
multiRenameSave.addEventListener('click', confirmMultiRename);
multiRenameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmMultiRename(); }
  if (e.key === 'Escape') { multiRenameDialog.classList.add('hidden'); }
});

// Create a new group and move all selected tabs into it.
function openMultiGroupDialog() {
  groupNameDialog.dataset.multi = '1';
  groupNameInput.value = '';
  groupNameDialog.classList.remove('hidden');
  groupNameInput.focus();
}

// ---------- Group-header context menu ----------
let groupCtxId = null;
function showGroupCtxMenu(e, groupId) {
  e.preventDefault();
  groupCtxId = groupId;
  const group = (state.groups || []).find((g) => g.id === groupId);
  const pinItem = groupContextMenu.querySelector('[data-group-action="pin"]');
  if (pinItem) pinItem.textContent = (group && group.pinned) ? 'Unpin group' : 'Pin group';
  buildColorRow(groupColorRow, (color) => {
    // Color the group header itself — members stay untouched.
    if (group) group.color = color || null;
    hideGroupCtxMenu();
    renderTabs();
    scheduleSave();
  }, group && group.color);
  placeMenuAt(groupContextMenu, e);
}

// All member tabs of a group, joined "## name" + content with --- separators.
function groupContentJoined(groupId) {
  syncEditorToState();
  const members = orderedTabs().filter((t) => t.groupId === groupId);
  return members
    .map((t) => '## ' + autoName(t, state.tabs.indexOf(t)) + '\n\n' + (t.content || ''))
    .join('\n\n---\n\n');
}

// Duplicate a group and all its member tabs into a new group.
function duplicateGroup(groupId) {
  syncEditorToState();
  const src = (state.groups || []).find((g) => g.id === groupId);
  if (!src) return;
  const ng = { id: uid(), name: src.name + ' copy', collapsed: false, color: src.color || null, pinned: !!src.pinned };
  state.groups.push(ng);
  const members = orderedTabs().filter((t) => t.groupId === groupId);
  members.forEach((t) => {
    state.tabs.push({
      id: uid(), name: t.name, custom: t.custom, content: t.content,
      dir: t.dir, color: t.color || null, groupId: ng.id
    });
  });
  renderTabs();
  scheduleSave();
}
function hideGroupCtxMenu() { groupContextMenu.classList.add('hidden'); groupCtxId = null; }

groupContextMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-group-action]');
  if (!item || !groupCtxId) return;
  const id = groupCtxId;
  const action = item.dataset.groupAction;
  const group = (state.groups || []).find((g) => g.id === id);
  hideGroupCtxMenu();
  switch (action) {
    case 'rename': {
      const headerEl = tabListEl.querySelector('.tab-group-header[data-group-id="' + id + '"]');
      const nameEl = headerEl && headerEl.querySelector('.tab-group-name');
      if (nameEl && group) startGroupRename(group, nameEl);
      break;
    }
    case 'duplicate': duplicateGroup(id); break;
    case 'copy': {
      const text = groupContentJoined(id);
      if (text) navigator.clipboard.writeText(text).catch((err) => console.error(err));
      break;
    }
    case 'export':
      if (group) window.api.exportNote(group.name, groupContentJoined(id), 'md');
      break;
    case 'pin':
      if (group) { group.pinned = !group.pinned; renderTabs(); scheduleSave(); }
      break;
    case 'ungroup': dissolveGroup(id); break;
  }
});

document.addEventListener('click', (e) => {
  if (!tabMultiMenu.classList.contains('hidden') && !tabMultiMenu.contains(e.target)) hideTabMultiMenu();
  if (!groupContextMenu.classList.contains('hidden') && !groupContextMenu.contains(e.target)) hideGroupCtxMenu();
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
  showEditorView();
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
  // Persist only durable tab fields. undo/redo stacks (up to 100 full copies
  // of a tab's content each) and checkpoint bookkeeping are session-only;
  // serializing them into every autosave made saves grow with typing history
  // and bloated the data file on disk.
  const tabs = state.tabs.map(
    ({ undoStack, redoStack, pendingCheckpoint, checkpointTimer, ...t }) => t
  );
  try {
    await window.api.saveNotes({ ...state, tabs });
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
      activeId: saved.activeId === FS_ID && settings.fastSaveEnabled
        ? FS_ID
        : (saved.activeId && saved.tabs.some((t) => t.id === saved.activeId)
          ? saved.activeId
          : saved.tabs[0].id),
      seq: saved.seq || 1,
      templates: saved.templates || [],
      groups: saved.groups || [],
      phValues: saved.phValues || {},
      fastSave: (saved.fastSave && Array.isArray(saved.fastSave.messages))
        ? saved.fastSave
        : { messages: [] },
      lastVersion: saved.lastVersion || null
    };
  } else {
    state.tabs = [{ id: uid(), name: '', custom: false, content: '', dir: 'auto', color: null }];
    state.activeId = state.tabs[0].id;
    state.templates = [];
    state.groups = [];
    state.phValues = {};
    state.fastSave = { messages: [] };
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
    // live update auto-name if not custom — patch just the name span; a full
    // renderTabs() here rebuilt the whole rail on every keystroke (visible
    // flicker + wasted layout with many tabs)
    if (!t.custom) updateActiveTabName(t);
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
  // Continue todo lists: Enter after the "- [ ] " prefix of a non-empty todo
  // line starts the next line with a fresh unchecked prefix.
  const todoM = text.match(TODO_RE);
  let contPrefix = '';
  if (todoM && offset >= todoM[0].length && text.length > todoM[0].length) {
    contPrefix = todoM[1] + '- [ ] ';
  }
  const firstLine = makeLine(text.slice(0, offset));
  const secondLine = makeLine(contPrefix + text.slice(offset));
  line.replaceWith(firstLine, secondLine);

  updateLineDirs();
  placeCaretInLine(secondLine, contPrefix.length);
  // Keep the new line in view as the caret moves past the viewport bottom.
  secondLine.scrollIntoView({ block: 'nearest' });

  handleEditorChanged();
});

// ---------- Todo checklists ----------
// Rewrite a line's text through a TODO_RE-aware transform and re-decorate.
function setLineText(line, next, caretOffset) {
  line.textContent = next;
  highlightLine(line);
  if (caretOffset != null) placeCaretInLine(line, Math.max(0, Math.min(next.length, caretOffset)));
  handleEditorChanged();
}

// Add/remove the "- [ ] " prefix on the caret line (statusbar button).
function toggleTodoOnCurrentLine() {
  if (mdOn || fsActive()) return;
  editorEl.focus();
  let line = currentLine();
  if (!line) {
    const all = editorLines();
    line = all[all.length - 1];
    if (!line) { setEditorText(''); line = editorLines()[0]; }
  }
  const text = line.textContent;
  const offset = getCaretOffsetIn(line);
  const m = text.match(TODO_RE);
  if (m) {
    const removed = m[0].length - m[1].length;
    setLineText(line, text.replace(TODO_RE, '$1'),
      offset == null ? null : offset - removed);
  } else {
    setLineText(line, text.replace(/^(\s*)/, '$1- [ ] '),
      offset == null ? text.length + 6 : offset + 6);
  }
}

function flipTodoPrefix(lineText) {
  return lineText.replace(TODO_RE, (s, ws, c) => ws + '- [' + (c === 'x' ? ' ' : 'x') + '] ');
}

// The .ln lines that the current selection touches (empty if no selection).
function selectedLines() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  if (range.collapsed) return [];
  return editorLines().filter((ln) => range.intersectsNode(ln));
}

// Todo button: with a multi-line selection, turn every selected line into a
// todo (or clear them all if they're already todos); otherwise toggle the
// caret line.
function applyTodoButton() {
  if (mdOn || fsActive()) return;
  const lines = selectedLines();
  if (lines.length > 1) {
    const allHave = lines.every((l) => TODO_RE.test(l.textContent));
    lines.forEach((l) => {
      const text = l.textContent;
      if (allHave) l.textContent = text.replace(TODO_RE, '$1');
      else if (!TODO_RE.test(text)) l.textContent = text.replace(/^(\s*)/, '$1- [ ] ');
      highlightLine(l);
    });
    handleEditorChanged();
    return;
  }
  toggleTodoOnCurrentLine();
}

// Preserve the editor selection when pressing the button (don't let the
// button steal focus before the click handler reads the selection).
todoBtn.addEventListener('mousedown', (e) => e.preventDefault());
todoBtn.addEventListener('click', applyTodoButton);

// Click a todo mark to check/uncheck it; click a thumbnail to zoom.
// mousedown + preventDefault keeps the caret where it was.
editorEl.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const mark = t.closest('.todo-mark');
  if (mark) {
    e.preventDefault();
    const line = mark.closest('.ln') || mark.parentElement;
    if (!line) return;
    line.textContent = flipTodoPrefix(line.textContent);
    highlightLine(line);
    handleEditorChanged();
    return;
  }
  if (t.closest('.pp-img-resize')) return; // handled by the resize listener
  const img = t.closest('.pp-img');
  if (img && e.button === 0) {
    e.preventDefault();
    openLightbox(img.getAttribute('src'));
  }
});

// ---------- Image thumbnails (editor) ----------
// A thumbnail is an <img> wrapped in a contenteditable=false span so it adds
// no text and can carry a corner resize handle. The wrapper records which
// image file + which editor line it belongs to for resize/download.
function makeImgThumb(file, width) {
  const wrap = document.createElement('span');
  wrap.className = 'pp-img-wrap';
  wrap.setAttribute('contenteditable', 'false');
  wrap.dataset.file = file;

  const img = document.createElement('img');
  img.className = 'pp-img';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = 'ppimg://' + file;
  img.draggable = false;
  if (width) img.style.width = width + 'px';
  wrap.appendChild(img);

  if (settings.imageResizable) {
    const handle = document.createElement('span');
    handle.className = 'pp-img-resize';
    handle.title = 'Drag to resize';
    wrap.appendChild(handle);
  }
  return wrap;
}

// Persist a resized width back into the line's image token so it survives
// save/reload and the DOM round-trip.
function writeImgWidth(line, file, width) {
  if (!line) return;
  const text = line.textContent;
  let idx = 0, replaced = false;
  const next = text.replace(IMG_TOKEN_RE, (m, f) => {
    if (!replaced && f === file) { replaced = true; return imgToken(f, width); }
    return m;
  });
  if (next !== text) {
    line.textContent = next;
    highlightLine(line);
    handleEditorChanged();
  }
}

// Corner-drag resize (editor thumbnails only).
let imgResizing = null;
editorEl.addEventListener('mousedown', (e) => {
  const handle = e.target instanceof Element && e.target.closest('.pp-img-resize');
  if (!handle || !settings.imageResizable) return;
  e.preventDefault();
  const wrap = handle.closest('.pp-img-wrap');
  const img = wrap && wrap.querySelector('.pp-img');
  if (!img) return;
  imgResizing = {
    img,
    wrap,
    line: wrap.closest('.ln'),
    file: wrap.dataset.file,
    startX: e.clientX,
    startW: img.getBoundingClientRect().width
  };
  document.body.style.cursor = 'nwse-resize';
});
window.addEventListener('mousemove', (e) => {
  if (!imgResizing) return;
  const w = Math.max(60, Math.min(900, Math.round(imgResizing.startW + (e.clientX - imgResizing.startX))));
  imgResizing.img.style.width = w + 'px';
});
window.addEventListener('mouseup', () => {
  if (!imgResizing) return;
  const r = imgResizing;
  imgResizing = null;
  document.body.style.cursor = '';
  const w = Math.round(r.img.getBoundingClientRect().width);
  writeImgWidth(r.line, r.file, w);
});

// Right-click a thumbnail → menu (zoom / save / — for editor images — remove).
let imgCtxTarget = null; // { file, source, wrap, line }

function showImgContextMenu(e, target) {
  imgCtxTarget = target;
  // Show items scoped to a source (data-img-only) only for that source.
  imgContextMenu.querySelectorAll('[data-img-only]').forEach((el) => {
    el.style.display = el.dataset.imgOnly === target.source ? '' : 'none';
  });
  const dl = imgContextMenu.querySelector('[data-img-action="download"]');
  if (dl) dl.style.display = settings.imageDownloadEnabled ? '' : 'none';

  imgContextMenu.style.left = e.clientX + 'px';
  imgContextMenu.style.top = e.clientY + 'px';
  imgContextMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = imgContextMenu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (rect.right > vw - 4) imgContextMenu.style.left = Math.max(4, vw - rect.width - 4) + 'px';
    if (rect.bottom > vh - 4) imgContextMenu.style.top = Math.max(4, vh - rect.height - 4) + 'px';
  });
}
function hideImgContextMenu() {
  imgContextMenu.classList.add('hidden');
  imgCtxTarget = null;
}

function fileFromImgSrc(src) {
  const m = /^ppimg:\/\/([a-zA-Z0-9._-]+)/.exec(src || '');
  return m ? m[1] : null;
}

// Remove one image token (the one behind `wrap`) from its editor line.
function removeImageFromLine(line, wrap) {
  if (!line) return;
  const wraps = [...line.querySelectorAll('.pp-img-wrap')];
  const nth = Math.max(0, wraps.indexOf(wrap));
  let seen = -1;
  const next = line.textContent.replace(IMG_TOKEN_RE, (m) => {
    seen++;
    return seen === nth ? '' : m;
  });
  line.textContent = next;
  highlightLine(line);
  handleEditorChanged();
}

// Any ppimg image anywhere (editor, preview, chat, gallery) → context menu.
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const img = t.closest('.pp-img, .md-img, .fs-msg-img, .gallery-img');
  if (!img) return;
  const file = fileFromImgSrc(img.getAttribute('src'));
  if (!file) return;
  const isEditor = !!img.closest('#editor');
  const galleryCell = img.closest('.gallery-cell');
  // Editor & gallery images always get a menu (Remove / Go to message);
  // elsewhere only when the right-click-to-save option is enabled.
  if (!isEditor && !galleryCell && !settings.imageDownloadEnabled) return;
  e.preventDefault();
  const wrap = isEditor ? img.closest('.pp-img-wrap') : null;
  showImgContextMenu(e, {
    file,
    source: isEditor ? 'editor' : (galleryCell ? 'gallery' : 'other'),
    wrap,
    line: wrap ? wrap.closest('.ln') : null,
    msgId: galleryCell ? galleryCell.dataset.msgId : null
  });
});

// Copy an image to the OS clipboard via Electron's native clipboard API.
async function copyImageToClipboard(file) {
  try {
    await window.api.copyImageToClipboard(file);
  } catch (err) {
    console.error('copy image failed', err);
  }
}

imgContextMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-img-action]');
  if (!item || !imgCtxTarget) return;
  const { file, wrap, line, msgId } = imgCtxTarget;
  const action = item.dataset.imgAction;
  hideImgContextMenu();
  if (action === 'download') window.api.downloadImage(file);
  else if (action === 'copy') copyImageToClipboard(file);
  else if (action === 'reveal') window.api.revealImage(file);
  else if (action === 'zoom') openLightbox('ppimg://' + file);
  else if (action === 'delete' && line) removeImageFromLine(line, wrap);
  else if (action === 'goto' && msgId) gotoFsMessage(msgId);
});

document.addEventListener('click', (e) => {
  if (!imgContextMenu.classList.contains('hidden') && !imgContextMenu.contains(e.target)) {
    hideImgContextMenu();
  }
});

// ---------- Generic text edit context menu (cut/copy/paste/select all) ----------
// Fallback for any editable field or plain text selection that isn't already
// handled by a more specific menu (tabs, groups, images — all of which call
// e.preventDefault() themselves, so this only fires when nothing else did).
let textCtxTarget = null;

function showTextContextMenu(e, target, isEditable, hasSelection) {
  textCtxTarget = target;
  const setRow = (action, show, enabled) => {
    const el = textContextMenu.querySelector('[data-text-action="' + action + '"]');
    if (!el) return;
    el.style.display = show ? '' : 'none';
    el.classList.toggle('disabled', show && !enabled);
  };
  setRow('cut', isEditable, hasSelection);
  setRow('copy', true, hasSelection);
  setRow('paste', isEditable, true);
  setRow('selectall', isEditable, true);
  textContextMenu.querySelectorAll('.ctx-sep').forEach((s) => { s.style.display = isEditable ? '' : 'none'; });

  textContextMenu.style.left = e.clientX + 'px';
  textContextMenu.style.top = e.clientY + 'px';
  textContextMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = textContextMenu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (rect.right > vw - 4) textContextMenu.style.left = Math.max(4, vw - rect.width - 4) + 'px';
    if (rect.bottom > vh - 4) textContextMenu.style.top = Math.max(4, vh - rect.height - 4) + 'px';
  });
}
function hideTextContextMenu() {
  textContextMenu.classList.add('hidden');
  textCtxTarget = null;
}

document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return; // a more specific menu already handled this
  const t = e.target;
  if (!(t instanceof Element)) return;
  const isField = t.matches('input, textarea');
  const isEditable = isField || t.isContentEditable;
  let hasSelection;
  if (isField) {
    hasSelection = t.selectionStart !== t.selectionEnd;
  } else {
    hasSelection = !!window.getSelection().toString();
  }
  if (!isEditable && !hasSelection) return; // nothing to do — leave no menu, as before
  e.preventDefault();
  showTextContextMenu(e, t, isEditable, hasSelection);
});

// mousedown (not click) so the menu never steals focus/selection from the
// field the user right-clicked — the commands below act on whatever still
// has focus at the time of the click.
textContextMenu.addEventListener('mousedown', (e) => e.preventDefault());

textContextMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('[data-text-action]');
  if (!item || item.classList.contains('disabled') || !textCtxTarget) return;
  const action = item.dataset.textAction;
  const target = textCtxTarget;
  hideTextContextMenu();
  target.focus();
  if (action === 'cut') document.execCommand('cut');
  else if (action === 'copy') document.execCommand('copy');
  else if (action === 'selectall') document.execCommand('selectAll');
  else if (action === 'paste') {
    // execCommand('paste') is blocked by Chromium's clipboard-read policy for
    // untrusted script; read via the async Clipboard API instead (same
    // pattern as the toolbar's paste button) and insert at the caret.
    try {
      const text = await navigator.clipboard.readText();
      if (text) document.execCommand('insertText', false, text);
    } catch (err) { console.error('paste failed', err); }
  }
});

document.addEventListener('click', (e) => {
  if (!textContextMenu.classList.contains('hidden') && !textContextMenu.contains(e.target)) {
    hideTextContextMenu();
  }
});

// ---------- Images ----------
const IMG_EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const s = String(fr.result || '');
      resolve(s.slice(s.indexOf(',') + 1)); // strip "data:...;base64,"
    };
    fr.readAsDataURL(blob);
  });
}

// Persist an image blob to userData/images via main; returns {filename} or null.
async function saveImageBlob(blob) {
  const ext = IMG_EXT_BY_MIME[blob.type];
  if (!ext) return null;
  if (blob.size > 10 * 1024 * 1024) {
    console.warn('image too large (max 10 MB)');
    return null;
  }
  try {
    const b64 = await blobToBase64(blob);
    return await window.api.saveImage(b64, ext);
  } catch (e) {
    console.error('saving image failed', e);
    return null;
  }
}

// Insert the image token as its own line right after the caret line.
function insertImageToken(filename) {
  const t = activeTab();
  if (!t) return;
  syncEditorToState();
  const prev = t.content;
  const token = '![img](ppimg://' + filename + ')';
  const lines = t.content.split('\n');
  let idx = lines.length - 1;
  const line = currentLine();
  if (line) {
    const domIdx = editorLines().indexOf(line);
    if (domIdx !== -1) idx = domIdx;
  }
  lines.splice(idx + 1, 0, token);
  t.content = lines.join('\n');
  noteEditForUndo(t, prev);
  setEditorText(t.content);
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
  if (mdOn) renderMdPreview();
}

imgBtn.addEventListener('click', async () => {
  if (mdOn || fsActive() || !activeTab()) return;
  const res = await window.api.pickImage();
  if (res && res.filename) insertImageToken(res.filename);
});

// Paste an image straight from the clipboard. Plain-text paste stays native.
editorEl.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const imgItem = [...items].find((it) => it.kind === 'file' && IMG_EXT_BY_MIME[it.type]);
  if (!imgItem) return;
  e.preventDefault();
  const file = imgItem.getAsFile();
  if (!file) return;
  saveImageBlob(file).then((res) => {
    if (res && res.filename) insertImageToken(res.filename);
  });
});

// ---------- Lightbox ----------
function openLightbox(src) {
  if (!src) return;
  lightboxImgEl.src = src;
  lightboxEl.classList.remove('hidden');
}

function closeLightbox() {
  lightboxEl.classList.add('hidden');
  lightboxImgEl.removeAttribute('src');
}

lightboxEl.addEventListener('click', closeLightbox);

// ---------- Markdown preview interactions ----------
// Toggle the underlying "- [ ]"/"- [x]" text for a preview todo item.
function toggleTodoLineInContent(lineIdx) {
  const t = activeTab();
  if (!t) return;
  const lines = t.content.split('\n');
  if (lineIdx < 0 || lineIdx >= lines.length || !TODO_RE.test(lines[lineIdx])) return;
  const prev = t.content;
  lines[lineIdx] = flipTodoPrefix(lines[lineIdx]);
  t.content = lines.join('\n');
  noteEditForUndo(t, prev);
  setEditorText(t.content);
  updateCounts();
  scheduleSave();
  renderMdPreview();
}

mdPreviewEl.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const copyCodeBtn = t.closest('.md-code-copy');
  if (copyCodeBtn) {
    const codeEl = copyCodeBtn.closest('.md-codeblock').querySelector('code');
    if (codeEl) {
      navigator.clipboard.writeText(codeEl.textContent).then(() => {
        copyCodeBtn.classList.add('copied');
        setTimeout(() => copyCodeBtn.classList.remove('copied'), 900);
      }).catch((err) => console.error('copy code failed', err));
    }
    return;
  }
  const img = t.closest('.md-img');
  if (img) { openLightbox(img.getAttribute('src')); return; }
  const link = t.closest('.md-link');
  if (link && link.dataset.href) {
    const url = link.dataset.href;
    if (/^https?:\/\//i.test(url)) window.api.openExternal(url);
    return;
  }
  const li = t.closest('.md-todo');
  if (li && li.dataset.line != null) toggleTodoLineInContent(Number(li.dataset.line));
});

// ---------- Editor text insertion / formatting ----------
// Selection confined to one .ln line, as character offsets within that line.
function currentLineSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount) {
    const line = currentLine();
    if (!line) return null;
    const off = getCaretOffsetIn(line);
    return { line, start: off || 0, end: off || 0 };
  }
  const range = sel.getRangeAt(0);
  let node = range.commonAncestorContainer;
  while (node && node !== editorEl &&
    !(node.nodeType === 1 && node.classList && node.classList.contains('ln'))) {
    node = node.parentNode;
  }
  if (!node || node === editorEl) {
    const line = currentLine();
    if (!line) return null;
    const off = getCaretOffsetIn(line);
    return { line, start: off || 0, end: off || 0 };
  }
  const line = node;
  const pre1 = document.createRange();
  pre1.selectNodeContents(line);
  try { pre1.setEnd(range.startContainer, range.startOffset); } catch {}
  const a = pre1.toString().length;
  const pre2 = document.createRange();
  pre2.selectNodeContents(line);
  try { pre2.setEnd(range.endContainer, range.endOffset); } catch {}
  const b = pre2.toString().length;
  return { line, start: Math.min(a, b), end: Math.max(a, b) };
}

function insertAtCaret(str) {
  if (mdOn || fsActive()) return;
  editorEl.focus();
  let s = currentLineSelection();
  if (!s) {
    const all = editorLines();
    const line = all[all.length - 1];
    if (!line) { setEditorText(str); return; }
    s = { line, start: line.textContent.length, end: line.textContent.length };
  }
  const text = s.line.textContent;
  setLineText(s.line, text.slice(0, s.start) + str + text.slice(s.end), s.start + str.length);
}

// Wrap the selection (or insert a stub at the caret) with markdown markers.
function surroundSelection(before, after, stub) {
  if (mdOn || fsActive()) return;
  editorEl.focus();
  const s = currentLineSelection();
  if (!s) return;
  const text = s.line.textContent;
  if (s.start === s.end) {
    const mid = s.start;
    setLineText(s.line, text.slice(0, mid) + before + (stub || '') + after + text.slice(mid),
      mid + before.length + (stub ? stub.length : 0));
  } else {
    const sel = text.slice(s.start, s.end);
    setLineText(s.line, text.slice(0, s.start) + before + sel + after + text.slice(s.end),
      s.end + before.length + after.length);
  }
}

// ---------- Emoji picker ----------
const EMOJIS = ['😀','😄','😁','😊','🙂','😉','😍','😘','😎','🤩','🤔','😐','😴','😢','😭','😡','🥳','🤯','😱','🤗',
  '👍','👎','👏','🙏','💪','🙌','👌','✌️','🤝','👀','🔥','✨','⭐','🌟','💯','✅','❌','⚠️','❓','❗',
  '❤️','🧡','💛','💚','💙','💜','🖤','💔','💖','💡','📌','📎','📝','🗒️','📅','⏰','🎯','🚀','🎉','🎁',
  '☕','🍕','🌙','☀️','🌈','⚡','💧','🎵','💰','🔒'];

let emojiBuilt = false;
let emojiTarget = 'editor'; // 'editor' | 'fs'
let emojiAnchor = null;

function insertIntoTextarea(ta, str) {
  const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
  ta.value = ta.value.slice(0, start) + str + ta.value.slice(end);
  const pos = start + str.length;
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

function insertEmoji(em) {
  if (emojiTarget === 'fs') insertIntoTextarea(fsInputEl, em);
  else insertAtCaret(em);
}

function buildEmojiPanel() {
  if (emojiBuilt) return;
  emojiBuilt = true;
  EMOJIS.forEach((em) => {
    const b = document.createElement('button');
    b.className = 'emoji-item';
    b.textContent = em;
    b.addEventListener('click', () => {
      insertEmoji(em);
      hideEmojiPanel();
    });
    emojiPanel.appendChild(b);
  });
}

function toggleEmojiPanel(anchorBtn, target) {
  emojiTarget = target || 'editor';
  emojiAnchor = anchorBtn || emojiBtn;
  if (!emojiPanel.classList.contains('hidden')) { hideEmojiPanel(); return; }
  buildEmojiPanel();
  const r = emojiAnchor.getBoundingClientRect();
  emojiPanel.classList.remove('hidden');
  const pr = emojiPanel.getBoundingClientRect();
  let left = r.left;
  if (left + pr.width > document.documentElement.clientWidth - 6) {
    left = document.documentElement.clientWidth - pr.width - 6;
  }
  emojiPanel.style.left = Math.max(6, left) + 'px';
  emojiPanel.style.top = (r.top - pr.height - 6) + 'px';
}
function hideEmojiPanel() { emojiPanel.classList.add('hidden'); }

emojiBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiPanel(emojiBtn, 'editor'); });
fsEmojiBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiPanel(fsEmojiBtn, 'fs'); });
document.addEventListener('click', (e) => {
  if (!emojiPanel.classList.contains('hidden') &&
      !emojiPanel.contains(e.target) && !(emojiAnchor && emojiAnchor.contains(e.target))) {
    hideEmojiPanel();
  }
});

// ---------- Link insertion ----------
function openLinkDialog() {
  if (mdOn || fsActive()) return;
  const s = currentLineSelection();
  const selected = s ? s.line.textContent.slice(s.start, s.end) : '';
  linkTextInput.value = selected;
  linkUrlInput.value = '';
  linkDialog.classList.remove('hidden');
  (selected ? linkUrlInput : linkTextInput).focus();
}
function closeLinkDialog() { linkDialog.classList.add('hidden'); }
function confirmLink() {
  const txt = linkTextInput.value.trim();
  let url = linkUrlInput.value.trim();
  if (!url) { closeLinkDialog(); return; }
  if (!/^[a-z]+:\/\//i.test(url) && !url.startsWith('#') && !url.startsWith('/')) url = 'https://' + url;
  const label = txt || url;
  closeLinkDialog();
  editorEl.focus();
  const s = currentLineSelection();
  if (!s) { insertAtCaret('[' + label + '](' + url + ')'); return; }
  const text = s.line.textContent;
  const md = '[' + label + '](' + url + ')';
  setLineText(s.line, text.slice(0, s.start) + md + text.slice(s.end), s.start + md.length);
}
linkBtn.addEventListener('click', openLinkDialog);
linkCancel.addEventListener('click', closeLinkDialog);
linkSave.addEventListener('click', confirmLink);
linkUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmLink(); }
  if (e.key === 'Escape') { closeLinkDialog(); }
});
linkTextInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); linkUrlInput.focus(); }
  if (e.key === 'Escape') { closeLinkDialog(); }
});

// ---------- Justify toggle ----------
// Editor lines carry an inline text-align (set per direction), so justify has
// to rewrite each line's alignment rather than rely on a CSS class.
function applyJustify() {
  const on = !!settings.editorJustify;
  justifyBtn.classList.toggle('active', on);
  mdPreviewEl.classList.toggle('justify', on);
  editorLines().forEach((d) => {
    const dir = d.getAttribute('dir') || 'ltr';
    d.style.textAlign = on ? 'justify' : (dir === 'rtl' ? 'right' : 'left');
    d.style.textAlignLast = '';
  });
}
justifyBtn.addEventListener('click', () => {
  settings.editorJustify = !settings.editorJustify;
  applyJustify();
  saveSettingsNow();
});

// ---------- Clean up spacing ----------
// Tidies the note's whitespace: collapses runs of spaces/tabs to one, trims
// trailing spaces per line, and squeezes 3+ blank lines down to one. Image
// and todo tokens contain no runs of spaces, so they're untouched.
function cleanUpText(text) {
  const lines = (text || '').split('\n').map((line) =>
    line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '')
  );
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function cleanUpNote() {
  if (mdOn || fsActive()) return;
  const t = activeTab();
  if (!t) return;
  syncEditorToState();
  const prev = t.content;
  const next = cleanUpText(prev);
  if (next === prev) {
    // brief "nothing to do" acknowledgement
    cleanBtn.classList.add('active');
    setTimeout(() => cleanBtn.classList.remove('active'), 400);
    return;
  }
  noteEditForUndo(t, prev);
  t.content = next;
  setEditorText(next);
  updateCounts();
  updatePlaceholderPanel();
  if (!t.custom) renderTabs();
  scheduleSave();
  editorEl.focus();
  placeCaretEnd();
}

cleanBtn.addEventListener('click', cleanUpNote);

addBtn.addEventListener('click', () => addTab());

copyBtn.addEventListener('click', async () => {
  const t = activeTab();
  if (!t || !t.content) return;
  try {
    await navigator.clipboard.writeText(t.content);
    copyBtn.classList.add('copied'); // swaps to a check + accent tint (CSS)
    setTimeout(() => copyBtn.classList.remove('copied'), 1300);
  } catch (e) {
    console.error('copy failed', e);
  }
});

// Paste clipboard text into the editor at the caret. Routed through
// execCommand so it fires the normal input pipeline (multi-line split,
// per-line RTL, undo).
pasteBtn.addEventListener('click', async () => {
  if (mdOn || fsActive()) return;
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) { console.error('paste failed', e); return; }
  if (!text) return;
  editorEl.focus();
  const ok = document.execCommand('insertText', false, text);
  if (!ok) insertAtCaret(text);
  pasteBtn.classList.add('copied');
  setTimeout(() => pasteBtn.classList.remove('copied'), 700);
});

// ---------- Per-tab file attachments ----------
function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

// Reflect the active tab's file count on the status-bar files button.
function updateFilesButton() {
  const t = activeTab();
  const n = (t && t.files && t.files.length) || 0;
  if (!filesCountEl) return;
  if (n) { filesCountEl.textContent = n; filesCountEl.classList.remove('hidden'); }
  else filesCountEl.classList.add('hidden');
}

function openFilesPanel() {
  if (fsActive() || !activeTab()) return;
  renderFilesList();
  filesOverlay.classList.remove('hidden');
}
function closeFilesPanel() { filesOverlay.classList.add('hidden'); }

function renderFilesList() {
  const t = activeTab();
  filesListEl.innerHTML = '';
  const files = (t && t.files) || [];
  filesEmptyEl.classList.toggle('hidden', files.length > 0);
  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-row';

    const info = document.createElement('div');
    info.className = 'file-row-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-row-name';
    nameEl.textContent = f.name;
    nameEl.title = f.name;
    nameEl.setAttribute('dir', detectDir(f.name));
    const meta = document.createElement('div');
    meta.className = 'file-row-meta';
    meta.textContent = fmtSize(f.size);
    info.appendChild(nameEl);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'file-row-actions';
    const mkBtn = (label, cls, cb) => {
      const b = document.createElement('button');
      b.className = 'file-act ' + cls;
      b.textContent = label;
      b.addEventListener('click', cb);
      actions.appendChild(b);
    };
    mkBtn('Open', 'file-open', () => window.api.openFile(f.storedName));
    mkBtn('Save as…', 'file-save', () => window.api.saveFileAs(f.storedName, f.name));
    mkBtn('Reveal', 'file-reveal', () => window.api.revealFile(f.storedName));
    mkBtn('Remove', 'file-remove', () => removeTabFile(f.id));

    row.appendChild(info);
    row.appendChild(actions);
    filesListEl.appendChild(row);
  });
}

async function addFilesToTab() {
  const t = activeTab();
  if (!t) return;
  const picked = await window.api.pickFiles();
  if (!picked || !picked.length) return;
  t.files = t.files || [];
  picked.forEach((f) => t.files.push({ id: uid(), ...f }));
  renderFilesList();
  updateFilesButton();
  scheduleSave();
}

function removeTabFile(id) {
  const t = activeTab();
  if (!t || !t.files) return;
  const f = t.files.find((x) => x.id === id);
  if (f) window.api.deleteFile(f.storedName);
  t.files = t.files.filter((x) => x.id !== id);
  renderFilesList();
  updateFilesButton();
  scheduleSave();
}

filesBtn.addEventListener('click', openFilesPanel);
filesClose.addEventListener('click', closeFilesPanel);
filesAddBtn.addEventListener('click', addFilesToTab);
filesOverlay.addEventListener('click', (e) => { if (e.target === filesOverlay) closeFilesPanel(); });

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
  // editor-only shortcuts are meaningless while the Fast Save chat is shown
  if (fsActive() && (e.code === 'KeyF' || e.code === 'KeyH' || e.code === 'KeyM')) return;
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
  } else if (!e.shiftKey && e.code === 'KeyB') {
    if (fsActive() || mdOn) return;
    e.preventDefault();
    surroundSelection('**', '**', 'bold');
  } else if (!e.shiftKey && e.code === 'KeyK') {
    if (fsActive() || mdOn) return;
    e.preventDefault();
    openLinkDialog();
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
  const ids = orderedTabs().map((t) => t.id);
  if (settings.fastSaveEnabled) ids.unshift(FS_ID);
  if (ids.length < 2) return;
  const idx = ids.indexOf(state.activeId);
  const next = (idx + dir + ids.length) % ids.length;
  switchTab(ids[next]);
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
  applyPlaceholderCollapsed();
  applyJustify();
  applyToolbarButtons();
}

// ---------- Toolbar buttons show/hide ----------
const TOOLBAR_BUTTONS = [
  { key: 'todo', label: 'Todo', el: () => todoBtn },
  { key: 'emoji', label: 'Emoji', el: () => emojiBtn },
  { key: 'link', label: 'Link', el: () => linkBtn },
  { key: 'justify', label: 'Justify', el: () => justifyBtn },
  { key: 'clean', label: 'Clean', el: () => cleanBtn },
  { key: 'md', label: 'Markdown', el: () => mdBtn },
  { key: 'paste', label: 'Paste', el: () => pasteBtn },
  { key: 'copy', label: 'Copy', el: () => copyBtn },
  { key: 'img', label: 'Image', el: () => imgBtn },
  { key: 'files', label: 'Attach File', el: () => filesBtn }
];

function toolbarPref(key) {
  return !settings.toolbar || settings.toolbar[key] !== false;
}

function applyToolbarButtons() {
  TOOLBAR_BUTTONS.forEach((b) => {
    const el = b.el();
    if (el) el.classList.toggle('hidden', !toolbarPref(b.key));
  });
}

// Row of clickable chips (one per button) — click toggles that button on/off.
function buildToolbarChips() {
  if (!toolbarRow) return;
  toolbarRow.innerHTML = '';
  TOOLBAR_BUTTONS.forEach((b) => {
    const chip = document.createElement('button');
    chip.className = 'toolbar-chip' + (toolbarPref(b.key) ? ' active' : '');
    chip.textContent = b.label;
    chip.addEventListener('click', () => {
      if (!settings.toolbar) settings.toolbar = {};
      settings.toolbar[b.key] = !toolbarPref(b.key);
      chip.classList.toggle('active', toolbarPref(b.key));
      applyToolbarButtons();
      saveSettingsNow();
    });
    toolbarRow.appendChild(chip);
  });
}

// ---------- Placeholder panel collapse ----------
function applyPlaceholderCollapsed() {
  const c = !!settings.placeholderBarCollapsed;
  placeholderBarEl.classList.toggle('collapsed', c);
  editorBodyEl.classList.toggle('ph-collapsed', c);
  placeholderCollapseEl.classList.toggle('collapsed', c);
  placeholderCollapseEl.title = c ? 'Expand' : 'Collapse';
}

placeholderCollapseEl.addEventListener('click', () => {
  settings.placeholderBarCollapsed = !settings.placeholderBarCollapsed;
  applyPlaceholderCollapsed();
  saveSettingsNow();
});

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
  buildToolbarChips();
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
  toggleFastSaveEl.checked = !!settings.fastSaveEnabled;
  toggleQuickCaptureEl.checked = !!settings.quickCaptureEnabled;
  toggleImageResizeEl.checked = !!settings.imageResizable;
  toggleImageDownloadEl.checked = !!settings.imageDownloadEnabled;
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

async function refreshStoragePathDisplay() {
  try {
    const res = await window.api.getStoragePath();
    if (res && res.path) {
      storagePathValueEl.textContent = res.path + (res.isDefault ? '  (default)' : '');
      storagePathValueEl.title = res.path;
    }
  } catch (e) { console.error('get-storage-path failed', e); }
}

function openSettings() {
  syncSettingsUI();
  refreshStoragePathDisplay();
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

toggleFastSaveEl.addEventListener('change', () => {
  settings.fastSaveEnabled = toggleFastSaveEl.checked;
  if (!settings.fastSaveEnabled && fsActive()) {
    // leave the chat view; messages are kept for when it's re-enabled
    const ordered = orderedTabs();
    if (ordered.length) switchTab(ordered[0].id);
    else addTab(false);
  }
  renderTabs();
  saveSettingsNow();
});

toggleQuickCaptureEl.addEventListener('change', async () => {
  const want = toggleQuickCaptureEl.checked;
  let real = false;
  try { real = await window.api.setQuickCapture(want); } catch {}
  settings.quickCaptureEnabled = want ? !!real : false;
  // snap back if the shortcut is taken by another app
  toggleQuickCaptureEl.checked = settings.quickCaptureEnabled;
  saveSettingsNow();
});

toggleImageResizeEl.addEventListener('change', () => {
  settings.imageResizable = toggleImageResizeEl.checked;
  invalidateHighlights();
  if (!mdOn && !fsActive()) setEditorText(getEditorText()); // add/remove handles
  saveSettingsNow();
});

toggleImageDownloadEl.addEventListener('change', () => {
  settings.imageDownloadEnabled = toggleImageDownloadEl.checked;
  saveSettingsNow();
});

// ---------- Storage location ----------
changeStorageBtn.addEventListener('click', async () => {
  const folder = await window.api.pickStorageFolder();
  if (!folder) return;
  changeStorageBtn.disabled = true;
  changeStorageLabel.textContent = 'Moving…';
  const res = await window.api.setStoragePath(folder);
  changeStorageBtn.disabled = false;
  if (res && res.ok) {
    changeStorageLabel.textContent = 'Moved ✓';
    refreshStoragePathDisplay();
  } else {
    changeStorageLabel.textContent = 'Failed — ' + (res && res.error ? res.error : 'unknown error');
  }
  setTimeout(() => { changeStorageLabel.textContent = 'Change location…'; }, 3000);
});

openStorageBtn.addEventListener('click', () => window.api.openStorageFolder());

// ---------- Backup: export / import ----------
exportDataBtn.addEventListener('click', async () => {
  await doSave(); // flush pending edits to disk first
  const res = await window.api.exportData();
  if (res && res.ok) {
    exportDataLabel.textContent = 'Exported ✓';
  } else if (res && !res.canceled) {
    exportDataLabel.textContent = 'Export failed';
  }
  setTimeout(() => { exportDataLabel.textContent = 'Export all data…'; }, 2500);
});

importDataBtn.addEventListener('click', () => {
  importConfirmDialog.classList.remove('hidden');
});

function closeImportConfirm() {
  importConfirmDialog.classList.add('hidden');
}

importCancelBtn.addEventListener('click', closeImportConfirm);

importConfirmBtn.addEventListener('click', async () => {
  closeImportConfirm();
  const res = await window.api.importData();
  if (res && res.ok) {
    window.api.relaunchApp(); // reload everything through the normal startup path
  } else if (res && res.invalid) {
    importDataLabel.textContent = 'Invalid backup file';
    setTimeout(() => { importDataLabel.textContent = 'Import backup…'; }, 2500);
  }
});

togglePlaceholdersEl.addEventListener('change', () => {
  settings.placeholdersEnabled = togglePlaceholdersEl.checked;
  invalidateHighlights();
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
  try {
    settings.quickCaptureEnabled = !!(await window.api.setQuickCapture(true));
  } catch { settings.quickCaptureEnabled = false; }
  applySettings();
  syncSettingsUI();
  renderTabs();
  updateLineDirs();
  updatePlaceholderPanel();
  applyActiveView();
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
  if (settings.placeholderBarPosition !== 'right' || settings.placeholderBarCollapsed) return;
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

// Title-bar search: opens the right search for the active view.
searchBtn.addEventListener('click', () => {
  if (fsActive()) openFsSearch();
  else openFind(false);
});

// ---------- Quick capture (Ctrl+Shift+Space floating box) ----------
let qcPendingImage = null;

function setQcPendingImage(filename) {
  qcPendingImage = filename || null;
  if (qcPendingImage) {
    qcPendingImg.src = 'ppimg://' + qcPendingImage;
    qcPending.classList.remove('hidden');
  } else {
    qcPendingImg.removeAttribute('src');
    qcPending.classList.add('hidden');
  }
}

function openQuickCapture() {
  qcInput.value = '';
  setQcPendingImage(null);
  quickCaptureOverlay.classList.remove('hidden');
  qcInput.focus();
}

function closeQuickCapture() {
  quickCaptureOverlay.classList.add('hidden');
  qcInput.value = '';
  setQcPendingImage(null);
}

// Save the quick-capture content as a Fast Save message.
function commitQuickCapture() {
  const text = qcInput.value.replace(/\s+$/, '');
  if (!text.trim() && !qcPendingImage) { closeQuickCapture(); return; }
  const msg = { id: uid(), ts: Date.now(), text };
  if (qcPendingImage) msg.image = qcPendingImage;
  fsMessages().push(msg);
  closeQuickCapture();
  renderTabs();
  if (fsActive()) renderFsMessages();
  scheduleSave();
}

qcClose.addEventListener('click', closeQuickCapture);
qcInput.addEventListener('input', () => {
  const dir = detectDir(qcInput.value);
  qcInput.setAttribute('dir', dir);
  qcInput.style.textAlign = dir === 'rtl' ? 'right' : 'left';
});
qcInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    commitQuickCapture();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeQuickCapture();
  }
});
qcInput.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const imgItem = [...items].find((it) => it.kind === 'file' && IMG_EXT_BY_MIME[it.type]);
  if (!imgItem) return;
  e.preventDefault();
  const file = imgItem.getAsFile();
  if (!file) return;
  saveImageBlob(file).then((r) => { if (r && r.filename) setQcPendingImage(r.filename); });
});
qcPendingRemove.addEventListener('click', () => { setQcPendingImage(null); qcInput.focus(); });
quickCaptureOverlay.addEventListener('click', (e) => {
  if (e.target === quickCaptureOverlay) closeQuickCapture();
});

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

  // Fast Save messages participate in all-tabs search too
  if (settings.fastSaveEnabled && fsMessages().length) {
    const joined = fsMessages().map((m) => m.text).join('\n');
    const lower = joined.toLowerCase();
    let p = 0, count = 0, first = -1;
    while ((p = lower.indexOf(qLower, p)) !== -1) {
      if (first === -1) first = p;
      count++;
      p++;
    }
    if (count) {
      any = true;
      const start = Math.max(0, first - 24);
      let snip = joined.slice(start, first + q.length + 40).replace(/\s+/g, ' ').trim();
      if (start > 0) snip = '…' + snip;
      if (first + q.length + 40 < joined.length) snip += '…';

      const row = document.createElement('div');
      row.className = 'find-result-row';
      const name = document.createElement('span');
      name.className = 'find-result-name';
      name.textContent = 'Fast Save';
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
      row.addEventListener('click', () => switchToFastSave());
      findResultsEl.appendChild(row);
    }
  }

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
  '• Fix — right-click on an image now actually opens its menu (it silently\n' +
  '   did nothing before); Copy image is also far more reliable now.\n' +
  '• Image right-click menu — added Copy image and Show in folder.\n' +
  '• Markdown code blocks — a copy button in the top-left corner, and the\n' +
  '   scrollbar now matches the rest of the app instead of the OS default.\n' +
  '• A generic Cut / Copy / Paste / Select All right-click menu now works\n' +
  '   everywhere text can be edited — the editor, Fast Save, dialogs, even\n' +
  '   the separate quick-capture popup.\n' +
  '• Settings → Storage — see where attached images/files are kept and\n' +
  '   move them to any folder you want; your notes stay put either way.\n' +
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

// ---------- Drag & drop files ----------
// Dropping .txt/.md files creates a tab per file; images are inserted into
// the current note. Internal tab drags carry no Files entry, so the guard
// keeps them on their own code path.
function createTabFromFile(name, content) {
  syncEditorToState();
  const tab = {
    id: uid(),
    name: String(name || '').trim().slice(0, 60) || 'Imported',
    custom: true,
    content,
    dir: 'auto',
    color: null
  };
  state.tabs.push(tab);
  state.activeId = tab.id;
  showEditorView();
  setEditorText(tab.content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
}

// Make sure a real note is active before inserting a dropped image.
function ensureEditorTab() {
  if (!fsActive() && activeTab()) return;
  const ordered = orderedTabs();
  if (ordered.length) switchTab(ordered[0].id);
  else addTab(false);
}

window.addEventListener('dragover', (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropHintEl.classList.remove('hidden');
  }
});

window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropHintEl.classList.add('hidden');
});

window.addEventListener('drop', async (e) => {
  dropHintEl.classList.add('hidden');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  e.preventDefault();

  for (const f of Array.from(files)) {
    if (IMG_EXT_BY_MIME[f.type]) {
      const res = await saveImageBlob(f);
      if (res && res.filename) {
        ensureEditorTab();
        insertImageToken(res.filename);
      }
    } else if (/\.(txt|md|markdown)$/i.test(f.name)) {
      if (f.size > 2 * 1024 * 1024) continue; // 2 MB cap
      try {
        const text = await f.text();
        createTabFromFile(f.name.replace(/\.[^.]+$/, ''), text);
      } catch (err) {
        console.error('reading dropped file failed', err);
      }
    }
  }
});

// ---------- Init ----------
(async function init() {
  const savedSettings = await window.api.loadSettings();
  settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  // ensure every toolbar key exists even if an older save lacked some
  settings.toolbar = { ...DEFAULT_SETTINGS.toolbar, ...(settings.toolbar || {}) };
  // reflect real OS startup state
  try { settings.launchAtStartup = await window.api.getStartup(); } catch {}
  applySettings();

  const hadSaved = await loadState();
  maybeShowWhatsNew(hadSaved);
  applyActiveView();

  const onTop = await window.api.getAlwaysOnTop();
  pinBtn.classList.toggle('active', onTop);

  buildCtxColorRow();

  // A quick-capture popup (separate window) forwards its text/image here; we
  // append it to Fast Save without the app window ever coming to the front.
  window.api.onQcMessage((payload) => {
    if (!payload) return;
    const text = (payload.text || '').replace(/\s+$/, '');
    if (!text.trim() && !payload.image) return;
    const msg = { id: uid(), ts: Date.now(), text };
    if (payload.image) msg.image = payload.image;
    fsMessages().push(msg);
    renderTabs();
    if (fsActive()) renderFsMessages();
    scheduleSave();
  });
  if (settings.quickCaptureEnabled) {
    try {
      settings.quickCaptureEnabled = !!(await window.api.setQuickCapture(true));
    } catch { settings.quickCaptureEnabled = false; }
  }

  // close overlays with Escape (priority: lightbox > ctx menu > find bar > dialogs > overlays)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!emojiPanel.classList.contains('hidden')) { hideEmojiPanel(); return; }
    if (!imgContextMenu.classList.contains('hidden')) { hideImgContextMenu(); return; }
    if (!textContextMenu.classList.contains('hidden')) { hideTextContextMenu(); return; }
    if (!tabMultiMenu.classList.contains('hidden')) { hideTabMultiMenu(); return; }
    if (!groupContextMenu.classList.contains('hidden')) { hideGroupCtxMenu(); return; }
    if (!lightboxEl.classList.contains('hidden')) { closeLightbox(); return; }
    if (!quickCaptureOverlay.classList.contains('hidden')) { closeQuickCapture(); return; }
    if (!galleryOverlay.classList.contains('hidden')) { closeGallery(); return; }
    if (!filesOverlay.classList.contains('hidden')) { closeFilesPanel(); return; }
    if (!linkDialog.classList.contains('hidden')) { closeLinkDialog(); return; }
    if (!multiRenameDialog.classList.contains('hidden')) { multiRenameDialog.classList.add('hidden'); return; }
    if (!ctxMenuEl.classList.contains('hidden')) { hideCtxMenu(); return; }
    if (!importConfirmDialog.classList.contains('hidden')) { closeImportConfirm(); return; }
    if (fsActive() && selectedMsgIds.size) { clearMsgSelection(); return; }
    if (selectedTabIds.size) { clearTabSelection(); return; }
    if (fsActive() && !fsSearchBar.classList.contains('hidden')) { closeFsSearch(); return; }
    if (!findBarEl.classList.contains('hidden')) { closeFind(); return; }
    if (mdOn && !fsActive()) { setMdPreview(false); return; }
    if (!saveTemplateDialog.classList.contains('hidden')) { closeSaveTemplateDialog(); return; }
    if (!groupNameDialog.classList.contains('hidden')) { closeGroupDialog(); return; }
    if (!historyOverlay.classList.contains('hidden')) { closeHistory(); return; }
    if (!templatesOverlay.classList.contains('hidden')) { closeTemplates(); return; }
    if (!settingsOverlay.classList.contains('hidden')) { closeSettings(); return; }
  });

  if (!fsActive()) editorEl.focus();

  // auto-check for updates after short delay (silent — banner only if newer version found)
  if (settings.autoCheckUpdates) {
    setTimeout(() => runUpdateCheck(true), 3000);
  }
})();
