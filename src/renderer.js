// ---------- State ----------
let state = {
  tabs: [],      // { id, name, custom, content, dir, align, md, pinned, color, groupId, snapshots, files }
  activeId: null,
  seq: 1,
  templates: [], // { id, name, content }
  groups: [],    // { id, name, collapsed }
  phValues: {},  // { '[token]': ['recent', 'values'] } — MRU, max 8
  fastSave: { messages: [] }, // { id, ts, text } — chat-style quick notes
  aiChat: { messages: [] }, // { id, ts, role: 'user'|'assistant', text } — one continuous AI conversation
  promptLab: [] // { id, ts, title, prompt, category, image?, audio?, video? } — local personal prompt library
};

// Sentinel activeId for the Fast Save view (not a real tab).
const FS_ID = '__fastsave__';
// Sentinel activeId for the AI Chat view (not a real tab).
const AI_ID = '__aichat__';
// Sentinel activeId for the Discover (shared prompt gallery) view.
const DISCOVER_ID = '__discover__';
// Sentinel activeId for the Prompt Lab (local personal library) view.
const LAB_ID = '__promptlab__';

function fsActive() {
  return state.activeId === FS_ID;
}

function aiChatActive() {
  return state.activeId === AI_ID;
}

function discoverActive() {
  return state.activeId === DISCOVER_ID;
}

function labActive() {
  return state.activeId === LAB_ID;
}

function labItems() {
  if (!Array.isArray(state.promptLab)) state.promptLab = [];
  return state.promptLab;
}

function fsMessages() {
  if (!state.fastSave || !Array.isArray(state.fastSave.messages)) {
    state.fastSave = { messages: [] };
  }
  return state.fastSave.messages;
}

function aiMessages() {
  if (!state.aiChat || !Array.isArray(state.aiChat.messages)) {
    state.aiChat = { messages: [] };
  }
  return state.aiChat.messages;
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
  templatesEnabled: true,       // show the templates button in the rail
  discoverEnabled: true,        // show the Discover tab in the rail (only when configured)
  discoverHintDismissed: false, // one-time "you can hide this in Settings" note
  promptLabEnabled: true,       // show the Prompt Lab (local library) button in the rail
  promptLabHintDismissed: false, // one-time "this is your private space" note
  collabEnabled: true,          // shared notes — invite another user into one of your tabs
  aiEnabled: true,              // master switch — hides every AI surface when off
  aiChatEnabled: true,          // show the AI Chat button in the rail (only when aiEnabled)
  profilesEnabled: true,        // show the profile switcher in the title bar (hiding it keeps every profile)
  quickCaptureEnabled: true,
  mdShortcuts: false, // Ctrl+I / Ctrl+Shift+… markdown formatting keys — opt-in
  imageResizable: true,
  imageDownloadEnabled: true,
  mdImageFullSize: false, // markdown preview: show images at full size (fit window) instead of the small thumbnail cap
  // Legacy. Alignment is per-tab now (t.align); this is kept only as the source
  // migrateTabAlign() in main.js reads once at boot. The renderer never writes
  // it any more — see the Text alignment section.
  editorAlign: 'auto', // 'auto' | 'left' | 'center' | 'right' | 'justify'
  fastSaveName: 'Fast Save',
  // which status-bar buttons are shown (toggle in Settings → Toolbar)
  toolbar: {
    todo: true, emoji: true, link: true, justify: true, clean: true, improve: true, voice: true,
    md: true, paste: true, copy: true, img: true, genimg: true, files: true
  },
  imageGen: { provider: 'pollinations', geminiApiKey: '', hfApiKey: '' },
  seenFeatures: {}, // { improve: true, aiChat: true, ... } — clears each button's "New" badge once used
  voice: { hfApiKey: '' }, // Hugging Face token for speech-to-text (Whisper)
  ai: { openrouterKey: '' }, // each user's own free OpenRouter key for Chat / Improve / AI actions
  toolbarOrder: [], // full left-to-right key order — filled in from TOOLBAR_BUTTONS on first render
  toolbarCollapsed: [], // subset of toolbarOrder currently tucked behind the overflow chevron
  toolbarNudged: false, // true once the one-time "some icons start collapsed" nudge has run
  railHidden: false, // tab rail collapsed to leave only the editor (persists)
  zenMode: false, // distraction-free mode — always reset to false on load (never boot chromeless)
  tabSize: 'medium', // 'small' | 'medium' | 'large' — height of tabs & group headers
  handyEnabled: true, // master switch for the whole handy dock feature
  handyMode: false, // "handy" peek dock — collapses to a line at the screen edge (persists)
  handyPosition: 'center', // 'left' | 'center' | 'right' — where the line docks
  handyCloseMode: 'leave', // 'leave' = hide when the mouse leaves; 'click' = stay open until you click away
  handyShortcut: 'Ctrl+Shift+D', // global (system-wide) show/hide toggle for the handy dock
  handyDisabledAction: 'tray', // 'minimize' | 'tray' | 'none' — what the shortcut does when handy is off
  quickCaptureShortcut: 'Ctrl+Shift+Space', // global shortcut for quick capture (configurable in Settings)
  language: 'en', // 'en' | 'fa' — UI language
  rtlMirror: false, // mirror the whole layout (rail on the right) — only meaningful for 'fa'
  helpLang: 'en', // legacy: language of the Settings help text; migrated into `language` on load
  lastVersion: null, // last version whose "What's new" tab was shown (global, not per-profile)
  donateSeenVersion: null // last version whose support banner was shown
};

let settings = { ...DEFAULT_SETTINGS };

// Master AI switch — when off, every AI surface (Chat, Improve, AI actions, the
// button on markdown code blocks, the API-key section) is hidden and inert.
function aiOn() { return settings.aiEnabled !== false; }

// Translate a string built in JS. The key is only for readability — the lookup
// is on the English text, same as the DOM pass in i18n.js.
function tr(key, en) {
  return window.PP_I18N ? window.PP_I18N.translate(settings.language || 'en', en) : en;
}

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
const maxBtn = document.getElementById('maxBtn');
const closeBtn = document.getElementById('closeBtn');
const railToggleBtn = document.getElementById('railToggleBtn');
const zenBtn = document.getElementById('zenBtn');
const zenExitHint = document.getElementById('zenExitHint');
const handyBtn = document.getElementById('handyBtn');
const handyHandle = document.getElementById('handyHandle');
const appEl = document.querySelector('.app');
const railEl = document.getElementById('rail');
const railResizer = document.getElementById('railResizer');
const discoverBtn = document.getElementById('discoverBtn');
const dcAdminPostsBtn = document.getElementById('adminPostsBtn');
const dcAdminPostsBadge = document.getElementById('adminPostsBadge');
const fastSaveBtn = document.getElementById('fastSaveBtn');
const aiChatBtn = document.getElementById('aiChatBtn');
// settings panel
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsClose = document.getElementById('settingsClose');
const themeRow = document.getElementById('themeRow');
const tabSizeSeg = document.getElementById('tabSizeSeg');
const handyPosSeg = document.getElementById('handyPosSeg');
const handyCloseSeg = document.getElementById('handyCloseSeg');
const handyShortcutInput = document.getElementById('handyShortcutInput');
const handyShortcutReset = document.getElementById('handyShortcutReset');
const handyShortcutHint = document.getElementById('handyShortcutHint');
const quickCaptureShortcutInput = document.getElementById('quickCaptureShortcutInput');
const quickCaptureShortcutReset = document.getElementById('quickCaptureShortcutReset');
const quickCaptureShortcutHint = document.getElementById('quickCaptureShortcutHint');
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
const ctxDirListEl = document.getElementById('ctxDirList');
const ctxProfileRowsEl = document.getElementById('ctxProfileRows');
// toast
const toastEl = document.getElementById('toast');
const toastMsgEl = document.getElementById('toastMsg');
const toastNameEl = document.getElementById('toastName');
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
// support / donation
const donateBannerEl = document.getElementById('donateBanner');
const donateBannerLinkEl = document.getElementById('donateBannerLink');
const donateBannerCloseEl = document.getElementById('donateBannerClose');
const donateBtn = document.getElementById('donateBtn');
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
const genImgBtn = document.getElementById('genImgBtn');
// fast save
const fastSaveViewEl = document.getElementById('fastSaveView');
const fsMessagesEl = document.getElementById('fsMessages');
const fsInputEl = document.getElementById('fsInput');
const fsSendBtn = document.getElementById('fsSend');
const toggleFastSaveEl = document.getElementById('toggleFastSave');
const aiChatViewEl = document.getElementById('aiChatView');
const aiMessagesEl = document.getElementById('aiMessages');
const aiErrorBarEl = document.getElementById('aiErrorBar');
const aiInputEl = document.getElementById('aiInput');
const aiSendBtn = document.getElementById('aiSend');
const aiVoiceBtn = document.getElementById('aiVoiceBtn');
const aiClearBtn = document.getElementById('aiClearBtn');
// discover
const discoverViewEl = document.getElementById('discoverView');
const discoverNavEl = document.getElementById('discoverNav');
const discoverBodyEl = document.getElementById('discoverBody');
const discoverHintEl = document.getElementById('discoverHint');
const discoverHintCloseEl = document.getElementById('discoverHintClose');
const toggleDiscoverEl = document.getElementById('toggleDiscover');
const discoverRowEl = document.getElementById('discoverRow');
// prompt lab
const promptLabViewEl = document.getElementById('promptLabView');
const labNavEl = document.getElementById('labNav');
const labBodyEl = document.getElementById('labBody');
const labHintEl = document.getElementById('labHint');
const labHintCloseEl = document.getElementById('labHintClose');
const promptLabBtn = document.getElementById('promptLabBtn');
const toggleLabEl = document.getElementById('toggleLab');
const labRowEl = document.getElementById('labRow');
const toggleCollabEl = document.getElementById('toggleCollab');
const collabRowEl = document.getElementById('collabRow');
// feature switches
const toggleTemplatesEl = document.getElementById('toggleTemplates');
const toggleAiChatEl = document.getElementById('toggleAiChat');
const toggleProfilesEl = document.getElementById('toggleProfiles');
const aiChatRowEl = document.getElementById('aiChatRow');
const toggleAiEl = document.getElementById('toggleAi');
const aiKeyFieldsEl = document.getElementById('aiKeyFields');
const toggleHandyEl = document.getElementById('toggleHandy');
const handyPosRowEl = document.getElementById('handyPosRow');
const handyCloseRowEl = document.getElementById('handyCloseRow');
const handyShortcutRowEl = document.getElementById('handyShortcutRow');
const handyDisabledRowEl = document.getElementById('handyDisabledRow');
const handyDisabledSeg = document.getElementById('handyDisabledSeg');
const handyDisabledHint = document.getElementById('handyDisabledHint');
// language
const languageSeg = document.getElementById('languageSeg');
const toggleRtlMirrorEl = document.getElementById('toggleRtlMirror');
const rtlMirrorRowEl = document.getElementById('rtlMirrorRow');
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
const alignBtnLabelEl = document.getElementById('alignBtnLabel');
const alignIconMidEl = document.getElementById('alignIconMid');
const cleanBtn = document.getElementById('cleanBtn');
const improveBtn = document.getElementById('improveBtn');
const voiceBtn = document.getElementById('voiceBtn');
const voiceHfApiKeyInputEl = document.getElementById('voiceHfApiKeyInput');
const aiApiKeyInputEl = document.getElementById('aiApiKeyInput');
const toolbarMainEl = document.getElementById('toolbarMain');
const toolbarOverflowBtnEl = document.getElementById('toolbarOverflowBtn');
const toolbarOverflowPanelEl = document.getElementById('toolbarOverflowPanel');
const linkDialog = document.getElementById('linkDialog');
const linkTextInput = document.getElementById('linkTextInput');
const linkUrlInput = document.getElementById('linkUrlInput');
const linkCancel = document.getElementById('linkCancel');
const linkSave = document.getElementById('linkSave');
// image context menu
const imgContextMenu = document.getElementById('imgContextMenu');
const textContextMenu = document.getElementById('textContextMenu');
const aiActionsMenu = document.getElementById('aiActionsMenu');
const mdCommandsMenu = document.getElementById('mdCommandsMenu');
const toggleImageResizeEl = document.getElementById('toggleImageResize');
const toggleImageDownloadEl = document.getElementById('toggleImageDownload');
const toggleMdImageFullSizeEl = document.getElementById('toggleMdImageFullSize');
const toggleMdShortcutsEl = document.getElementById('toggleMdShortcuts');
const geminiApiKeyInputEl = document.getElementById('geminiApiKeyInput');
const hfApiKeyInputEl = document.getElementById('hfApiKeyInput');
const imageGenProviderSeg = document.getElementById('imageGenProviderSeg');
const geminiProviderFieldsEl = document.getElementById('geminiProviderFields');
const hfProviderFieldsEl = document.getElementById('hfProviderFields');
const providerHintPollinationsEl = document.getElementById('providerHintPollinations');
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
const multiProfileRowsEl = document.getElementById('multiProfileRows');
const groupContextMenu = document.getElementById('groupContextMenu');
const groupColorRow = document.getElementById('groupColorRow');
const groupProfileRowsEl = document.getElementById('groupProfileRows');
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

// Other inline spans decorated the same way (marker text kept, styled inner).
const MD_STRIKE_RE = /~~([^~\r\n]+)~~/g;
const MD_HILITE_RE = /==([^=\r\n]+)==/g;

// Leading block markers: "# ", "1. ", "- ", "> ". On an RTL line these are
// ASCII runs at the logical start, and the bidi algorithm reorders them into
// the middle of the text (the classic "1." rendering as ".1" on the wrong
// side). Wrapping them in an isolating span pins them where they belong —
// see .md-blockmark in styles.css. The wrapper keeps the literal text, so
// textContent still round-trips.
const MD_BLOCKMARK_RE = /^(\s*)(#{1,6} |[0-9۰-۹٠-٩]+[.)] |[-*+] |> )/;

// A bullet or numbered list marker, split so Enter can rebuild it:
// 1=indent, 2=bullet char, 3=spaces  |  4=digits, 5=".) " tail
const MD_LIST_RE = /^(\s*)(?:([-*+])( +)|([0-9۰-۹٠-٩]+)([.)] +))/;

// Increment a list number, keeping the digit system the author was using —
// a Persian list numbered ۱. continues with ۲., not 2.
function nextListNumber(digits) {
  const fa = /[۰-۹]/.test(digits);
  const ar = /[٠-٩]/.test(digits);
  const ascii = digits
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  const next = String((parseInt(ascii, 10) || 0) + 1);
  if (fa) return next.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
  if (ar) return next.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
  return next;
}

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
//
// The raw ![img](…) token stays in the DOM but is hidden (.img-token), so a
// restored offset can land *inside* it: the caret then looks like it's at the
// start of the line while it's really in the middle of the token, and the next
// keystroke corrupts the token — the image silently disappears. Landing inside
// a hidden token snaps past it instead. (getCaretOffsetIn stays as-is: it
// measures where the caret genuinely is, which is what the offset must mean.)
function placeCaretInLine(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  let acc = 0;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (acc + len >= offset) {
      const hidden = node.parentElement && node.parentElement.closest('.img-token');
      if (hidden) {
        const r = document.createRange();
        r.setStartAfter(hidden);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
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
  const hadDecor = !!el.querySelector('.placeholder-tag, .todo-mark, .img-token, .pp-img, .md-bold, .md-mark, .md-link-mark, .md-blockmark');
  const phMatches = settings.placeholdersEnabled ? [...text.matchAll(PLACEHOLDER_RE)] : [];
  const todoM = text.match(TODO_RE);
  const imgMatches = [...text.matchAll(IMG_TOKEN_RE)];
  const boldMatches = [...text.matchAll(MD_BOLD_RE)];
  const strikeMatches = [...text.matchAll(MD_STRIKE_RE)];
  const hiliteMatches = [...text.matchAll(MD_HILITE_RE)];
  const linkMatches = [...text.matchAll(MDLINK_RE)];
  // Only isolate the marker when the line actually needs it — an LTR line
  // reorders correctly on its own, and an extra span there is pure churn.
  const blockM = detectDir(text) === 'rtl' && !todoM ? text.match(MD_BLOCKMARK_RE) : null;
  el.classList.toggle('todo-done', !!(todoM && todoM[2] === 'x'));
  if (!phMatches.length && !todoM && !imgMatches.length && !boldMatches.length &&
      !strikeMatches.length && !hiliteMatches.length && !linkMatches.length &&
      !blockM && !hadDecor) return;

  const offset = getCaretOffsetIn(el);
  el.innerHTML = '';
  if (text === '') {
    el.appendChild(document.createElement('br'));
  } else {
    // Merge all decoration ranges; on overlap the earliest start wins
    // (e.g. "[img]" inside an image token, "[ ]" inside a todo prefix).
    const ranges = [];
    if (todoM) ranges.push({ start: 0, end: todoM[0].length, cls: 'todo-mark' });
    if (blockM) {
      ranges.push({ start: blockM[1].length, end: blockM[0].length, cls: 'md-blockmark' });
    }
    for (const m of imgMatches) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'img-token',
        file: m[1], width: m[2] ? Number(m[2]) : null });
    }
    for (const m of boldMatches) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'md-bold' });
    }
    for (const m of strikeMatches) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'md-strike' });
    }
    for (const m of hiliteMatches) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'md-hilite' });
    }
    // Ranges of markdown-link [text] parts, so they aren't tagged as placeholders.
    const linkRanges = linkMatches.map((m) => [m.index, m.index + m[0].length]);
    // …and decorate them, so a link you just inserted actually looks like one
    // instead of staying indistinguishable from plain text. Image tokens also
    // match MDLINK_RE, but their range starts one char earlier (the "!") and so
    // win the overlap merge below.
    //
    // Only decorate when the target really is a link. MDLINK_RE also matches
    // ordinary prose like "see [the note](later today)", and hiding the "(…)"
    // of something that was never a link would look like the text vanished.
    // The shapes here are exactly the ones confirmLink() can produce.
    for (const m of linkMatches) {
      const target = m[0].slice(m[0].indexOf('](') + 2, -1);
      if (!/^([a-z][a-z0-9+.-]*:\/\/|mailto:|#|\/)/i.test(target)) continue;
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'md-link-token' });
    }
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
      if (r.cls === 'md-bold' || r.cls === 'md-strike' || r.cls === 'md-hilite') {
        // **text** / ~~text~~ / ==text== → dimmed 2-char marks + styled inner
        // text (all literal, so the raw markdown still round-trips through
        // getEditorText).
        const mark = text.slice(r.start, r.start + 2);
        const inner = text.slice(r.start + 2, r.end - 2);
        const mk1 = document.createElement('span'); mk1.className = 'md-mark'; mk1.textContent = mark;
        const b = document.createElement('span'); b.className = r.cls; b.textContent = inner;
        const mk2 = document.createElement('span'); mk2.className = 'md-mark'; mk2.textContent = mark;
        el.appendChild(mk1); el.appendChild(b); el.appendChild(mk2);
      } else if (r.cls === 'md-link-token') {
        // [label](url) → just the label, styled and clickable like a link on a
        // web page. The brackets and the URL stay in the DOM (so the raw
        // markdown still round-trips through getEditorText) but are collapsed
        // to font-size:0, the same trick the ** markers use. They come back
        // into view on the line holding the caret, which is the only way to
        // edit the URL again — see .ln.caret-line in styles.css.
        const raw = text.slice(r.start, r.end);
        const cut = raw.indexOf('](');
        const label = raw.slice(1, cut);
        const tail = raw.slice(cut);
        const url = tail.slice(2, -1);
        const lb = document.createElement('span'); lb.className = 'md-link-mark'; lb.textContent = '[';
        const mid = document.createElement('span'); mid.className = 'md-link-text'; mid.textContent = label;
        mid.dataset.href = url;
        mid.title = url; // hover only — never printed into the note
        const rest = document.createElement('span'); rest.className = 'md-link-mark'; rest.textContent = tail;
        el.appendChild(lb); el.appendChild(mid); el.appendChild(rest);
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

// Link syntax is hidden everywhere except the line the caret is on, so a link
// reads as plain clickable text while you write but its URL is still reachable
// when you go to edit it. Only the class moves; nothing is re-highlighted.
let caretLineEl = null;
function updateCaretLine() {
  const line = document.activeElement === editorEl ? currentLine() : null;
  if (line === caretLineEl) return;
  if (caretLineEl && caretLineEl.isConnected) caretLineEl.classList.remove('caret-line');
  caretLineEl = line;
  if (caretLineEl) caretLineEl.classList.add('caret-line');
}
document.addEventListener('selectionchange', updateCaretLine);

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
  const align = editorAlign(); // resolved once — this runs on every keystroke
  const activeLine = currentLine();
  let changed = false;
  editorLines().forEach((d) => {
    if (!d.classList.contains('ln')) d.classList.add('ln');
    const want = forced || detectDir(d.textContent);
    if (d.getAttribute('dir') !== want) {
      d.setAttribute('dir', want);
      d.style.direction = want;
      d.style.textAlign = lineAlignFor(want, align);
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
// Fast Save & AI Chat are compact rail buttons (like discover / prompt lab),
// sitting above the note tabs. These updaters refill the persistent buttons.
const FS_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
  '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const AI_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
  '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

function updateFastSaveBtn() {
  if (!fastSaveBtn) return;
  fastSaveBtn.classList.toggle('hidden', !settings.fastSaveEnabled);
  fastSaveBtn.classList.toggle('active', fsActive());
  fastSaveBtn.innerHTML = '';
  const icon = document.createElement('span'); icon.innerHTML = FS_ICON; fastSaveBtn.appendChild(icon);
  const nameEl = document.createElement('span'); nameEl.className = 'rail-tab-name'; nameEl.textContent = fsLabel();
  fastSaveBtn.appendChild(nameEl);
  fastSaveBtn._nameEl = nameEl;
  const c = fsMessages().length;
  if (c) { const b = document.createElement('span'); b.className = 'fs-tab-count'; b.textContent = c; fastSaveBtn.appendChild(b); }
}

function updateAiChatBtn() {
  if (!aiChatBtn) return;
  const seen = settings.seenFeatures || {};
  aiChatBtn.classList.toggle('hidden', !aiOn() || settings.aiChatEnabled === false);
  aiChatBtn.classList.toggle('active', aiChatActive());
  aiChatBtn.classList.toggle('ai-thinking', !!aiSending);
  aiChatBtn.classList.toggle('has-new-badge', !seen.aiChat);
  aiChatBtn.innerHTML = '';
  const icon = document.createElement('span'); icon.innerHTML = AI_ICON; aiChatBtn.appendChild(icon);
  const nameEl = document.createElement('span'); nameEl.className = 'rail-tab-name'; nameEl.textContent = tr('rail.aiChat', 'AI Chat');
  aiChatBtn.appendChild(nameEl);
  const c = aiMessages().length;
  if (c) { const b = document.createElement('span'); b.className = 'fs-tab-count'; b.textContent = c; aiChatBtn.appendChild(b); }
}

if (fastSaveBtn) {
  fastSaveBtn.addEventListener('click', (e) => {
    if (e.shiftKey) { e.stopPropagation(); startFsRename(fastSaveBtn, fastSaveBtn._nameEl); return; }
    switchToFastSave();
  });
  fastSaveBtn.addEventListener('dblclick', (e) => { e.stopPropagation(); if (fastSaveBtn._nameEl) startFsRename(fastSaveBtn, fastSaveBtn._nameEl); });
}
if (aiChatBtn) {
  aiChatBtn.addEventListener('click', () => { markFeatureSeen('aiChat'); switchToAiChat(); });
}

function fsLabel() {
  // A user-renamed Fast Save keeps its name in every language; only the default
  // label is translated.
  const name = (settings.fastSaveName || '').trim();
  if (!name || name === 'Fast Save') return tr('rail.fastSave', 'Fast Save');
  return name;
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
    // typing the default label back (in either language) clears the override
    settings.fastSaveName = (!v || v === tr('rail.fastSave', 'Fast Save')) ? 'Fast Save' : v;
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

  // Fast Save, AI Chat, Discover and Prompt Lab are compact rail buttons above
  // the note tabs (not tab rows), so they don't push the note tabs down.
  updateFastSaveBtn();
  updateAiChatBtn();
  if (templatesBtn) {
    templatesBtn.classList.toggle('hidden', settings.templatesEnabled === false);
  }
  if (discoverBtn) {
    const showDiscover = window.DISCOVER_CONFIGURED && settings.discoverEnabled;
    discoverBtn.classList.toggle('hidden', !showDiscover);
    discoverBtn.classList.toggle('active', discoverActive());
  }
  if (promptLabBtn) {
    promptLabBtn.classList.toggle('hidden', settings.promptLabEnabled === false);
    promptLabBtn.classList.toggle('active', labActive());
  }

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

    // A shared note gets a small badge so it's never a surprise that someone
    // else can see what you're typing.
    if (tab.shareId) {
      const shareEl = document.createElement('span');
      shareEl.className = 'tab-share';
      shareEl.innerHTML =
        '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
        '<circle cx="17" cy="5.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
        '<circle cx="6.5" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
        '<circle cx="17" cy="18.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
        '<line x1="8.9" y1="10.7" x2="14.6" y2="6.8" stroke="currentColor" stroke-width="1.7"/>' +
        '<line x1="8.9" y1="13.3" x2="14.6" y2="17.2" stroke="currentColor" stroke-width="1.7"/></svg>';
      shareEl.title = tab.shareRole === 'viewer'
        ? tr('collab.tabBadgeView', 'Shared note — you can read it')
        : tr('collab.tabBadge', 'Shared note — edited live with others');
      el.appendChild(shareEl);
    }

    // Markdown is per-note now, so mark which tabs open rendered.
    if (tab.md) {
      const mdEl = document.createElement('span');
      mdEl.className = 'tab-md';
      mdEl.textContent = 'MD';
      mdEl.title = tr('tab.mdBadge', 'Opens in markdown preview');
      el.appendChild(mdEl);
    }

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
      lastClickedTabId = tab.id; // a plain click becomes the range anchor
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

  if (!isGrouping()) {
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

// The Ctrl+Shift gesture is a one-way setter (and idempotent, like Windows), so
// without this row a tab forced to rtl/ltr could never go back to auto-detection.
function setTabDir(tabId, dir) {
  const t = state.tabs.find((x) => x.id === tabId);
  if (!t) return;
  t.dir = (dir === 'rtl' || dir === 'ltr') ? dir : 'auto';
  if (t.id === state.activeId) {
    applyEditorDir();
    if (mdOn()) renderMdPreview();
  }
  scheduleSave();
}

// Direction picker inside the tab context menu
function buildCtxDirList(tab) {
  ctxDirListEl.innerHTML = '';
  const cur = (tab.dir === 'rtl' || tab.dir === 'ltr') ? tab.dir : 'auto';
  [['Auto', 'auto'], ['Left to right', 'ltr'], ['Right to left', 'rtl']].forEach(([label, dir]) => {
    const b = document.createElement('button');
    b.className = 'ctx-group-item' + (cur === dir ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      hideCtxMenu();
      setTabDir(tab.id, dir);
    });
    ctxDirListEl.appendChild(b);
  });
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

// Groups apply in both layouts now — in the top layout the strip wraps onto
// multiple rows with each group name acting as a full-width row separator.
function isGrouping() {
  return (state.groups || []).length > 0;
}

// True top-to-bottom order of the tabs actually shown in the rail — mirrors
// the grouping in renderTabs() (pinned block → each group's members, pinned
// groups first → ungrouped), and omits collapsed groups' members since they
// aren't on screen. Range-select uses this so a Ctrl+Shift span matches what
// the user sees, instead of the flat orderedTabs() array.
function visibleTabOrder() {
  const ordered = orderedTabs();
  const groups = state.groups || [];
  if (!isGrouping()) return ordered.slice();

  const inKnownGroup = (t) => t.groupId && groups.some((g) => g.id === t.groupId);
  const out = [];
  ordered.filter((t) => t.pinned).forEach((t) => out.push(t));
  [...groups].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).forEach((g) => {
    if (g.collapsed) return;
    ordered.filter((t) => !t.pinned && t.groupId === g.id).forEach((t) => out.push(t));
  });
  ordered.filter((t) => !t.pinned && !inKnownGroup(t)).forEach((t) => out.push(t));
  return out;
}

// The visual "section" a tab lives in — range-select never spans across two
// different sections (pinned / a specific group / ungrouped).
function tabBucketKey(t) {
  if (t.pinned) return 'pinned';
  const groups = state.groups || [];
  if (isGrouping() && t.groupId && groups.some((g) => g.id === t.groupId)) return 'group:' + t.groupId;
  return 'ungrouped';
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
  const horizontal = false; // the tab rail is always the vertical left layout
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
  if (dragging && draggedTab && !draggedTab.pinned && isGrouping()) {
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
    // A shared note carries one name for everybody — push the new one.
    if (tab.shareId) shPushTitle(tab);
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
  aiChatViewEl.classList.add('hidden');
  discoverViewEl.classList.add('hidden');
  promptLabViewEl.classList.add('hidden');
  shUpdateBar();
}

function showFastSaveView() {
  selectedTabIds.clear();
  appEl.classList.add('fastsave-active');
  editorBodyEl.classList.add('hidden');
  aiChatViewEl.classList.add('hidden');
  discoverViewEl.classList.add('hidden');
  promptLabViewEl.classList.add('hidden');
  fastSaveViewEl.classList.remove('hidden');
  if (fsHeaderTitle) fsHeaderTitle.textContent = fsLabel();
  updateFsInputDir();
  updateFsSelectBar();
  renderFsMessages();
  fsInputEl.focus();
}

function showAiChatView() {
  selectedTabIds.clear();
  appEl.classList.add('fastsave-active');
  editorBodyEl.classList.add('hidden');
  fastSaveViewEl.classList.add('hidden');
  discoverViewEl.classList.add('hidden');
  promptLabViewEl.classList.add('hidden');
  aiChatViewEl.classList.remove('hidden');
  renderAiMessages();
  // one-shot appear each time the chat opens (reflow to restart the animation)
  aiChatViewEl.classList.remove('ai-view-enter');
  void aiChatViewEl.offsetWidth;
  aiChatViewEl.classList.add('ai-view-enter');
  aiInputEl.focus();
}

function showDiscoverView() {
  selectedTabIds.clear();
  appEl.classList.add('fastsave-active');
  editorBodyEl.classList.add('hidden');
  fastSaveViewEl.classList.add('hidden');
  aiChatViewEl.classList.add('hidden');
  promptLabViewEl.classList.add('hidden');
  discoverViewEl.classList.remove('hidden');
  dcRender();
  // Re-check the profile (e.g. you were just promoted to admin) and refresh the
  // nav so the Admin button appears without needing to log out and back in.
  if (dcClient && dcSession) {
    const wasAdmin = dcProfile && dcProfile.is_admin;
    dcLoadProfile().then(() => {
      if (discoverActive() && dcProfile && !!dcProfile.is_admin !== !!wasAdmin) dcRenderNav();
    });
  }
}

function showLabView() {
  selectedTabIds.clear();
  appEl.classList.add('fastsave-active');
  editorBodyEl.classList.add('hidden');
  fastSaveViewEl.classList.add('hidden');
  aiChatViewEl.classList.add('hidden');
  discoverViewEl.classList.add('hidden');
  promptLabViewEl.classList.remove('hidden');
  labRender();
}

// Show whichever view matches state.activeId (used at startup).
function applyActiveView() {
  if (fsActive()) showFastSaveView();
  else if (aiChatActive()) showAiChatView();
  else if (discoverActive()) showDiscoverView();
  else if (labActive()) showLabView();
  else {
    showEditorView();
    applyMdView();
    if (mdOn()) renderMdPreview();
  }
}

// Bail out of a special view (Fast Save / AI Chat / Discover / Lab) that was
// just turned off in Settings, landing on a normal note instead of a blank pane.
function leaveSpecialView() {
  const ordered = orderedTabs();
  if (ordered.length) switchTab(ordered[0].id);
  else addTab(false);
}

// ---------- Profiles ----------
// Chrome-like workspaces. Each profile owns its tabs, groups, templates,
// placeholder values, Fast Save and AI Chat; the Prompt Lab and the Discover
// login are shared by every profile. Main owns the registry and does the
// park/hydrate — see the Profiles block in main.js.
//
// Two things are deliberately never touched here: dcInit() (creating a second
// Supabase client would leak an auth listener, and the session lives in
// localStorage which is per-install, so Discover stays signed in for free) and
// applySettings() (theme, rail, opacity and handy mode are global).
let profiles = [];
let activeProfileId = null;
let profileSwitching = false;
let profileEpoch = 0;   // fences async work started under a previous profile
let pendingQc = [];     // quick-capture payloads that land mid-switch

function activeProfile() {
  return profiles.find((p) => p.id === activeProfileId) || null;
}

// Every overlay/menu/dialog that renders from the outgoing workspace. Runs
// before the swap, because some of these re-render on close (closeFsSearch).
function closeAllProfileScopedUI() {
  closeCommandPalette(); hideAiActionsMenu(); hideEmojiPanel();
  hideImgContextMenu(); hideTextContextMenu(); hideTabMultiMenu();
  hideGroupCtxMenu(); hideCtxMenu();
  closeLightbox(); closeGallery(); closeFilesPanel(); closeLinkDialog();
  closeSaveTemplateDialog(); closeGroupDialog(); closeHistory(); closeTemplates();
  closeToolbarOverflow(); closeFind(); closeFsSearch();
  shCloseLeaveDialog(); shCloseShareDialog(); shCloseInvitesPanel();
  hideToast(); // names the outgoing profile — must not linger into the new one
  if (multiRenameDialog) multiRenameDialog.classList.add('hidden');
}

// Module-level state that points at the outgoing workspace (ids, DOM ranges,
// in-flight edits). Anything left behind here would silently act on the new
// profile's data. Discover's and Prompt Lab's own state is intentionally absent
// — both are shared.
function resetProfileScopedState() {
  _previewToken = null; _previewBase = null;
  selectedTabIds.clear(); selectedMsgIds.clear(); lastClickedTabId = null;
  fsPendingImage = null; fsPendingFileMeta = null; fsFilterQuery = ''; fsEditingId = null;
  ctxTabId = null; groupCtxId = null; historyTabId = null;
  imgCtxTarget = null; textCtxTarget = null; textCtxSelection = '';
  todoBtnSavedRange = null; linkSavedRange = null; pendingLinkSel = null;
  imgResizing = null; emojiAnchor = null; qcPendingImage = null;
  mdEditEl = null; cmdItems = []; cmdActiveIdx = 0;
  shShareTabId = null;
  findMatches = []; findIdx = 0;
  handySavedScroll = 0;
  caretLineEl = null;
  clearTimeout(highlightTimer);
  invalidateHighlights();
}

async function switchProfile(id) {
  if (!id || id === activeProfileId || profileSwitching) return;
  // An in-flight AI reply or transcription resolves into whichever workspace is
  // live when it lands; refuse rather than misfile it.
  if (aiSending || voiceRecording) return;
  profileSwitching = true;
  try {
    // 1. Flush the OUTGOING workspace, and make sure nothing is still queued.
    commitMdBlockEdit();
    cancelFsEdit();
    clearTimeout(saveTimer);
    state.tabs.forEach((t) => {
      clearTimeout(t.checkpointTimer);
      t.checkpointTimer = null; t.pendingCheckpoint = null;
      t.undoStack = null; t.redoStack = null;
    });
    await doSave();

    // 2. Tear down UI that reads live state, then invalidate pending async work.
    closeAllProfileScopedUI();
    resetProfileScopedState();
    profileEpoch++;

    // 3. Swap.
    const res = await window.api.switchProfile(id);
    if (!res || !res.ok) return;
    profiles = res.profiles;
    activeProfileId = res.activeProfileId;
    await loadState();

    // 4. Re-render. loadState already did the editor + tab rail.
    applyActiveView();
    renderProfileChip();
    updateFilesButton();
    updateEmptyState();
    if (!fsActive() && !aiChatActive() && !discoverActive() && !labActive()) {
      editorEl.focus();
      placeCaretEnd();
    }
  } finally {
    profileSwitching = false;
    closeProfileMenu();
    drainPendingQc();
  }
}

async function createProfile(name) {
  if (profileSwitching || aiSending || voiceRecording) return;
  profileSwitching = true;
  try {
    commitMdBlockEdit();
    cancelFsEdit();
    clearTimeout(saveTimer);
    state.tabs.forEach((t) => { clearTimeout(t.checkpointTimer); t.checkpointTimer = null; });
    await doSave();
    closeAllProfileScopedUI();
    resetProfileScopedState();
    profileEpoch++;
    const res = await window.api.createProfile(name);
    if (!res || !res.ok) return;
    profiles = res.profiles;
    activeProfileId = res.activeProfileId;
    await loadState();
    applyActiveView();
    renderProfileChip();
    updateFilesButton();
    updateEmptyState();
    editorEl.focus();
    placeCaretEnd();
  } finally {
    profileSwitching = false;
    closeProfileMenu();
    drainPendingQc();
  }
}

async function renameProfile(id, name) {
  const res = await window.api.renameProfile(id, name);
  if (res && res.ok) { profiles = res.profiles; renderProfileChip(); renderProfileMenu(); }
}

async function deleteProfile(id) {
  if (profiles.length <= 1) return;
  const wasActive = id === activeProfileId;
  if (wasActive) {
    // Same flush/teardown as a switch — main moves us to a neighbour.
    profileSwitching = true;
    try {
      clearTimeout(saveTimer);
      await doSave();
      closeAllProfileScopedUI();
      resetProfileScopedState();
      profileEpoch++;
      const res = await window.api.deleteProfile(id);
      if (!res || !res.ok) return;
      profiles = res.profiles;
      activeProfileId = res.activeProfileId;
      await loadState();
      applyActiveView();
      renderProfileChip();
      updateFilesButton();
      updateEmptyState();
    } finally {
      profileSwitching = false;
      closeProfileMenu();
      drainPendingQc();
    }
    return;
  }
  const res = await window.api.deleteProfile(id);
  if (res && res.ok) { profiles = res.profiles; renderProfileChip(); renderProfileMenu(); }
}

// ---------- Profile chip / menu UI ----------
const profileChipEl = document.getElementById('profileChip');
const profileAvatarEl = document.getElementById('profileAvatar');
const profileChipNameEl = document.getElementById('profileChipName');
const profileMenuEl = document.getElementById('profileMenu');
const profileNameDialog = document.getElementById('profileNameDialog');
const profileNameLabel = document.getElementById('profileNameLabel');
const profileNameInput = document.getElementById('profileNameInput');
const profileNameCancel = document.getElementById('profileNameCancel');
const profileNameSave = document.getElementById('profileNameSave');
const profileDeleteDialog = document.getElementById('profileDeleteDialog');
const profileDeleteText = document.getElementById('profileDeleteText');
const profileDeleteCancel = document.getElementById('profileDeleteCancel');
const profileDeleteConfirm = document.getElementById('profileDeleteConfirm');

let profileDialogMode = 'create'; // 'create' | 'rename'
let profileDialogId = null;
let profileDeleteId = null;

const ICON_CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
  '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
  '<path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linejoin="round"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
  '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
  '<line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
  '<line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function profileInitial(p) {
  return ((p && p.name) || '?').trim().charAt(0) || '?';
}

function renderProfileChip() {
  const p = activeProfile();
  // Shown even with a single profile — it's the only entry point for creating
  // the second one. Settings → Sidebar → Profiles hides it entirely.
  const show = !!p && settings.profilesEnabled !== false;
  profileChipEl.classList.toggle('hidden', !show);
  if (!show) return;
  profileAvatarEl.textContent = profileInitial(p);
  profileAvatarEl.style.setProperty('--profile-color', p.color || 'var(--accent)');
  profileChipNameEl.textContent = p.name;
}

function renderProfileMenu() {
  profileMenuEl.innerHTML = '';
  const only = profiles.length <= 1;
  profiles.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'profile-menu-row';
    row.dataset.id = p.id;

    const av = document.createElement('span');
    av.className = 'profile-avatar';
    av.textContent = profileInitial(p);
    av.style.setProperty('--profile-color', p.color || 'var(--accent)');

    const nm = document.createElement('span');
    nm.className = 'profile-menu-name';
    nm.textContent = p.name;

    row.appendChild(av);
    row.appendChild(nm);
    if (p.id === activeProfileId) {
      const ck = document.createElement('span');
      ck.className = 'profile-menu-check';
      ck.innerHTML = ICON_CHECK;
      row.appendChild(ck);
    }

    const ren = document.createElement('button');
    ren.className = 'profile-row-btn';
    ren.title = 'Rename profile';
    ren.innerHTML = ICON_PENCIL;
    ren.addEventListener('click', (e) => { e.stopPropagation(); openProfileRename(p); });

    const del = document.createElement('button');
    del.className = 'profile-row-btn danger' + (only ? ' disabled' : '');
    del.title = 'Delete profile';
    del.innerHTML = ICON_TRASH;
    del.addEventListener('click', (e) => { e.stopPropagation(); openProfileDelete(p); });

    row.appendChild(ren);
    row.appendChild(del);
    row.addEventListener('click', () => switchProfile(p.id));
    profileMenuEl.appendChild(row);
  });

  const sep = document.createElement('div');
  sep.className = 'ctx-sep';
  profileMenuEl.appendChild(sep);

  const add = document.createElement('div');
  add.className = 'ctx-item ctx-item--icon';
  add.innerHTML = ICON_PLUS + '<span>Add profile</span>';
  add.addEventListener('click', openProfileCreate);
  profileMenuEl.appendChild(add);
}

function openProfileMenu() {
  renderProfileMenu();
  profileMenuEl.classList.remove('hidden');
  const r = profileChipEl.getBoundingClientRect();
  profileMenuEl.style.left = r.left + 'px';
  profileMenuEl.style.top = (r.bottom + 6) + 'px';
}
function closeProfileMenu() { profileMenuEl.classList.add('hidden'); }
function profileMenuOpen() { return !profileMenuEl.classList.contains('hidden'); }

profileChipEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (profileMenuOpen()) closeProfileMenu(); else openProfileMenu();
});
document.addEventListener('click', (e) => {
  if (profileMenuOpen() && !profileMenuEl.contains(e.target)) closeProfileMenu();
});

function openProfileCreate() {
  closeProfileMenu();
  profileDialogMode = 'create';
  profileDialogId = null;
  profileNameLabel.textContent = 'New profile';
  profileNameSave.textContent = 'Create';
  profileNameInput.value = '';
  profileNameDialog.classList.remove('hidden');
  profileNameInput.focus();
}

function openProfileRename(p) {
  closeProfileMenu();
  profileDialogMode = 'rename';
  profileDialogId = p.id;
  profileNameLabel.textContent = 'Profile name';
  profileNameSave.textContent = 'Save';
  profileNameInput.value = p.name;
  profileNameDialog.classList.remove('hidden');
  profileNameInput.focus();
  profileNameInput.select();
}

function closeProfileNameDialog() {
  profileNameDialog.classList.add('hidden');
  profileDialogId = null;
}

function confirmProfileName() {
  const name = profileNameInput.value.trim();
  const mode = profileDialogMode;
  const id = profileDialogId;
  closeProfileNameDialog();
  if (!name) return;
  if (mode === 'create') createProfile(name);
  else if (id) renameProfile(id, name);
}

profileNameCancel.addEventListener('click', closeProfileNameDialog);
profileNameSave.addEventListener('click', confirmProfileName);
profileNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmProfileName(); }
  if (e.key === 'Escape') { closeProfileNameDialog(); }
});

function openProfileDelete(p) {
  if (profiles.length <= 1) return;
  closeProfileMenu();
  profileDeleteId = p.id;
  // The name is user content, so it's concatenated rather than translated.
  profileDeleteText.textContent = '“' + p.name + '” — ' +
    tr('profile.deleteBody', "its notes, groups, templates and Fast Save messages are removed for good. " +
      "Prompt Lab and Discover are shared and stay.");
  profileDeleteDialog.classList.remove('hidden');
}
function closeProfileDelete() {
  profileDeleteDialog.classList.add('hidden');
  profileDeleteId = null;
}
profileDeleteCancel.addEventListener('click', closeProfileDelete);
profileDeleteConfirm.addEventListener('click', () => {
  const id = profileDeleteId;
  closeProfileDelete();
  if (id) deleteProfile(id);
});

function handleQcMessage(payload) {
  if (!payload) return;
  const text = (payload.text || '').replace(/\s+$/, '');
  if (!text.trim() && !payload.image) return;
  const msg = { id: uid(), ts: Date.now(), text };
  if (payload.image) msg.image = payload.image;
  fsMessages().push(msg);
  renderTabs();
  if (fsActive()) renderFsMessages();
  scheduleSave();
}

function drainPendingQc() {
  const queued = pendingQc;
  pendingQc = [];
  queued.forEach(handleQcMessage);
}

function switchToAiChat() {
  if (!aiOn() || settings.aiChatEnabled === false) return;
  if (aiChatActive()) { aiInputEl.focus(); return; }
  _previewToken = null; _previewBase = null;
  clearFindHL();
  findBarEl.classList.add('hidden');
  syncEditorToState();
  state.activeId = AI_ID;
  showAiChatView();
  renderTabs();
  scheduleSave();
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

function switchToDiscover() {
  if (!settings.discoverEnabled || !window.DISCOVER_CONFIGURED) return;
  if (discoverActive()) return;
  _previewToken = null; _previewBase = null;
  clearFindHL();
  findBarEl.classList.add('hidden');
  syncEditorToState();
  state.activeId = DISCOVER_ID;
  showDiscoverView();
  renderTabs();
  scheduleSave();
}

function switchToLab() {
  if (settings.promptLabEnabled === false) return;
  if (labActive()) return;
  _previewToken = null; _previewBase = null;
  clearFindHL();
  findBarEl.classList.add('hidden');
  syncEditorToState();
  state.activeId = LAB_ID;
  showLabView();
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

// ---------- AI Chat ----------
// Keep the stored conversation bounded — otherwise a long-running chat would
// grow the rendered message list and the saved data file without limit.
const AI_CHAT_MAX_MESSAGES = 200;

function trimAiMessages() {
  const msgs = aiMessages();
  if (msgs.length > AI_CHAT_MAX_MESSAGES) {
    state.aiChat.messages = msgs.slice(msgs.length - AI_CHAT_MAX_MESSAGES);
  }
}

function clearAiChat() {
  if (!aiMessages().length) return;
  state.aiChat.messages = [];
  hideAiError();
  renderAiMessages();
  renderTabs();
  scheduleSave();
}

function aiAutoGrow() {
  aiInputEl.style.height = 'auto';
  aiInputEl.style.height = Math.min(120, aiInputEl.scrollHeight) + 'px';
}

function updateAiInputDir() {
  const dir = detectDir(aiInputEl.value);
  aiInputEl.setAttribute('dir', dir);
  aiInputEl.style.textAlign = dir === 'rtl' ? 'right' : 'left';
}

function showAiError(msg) {
  aiErrorBarEl.textContent = msg;
  aiErrorBarEl.classList.remove('hidden');
}

function hideAiError() {
  aiErrorBarEl.classList.add('hidden');
}

// Ids already painted at least once — so only genuinely new bubbles get the
// entrance animation, instead of the whole list re-animating on every render.
const aiShownMsgIds = new Set();

// Each user's own free OpenRouter key (Settings → AI Chat & actions).
function aiKey() { return (settings.ai && settings.ai.openrouterKey) || ''; }

// Bilingual (English + Persian) onboarding card shown in AI Chat when there's
// no key yet — explains how to grab a free OpenRouter key and where to paste it.
function buildAiOnboardCard() {
  const card = document.createElement('div');
  card.className = 'ai-onboard';
  card.innerHTML =
    '<div class="ai-onboard-title">✨ Set up the free AI  ·  فعال‌سازی هوش مصنوعی رایگان</div>' +
    '<div class="ai-onboard-body">' +
      '<p>AI Chat, <b>Improve</b> and the AI actions run on <b>your own free OpenRouter key</b>, so you get your own limits. Takes ~1 minute:</p>' +
      '<ol>' +
        '<li>Tap <b>Get free key</b> → sign in (Google/GitHub) → create a key.</li>' +
        '<li>Copy it (starts with <code>sk-or-v1-</code>).</li>' +
        '<li>Tap <b>Open Settings</b> and paste it under “AI Chat &amp; actions”.</li>' +
      '</ol>' +
      '<hr class="ai-onboard-sep">' +
      '<p dir="rtl">چت هوش مصنوعی، <b>Improve</b> و اکشن‌های AI با <b>کلیدِ رایگانِ خودت</b> کار می‌کنن تا لیمیتِ خودتو داشته باشی. حدود ۱ دقیقه:</p>' +
      '<ol dir="rtl">' +
        '<li>روی <b>دریافت کلید رایگان</b> بزن → وارد شو (گوگل/گیت‌هاب) → یه کلید بساز.</li>' +
        '<li>کپیش کن (با <code>sk-or-v1-</code> شروع می‌شه).</li>' +
        '<li>روی <b>باز کردن تنظیمات</b> بزن و زیر «AI Chat &amp; actions» بذارش.</li>' +
      '</ol>' +
    '</div>' +
    '<div class="ai-onboard-actions">' +
      '<button type="button" class="ai-onboard-btn primary js-get">Get free key · دریافت کلید</button>' +
      '<button type="button" class="ai-onboard-btn js-settings">Open Settings · تنظیمات</button>' +
    '</div>';
  card.querySelector('.js-get').addEventListener('click', () => window.api.openExternal('https://openrouter.ai/keys'));
  card.querySelector('.js-settings').addEventListener('click', () => { openSettings(); setTimeout(() => aiApiKeyInputEl.focus(), 60); });
  return card;
}

function renderAiMessages() {
  aiMessagesEl.innerHTML = '';
  const msgs = aiMessages();
  if (!aiKey()) {
    // no key yet → focus the onboarding (chat history reappears once a key is set)
    aiShownMsgIds.clear();
    aiMessagesEl.appendChild(buildAiOnboardCard());
    return;
  }
  if (!msgs.length) {
    aiShownMsgIds.clear();
    const empty = document.createElement('div');
    empty.className = 'fs-empty';
    empty.textContent = 'Say something — this uses a free AI and stays only on this device.';
    aiMessagesEl.appendChild(empty);
    return;
  }
  msgs.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'ai-msg ai-msg-' + (m.role === 'assistant' ? 'assistant' : 'user');
    if (!aiShownMsgIds.has(m.id)) { row.classList.add('ai-msg-new'); aiShownMsgIds.add(m.id); }
    const body = document.createElement('div');
    body.className = 'ai-msg-text';
    body.textContent = m.text;
    body.setAttribute('dir', detectDir(m.text));
    row.appendChild(body);
    const time = document.createElement('span');
    time.className = 'ai-msg-time';
    time.textContent = fmtMsgTime(m.ts);
    row.appendChild(time);
    aiMessagesEl.appendChild(row);
  });
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
}

let aiSending = false;

async function sendAiMessage() {
  const text = aiInputEl.value.trim();
  if (!text || aiSending) return;
  if (!aiKey()) { renderAiMessages(); openSettings(); aiApiKeyInputEl.focus(); return; }
  hideAiError();
  aiInputEl.value = '';
  aiAutoGrow();
  updateAiInputDir();

  aiMessages().push({ id: uid(), ts: Date.now(), role: 'user', text });
  trimAiMessages();
  renderAiMessages();
  renderTabs();
  scheduleSave();

  aiSending = true;
  aiSendBtn.disabled = true;
  renderTabs(); // light up the AI Chat rail tab while it's thinking
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg ai-msg-assistant ai-msg-thinking';
  thinking.innerHTML = '<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>';
  aiMessagesEl.appendChild(thinking);
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;

  try {
    const history = aiMessages().map((m) => ({ role: m.role, content: m.text }));
    const res = await window.api.chatMessage(history, aiKey());
    thinking.remove();
    if (res && res.ok && res.text) {
      aiMessages().push({ id: uid(), ts: Date.now(), role: 'assistant', text: res.text });
      trimAiMessages();
      renderAiMessages();
      renderTabs();
      scheduleSave();
    } else {
      showAiError((res && res.error) || 'Something went wrong.');
    }
  } finally {
    aiSending = false;
    aiSendBtn.disabled = false;
    renderTabs(); // stop the thinking glow on the rail tab
    aiInputEl.focus();
  }
}

aiSendBtn.addEventListener('click', sendAiMessage);
aiClearBtn.addEventListener('click', clearAiChat);
aiInputEl.addEventListener('input', () => { aiAutoGrow(); updateAiInputDir(); });
aiInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendAiMessage();
  }
});

// ---------- Actions ----------
function switchTab(id) {
  if (id === FS_ID) { switchToFastSave(); return; }
  if (id === AI_ID) { switchToAiChat(); return; }
  if (id === DISCOVER_ID) { switchToDiscover(); return; }
  if (id === LAB_ID) { switchToLab(); return; }
  _previewToken = null; _previewBase = null;
  clearFindHL();
  // flush current editor into state first
  commitMdBlockEdit();
  syncEditorToState();
  state.activeId = id;
  showEditorView();
  const t = activeTab();
  setEditorText(t ? t.content : '');
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  applyEditorAlign(); // alignment is per-note too — repaint the button and preview class
  applyMdView(); // markdown is per-note — honour this tab's own setting
  if (mdOn()) renderMdPreview();
  else {
    editorEl.focus();
    placeCaretEnd();
  }
  scheduleSave();
}

function addTab(focus = true) {
  commitMdBlockEdit();
  syncEditorToState();
  const tab = { id: uid(), name: '', custom: false, content: '', dir: 'auto', align: 'auto', color: null, md: false };
  state.tabs.push(tab);
  state.activeId = tab.id;
  showEditorView();
  setEditorText('');
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  applyEditorAlign();
  applyMdView();
  if (focus) editorEl.focus();
  scheduleSave();
}

// Open a prompt from Discover in a fresh editor tab.
function addTabWithContent(name, content) {
  commitMdBlockEdit();
  syncEditorToState();
  const tab = { id: uid(), name: (name || '').slice(0, 60), custom: !!name, content: content || '', dir: 'auto', align: 'auto', color: null, md: false };
  state.tabs.push(tab);
  state.activeId = tab.id;
  showEditorView();
  setEditorText(tab.content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  applyEditorAlign();
  applyMdView();
  editorEl.focus();
  scheduleSave();
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  // Closing a shared note only closes it here — flush any last edit and drop
  // the channel; you stay a member and can rejoin from the invitations bell.
  const shareId = state.tabs[idx].shareId;
  state.tabs.splice(idx, 1);
  if (shareId) shDisconnect(shareId);

  if (state.activeId === id) {
    commitMdBlockEdit(true);
    const next = state.tabs[idx] || state.tabs[idx - 1] || null;
    state.activeId = next ? next.id : null;
    setEditorText(next ? next.content : '');
    applyMdView();
    if (mdOn()) renderMdPreview();
  }
  applyEditorAlign();
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  shUpdateBar();
  scheduleSave();
}

function syncEditorToState() {
  const t = activeTab();
  if (!t) return;
  // While the markdown preview is up the editor is hidden and stale — edits are
  // made against t.content directly (block editing, todo checkboxes, AI on a
  // code block). Reading the editor back here would silently revert them, which
  // is exactly what doSave() did 350ms after every preview edit.
  if (t.md) return;
  t.content = getEditorText();
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
    id: uid(), name: src.name, custom: src.custom, content: src.content,
    dir: src.dir, align: src.align || 'auto', color: src.color || null, md: !!src.md
  };
  const idx = state.tabs.indexOf(src);
  state.tabs.splice(idx + 1, 0, tab);
  state.activeId = tab.id;
  showEditorView();
  setEditorText(tab.content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  applyEditorAlign();
  applyMdView();
  if (mdOn()) renderMdPreview();
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
  buildCtxDirList(tab);
  wireProfileSections(ctxMenuEl, ctxProfileRowsEl, hideCtxMenu, () => [tabId]);

  // Sharing needs the Discover backend and a signed-in account behind it.
  const shareItem = ctxMenuEl.querySelector('.ctx-share-item');
  if (shareItem) {
    shareItem.classList.toggle('hidden', !shConfigured());
    shareItem.textContent = tab.shareId
      ? tr('ctx.manageShare', 'Sharing & people…')
      : tr('ctx.share', 'Share & invite…');
  }

  placeMenuAt(ctxMenuEl, e);
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
  // measured before hiding — a display:none row has a zero-sized rect, and
  // the export flyout is positioned from it
  const itemRect = item.getBoundingClientRect();
  if (action === 'export') e.stopPropagation(); // don't let the document handler close the flyout
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
        showExportMenu(itemRect.right + 2, itemRect.top,
          autoName(tab, state.tabs.indexOf(tab)), tab.content);
      }
      break;
    }
    case 'save-template': openSaveTemplateDialog(id); break;
    case 'share': shShareTab(id); break;
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

// Select every tab between the anchor (last-clicked) and this one, in the
// order they're actually shown on screen — but never crossing out of the
// anchor's section, so a Ctrl+Shift+click into another group doesn't sweep up
// everything in between. Clicking into a different section (or with no anchor)
// starts a fresh single selection there instead.
function rangeSelectTo(id) {
  const order = visibleTabOrder();
  const bi = order.findIndex((t) => t.id === id);
  if (bi === -1) return;
  const target = order[bi];
  const ai = order.findIndex((t) => t.id === lastClickedTabId);
  if (ai === -1 || tabBucketKey(order[ai]) !== tabBucketKey(target)) {
    selectedTabIds.add(id);
    lastClickedTabId = id;
    renderTabs();
    return;
  }
  const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
  for (let k = lo; k <= hi; k++) selectedTabIds.add(order[k].id);
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
    // offsetWidth/Height rather than getBoundingClientRect(): the `pop` opening
    // animation scales the menu, so a rect measured on this frame is smaller
    // than the settled box and the clamp would leave a tall menu overhanging.
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (e.clientX + w > vw - 4) menuEl.style.left = Math.max(4, vw - w - 4) + 'px';
    if (e.clientY + h > vh - 4) menuEl.style.top = Math.max(4, vh - h - 4) + 'px';
  });
}

// ---------- Toast ----------
// `msg` must be an English literal — it's the dictionary key. A toast appears
// long after applyLanguage() has walked the DOM, so it's translated here at
// call time rather than by the pass. `name` is user content (a profile name, a
// username) and lands in a span excluded from translation.
let toastTimer = null;
let toastHideTimer = null;

function showToast(msg, name) {
  toastMsgEl.textContent = tr('toast', msg);
  toastNameEl.textContent = name || '';
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  toastEl.classList.remove('hidden');
  void toastEl.offsetWidth; // restart the transition when one toast follows another
  toastEl.classList.add('toast-show');
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('toast-show');
    toastHideTimer = setTimeout(() => toastEl.classList.add('hidden'), 200);
  }, 2200);
}

function hideToast() {
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  toastEl.classList.remove('toast-show');
  toastEl.classList.add('hidden');
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
  // Selected tabs travel loose: their group (if any) stays behind. Moving a
  // whole group is what the group header's own menu is for.
  wireProfileSections(tabMultiMenu, multiProfileRowsEl, hideTabMultiMenu,
    () => [...selectedTabIds]);
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
  wireProfileSections(groupContextMenu, groupProfileRowsEl, hideGroupCtxMenu,
    () => orderedTabs().filter((t) => t.groupId === groupId).map((t) => t.id),
    () => groupId);
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
      dir: t.dir, align: t.align || 'auto', color: t.color || null, groupId: ng.id
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
  const itemRect = item.getBoundingClientRect(); // before hiding — see the tab menu
  if (action === 'export') e.stopPropagation();
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
      if (group) showExportMenu(itemRect.right + 2, itemRect.top, group.name, groupContentJoined(id));
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

// ---------- Move / copy to another profile ----------
// Profiles own separate workspaces, so this is the only way to get a note across
// without going through the clipboard. The target is always a parked profile —
// main refuses to write the active one, whose workspace the renderer owns live.

// Profiles you can send to: never the current one, and none at all when the
// profile switcher is turned off in Settings.
function otherProfiles() {
  if (settings.profilesEnabled === false) return [];
  return profiles.filter((p) => p.id !== activeProfileId);
}
function profilesTargetable() { return otherProfiles().length > 0; }

// Build the profile picker into `container`: one row per profile, with a
// move and a copy button on it. Used to be two full lists (every profile
// name once under "Move to profile", again under "Copy to profile") — same
// names stacked twice for no reason, which is most of what made this menu
// feel so tall.
function buildProfileRows(container, onMove, onCopy) {
  container.innerHTML = '';
  otherProfiles().forEach((p) => {
    const row = document.createElement('div');
    row.className = 'ctx-profile-row';

    const name = document.createElement('span');
    name.className = 'ctx-profile-name';
    name.textContent = p.name;
    name.setAttribute('dir', detectDir(p.name));
    row.appendChild(name);

    const move = document.createElement('button');
    move.className = 'ctx-profile-act';
    move.title = tr('profile.moveTo', 'Move to') + ' ' + p.name;
    move.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
      '<line x1="5" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<polyline points="12 6 18 12 12 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    move.addEventListener('click', (e) => { e.stopPropagation(); onMove(p.id); });
    row.appendChild(move);

    const copy = document.createElement('button');
    copy.className = 'ctx-profile-act';
    copy.title = tr('profile.copyTo', 'Copy to') + ' ' + p.name;
    copy.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
      '<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M5 15V6a1 1 0 0 1 1-1h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    copy.addEventListener('click', (e) => { e.stopPropagation(); onCopy(p.id); });
    row.appendChild(copy);

    container.appendChild(row);
  });
}

// Show or hide the picker section in one menu, wiring it to the given
// selection. `getIds`/`getGid` are read at click time so a menu built before
// the user changed the selection can't send the wrong tabs.
function wireProfileSections(menuEl, rowsEl, hide, getIds, getGid) {
  const show = profilesTargetable();
  menuEl.querySelectorAll('.ctx-profile-sec').forEach((n) => n.classList.toggle('hidden', !show));
  if (!show) return;
  const pick = (mode) => (pid) => {
    const ids = getIds();
    const gid = getGid ? getGid() : null;
    hide();
    sendToProfile(pid, mode, ids, gid);
  };
  buildProfileRows(rowsEl, pick('move'), pick('copy'));
}

// Snapshot a tab for transport, with a fresh id — nothing references a tab id
// across profiles, so re-issuing on move as well as copy keeps both paths the
// same. `groupId` is the caller's (already remapped) target group.
function tabPayload(t, mode, groupId) {
  const payload = {
    id: uid(), name: t.name, custom: !!t.custom, content: t.content || '',
    dir: t.dir || 'auto', align: t.align || 'auto', pinned: !!t.pinned,
    color: t.color || null, groupId: groupId || null, md: !!t.md,
    files: Array.isArray(t.files) ? t.files.map((f) => ({ ...f })) : [],
    snapshots: mode === 'move' && Array.isArray(t.snapshots) ? t.snapshots : []
  };
  // A shared note follows a move (it just lives in the other profile now), but
  // a *copy* must not: two tabs bound to one note would be two local buffers
  // fighting over the same text. The copy becomes an ordinary local note.
  if (mode === 'move' && t.shareId) {
    payload.shareId = t.shareId;
    payload.shareRole = t.shareRole;
    payload.shareOwner = t.shareOwner || '';
    payload.shareBase = t.shareBase != null ? t.shareBase : (t.content || '');
    payload.shareRev = t.shareRev || 0;
  }
  return payload;
}

async function sendToProfile(targetId, mode, tabIds, groupId) {
  const target = profiles.find((p) => p.id === targetId);
  if (!target || target.id === activeProfileId) return;

  commitMdBlockEdit(); // flush an open preview-block editor first…
  syncEditorToState(); // …because syncEditorToState no-ops in md mode

  let groups = [];
  let newGid = null;
  if (groupId) {
    const g = (state.groups || []).find((x) => x.id === groupId);
    if (!g) return;
    newGid = uid();
    groups = [{
      id: newGid, name: g.name, collapsed: false,
      color: g.color || null, pinned: !!g.pinned
    }];
  }
  const srcTabs = orderedTabs().filter((t) => tabIds.includes(t.id));
  if (!srcTabs.length && !groups.length) return;
  const tabs = srcTabs.map((t) => tabPayload(t, mode, newGid));

  // Remote write first: if it fails nothing local has changed, and if the app
  // dies between the two writes the worst case is a duplicate, never a loss.
  let res = null;
  try {
    res = await window.api.copyIntoProfile({ targetId, mode, tabs, groups });
  } catch (err) {
    console.error('copy-into-profile failed', err);
  }
  if (!res || !res.ok) { showToast("Couldn't move those to that profile.", ''); return; }

  if (mode === 'move') removeMovedLocally(srcTabs, groupId);
  showToast(mode === 'move' ? 'Moved to' : 'Copied to', target.name);
}

// Drop the tabs (and the group, if any) that just left for another profile.
function removeMovedLocally(srcTabs, groupId) {
  const ids = new Set(srcTabs.map((t) => t.id));
  const firstIdx = state.tabs.findIndex((t) => ids.has(t.id));
  srcTabs.forEach((t) => { clearTimeout(t.checkpointTimer); t.checkpointTimer = null; });
  // The note travelled with the tab; this profile stops listening for it.
  srcTabs.forEach((t) => { if (t.shareId) shDisconnect(t.shareId); });

  state.tabs = state.tabs.filter((t) => !ids.has(t.id));
  if (groupId) state.groups = (state.groups || []).filter((g) => g.id !== groupId);
  selectedTabIds.clear();
  lastClickedTabId = null;

  if (!state.tabs.some((t) => t.id === state.activeId)) {
    commitMdBlockEdit(true);
    const next = state.tabs[Math.min(Math.max(firstIdx, 0), state.tabs.length - 1)] || null;
    state.activeId = next ? next.id : null;
    showEditorView();
    setEditorText(next ? next.content : '');
    applyEditorAlign();
    applyMdView();
    if (mdOn()) renderMdPreview();
  }
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  // Flush now rather than on the 350ms debounce: the tabs are already on disk
  // in the target profile, so a crash before the save would leave them in both.
  clearTimeout(saveTimer);
  doSave();
}

// ---------- Templates ----------
function openTemplates() {
  if (settings.templatesEnabled === false) return;
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
  const tab = { id: uid(), name: tmpl.name, custom: true, content: tmpl.content, dir: 'auto', align: 'auto', color: null };
  state.tabs.push(tab);
  state.activeId = tab.id;
  showEditorView();
  setEditorText(tab.content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  applyEditorAlign();
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
if (discoverBtn) discoverBtn.addEventListener('click', () => switchToDiscover());
if (promptLabBtn) promptLabBtn.addEventListener('click', () => switchToLab());
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
    if (mdOn()) renderMdPreview();
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
  // Every path that changes a tab's text ends up scheduling a save — markdown
  // block edits, AI actions, undo, snapshot restore, clean-up. Sweeping the
  // shared tabs here covers all of them with one check (shLocalEdit no-ops when
  // the text already matches what the other side has).
  state.tabs.forEach((t) => { if (t.shareId) shLocalEdit(t); });
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

// Which id the workspace should open on. Only FS_ID and AI_ID used to be
// recognised, so quitting on Discover or Prompt Lab silently dropped you into
// the first tab; with profile switching that fired on every switch. Each
// sentinel is gated on the same settings flags as its switchTo* entry point,
// so a disabled view can never be restored into.
function resolveActiveId(wanted, tabs) {
  if (wanted === FS_ID && settings.fastSaveEnabled) return FS_ID;
  if (wanted === AI_ID && aiOn() && settings.aiChatEnabled !== false) return AI_ID;
  if (wanted === DISCOVER_ID && settings.discoverEnabled && window.DISCOVER_CONFIGURED) return DISCOVER_ID;
  if (wanted === LAB_ID && settings.promptLabEnabled !== false) return LAB_ID;
  if (wanted && tabs.some((t) => t.id === wanted)) return wanted;
  return tabs.length ? tabs[0].id : null;
}

// Per-key restore. This used to reset EVERY key whenever a workspace had no
// tabs — which a brand-new profile legitimately does, and that reset wiped the
// now-shared Prompt Lab. Each key is restored on its own merits instead, and
// promptLab never falls back to [] (main also refuses to persist a non-array
// over the shared copy, so the wipe is impossible from either side).
async function loadState() {
  const saved = (await window.api.loadNotes()) || {};
  const tabs = Array.isArray(saved.tabs) ? saved.tabs : [];
  const hadSaved = tabs.length > 0;

  state.tabs = hadSaved
    ? tabs
    : [{ id: uid(), name: '', custom: false, content: '', dir: 'auto', align: 'auto', color: null }];
  state.seq = saved.seq || 1;
  state.templates = Array.isArray(saved.templates) ? saved.templates : [];
  state.groups = Array.isArray(saved.groups) ? saved.groups : [];
  state.phValues = (saved.phValues && typeof saved.phValues === 'object') ? saved.phValues : {};
  state.fastSave = (saved.fastSave && Array.isArray(saved.fastSave.messages))
    ? saved.fastSave : { messages: [] };
  state.aiChat = (saved.aiChat && Array.isArray(saved.aiChat.messages))
    ? saved.aiChat : { messages: [] };
  state.promptLab = Array.isArray(saved.promptLab) ? saved.promptLab : (state.promptLab || []);
  state.activeId = resolveActiveId(saved.activeId, state.tabs);
  // One-time carry-over: lastVersion used to be stored with the workspace.
  if (!settings.lastVersion && saved.lastVersion) {
    settings.lastVersion = saved.lastVersion;
    saveSettingsNow();
  }
  trimAiMessages();
  const t = activeTab();
  setEditorText(t ? t.content : '');
  applyEditorAlign();
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  // Shared notes belong to the profile they were accepted into, so a profile
  // switch has to drop the outgoing profile's channels and open this one's.
  shSyncChannels();
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
    // Shared note: push this keystroke out on its own (short) debounce rather
    // than waiting for the 350ms autosave to notice.
    if (t.shareId && t.content !== prevContent) shLocalEdit(t);
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
  // Continue lists: Enter after the marker of a non-empty todo / bullet /
  // numbered line starts the next line with a fresh marker (numbers
  // auto-increment). Enter on an item that is *only* a marker ends the list
  // instead, which is what every other editor does — and it's the fastest way
  // out of a run of "1." lines.
  const todoM = text.match(TODO_RE);
  const listM = todoM ? null : text.match(MD_LIST_RE);
  let contPrefix = '';
  if (todoM || listM) {
    const markerLen = (todoM || listM)[0].length;
    if (text.trimEnd().length <= markerLen) {
      // a marker with nothing after it — clear the line and end the list
      setLineText(line, '', 0);
      updateLineDirs();
      return;
    }
    if (offset >= markerLen) {
      if (todoM) contPrefix = todoM[1] + '- [ ] ';
      else if (listM[2]) contPrefix = listM[1] + listM[2] + listM[3];      // "- " / "* "
      else contPrefix = listM[1] + nextListNumber(listM[4]) + listM[5];    // "1. " → "2. "
    }
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
  if (mdOn() || fsActive()) return;
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
  if (mdOn() || fsActive()) return;
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
// button steal focus before the click handler reads the selection). This
// used to be a plain mousedown preventDefault(), but that also suppresses
// the native drag gesture — Chromium won't start dragging an element whose
// mousedown was cancelled — which broke reordering this button in the
// toolbar. Capture the selection instead and restore it just before acting,
// so a genuine drag is left alone while a plain click still works.
let todoBtnSavedRange = null;
todoBtn.addEventListener('mousedown', () => {
  const sel = window.getSelection();
  todoBtnSavedRange = (sel && sel.rangeCount && editorEl.contains(sel.anchorNode))
    ? sel.getRangeAt(0).cloneRange() : null;
});
todoBtn.addEventListener('click', () => {
  if (todoBtnSavedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    try { sel.addRange(todoBtnSavedRange); } catch {}
  }
  applyTodoButton();
});

// Click a todo mark to check/uncheck it; click a thumbnail to zoom; click a
// link to open it. mousedown + preventDefault keeps the caret where it was.
editorEl.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  // A link opens on click the way it would on a web page — unless the caret is
  // already on that line, where the raw [label](url) is showing and the click
  // should just move the caret so the text can be edited.
  const link = t.closest('.md-link-text');
  if (link && e.button === 0 && !link.closest('.ln.caret-line')) {
    const url = link.dataset.href || '';
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault();
      window.api.openExternal(url);
      return;
    }
  }
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
  if (width) {
    img.style.width = width + 'px';
    img.classList.add('pp-img-sized');
  }
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
  img.classList.add('pp-img-sized');
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
  const w = Math.max(60, Math.round(imgResizing.startW + (e.clientX - imgResizing.startX)));
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
let textCtxSelection = ''; // text selected when the menu opened (for "Share to Discover")

function selectedTextFrom(target) {
  if (target && target.matches && target.matches('input, textarea')) {
    try { return target.value.slice(target.selectionStart, target.selectionEnd); } catch { return ''; }
  }
  return window.getSelection().toString();
}

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

  // "Improve Prompt" only makes sense in the main prompt editor itself. A
  // real right-click's target is a descendant (a .ln line div or its text),
  // not editorEl itself — must check ancestry, not identity.
  const showImprove = aiOn() && editorEl.contains(target) && !mdOn();
  document.getElementById('ctxImproveSep').classList.toggle('hidden', !showImprove);
  document.getElementById('ctxImproveItem').classList.toggle('hidden', !showImprove);
  document.getElementById('ctxAiMoreItem').classList.toggle('hidden', !showImprove);

  // "Markdown Commands" needs the raw editor for the same reason Improve does:
  // every command writes markdown into the note text, and the appliers bail out
  // in preview mode.
  const showMd = editorEl.contains(target) && !mdOn();
  document.getElementById('ctxMdSep').classList.toggle('hidden', !showMd);
  document.getElementById('ctxMdItem').classList.toggle('hidden', !showMd);

  // "Share to Discover" — any selected text, anywhere, once Discover is set up.
  textCtxSelection = selectedTextFrom(target);
  const showShare = !!window.DISCOVER_CONFIGURED && settings.discoverEnabled && !!dcClient && !!textCtxSelection.trim();
  const shareSep = document.getElementById('ctxShareSep');
  const shareItem = document.getElementById('ctxShareItem');
  shareSep.classList.toggle('hidden', !showShare);
  shareItem.classList.toggle('hidden', !showShare);
  if (showShare) { shareSep.style.display = ''; shareItem.style.display = ''; }

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
  if (action === 'share-discover') {
    const text = textCtxSelection;
    hideTextContextMenu();
    shareTextToDiscover(text);
    return;
  }
  if (action === 'md-more') {
    // as with ai-more: don't let this click reach the document handler that
    // would close the flyout we're about to open
    e.stopPropagation();
    const r = item.getBoundingClientRect();
    hideTextContextMenu();
    showMdCommandsMenu(r.right + 2, r.top);
    return;
  }
  if (action === 'ai-more') {
    // stop this click from bubbling to the document handler that would
    // otherwise immediately close the actions menu we're about to open
    e.stopPropagation();
    const r = item.getBoundingClientRect();
    hideTextContextMenu();
    showAiActionsMenu(r.right + 2, r.top);
    return;
  }
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
  } else if (action === 'improve') {
    improvePromptNote();
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
//
// setEditorText() rebuilds the whole editor and drops the selection, so the
// caret has to be put back on the line we just inserted — otherwise the next
// insert finds currentLine() === null and appends to the very end of the note.
// That's what scattered a multi-image paste or drop (the drop loop below calls
// this once per file).
function insertImageToken(filename) {
  const t = activeTab();
  if (!t) return;
  syncEditorToState();
  const prev = t.content;
  const token = imgToken(filename);
  const lines = t.content.split('\n');
  let idx = lines.length - 1;
  const line = currentLine();
  if (line) {
    const domIdx = editorLines().indexOf(line);
    if (domIdx !== -1) idx = domIdx;
  }
  const at = idx + 1;
  lines.splice(at, 0, token);
  t.content = lines.join('\n');
  noteEditForUndo(t, prev);
  setEditorText(t.content);
  if (!mdOn()) {
    const el = editorLines()[at];
    if (el) {
      if (document.activeElement !== editorEl) editorEl.focus();
      placeCaretInLine(el, token.length);
    }
  }
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
  if (mdOn()) renderMdPreview();
}

imgBtn.addEventListener('click', async () => {
  if (mdOn() || fsActive() || !activeTab()) return;
  const res = await window.api.pickImage();
  if (res && res.filename) insertImageToken(res.filename);
});

// Anchored, non-global check — IMG_TOKEN_RE carries /g and .test() on a
// global regex advances lastIndex as a side effect, which would misfire
// intermittently across back-to-back regenerate clicks.
const IMG_TOKEN_LINE_RE = /^!\[img\]\(ppimg:\/\/[a-zA-Z0-9._-]+(?:\|\d+)?\)$/;

// Insert/replace a generated preview image directly above `targetLine`
// (0 = top of the whole tab; a code block's data-line = just above that
// block). If a preview token already sits in that slot, replace it in
// place so regenerating updates the image instead of stacking duplicates.
function setPreviewImageToken(t, filename, targetLine) {
  const prev = t.content;
  const lines = t.content.split('\n');
  const token = imgToken(filename);
  const above = targetLine - 1;
  if (above >= 0 && IMG_TOKEN_LINE_RE.test(lines[above])) lines[above] = token;
  else if (targetLine === 0 && IMG_TOKEN_LINE_RE.test(lines[0])) lines[0] = token;
  else lines.splice(targetLine, 0, token);
  t.content = lines.join('\n');
  noteEditForUndo(t, prev);
}

// Shared by the toolbar "Generate Image" button and each code block's
// generate-image button (see the mdPreviewEl click delegate below).
async function runImageGeneration(btnEl, prompt, targetLine) {
  const provider = settings.imageGen.provider || 'pollinations';
  if (provider === 'gemini' && !settings.imageGen.geminiApiKey) {
    openSettings();
    geminiApiKeyInputEl.focus();
    return;
  }
  if (provider === 'huggingface' && !settings.imageGen.hfApiKey) {
    openSettings();
    hfApiKeyInputEl.focus();
    return;
  }
  const t = activeTab();
  if (!t) return;
  const tabId = t.id;
  prompt = prompt.trim();
  if (!prompt) return;

  const defaultTitle = btnEl.title;
  const epoch = profileEpoch; // `t` belongs to this profile's workspace
  btnEl.disabled = true;
  btnEl.classList.add('generating');
  btnEl.title = 'Generating…';
  try {
    const res = await window.api.generateImage(prompt, {
      provider,
      geminiApiKey: settings.imageGen.geminiApiKey,
      hfApiKey: settings.imageGen.hfApiKey
    });
    if (epoch !== profileEpoch) return;
    if (res && res.ok && res.filename) {
      setPreviewImageToken(t, res.filename, targetLine);
      // Only touch the visible editor if the user is still on this tab —
      // otherwise this would hijack whatever tab is now on screen, and the
      // next autosave would write that stale DOM text into the wrong tab.
      if (activeTab() && activeTab().id === tabId) {
        setEditorText(t.content);
        if (mdOn()) renderMdPreview();
      }
      updateCounts();
      updatePlaceholderPanel();
      scheduleSave();
    } else {
      btnEl.classList.add('failed');
      btnEl.title = (res && res.error) || 'Image generation failed.';
      setTimeout(() => {
        btnEl.classList.remove('failed');
        btnEl.title = defaultTitle;
      }, 4000);
    }
  } finally {
    btnEl.disabled = false;
    btnEl.classList.remove('generating');
    if (!btnEl.classList.contains('failed')) btnEl.title = defaultTitle;
  }
}

genImgBtn.addEventListener('click', () => {
  if (mdOn() || fsActive() || !activeTab()) return;
  const prompt = activeTab().content.replace(IMG_TOKEN_RE, '');
  runImageGeneration(genImgBtn, prompt, 0);
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
  const epoch = profileEpoch;
  saveImageBlob(file).then((res) => {
    if (epoch !== profileEpoch) return;
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
  const genImgCodeBtn = t.closest('.md-code-genimg');
  if (genImgCodeBtn) {
    const block = genImgCodeBtn.closest('.md-codeblock');
    const codeEl = block && block.querySelector('code');
    const line = block ? Number(block.dataset.line) : NaN;
    if (codeEl && Number.isFinite(line)) runImageGeneration(genImgCodeBtn, codeEl.textContent, line);
    return;
  }
  const improveCodeBtn = t.closest('.md-code-improve');
  if (improveCodeBtn) {
    markFeatureSeen('improve');
    const block = improveCodeBtn.closest('.md-codeblock');
    const codeEl = block && block.querySelector('code');
    const startLine = block ? Number(block.dataset.line) : NaN;
    const endLine = block ? Number(block.dataset.endLine) : NaN;
    const tab = activeTab();
    if (codeEl && tab && Number.isFinite(startLine) && Number.isFinite(endLine)) {
      const tabId = tab.id;
      runImprove(improveCodeBtn, codeEl.textContent, (improved) => {
        if (!activeTab() || activeTab().id !== tabId) return;
        const prev = tab.content;
        const lines = prev.split('\n');
        if (endLine > lines.length) return; // content changed underneath us — skip
        lines.splice(startLine + 1, endLine - (startLine + 1), ...improved.split('\n'));
        tab.content = lines.join('\n');
        noteEditForUndo(tab, prev);
        setEditorText(tab.content); // same reason as the block editor above
        renderMdPreview();
        updateCounts();
        scheduleSave();
      });
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
  if (mdOn() || fsActive()) return;
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
  if (mdOn() || fsActive()) return;
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

// ---------- Markdown commands ----------
// Block-level formatting, i.e. everything surroundSelection() can't do: it
// works inside one line by construction, while these rewrite the marker at the
// start of every selected line.

// Any leading block marker, so applying a new one replaces the old rather
// than stacking "> - # " prefixes.
const MD_ANY_MARK_RE = /^(\s*)(?:#{1,6} |> |[-*+] (?:\[[ x]\] )?|[0-9۰-۹٠-٩]+[.)] )?/;

// The .ln lines a command should act on: the selection if there is one,
// otherwise just the caret line.
function commandLines() {
  const sel = selectedLines();
  if (sel.length) return sel;
  const line = currentLine();
  return line ? [line] : [];
}

// prefix — either a string ("# ", "> ", "- ") or a function(index) for
// numbered lists. Re-applying the same prefix to every selected line strips it
// instead, so each command toggles.
function applyLinePrefix(prefix) {
  if (mdOn() || fsActive()) return;
  editorEl.focus();
  const lines = commandLines();
  if (!lines.length) return;
  const at = (n) => (typeof prefix === 'function' ? prefix(n) : prefix);
  const has = (l, n) => {
    const m = l.textContent.match(MD_ANY_MARK_RE);
    return m && m[0].slice(m[1].length) === at(n).trimStart();
  };
  const allHave = prefix !== '' && lines.every((l, n) => has(l, n));
  lines.forEach((l, n) => {
    const m = l.textContent.match(MD_ANY_MARK_RE);
    const indent = m ? m[1] : '';
    const body = l.textContent.slice(m ? m[0].length : 0);
    l.textContent = indent + (allHave ? '' : at(n).trimStart()) + body;
    highlightLine(l);
  });
  updateLineDirs();
  const last = lines[lines.length - 1];
  placeCaretInLine(last, last.textContent.length);
  handleEditorChanged();
}

// Insert a multi-line block (table skeleton, code fence) below the caret line.
function insertBlock(block) {
  if (mdOn() || fsActive()) return;
  editorEl.focus();
  let line = currentLine();
  if (!line) {
    const all = editorLines();
    line = all[all.length - 1];
    if (!line) { setEditorText(''); line = editorLines()[0]; }
  }
  const rows = block.split('\n');
  // An empty caret line becomes the block's first row rather than leaving a
  // stray blank line above it.
  const start = line.textContent.trim() ? null : line;
  const made = rows.map((r) => makeLine(r));
  if (start) start.replaceWith(...made);
  else made.reduce((prev, el) => { prev.after(el); return el; }, line);
  updateLineDirs();
  const target = made[Math.min(1, made.length - 1)];
  placeCaretInLine(target, target.textContent.length);
  target.scrollIntoView({ block: 'nearest' });
  handleEditorChanged();
}

// Every command the right-click menu and the shortcuts share. `run` is called
// with no arguments; `key` is the data-md-action value.
const MD_COMMANDS = {
  h1: () => applyLinePrefix('# '),
  h2: () => applyLinePrefix('## '),
  h3: () => applyLinePrefix('### '),
  h4: () => applyLinePrefix('#### '),
  h5: () => applyLinePrefix('##### '),
  h6: () => applyLinePrefix('###### '),
  paragraph: () => applyLinePrefix(''),
  bold: () => surroundSelection('**', '**', 'bold'),
  italic: () => surroundSelection('*', '*', 'italic'),
  strike: () => surroundSelection('~~', '~~', 'strikethrough'),
  highlight: () => surroundSelection('==', '==', 'highlight'),
  code: () => surroundSelection('`', '`', 'code'),
  sub: () => surroundSelection('~', '~', 'sub'),
  sup: () => surroundSelection('^', '^', 'sup'),
  // The live selection is still intact here (the menu suppresses mousedown),
  // so clear any range the toolbar button may have parked earlier.
  link: () => { linkSavedRange = null; openLinkDialog(); },
  quote: () => applyLinePrefix('> '),
  ul: () => applyLinePrefix('- '),
  ol: () => applyLinePrefix((n) => n + 1 + '. '),
  todo: () => applyTodoButton(),
  codeblock: () => insertBlock('```\n\n```'),
  table: () => insertBlock('| Column | Column |\n| --- | --- |\n|  |  |'),
  hr: () => insertBlock('---'),
  footnote: () => surroundSelection('[^', ']', '1')
};

function runMdCommand(key) {
  const fn = MD_COMMANDS[key];
  if (fn) fn();
}

// Optional shortcuts (Settings → "Markdown keyboard shortcuts", off by
// default). Keyed by e.code so they fire on any layout, Persian included.
// Ctrl+B and Ctrl+K already exist unconditionally and stay out of this table.
// Nothing here may collide with Ctrl+Shift+F/D/C/Z or Ctrl+Shift+Space.
const MD_SHORTCUTS = {
  'KeyI': 'italic',
  'shift+KeyX': 'strike',
  'shift+KeyH': 'highlight',
  'shift+KeyK': 'code',
  'shift+Digit1': 'h1',
  'shift+Digit2': 'h2',
  'shift+Digit3': 'h3',
  'shift+Digit4': 'h4',
  'shift+Digit5': 'h5',
  'shift+Digit6': 'h6',
  'shift+Digit0': 'paragraph',
  'shift+KeyQ': 'quote',
  'shift+Digit8': 'ul',
  'shift+Digit7': 'ol',
  'shift+KeyR': 'hr',
  'shift+KeyT': 'table'
};

// Human-readable labels for the menu, derived from the table above so the two
// can't drift apart. Bold/Link are listed by hand — they're always on.
const MD_SHORTCUT_LABELS = { bold: 'Ctrl+B', link: 'Ctrl+K' };
for (const [combo, cmd] of Object.entries(MD_SHORTCUTS)) {
  const shift = combo.startsWith('shift+');
  const code = shift ? combo.slice(6) : combo;
  MD_SHORTCUT_LABELS[cmd] = 'Ctrl+' + (shift ? 'Shift+' : '') + code.replace(/^(Key|Digit)/, '');
}

// Fill the menu's shortcut hints, blanking the optional ones while the
// setting is off so the menu never advertises a key that does nothing.
function syncMdShortcutHints() {
  mdCommandsMenu.querySelectorAll('.ctx-key').forEach((el) => {
    const cmd = el.dataset.key;
    const always = cmd === 'bold' || cmd === 'link';
    el.textContent = (always || settings.mdShortcuts) ? (MD_SHORTCUT_LABELS[cmd] || '') : '';
  });
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
// The dialog's inputs take focus, which destroys the editor selection — so the
// selection has to be resolved to line + offsets BEFORE the dialog opens and
// kept in pendingLinkSel. Re-reading it in confirmLink() (as this used to do)
// always came back null: the selected text was left untouched and the new
// [text](url) was appended to the bottom of the note instead.
//
// Clicking the toolbar button also moves focus off the contenteditable before
// the click handler runs, so the range is captured on mousedown — same shape as
// todoBtn above, and for the same reason (a plain preventDefault() there would
// break dragging the button to reorder the toolbar).
let linkSavedRange = null;
let pendingLinkSel = null;

linkBtn.addEventListener('mousedown', () => {
  const sel = window.getSelection();
  linkSavedRange = (sel && sel.rangeCount && editorEl.contains(sel.anchorNode))
    ? sel.getRangeAt(0).cloneRange() : null;
});

function openLinkDialog() {
  if (mdOn() || fsActive()) return;
  // Ignore a range left behind by a mousedown that turned into a toolbar drag,
  // or one whose line has since been rebuilt out of the DOM.
  if (linkSavedRange && editorEl.contains(linkSavedRange.commonAncestorContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    try { sel.addRange(linkSavedRange); } catch {}
  }
  const s = currentLineSelection();
  pendingLinkSel = s;
  const selected = s ? s.line.textContent.slice(s.start, s.end) : '';
  linkTextInput.value = selected;
  linkUrlInput.value = '';
  linkDialog.classList.remove('hidden');
  (selected ? linkUrlInput : linkTextInput).focus();
}
function closeLinkDialog() {
  linkDialog.classList.add('hidden');
  linkSavedRange = null;
  pendingLinkSel = null;
}
function confirmLink() {
  const txt = linkTextInput.value.trim();
  let url = linkUrlInput.value.trim();
  if (!url) { closeLinkDialog(); return; }
  if (!/^[a-z]+:\/\//i.test(url) && !url.startsWith('#') && !url.startsWith('/')) url = 'https://' + url;
  const label = txt || url;
  const s = pendingLinkSel;
  closeLinkDialog();
  editorEl.focus();
  const md = '[' + label + '](' + url + ')';
  // The line can go stale if the editor was rebuilt while the dialog was open.
  if (!s || !editorEl.contains(s.line)) { insertAtCaret(md); return; }
  const text = s.line.textContent;
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

// ---------- Text alignment ----------
// The mode lives on the tab (t.align), like t.dir and t.md — aligning one note
// must not re-flow every other one. It used to be a single global setting.
//
// Editor lines carry an inline text-align (updateLineDirs rewrites it on every
// keystroke), so alignment cannot be a CSS class — an inline style always wins.
// Both paths go through lineAlignFor() so typing can never undo the choice.
const EDITOR_ALIGNS = ['auto', 'left', 'center', 'right', 'justify'];
const ALIGN_LABELS = {
  auto: 'Auto', left: 'Left', center: 'Center', right: 'Right', justify: 'Justify'
};
// Middle line of the toolbar icon, redrawn to hint the current mode.
const ALIGN_ICON_MID = {
  auto: [4, 20], left: [4, 15], center: [7, 17], right: [9, 20], justify: [4, 20]
};

// No fallback to the old settings.editorAlign: the boot migration in main.js
// stamps that value onto every tab once, so a live fallback would only make
// "this tab was set back to auto" indistinguishable from "never set".
function editorAlign() {
  const t = activeTab();
  const m = t && t.align;
  return EDITOR_ALIGNS.includes(m) ? m : 'auto';
}

// The text-align a line should carry, given its own detected direction. `mode`
// is optional so callers looping over every line resolve the tab only once —
// this runs from updateLineDirs() on every keystroke.
function lineAlignFor(dir, mode) {
  const m = mode || editorAlign();
  if (m === 'auto') return dir === 'rtl' ? 'right' : 'left';
  return m;
}

function applyEditorAlign() {
  const m = editorAlign();
  justifyBtn.classList.toggle('active', m !== 'auto');
  // Written in English on purpose: the i18n DOM pass (and its MutationObserver)
  // translates from the English source string, so writing Persian here directly
  // would fight it when the language is switched back.
  if (alignBtnLabelEl) alignBtnLabelEl.textContent = ALIGN_LABELS[m];
  if (alignIconMidEl) {
    const [x1, x2] = ALIGN_ICON_MID[m];
    alignIconMidEl.setAttribute('x1', x1);
    alignIconMidEl.setAttribute('x2', x2);
  }
  EDITOR_ALIGNS.forEach((a) => mdPreviewEl.classList.toggle('align-' + a, a === m));
  editorLines().forEach((d) => {
    d.style.textAlign = lineAlignFor(d.getAttribute('dir') || 'ltr', m);
    d.style.textAlignLast = '';
  });
}

function setEditorAlign(mode) {
  const t = activeTab();
  if (!t) return; // Fast Save / AI Chat / Discover / Lab have no note to align
  t.align = EDITOR_ALIGNS.includes(mode) ? mode : 'auto';
  applyEditorAlign();
  scheduleSave();
}

justifyBtn.addEventListener('click', () => {
  const i = EDITOR_ALIGNS.indexOf(editorAlign());
  setEditorAlign(EDITOR_ALIGNS[(i + 1) % EDITOR_ALIGNS.length]);
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
  if (mdOn() || fsActive()) return;
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

// Transient button title while each AI action runs.
const AI_ACTION_TITLES = {
  improve: 'Improving…',
  translate: 'Translating…',
  summarize: 'Summarizing…',
  grammar: 'Fixing grammar…',
  'tone-professional': 'Rewriting…',
  'tone-casual': 'Rewriting…',
  'tone-concise': 'Rewriting…'
};

// Shared by every AI text action (Improve, Translate, Summarize, …) — handles
// the network call and the button's generating/failed states; `applyFn(text)`
// decides what to do with the result (whole-tab replace, selection replace,
// code-block replace, …).
async function runAiTransform(btnEl, sourceText, action, applyFn) {
  if (!sourceText.trim()) return;
  // no key yet → send the user to Settings to add their free OpenRouter key
  if (!aiKey()) { openSettings(); aiApiKeyInputEl.focus(); return; }
  const defaultTitle = btnEl.title;
  // applyFn closes over the tab/selection this ran against; if the workspace
  // was swapped meanwhile, dropping the result beats writing it somewhere else.
  const epoch = profileEpoch;
  btnEl.disabled = true;
  btnEl.classList.add('generating');
  btnEl.title = AI_ACTION_TITLES[action] || 'Working…';
  try {
    const res = await window.api.aiTransform(action, sourceText, aiKey());
    if (epoch !== profileEpoch) return;
    if (res && res.ok && res.text) {
      applyFn(res.text);
    } else {
      btnEl.classList.add('failed');
      btnEl.title = (res && res.error) || 'AI action failed.';
      setTimeout(() => {
        btnEl.classList.remove('failed');
        btnEl.title = defaultTitle;
      }, 4000);
    }
  } finally {
    btnEl.disabled = false;
    btnEl.classList.remove('generating');
    if (!btnEl.classList.contains('failed')) btnEl.title = defaultTitle;
  }
}

// Back-compat wrapper — the code-block Improve button (markdown preview) still
// calls runImprove(...).
function runImprove(btnEl, sourceText, applyFn) {
  return runAiTransform(btnEl, sourceText, 'improve', applyFn);
}

// Write an AI result back into the tab: replaces the selected line-slice if
// there was a selection, otherwise the whole tab. Only touches the DOM when
// the user is still on the originating tab (guards against a mid-flight tab
// switch — same pattern as runImageGeneration).
function applyTransformResult(t, tabId, sel, hasSelection, out) {
  if (!activeTab() || activeTab().id !== tabId) { if (!hasSelection) t.content = out; return; }
  if (hasSelection) {
    const text = sel.line.textContent;
    if (sel.end > text.length) return; // line changed underneath us — skip rather than corrupt it
    setLineText(sel.line, text.slice(0, sel.start) + out + text.slice(sel.end), sel.start + out.length);
    scheduleSave();
  } else {
    const prev = t.content;
    noteEditForUndo(t, prev);
    t.content = out;
    setEditorText(out);
    updateCounts();
    updatePlaceholderPanel();
    if (!t.custom) renderTabs();
    scheduleSave();
    editorEl.focus();
    placeCaretEnd();
  }
}

// Runs an AI action on the current single-line selection if there is one
// (mirrors the single-line constraint of surroundSelection/bold — this editor
// is line-based, so cross-line selections aren't addressable), otherwise the
// whole tab.
async function runTabAiAction(action) {
  if (!aiOn() || mdOn() || fsActive() || !activeTab()) return;
  if (!aiKey()) { openSettings(); aiApiKeyInputEl.focus(); return; }
  markFeatureSeen('improve');
  const t = activeTab();
  syncEditorToState();
  const tabId = t.id;
  const sel = currentLineSelection();
  const hasSelection = !!(sel && sel.end > sel.start);
  const source = hasSelection ? sel.line.textContent.slice(sel.start, sel.end) : t.content;
  if (!source.trim()) return;
  // shimmer the target text (the selected line, or the whole editor) so it's
  // clear the AI is working on it
  const workEl = hasSelection ? sel.line : editorEl;
  if (workEl) workEl.classList.add('ai-working');
  try {
    await runAiTransform(improveBtn, source, action, (out) => applyTransformResult(t, tabId, sel, hasSelection, out));
  } finally {
    if (workEl) workEl.classList.remove('ai-working');
  }
}

function improvePromptNote() { return runTabAiAction('improve'); }

// ---------- AI actions menu ----------
function showAiActionsMenu(x, y) {
  if (!aiOn() || mdOn() || fsActive() || !activeTab()) return;
  hideTextContextMenu();
  aiActionsMenu.style.left = x + 'px';
  aiActionsMenu.style.top = y + 'px';
  aiActionsMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = aiActionsMenu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (rect.right > vw - 4) aiActionsMenu.style.left = Math.max(4, vw - rect.width - 4) + 'px';
    if (rect.bottom > vh - 4) aiActionsMenu.style.top = Math.max(4, vh - rect.height - 4) + 'px';
  });
}
function hideAiActionsMenu() { aiActionsMenu.classList.add('hidden'); }

// keep selection/focus in the editor when clicking a menu item
aiActionsMenu.addEventListener('mousedown', (e) => e.preventDefault());
aiActionsMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-ai-action]');
  if (!item) return;
  const action = item.dataset.aiAction;
  hideAiActionsMenu();
  runTabAiAction(action);
});

// Right-clicking the Improve toolbar button opens the actions menu at it.
improveBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = improveBtn.getBoundingClientRect();
  showAiActionsMenu(r.left, r.top - 8);
});

document.addEventListener('click', (e) => {
  if (!aiActionsMenu.classList.contains('hidden') && !aiActionsMenu.contains(e.target)) {
    hideAiActionsMenu();
  }
});

// ---------- Export ----------
// "Export as file…" used to write the raw note string and nothing else, which
// meant every ![img](ppimg://…) token in it became a dead link the moment the
// file left the app. Each format below either carries the image files along or
// renders them into the output.
const exportMenu = document.getElementById('exportMenu');
let pendingExport = null; // { name, content }

function showExportMenu(x, y, name, content) {
  pendingExport = { name, content };
  exportMenu.style.left = x + 'px';
  exportMenu.style.top = y + 'px';
  exportMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = exportMenu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (rect.right > vw - 4) exportMenu.style.left = Math.max(4, vw - rect.width - 4) + 'px';
    if (rect.bottom > vh - 4) exportMenu.style.top = Math.max(4, vh - rect.height - 4) + 'px';
  });
}
function hideExportMenu() { exportMenu.classList.add('hidden'); pendingExport = null; }

// The theme is a set of CSS custom properties on :root, so a rendered export
// only matches the app if they travel with it. Chromium enumerates custom
// properties in a computed style, which is the only way to get them all
// without parsing the stylesheet.
function themeVarsCss() {
  const cs = getComputedStyle(document.documentElement);
  const out = [];
  for (let i = 0; i < cs.length; i++) {
    const prop = cs[i];
    if (prop.startsWith('--')) out.push(prop + ':' + cs.getPropertyValue(prop) + ';');
  }
  return out.join('');
}

// HTML/PDF/PNG all render the same document the preview pane shows, so what
// you export is what you were looking at.
function exportRenderPayload(content) {
  const t = activeTab();
  const forced = t && (t.dir === 'rtl' || t.dir === 'ltr') ? t.dir : null;
  const holder = document.createElement('div');
  holder.innerHTML = window.renderMarkdown(content, { ai: false });
  // Same per-block direction pass the preview does — without it an exported
  // Persian note comes out left-aligned with its list markers on the wrong side.
  const SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, ul, ol, dl, dt, dd, table, th, td';
  holder.querySelectorAll(SEL).forEach((el) => {
    el.setAttribute('dir', forced || detectDir(el.textContent));
  });
  // The preview's buttons are app chrome, not content.
  holder.querySelectorAll('.md-code-copy, .md-code-improve, .md-code-genimg').forEach((b) => b.remove());
  return {
    body: holder.innerHTML,
    dir: forced || detectDir(content),
    vars: themeVarsCss(),
    fullSizeImages: !!settings.mdImageFullSize
  };
}

exportMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('[data-export-format]');
  if (!item || !pendingExport) return;
  const format = item.dataset.exportFormat;
  const { name, content } = pendingExport;
  hideExportMenu();
  const payload = { name, content, format };
  if (format === 'html' || format === 'pdf' || format === 'png' || format === 'clipboard-png') {
    payload.render = exportRenderPayload(content);
  }
  try {
    const res = await window.api.exportNoteRich(payload);
    if (res && res.ok && format === 'clipboard-png') showToast('Copied as image');
    // an image has a hard height limit; say so rather than silently trimming
    if (res && res.ok && res.truncated) showToast('Note too long — the image was cut short');
  } catch (err) {
    console.error('export failed', err);
  }
});

document.addEventListener('click', (e) => {
  if (!exportMenu.classList.contains('hidden') && !exportMenu.contains(e.target)) hideExportMenu();
});

// ---------- Markdown commands menu ----------
// Same flyout shape as the AI actions menu above: opened from a row of the
// text context menu, positioned to that row's right edge, closed by a click
// anywhere else or by Escape.
function showMdCommandsMenu(x, y) {
  if (mdOn() || fsActive() || !activeTab()) return;
  hideTextContextMenu();
  syncMdShortcutHints();
  mdCommandsMenu.style.left = x + 'px';
  mdCommandsMenu.style.top = y + 'px';
  mdCommandsMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = mdCommandsMenu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (rect.right > vw - 4) mdCommandsMenu.style.left = Math.max(4, vw - rect.width - 4) + 'px';
    if (rect.bottom > vh - 4) mdCommandsMenu.style.top = Math.max(4, vh - rect.height - 4) + 'px';
  });
}
function hideMdCommandsMenu() { mdCommandsMenu.classList.add('hidden'); }

// keep selection/focus in the editor when clicking a menu item
mdCommandsMenu.addEventListener('mousedown', (e) => e.preventDefault());
mdCommandsMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-md-action]');
  if (!item) return;
  hideMdCommandsMenu();
  runMdCommand(item.dataset.mdAction);
});

document.addEventListener('click', (e) => {
  if (!mdCommandsMenu.classList.contains('hidden') && !mdCommandsMenu.contains(e.target)) {
    hideMdCommandsMenu();
  }
});

// ---------- Command palette (Ctrl+P) ----------
const cmdPalette = document.getElementById('cmdPalette');
const cmdInput = document.getElementById('cmdInput');
const cmdResults = document.getElementById('cmdResults');
let cmdItems = [];       // current filtered command objects
let cmdActiveIdx = 0;

function buildCommands() {
  const cmds = [
    { id: 'new-tab', label: tr('cmd.newTab', 'New tab'), hint: 'Ctrl+T', run: () => addTab() },
    { id: 'toggle-tabs', label: settings.railHidden ? tr('cmd.showTabs', 'Show tabs') : tr('cmd.hideTabs', 'Hide tabs'), hint: 'Ctrl+\\', run: toggleRail },
    { id: 'focus-mode', label: tr('cmd.focusMode', 'Focus mode'), hint: 'Ctrl+Shift+F', run: () => toggleZen(true) },
    { id: 'toggle-md', label: tr('cmd.toggleMd', 'Toggle markdown preview'), hint: 'Ctrl+M', run: () => { if (!fsActive()) setMdPreview(!mdOn()); } },
    { id: 'find', label: tr('cmd.find', 'Find'), hint: 'Ctrl+F', run: () => { if (!fsActive()) openFind(false); } },
    { id: 'replace', label: tr('cmd.replace', 'Find & replace'), hint: 'Ctrl+H', run: () => { if (!fsActive()) openFind(true); } },
    { id: 'settings', label: tr('cmd.settings', 'Settings'), hint: '', run: openSettings }
  ];
  if (settings.handyEnabled !== false) {
    cmds.push({ id: 'handy-mode', label: settings.handyMode ? tr('cmd.handyExit', 'Exit handy dock') : tr('cmd.handyEnter', 'Handy mode (dock to edge)'), hint: settings.handyShortcut || 'Ctrl+Shift+D', run: toggleHandy });
  }
  if (aiOn()) {
    cmds.push({ id: 'improve', label: tr('cmd.improve', 'Improve prompt'), hint: 'AI', run: () => improvePromptNote() });
    if (settings.aiChatEnabled !== false) {
      cmds.push({ id: 'ai-chat', label: tr('cmd.aiChat', 'Go to AI Chat'), hint: '', run: switchToAiChat });
      cmds.push({ id: 'clear-ai', label: tr('cmd.clearAi', 'Clear AI chat'), hint: '', run: clearAiChat });
    }
  }
  if (settings.templatesEnabled !== false) {
    cmds.push({ id: 'templates', label: tr('cmd.templates', 'Templates'), hint: '', run: openTemplates });
  }
  if (settings.fastSaveEnabled) {
    cmds.push({ id: 'fast-save', label: tr('cmd.goTo', 'Go to') + ' ' + fsLabel(), hint: '', run: switchToFastSave });
  }
  if (settings.promptLabEnabled !== false) {
    cmds.push({ id: 'prompt-lab', label: tr('cmd.goTo', 'Go to') + ' ' + tr('rail.promptLab', 'prompt lab'), hint: '', run: switchToLab });
  }
  if (window.DISCOVER_CONFIGURED && settings.discoverEnabled) {
    cmds.push({ id: 'discover', label: tr('cmd.goTo', 'Go to') + ' ' + tr('rail.discover', 'discover'), hint: '', run: switchToDiscover });
  }
  orderedTabs().forEach((t) => {
    cmds.push({ id: 'tab:' + t.id, label: autoName(t, state.tabs.indexOf(t)), hint: 'tab', run: () => switchTab(t.id) });
  });
  return cmds;
}

// Subsequence fuzzy score — lower is better, -1 means no match.
function cmdFuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  let qi = 0, score = 0, lastIdx = -1;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      if (lastIdx >= 0) score += (i - lastIdx); // reward adjacent matches
      lastIdx = i;
      qi++;
    }
  }
  if (qi < q.length) return -1;
  return score + lastIdx * 0.01; // slight preference for earlier full matches
}

function renderCmdResults() {
  const query = cmdInput.value.trim();
  const all = buildCommands();
  const scored = query
    ? all.map((c) => ({ c, s: cmdFuzzyScore(query, c.label) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s)
    : all.map((c) => ({ c, s: 0 }));
  cmdItems = scored.map((x) => x.c);
  cmdActiveIdx = 0;
  cmdResults.innerHTML = '';
  if (!cmdItems.length) {
    const empty = document.createElement('div');
    empty.className = 'cmd-empty';
    empty.textContent = 'No matches';
    cmdResults.appendChild(empty);
    return;
  }
  cmdItems.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'cmd-row' + (i === cmdActiveIdx ? ' active' : '');
    row.dataset.idx = i;
    const label = document.createElement('span');
    label.className = 'cmd-row-label';
    label.textContent = c.label;
    label.setAttribute('dir', detectDir(c.label));
    row.appendChild(label);
    if (c.hint) {
      const hint = document.createElement('span');
      hint.className = 'cmd-row-hint';
      hint.textContent = c.hint;
      row.appendChild(hint);
    }
    cmdResults.appendChild(row);
  });
}

function setCmdActive(idx) {
  const rows = [...cmdResults.querySelectorAll('.cmd-row')];
  if (!rows.length) return;
  cmdActiveIdx = (idx + rows.length) % rows.length;
  rows.forEach((r, i) => r.classList.toggle('active', i === cmdActiveIdx));
  rows[cmdActiveIdx].scrollIntoView({ block: 'nearest' });
}

function runCmdActive() {
  const c = cmdItems[cmdActiveIdx];
  closeCommandPalette();
  if (c) { try { c.run(); } catch (err) { console.error('command failed', err); } }
}

function openCommandPalette() {
  if (!cmdPalette.classList.contains('hidden')) return;
  cmdInput.value = '';
  cmdPalette.classList.remove('hidden');
  renderCmdResults();
  cmdInput.focus();
}
function closeCommandPalette() {
  cmdPalette.classList.add('hidden');
}

cmdInput.addEventListener('input', renderCmdResults);
cmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setCmdActive(cmdActiveIdx + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setCmdActive(cmdActiveIdx - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); runCmdActive(); }
});
cmdResults.addEventListener('mousemove', (e) => {
  const row = e.target.closest('.cmd-row');
  if (row) setCmdActive(+row.dataset.idx);
});
cmdResults.addEventListener('click', (e) => {
  const row = e.target.closest('.cmd-row');
  if (!row) return;
  setCmdActive(+row.dataset.idx);
  runCmdActive();
});
cmdPalette.addEventListener('mousedown', (e) => {
  if (e.target === cmdPalette) closeCommandPalette();
});

// ---------- Handy (peek) mode ----------
// The window collapses to a thin line at the bottom edge; hovering it slides
// the notepad open, and it tucks back when you move away (unless you've clicked
// in and are actively using it).
let handyCollapseTimer = null;
let handyExpandTimer = null;
let handyHovered = false;
let handyGlobalOK = false; // did the global show/hide shortcut register successfully?

// The global shortcut (registered in main) forwards a toggle here.
window.api.onToggleHandy(() => toggleHandy());

function handyOpen() { return appEl.classList.contains('handy-open'); }

function handyShortcutLabel() {
  return settings.handyShortcut || DEFAULT_SETTINGS.handyShortcut;
}

function setHandyMode(on) {
  on = !!on;
  if (on && settings.handyEnabled === false) return;
  settings.handyMode = on;
  clearTimeout(handyCollapseTimer);
  handyBtn.classList.toggle('active', on);
  handyBtn.title = on
    ? tr('handy.exitTitle', 'Exit handy mode') + ' (' + handyShortcutLabel() + ')'
    : tr('handy.enterTitle', 'Handy mode — dock to edge') + ' (' + handyShortcutLabel() + ')';
  if (on) {
    // Handy and Focus (zen) mode can coexist — toggling the dock must NOT kick
    // the user out of Focus mode. The collapsed dock hides chrome anyway, and the
    // expanded panel stays chromeless while zen is on.
    appEl.classList.add('handy-mode');
    appEl.classList.remove('handy-open');
    window.api.handyEnter(settings.handyPosition);
  } else {
    appEl.classList.remove('handy-mode', 'handy-open');
    window.api.handyExit();
  }
  saveSettingsNow();
}
// With handy mode switched off in Settings the shortcut isn't wasted — it does
// whatever the user picked instead (minimize, tuck into the tray, or nothing).
function toggleHandy() {
  if (settings.handyEnabled === false) {
    const action = settings.handyDisabledAction || 'tray';
    if (action === 'minimize') window.api.toggleMinimize();
    else if (action === 'tray') window.api.toggleTray();
    return;
  }
  setHandyMode(!settings.handyMode);
}

// Show/hide the handy chrome + the sub-settings that only apply while it's on.
function applyHandySettingsVisibility() {
  const on = settings.handyEnabled !== false;
  if (handyBtn) handyBtn.classList.toggle('hidden', !on);
  [handyPosRowEl, handyCloseRowEl, handyShortcutRowEl].forEach((el) => {
    if (el) el.classList.toggle('disabled', !on);
  });
  if (handyDisabledRowEl) handyDisabledRowEl.classList.toggle('hidden', on);
  if (handyDisabledHint) {
    handyDisabledHint.textContent =
      tr('handy.disabledHint', 'Reuse {key} to hide/restore the window').replace('{key}', handyShortcutLabel());
  }
}

// Which scroll container is on screen — so the scroll position survives the
// collapse (hiding the body resets it to the top otherwise).
let handySavedScroll = 0;
function handyActiveScroller() {
  if (fsActive()) return fsMessagesEl;
  if (aiChatActive()) return aiMessagesEl;
  if (mdOn()) return mdPreviewEl;
  return editorEl;
}
function handyExpand() {
  if (!settings.handyMode || handyOpen()) return;
  clearTimeout(handyCollapseTimer);
  appEl.classList.add('handy-open');
  // 'click away' mode focuses the panel so it stays open until you click
  // somewhere else (a blur); 'leave' mode never steals focus.
  window.api.handyExpand(settings.handyPosition, settings.handyCloseMode === 'click');
  // showing the body again resets the scroller to the top — put it back where
  // it was (rAF + a post-animation pass, so it sticks past the grow animation).
  const scroller = handyActiveScroller();
  if (scroller) {
    const apply = () => { scroller.scrollTop = handySavedScroll; };
    requestAnimationFrame(apply);
    setTimeout(apply, 260);
  }
}
function handyCollapse() {
  if (!settings.handyMode || !handyOpen()) return;
  const scroller = handyActiveScroller();
  if (scroller) handySavedScroll = scroller.scrollTop;
  appEl.classList.remove('handy-open');
  window.api.handyCollapse(settings.handyPosition);
}
// Generous delay so moving the mouse up to the window's edge to resize doesn't
// snap it shut before you can grab the edge; a real resize keeps it open anyway
// (see the window 'resize' handler), and re-entering cancels this.
const HANDY_COLLAPSE_DELAY = 800;
function scheduleHandyCollapse() {
  clearTimeout(handyCollapseTimer);
  handyCollapseTimer = setTimeout(() => {
    if (settings.handyMode && !handyHovered) handyCollapse();
  }, HANDY_COLLAPSE_DELAY);
}

// Hover the whole (tiny) window to open. A short debounce means a quick
// pass-over near the taskbar edge no longer pops the panel — killing the
// open/close flicker — while a deliberate hover still opens promptly.
document.documentElement.addEventListener('mouseenter', () => {
  handyHovered = true;
  clearTimeout(handyCollapseTimer);
  if (!settings.handyMode || handyOpen()) return;
  clearTimeout(handyExpandTimer);
  handyExpandTimer = setTimeout(() => { if (handyHovered) handyExpand(); }, 90);
});
document.documentElement.addEventListener('mouseleave', (e) => {
  handyHovered = false;
  clearTimeout(handyExpandTimer); // cancel a pending open if the mouse just grazed it
  // Don't tuck away while a button is held — the user is dragging to resize or
  // selecting text and the pointer just crossed the window edge.
  if (e.buttons) return;
  // 'leave' mode tucks away as soon as the mouse leaves; 'click away' mode keeps
  // it open (the blur handler closes it once you click elsewhere).
  if (settings.handyMode && settings.handyCloseMode === 'leave') scheduleHandyCollapse();
});
// Any pointer movement inside the window means we're still hovering — keeps
// handyHovered accurate after an OS resize (which can leave the pointer inside
// without firing a fresh mouseenter) so the panel doesn't tuck itself away.
document.documentElement.addEventListener('mousemove', () => {
  if (!settings.handyMode || !handyOpen() || handyHovered) return;
  handyHovered = true;
  clearTimeout(handyCollapseTimer);
});

// While the open panel is being resized (native frameless drag doesn't send DOM
// mouse events, but the window still fires 'resize'), keep it open — and for a
// short grace period after the last resize tick so it doesn't snap shut the
// instant the mouse is released near the edge.
let handyResizeIdleTimer = null;
window.addEventListener('resize', () => {
  if (!settings.handyMode || !handyOpen()) return;
  clearTimeout(handyCollapseTimer);
  clearTimeout(handyResizeIdleTimer);
  handyResizeIdleTimer = setTimeout(() => {
    if (settings.handyMode && settings.handyCloseMode === 'leave' && !handyHovered) handyCollapse();
  }, 550);
});
window.addEventListener('blur', () => {
  if (!settings.handyMode) return;
  // clicking outside the app pulls focus away → tuck the panel back
  if (settings.handyCloseMode === 'click') handyCollapse();
  else if (!handyHovered) handyCollapse();
});
window.addEventListener('focus', () => { clearTimeout(handyCollapseTimer); });
// clicking the collapsed line also opens it, in case a hover was missed
handyHandle.addEventListener('click', () => { if (settings.handyMode) handyExpand(); });

handyBtn.addEventListener('click', () => toggleHandy());

// ---------- Speech to text ----------
let voiceRecording = null; // { recorder, autoStopTimer, sink } while recording
// Captured once, before any handler ever overwrites the title with a
// transient "Recording…"/"Transcribing…" state.
const VOICE_BTN_DEFAULT_TITLE = voiceBtn.title;
const AI_VOICE_BTN_DEFAULT_TITLE = aiVoiceBtn.title;

// Insert transcribed text into the AI Chat composer at the caret.
function insertIntoAiInput(text) {
  const el = aiInputEl;
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  el.value = before + sep + text + after;
  const caret = (before + sep + text).length;
  el.focus();
  el.setSelectionRange(caret, caret);
  aiAutoGrow();
  updateAiInputDir();
}

// A "sink" describes where a transcription goes: the button that shows the
// recording/transcribing state, whether recording may start, a token captured
// before the async upload, and how to insert the result.
const editorVoiceSink = {
  btn: voiceBtn,
  defaultTitle: () => VOICE_BTN_DEFAULT_TITLE,
  canStart: () => !(mdOn() || fsActive() || !activeTab()),
  begin: () => (activeTab() ? activeTab().id : null),
  insert: (text, tabId) => { if (activeTab() && activeTab().id === tabId) insertAtCaret(text); }
};
const aiVoiceSink = {
  btn: aiVoiceBtn,
  defaultTitle: () => AI_VOICE_BTN_DEFAULT_TITLE,
  canStart: () => aiChatActive(),
  begin: () => 'ai',
  insert: (text) => { if (aiChatActive()) insertIntoAiInput(text); }
};

async function startVoiceRecording(sink) {
  if (!sink.canStart()) return;
  if (!settings.voice.hfApiKey) {
    openSettings();
    voiceHfApiKeyInputEl.focus();
    return;
  }
  const btn = sink.btn;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    btn.classList.add('failed');
    btn.title = 'Microphone access denied.';
    setTimeout(() => { btn.classList.remove('failed'); btn.title = sink.defaultTitle(); }, 4000);
    return;
  }

  // Hugging Face's Whisper endpoint accepts audio/webm (tested live); fall
  // back to whatever else the browser supports if that's ever unavailable.
  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
    : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach((tr) => tr.stop());
    finishVoiceRecording(new Blob(chunks, { type: mimeType }), mimeType, sink);
  });
  recorder.start();
  // Safety net so a forgotten recording can't run (and upload) forever.
  const autoStopTimer = setTimeout(() => stopVoiceRecording(), 120_000);
  voiceRecording = { recorder, autoStopTimer, sink };
  btn.classList.add('recording');
  btn.title = 'Recording… click to stop';
}

function stopVoiceRecording() {
  if (!voiceRecording) return;
  clearTimeout(voiceRecording.autoStopTimer);
  voiceRecording.recorder.stop();
  voiceRecording = null;
}

async function finishVoiceRecording(blob, mimeType, sink) {
  const btn = sink.btn;
  btn.classList.remove('recording');
  const token = sink.begin();
  if (token == null) return; // sink no longer valid (e.g. tab closed)

  btn.disabled = true;
  btn.classList.add('generating');
  btn.title = 'Transcribing…';
  try {
    const base64 = await blobToBase64(blob);
    const res = await window.api.transcribeAudio(base64, mimeType, {
      hfApiKey: settings.voice.hfApiKey
    });
    if (res && res.ok && res.text) {
      sink.insert(res.text, token);
    } else {
      btn.classList.add('failed');
      btn.title = (res && res.error) || 'Transcription failed.';
      setTimeout(() => {
        btn.classList.remove('failed');
        btn.title = sink.defaultTitle();
      }, 5000);
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove('generating');
    if (!btn.classList.contains('failed')) btn.title = sink.defaultTitle();
  }
}

voiceBtn.addEventListener('click', () => {
  if (voiceRecording) stopVoiceRecording();
  else startVoiceRecording(editorVoiceSink);
});
aiVoiceBtn.addEventListener('click', () => {
  if (voiceRecording) stopVoiceRecording();
  else startVoiceRecording(aiVoiceSink);
});

improveBtn.addEventListener('click', improvePromptNote);

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
  if (mdOn() || fsActive()) return;
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

// ---------- Hide / show the tab rail ----------
function toggleRail() {
  settings.railHidden = !settings.railHidden;
  applySettings();
  saveSettingsNow();
}
railToggleBtn.addEventListener('click', toggleRail);

// ---------- Focus / Zen mode ----------
let zenHintTimer = null;
function toggleZen(force) {
  const on = typeof force === 'boolean' ? force : !settings.zenMode;
  settings.zenMode = on;
  applySettings();
  clearTimeout(zenHintTimer);
  if (on) {
    zenExitHint.classList.remove('hidden', 'fading');
    // let the show transition run, then fade the hint away
    zenHintTimer = setTimeout(() => zenExitHint.classList.add('fading'), 1800);
  } else {
    zenExitHint.classList.add('hidden');
  }
}
zenBtn.addEventListener('click', () => toggleZen());

minBtn.addEventListener('click', () => window.api.minimize());

// Maximize / restore. Main is the source of truth for the state, because the
// window can also be maximized outside the app (snap, Win+Up, titlebar
// double-click) — those arrive via onMaximizeChange.
function applyMaximized(on) {
  appEl.classList.toggle('maximized', !!on);
  maxBtn.title = on ? 'Restore' : 'Maximize';
}
maxBtn.addEventListener('click', async () => {
  if (settings.handyMode) return; // handy mode owns the window bounds
  applyMaximized(await window.api.toggleMaximize());
});
window.api.onMaximizeChange(applyMaximized);
closeBtn.addEventListener('click', () => window.api.close());

// keyboard shortcuts — use e.code (physical key) so they work on any
// keyboard layout, including Persian.
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  // Global (work in any view): hide-tabs, focus mode, command palette.
  if (!e.shiftKey && e.code === 'Backslash') { e.preventDefault(); toggleRail(); return; }
  if (e.shiftKey && e.code === 'KeyF') { e.preventDefault(); toggleZen(); return; }
  // Handy toggle is normally the global shortcut (works unfocused); only fall
  // back to this local handler for the default combo if that registration failed.
  if (e.shiftKey && e.code === 'KeyD') { e.preventDefault(); if (!handyGlobalOK) toggleHandy(); return; }
  if (!e.shiftKey && e.code === 'KeyP') { e.preventDefault(); openCommandPalette(); return; }
  // editor-only shortcuts are meaningless while the Fast Save chat is shown
  if (fsActive() && (e.code === 'KeyF' || e.code === 'KeyH' || e.code === 'KeyM')) return;
  // Markdown shortcuts — opt-in (Settings → Editor), and only in the raw
  // editor. Checked before the chain below because Ctrl+Shift+0 would
  // otherwise be swallowed by the Ctrl+0 font-size reset.
  if (settings.mdShortcuts && !fsActive() && !mdOn()) {
    const cmd = MD_SHORTCUTS[(e.shiftKey ? 'shift+' : '') + e.code];
    if (cmd) { e.preventDefault(); runMdCommand(cmd); return; }
  }
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
    setMdPreview(!mdOn());
  } else if (!e.shiftKey && e.code === 'KeyB') {
    if (fsActive() || mdOn()) return;
    e.preventDefault();
    surroundSelection('**', '**', 'bold');
  } else if (!e.shiftKey && e.code === 'KeyK') {
    if (fsActive() || mdOn()) return;
    e.preventDefault();
    openLinkDialog();
  }
});

// Ctrl+wheel over the editor zooms the font. Anchor the zoom to the cursor
// position (like browser/VS Code zoom) — otherwise growing the font pushes
// everything below the cursor further down and the page appears to "scroll".
editorEl.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const oldSize = settings.fontSize || DEFAULT_SETTINGS.fontSize;
  const mouseOffset = e.clientY - editorEl.getBoundingClientRect().top;
  const contentY = editorEl.scrollTop + mouseOffset;
  stepFontSize(e.deltaY < 0 ? 1 : -1);
  const newSize = settings.fontSize || DEFAULT_SETTINGS.fontSize;
  editorEl.scrollTop = contentY * (newSize / oldSize) - mouseOffset;
}, { passive: false });

// ---- Per-tab text direction via Windows Ctrl+Shift gesture ----
// Ctrl + Right-Shift = RTL, Ctrl + Left-Shift = LTR. We persist the choice
// on the active tab so it doesn't leak to other tabs. Both combos are
// idempotent, like Windows itself — the way back to 'auto' is the Direction
// row in the tab's context menu (setTabDir).
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
        // applyEditorDir() runs unconditionally: the hidden editor is kept in
        // sync with t.content on every md path, so re-stamping it costs nothing
        // and leaving preview mode already shows the right direction.
        applyEditorDir();
        if (mdOn()) renderMdPreview();
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
  ids.unshift(AI_ID);
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
  // cssClass may carry more than one name — the Glass and XP themes are light
  // designs, so they pair their fx-* class with theme-light.
  Object.values(THEMES).forEach((th) => {
    if (th.cssClass) appEl.classList.remove(...th.cssClass.split(/\s+/));
  });
  if (t.cssClass) appEl.classList.add(...t.cssClass.split(/\s+/));
  // Pro themes carry a runtime (refraction maps, scanline roll, glyph rain,
  // the audio analyser). Swap it after the class, so a runtime that measures
  // an element reads it with the new layout already applied.
  if (window.PP_FX) window.PP_FX.apply(t.fx || null);
  // The native window can't take the rgba backgrounds the effect themes use.
  window.api.setBgColor(t.winBg || t.bg);
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
  appEl.classList.toggle('rail-hidden', !!settings.railHidden);
  appEl.classList.toggle('zen-mode', !!settings.zenMode);
  appEl.classList.toggle('tabsize-small', settings.tabSize === 'small');
  appEl.classList.toggle('tabsize-large', settings.tabSize === 'large');
  railToggleBtn.title = settings.railHidden ? 'Show tabs (Ctrl+\\)' : 'Hide tabs (Ctrl+\\)';
  appEl.classList.toggle('pins-off', !settings.pinningEnabled);
  appEl.classList.toggle('close-off', !settings.closeButtonEnabled);
  appEl.classList.toggle('resize-off', !settings.railResizable);
  appEl.classList.toggle('md-img-fullsize', !!settings.mdImageFullSize);
  document.documentElement.style.setProperty(
    '--rail-width', (settings.railWidth || 166) + 'px');

  const barRight = settings.placeholderBarPosition === 'right';
  editorBodyEl.classList.toggle('bar-right', barRight);
  placeholderBarEl.classList.toggle('pos-right', barRight);
  placeholderBarEl.classList.toggle('wrap-stack', !barRight && settings.placeholderBarWrap === 'stack');
  document.documentElement.style.setProperty(
    '--placeholder-width', (settings.placeholderBarWidth || 220) + 'px');
  applyPlaceholderCollapsed();
  applyEditorAlign();
  renderProfileChip();
  applyToolbarButtons();
  renderToolbarLayout();
  applyNewBadges();
  applyHandySettingsVisibility();
  applyLanguage();
}

// ---------- Language / RTL ----------
// The text swap and the layout mirror are independent: Persian with the normal
// left-to-right layout is a valid (and the default) combination.
function applyLanguage() {
  const lang = settings.language || 'en';
  const mirror = lang === 'fa' && !!settings.rtlMirror;
  document.documentElement.dir = mirror ? 'rtl' : 'ltr';
  appEl.classList.toggle('rtl', mirror);
  appEl.classList.toggle('lang-fa', lang === 'fa');
  runI18nPass(lang);
  if (settingsOverlay) settingsOverlay.classList.toggle('help-lang-fa', lang === 'fa');
}

// A pass that rewrites nothing means the DOM has converged — that's what stops
// this from ping-ponging with the MutationObserver below, since every rewrite
// is itself a mutation. Re-laying out the toolbar only matters when something
// changed, because translated labels have different widths.
function runI18nPass(lang) {
  if (!window.PP_I18N) return 0;
  const changed = window.PP_I18N.applyLanguage(lang || settings.language || 'en');
  if (changed) renderToolbarLayout();
  return changed;
}

// The rail, chat transcripts and Discover/Lab cards are all rebuilt by JS after
// the initial translation pass, so re-run it whenever the DOM settles. Cheap
// enough at this app's size, and it means no render path has to remember.
let i18nPassTimer = null;
if (window.PP_I18N) {
  const observer = new MutationObserver(() => {
    if ((settings.language || 'en') === 'en') return;
    if (window.PP_I18N.isApplying()) return;
    clearTimeout(i18nPassTimer);
    i18nPassTimer = setTimeout(() => runI18nPass(), 50);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------- "New" badges on recently-added features ----------
// Clears itself the first time the user actually uses that feature.
function markFeatureSeen(key) {
  if (settings.seenFeatures && settings.seenFeatures[key]) return;
  settings.seenFeatures = { ...settings.seenFeatures, [key]: true };
  saveSettingsNow();
  applyNewBadges();
  renderTabs();
}

function applyNewBadges() {
  const seen = settings.seenFeatures || {};
  improveBtn.classList.toggle('has-new-badge', aiOn() && !seen.improve);
}

// ---------- Toolbar buttons show/hide ----------
const TOOLBAR_BUTTONS = [
  { key: 'todo', label: 'Todo', el: () => todoBtn },
  { key: 'emoji', label: 'Emoji', el: () => emojiBtn },
  { key: 'link', label: 'Link', el: () => linkBtn },
  // key stays 'justify' so saved toolbarOrder / toolbarCollapsed keep working
  { key: 'justify', label: 'Align', el: () => justifyBtn },
  { key: 'clean', label: 'Clean', el: () => cleanBtn },
  { key: 'improve', label: 'Improve Prompt', el: () => improveBtn },
  { key: 'voice', label: 'Voice to Text', el: () => voiceBtn },
  { key: 'md', label: 'Markdown', el: () => mdBtn },
  { key: 'paste', label: 'Paste', el: () => pasteBtn },
  { key: 'copy', label: 'Copy', el: () => copyBtn },
  { key: 'img', label: 'Image', el: () => imgBtn },
  // genImgBtn intentionally omitted — image generation is hidden for now,
  // see index.html; leaving it out of this list keeps it from being
  // re-shown via the Settings → Toolbar buttons chips.
  { key: 'files', label: 'Attach File', el: () => filesBtn }
];

function toolbarPref(key) {
  return !settings.toolbar || settings.toolbar[key] !== false;
}

function applyToolbarButtons() {
  TOOLBAR_BUTTONS.forEach((b) => {
    const el = b.el();
    // The master AI switch wins over the per-button preference, so turning AI
    // back on restores whatever the user had chosen for the Improve chip.
    const on = toolbarPref(b.key) && (b.key !== 'improve' || aiOn());
    if (el) el.classList.toggle('hidden', !on);
  });
}

// ---------- Toolbar drag-to-reorder + overflow chevron (Windows-taskbar style) ----------
// Buttons live in #toolbarMain (visible row) or #toolbarOverflowPanel (behind
// the chevron); settings.toolbarOrder/toolbarCollapsed remember the split and
// per-group order. Show/hide (toolbarPref, above) is a separate concern —
// this only controls *position*, not visibility.
function openToolbarOverflow() {
  toolbarOverflowPanelEl.classList.remove('hidden');
  toolbarOverflowBtnEl.classList.add('active');
}
function closeToolbarOverflow() {
  toolbarOverflowPanelEl.classList.add('hidden');
  toolbarOverflowBtnEl.classList.remove('active');
}

// Icons nudged into the overflow the very first time this ships, purely so
// the chevron/flyout has something in it and gets noticed. Fires once ever
// (settings.toolbarNudged), never re-applied once the user has touched it.
const TOOLBAR_NUDGE_COLLAPSE = ['emoji', 'link', 'justify', 'clean'];

function renderToolbarLayout() {
  const allKeys = TOOLBAR_BUTTONS.map((b) => b.key);
  // Migration-safe: keep any known order, drop stale keys, append new ones
  // (e.g. a future update adding another toolbar button) at the end.
  let order = (settings.toolbarOrder || []).filter((k) => allKeys.includes(k));
  allKeys.forEach((k) => { if (!order.includes(k)) order.push(k); });
  settings.toolbarOrder = order;

  if (!settings.toolbarNudged) {
    settings.toolbarNudged = true;
    settings.toolbarCollapsed = TOOLBAR_NUDGE_COLLAPSE.filter((k) => order.includes(k));
    saveSettingsNow();
  }

  const collapsedSet = new Set((settings.toolbarCollapsed || []).filter((k) => order.includes(k)));
  const mainKeys = order.filter((k) => !collapsedSet.has(k));
  const overflowKeys = order.filter((k) => collapsedSet.has(k));

  mainKeys.forEach((k) => {
    const el = TOOLBAR_BUTTONS.find((b) => b.key === k)?.el();
    if (el) toolbarMainEl.appendChild(el);
  });
  overflowKeys.forEach((k) => {
    const el = TOOLBAR_BUTTONS.find((b) => b.key === k)?.el();
    if (el) toolbarOverflowPanelEl.appendChild(el);
  });

  // Always visible — otherwise there's no way to discover a drag-to-collapse
  // feature whose only affordance only appears after you've already used it.
  toolbarOverflowBtnEl.classList.remove('hidden');
  toolbarOverflowPanelEl.classList.toggle('empty', overflowKeys.length === 0);
}

// Live-move the dragged button to wherever the cursor currently is within a
// drop container, based on the horizontal midpoint of its siblings.
function toolbarDragAfterElement(container, x) {
  const els = [...container.querySelectorAll('.copy-btn:not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = x - box.left - box.width / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function commitToolbarLayoutFromDom() {
  const mainKeys = [...toolbarMainEl.children].map((el) => el.dataset.toolbarKey).filter(Boolean);
  const overflowKeys = [...toolbarOverflowPanelEl.children].map((el) => el.dataset.toolbarKey).filter(Boolean);
  settings.toolbarOrder = [...mainKeys, ...overflowKeys];
  settings.toolbarCollapsed = overflowKeys;
  saveSettingsNow();
  renderToolbarLayout();
}

function initToolbarDragDrop() {
  TOOLBAR_BUTTONS.forEach(({ key, el }) => {
    const btn = el();
    if (!btn) return;
    btn.dataset.toolbarKey = key;
    btn.draggable = true;
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
      btn.classList.add('dragging');
    });
    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
      commitToolbarLayoutFromDom();
    });
  });

  [toolbarMainEl, toolbarOverflowPanelEl].forEach((container) => {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const dragging = document.querySelector('.copy-btn.dragging');
      if (!dragging) return;
      const after = toolbarDragAfterElement(container, e.clientX);
      if (after == null) container.appendChild(dragging);
      else container.insertBefore(dragging, after);
    });
    container.addEventListener('drop', (e) => e.preventDefault());
  });

  // Dropping directly on the (possibly closed) chevron collapses the button.
  toolbarOverflowBtnEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  toolbarOverflowBtnEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.copy-btn.dragging');
    if (dragging) toolbarOverflowPanelEl.appendChild(dragging);
    openToolbarOverflow();
  });

  toolbarOverflowBtnEl.addEventListener('click', () => {
    if (toolbarOverflowPanelEl.classList.contains('hidden')) openToolbarOverflow();
    else closeToolbarOverflow();
  });
  document.addEventListener('click', (e) => {
    if (toolbarOverflowPanelEl.classList.contains('hidden')) return;
    if (toolbarOverflowPanelEl.contains(e.target) || toolbarOverflowBtnEl.contains(e.target)) return;
    closeToolbarOverflow();
  });
}
initToolbarDragDrop(); // one-time listener setup — safe to call before settings load

// Row of clickable chips (one per button) — click toggles that button on/off.
function buildToolbarChips() {
  if (!toolbarRow) return;
  toolbarRow.innerHTML = '';
  TOOLBAR_BUTTONS.forEach((b) => {
    if (b.key === 'improve' && !aiOn()) return; // no chip for a hidden feature
    const chip = document.createElement('button');
    chip.className = 'toolbar-chip' + (toolbarPref(b.key) ? ' active' : '');
    chip.textContent = tr('toolbar.' + b.key, b.label);
    chip.addEventListener('click', () => {
      if (!settings.toolbar) settings.toolbar = {};
      settings.toolbar[b.key] = !toolbarPref(b.key);
      chip.classList.toggle('active', toolbarPref(b.key));
      applyToolbarButtons();
      renderToolbarLayout();
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
      // Checked on cssClass, not type — a couple of the "Pro" themes are light
      // too and need the same subtle outline so a near-white swatch doesn't
      // just disappear against the dark settings panel.
      if (t.cssClass === 'theme-light') sw.style.outline = '1px solid rgba(0,0,0,.14)';
      const dot = document.createElement('span');
      dot.className = 'sw-dot';
      dot.style.background = t.accent;
      sw.appendChild(dot);
      sw.addEventListener('click', () => {
        const prev = THEMES[settings.theme];
        settings.theme = key;
        applySettings();
        buildThemeSwatches();
        saveSettingsNow();
        // Glass is the one theme the renderer can't fully switch on its own —
        // the window's acrylic material is fixed at creation. Offer the
        // restart instead of leaving it looking half-applied.
        const wasGlass = !!(prev && prev.needsRestart);
        const isGlass = !!t.needsRestart;
        if (wasGlass !== isGlass) showRestartBanner();
      });
      row.appendChild(sw);
    });
    grp.appendChild(row);
    themeRow.appendChild(grp);
  };
  const dark = Object.entries(THEMES).filter(([, t]) => t.type === 'dark');
  const light = Object.entries(THEMES).filter(([, t]) => t.type === 'light');
  const pro = Object.entries(THEMES).filter(([, t]) => t.type === 'pro');
  makeGroup('Dark', dark);
  makeGroup('Light', light);
  if (pro.length) makeGroup('Pro', pro);
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
  tabSizeSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tabsize === (settings.tabSize || 'medium'));
  });
  handyPosSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.handypos === (settings.handyPosition || 'center'));
  });
  handyCloseSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.handyclose === (settings.handyCloseMode || 'click'));
  });
  if (handyShortcutInput && !handyShortcutInput.classList.contains('capturing')) {
    handyShortcutInput.value = settings.handyShortcut || DEFAULT_SETTINGS.handyShortcut;
  }
  if (quickCaptureShortcutInput && !quickCaptureShortcutInput.classList.contains('capturing')) {
    quickCaptureShortcutInput.value = settings.quickCaptureShortcut || DEFAULT_SETTINGS.quickCaptureShortcut;
  }
  togglePinEl.checked = settings.pinningEnabled;
  toggleCloseEl.checked = settings.closeButtonEnabled;
  toggleResizeEl.checked = settings.railResizable;
  toggleStartupEl.checked = settings.launchAtStartup;
  toggleAutoUpdateEl.checked = settings.autoCheckUpdates;
  opacityRangeEl.value = settings.windowOpacity || 100;
  opacityValueEl.textContent = (settings.windowOpacity || 100) + '%';
  toggleTrayEl.checked = !!settings.closeToTray;
  toggleFastSaveEl.checked = !!settings.fastSaveEnabled;
  toggleDiscoverEl.checked = !!settings.discoverEnabled;
  // Only offer the Discover toggle when a backend is actually configured.
  if (discoverRowEl) discoverRowEl.style.display = window.DISCOVER_CONFIGURED ? '' : 'none';
  // Shared notes ride on the same backend + account as Discover.
  if (toggleCollabEl) toggleCollabEl.checked = settings.collabEnabled !== false;
  if (collabRowEl) collabRowEl.style.display = window.DISCOVER_CONFIGURED ? '' : 'none';
  if (toggleLabEl) toggleLabEl.checked = settings.promptLabEnabled !== false;
  if (toggleTemplatesEl) toggleTemplatesEl.checked = settings.templatesEnabled !== false;
  if (toggleAiChatEl) toggleAiChatEl.checked = settings.aiChatEnabled !== false;
  if (toggleProfilesEl) toggleProfilesEl.checked = settings.profilesEnabled !== false;
  if (toggleAiEl) toggleAiEl.checked = aiOn();
  if (toggleHandyEl) toggleHandyEl.checked = settings.handyEnabled !== false;
  if (handyDisabledSeg) {
    handyDisabledSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.handydisabled === (settings.handyDisabledAction || 'tray'));
    });
  }
  if (languageSeg) {
    languageSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === (settings.language || 'en'));
    });
  }
  if (toggleRtlMirrorEl) toggleRtlMirrorEl.checked = !!settings.rtlMirror;
  applyAiSettingsVisibility();
  applyHandySettingsVisibility();
  if (rtlMirrorRowEl) rtlMirrorRowEl.classList.toggle('disabled', settings.language !== 'fa');
  toggleQuickCaptureEl.checked = !!settings.quickCaptureEnabled;
  toggleImageResizeEl.checked = !!settings.imageResizable;
  toggleImageDownloadEl.checked = !!settings.imageDownloadEnabled;
  toggleMdImageFullSizeEl.checked = !!settings.mdImageFullSize;
  toggleMdShortcutsEl.checked = !!settings.mdShortcuts;
  geminiApiKeyInputEl.value = (settings.imageGen && settings.imageGen.geminiApiKey) || '';
  hfApiKeyInputEl.value = (settings.imageGen && settings.imageGen.hfApiKey) || '';
  const genProvider = (settings.imageGen && settings.imageGen.provider) || 'pollinations';
  imageGenProviderSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.provider === genProvider);
  });
  geminiProviderFieldsEl.classList.toggle('hidden', genProvider !== 'gemini');
  hfProviderFieldsEl.classList.toggle('hidden', genProvider !== 'huggingface');
  providerHintPollinationsEl.classList.toggle('hidden', genProvider !== 'pollinations');

  voiceHfApiKeyInputEl.value = (settings.voice && settings.voice.hfApiKey) || '';
  aiApiKeyInputEl.value = (settings.ai && settings.ai.openrouterKey) || '';
  togglePlaceholdersEl.checked = settings.placeholdersEnabled;
  resizeRow.classList.remove('disabled');
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

// Small "فارسی / English" chips next to the AI / Speech help text — now just a
// shortcut for the main Language setting.
document.querySelectorAll('.lang-toggle').forEach((btn) => {
  btn.addEventListener('click', () => setLanguage(settings.language === 'fa' ? 'en' : 'fa'));
});

function setLanguage(lang) {
  settings.language = lang === 'fa' ? 'fa' : 'en';
  settings.helpLang = settings.language; // keep the legacy key in step
  applyLanguage();
  syncSettingsUI();
  renderTabs();
  saveSettingsNow();
}

if (languageSeg) languageSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn) setLanguage(btn.dataset.lang);
});

if (toggleRtlMirrorEl) toggleRtlMirrorEl.addEventListener('change', () => {
  settings.rtlMirror = toggleRtlMirrorEl.checked;
  applyLanguage();
  saveSettingsNow();
});
function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

tabSizeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.tabSize = btn.dataset.tabsize;
  applySettings();
  syncSettingsUI();
  saveSettingsNow();
});

handyPosSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.handyPosition = btn.dataset.handypos;
  syncSettingsUI();
  saveSettingsNow();
  if (settings.handyMode) window.api.handySetPosition(settings.handyPosition, handyOpen());
});

handyCloseSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.handyCloseMode = btn.dataset.handyclose;
  syncSettingsUI();
  saveSettingsNow();
});

if (toggleHandyEl) toggleHandyEl.addEventListener('change', () => {
  settings.handyEnabled = toggleHandyEl.checked;
  // Restore the window before the feature goes away, or it stays docked with no
  // way to bring it back.
  if (!settings.handyEnabled && settings.handyMode) setHandyMode(false);
  applyHandySettingsVisibility();
  saveSettingsNow();
});

if (handyDisabledSeg) handyDisabledSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.handyDisabledAction = btn.dataset.handydisabled;
  syncSettingsUI();
  saveSettingsNow();
});

// ---- Handy show/hide shortcut capture ----
// Build an Electron-accelerator string ('Ctrl+Shift+D') from a keydown. We use
// e.code (physical key) for the main key so it's layout-independent, then map
// it to the character Electron's globalShortcut expects.
function accelFromEvent(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  let key = null;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c;
  else if (c === 'Space') key = 'Space';
  else if (c === 'Backslash') key = '\\';
  else if (c === 'Slash') key = '/';
  else if (c === 'Comma') key = ',';
  else if (c === 'Period') key = '.';
  else if (c === 'Minus') key = '-';
  else if (c === 'Equal') key = '=';
  else if (c === 'BracketLeft') key = '[';
  else if (c === 'BracketRight') key = ']';
  if (!key) return null;             // a bare modifier — not a full combo yet
  if (mods.length === 0) return null; // require at least one modifier (avoid stealing plain keys)
  return mods.concat(key).join('+');
}

// Wire a click-to-record shortcut field. `apply(accel)` persists + (re)registers
// the shortcut. `defaultAccel` is used by the Reset button.
function setupShortcutCapture(input, resetBtn, defaultAccel, apply) {
  if (!input) return;
  input.addEventListener('focus', () => {
    input.classList.add('capturing');
    input.value = 'Press a combo…';
  });
  input.addEventListener('blur', () => {
    input.classList.remove('capturing');
    syncSettingsUI(); // restore the shown value if nothing was captured
  });
  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation(); // don't let the combo trigger app-level shortcuts while capturing
    if (e.key === 'Escape') { input.blur(); return; }
    const accel = accelFromEvent(e);
    if (!accel) return; // wait for a full modifier+key combo
    input.value = accel;
    input.classList.remove('capturing');
    apply(accel);
    input.blur();
  });
  if (resetBtn) {
    resetBtn.addEventListener('click', () => { apply(defaultAccel); syncSettingsUI(); });
  }
}

function setHintState(hintEl, warn, okText, warnText) {
  if (!hintEl) return;
  hintEl.classList.toggle('shortcut-warn', warn);
  hintEl.textContent = warn ? warnText : okText;
}

async function applyHandyShortcut(accel) {
  settings.handyShortcut = accel;
  saveSettingsNow();
  try {
    handyGlobalOK = !!(await window.api.setHandyShortcut(accel));
  } catch { handyGlobalOK = false; }
  setHintState(handyShortcutHint, !handyGlobalOK,
    'Global shortcut — toggles the dock even when PromptPad isn’t focused.',
    'That combo is already used by another app — try a different one.');
}

async function applyQuickCaptureShortcut(accel) {
  settings.quickCaptureShortcut = accel;
  saveSettingsNow();
  let ok = false;
  try { ok = !!(await window.api.setQuickCaptureShortcut(accel)); } catch {}
  // ok is false when quick capture is simply turned off — only warn about a
  // genuine clash, i.e. when the feature is enabled but registration failed.
  const clash = settings.quickCaptureEnabled && !ok;
  setHintState(quickCaptureShortcutHint, clash,
    'Global shortcut — opens Fast Save from anywhere.',
    'That combo is already used by another app — try a different one.');
}

setupShortcutCapture(handyShortcutInput, handyShortcutReset, DEFAULT_SETTINGS.handyShortcut, applyHandyShortcut);
setupShortcutCapture(quickCaptureShortcutInput, quickCaptureShortcutReset, DEFAULT_SETTINGS.quickCaptureShortcut, applyQuickCaptureShortcut);

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

toggleDiscoverEl.addEventListener('change', () => {
  settings.discoverEnabled = toggleDiscoverEl.checked;
  if (!settings.discoverEnabled && discoverActive()) {
    const ordered = orderedTabs();
    if (ordered.length) switchTab(ordered[0].id);
    else addTab(false);
  }
  renderTabs();
  saveSettingsNow();
});

// Turning shared notes off drops every live channel but leaves the tabs (and
// their text) alone, so turning it back on just reconnects them.
if (toggleCollabEl) toggleCollabEl.addEventListener('change', () => {
  settings.collabEnabled = toggleCollabEl.checked;
  shRefresh();
  renderTabs();
  saveSettingsNow();
});

if (toggleLabEl) toggleLabEl.addEventListener('change', () => {
  settings.promptLabEnabled = toggleLabEl.checked;
  if (!settings.promptLabEnabled && labActive()) leaveSpecialView();
  renderTabs();
  saveSettingsNow();
});

if (toggleTemplatesEl) toggleTemplatesEl.addEventListener('change', () => {
  settings.templatesEnabled = toggleTemplatesEl.checked;
  if (!settings.templatesEnabled) closeTemplates();
  renderTabs();
  saveSettingsNow();
});

if (toggleAiChatEl) toggleAiChatEl.addEventListener('change', () => {
  settings.aiChatEnabled = toggleAiChatEl.checked;
  if (!settings.aiChatEnabled && aiChatActive()) leaveSpecialView();
  renderTabs();
  saveSettingsNow();
});

// Hides the title-bar switcher only. Nothing is deleted or merged: whichever
// profile is active stays active, the rest keep their tabs, and turning this
// back on hands them straight back.
if (toggleProfilesEl) toggleProfilesEl.addEventListener('change', () => {
  settings.profilesEnabled = toggleProfilesEl.checked;
  if (!settings.profilesEnabled) closeProfileMenu();
  renderProfileChip();
  saveSettingsNow();
});

// Master AI switch — hides Chat, Improve, the AI actions menu, the button on
// markdown code blocks and the API-key field. The stored key is kept so turning
// AI back on doesn't mean pasting it again.
if (toggleAiEl) toggleAiEl.addEventListener('change', () => {
  settings.aiEnabled = toggleAiEl.checked;
  if (!aiOn()) {
    if (aiChatActive()) leaveSpecialView();
    hideTextContextMenu();
    hideAiActionsMenu();
  }
  applyAiSettingsVisibility();
  applyToolbarButtons();
  buildToolbarChips(); // the Improve chip comes and goes with the master switch
  renderToolbarLayout();
  applyNewBadges();
  if (mdOn()) renderMdPreview();
  renderTabs();
  saveSettingsNow();
});

function applyAiSettingsVisibility() {
  const on = aiOn();
  if (aiChatRowEl) aiChatRowEl.classList.toggle('hidden', !on);
  if (aiKeyFieldsEl) aiKeyFieldsEl.classList.toggle('hidden', !on);
}

if (discoverHintCloseEl) {
  discoverHintCloseEl.addEventListener('click', () => {
    settings.discoverHintDismissed = true;
    if (discoverHintEl) discoverHintEl.classList.add('hidden');
    saveSettingsNow();
  });
}

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
  if (!mdOn() && !fsActive()) setEditorText(getEditorText()); // add/remove handles
  saveSettingsNow();
});

toggleImageDownloadEl.addEventListener('change', () => {
  settings.imageDownloadEnabled = toggleImageDownloadEl.checked;
  saveSettingsNow();
});

toggleMdImageFullSizeEl.addEventListener('change', () => {
  settings.mdImageFullSize = toggleMdImageFullSizeEl.checked;
  appEl.classList.toggle('md-img-fullsize', settings.mdImageFullSize);
  saveSettingsNow();
});

toggleMdShortcutsEl.addEventListener('change', () => {
  settings.mdShortcuts = toggleMdShortcutsEl.checked;
  saveSettingsNow();
});

geminiApiKeyInputEl.addEventListener('change', () => {
  settings.imageGen = { ...settings.imageGen, geminiApiKey: geminiApiKeyInputEl.value.trim() };
  saveSettingsNow();
});

hfApiKeyInputEl.addEventListener('change', () => {
  settings.imageGen = { ...settings.imageGen, hfApiKey: hfApiKeyInputEl.value.trim() };
  saveSettingsNow();
});

imageGenProviderSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.imageGen = { ...settings.imageGen, provider: btn.dataset.provider };
  syncSettingsUI();
  saveSettingsNow();
});

voiceHfApiKeyInputEl.addEventListener('change', () => {
  settings.voice = { ...settings.voice, hfApiKey: voiceHfApiKeyInputEl.value.trim() };
  saveSettingsNow();
});

aiApiKeyInputEl.addEventListener('change', () => {
  settings.ai = { ...settings.ai, openrouterKey: aiApiKeyInputEl.value.trim() };
  saveSettingsNow();
  if (aiChatActive()) renderAiMessages(); // reflect the new key in the onboarding/empty state
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
  settings.imageGen = { ...DEFAULT_SETTINGS.imageGen };
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
  if (!settings.railResizable) return;
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
// Markdown is a per-note mode: each tab remembers whether it opens rendered or
// raw, and that choice is saved with the note.
function mdOn() {
  const t = activeTab();
  return !!(t && t.md);
}

function renderMdPreview() {
  const t = activeTab();
  mdPreviewEl.innerHTML = window.renderMarkdown(t ? t.content : '', { ai: aiOn() });
  // Mirror updateLineDirs()'s `forced` rule: a manual per-tab direction wins over
  // per-block auto-detection, exactly as it does in the raw editor. The dir on the
  // container matters too — list bullets and the blockquote bar take their side
  // from the container, not from the li, so without it a forced-RTL note renders
  // right-aligned text with left-hand bullets.
  const forced = t && (t.dir === 'rtl' || t.dir === 'ltr') ? t.dir : null;
  if (forced) mdPreviewEl.setAttribute('dir', forced);
  else mdPreviewEl.removeAttribute('dir');
  // ul/ol/table/dl are in this list for a reason: the list marker and the cell
  // order are laid out by the CONTAINER's direction, not the item's. Without a
  // dir here an auto-detected Persian list inherited ltr from <html> and drew
  // its numbers on the left of right-aligned text — the "1. / 2. breaks in
  // markdown mode" bug.
  const SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, ul, ol, dl, dt, dd, table, th, td';
  mdPreviewEl.querySelectorAll(SEL).forEach((el) => {
    el.setAttribute('dir', forced || detectDir(el.textContent));
  });
}

function setMdPreview(on) {
  const t = activeTab();
  if (!t) return;
  commitMdBlockEdit();
  if (on) {
    syncEditorToState(); // runs before t.md flips, so the flush still happens
    t.md = true;
    renderMdPreview();
  } else {
    t.md = false;
    // Pick up anything edited from the preview side while it was hidden.
    setEditorText(t.content);
  }
  applyMdView();
  if (!on) editorEl.focus();
  scheduleSave();
}

// Push the active tab's stored md flag onto the DOM. Called on tab switch and
// at boot, so the preview/editor panes always match the note you're looking at.
function applyMdView() {
  const on = mdOn();
  editorEl.classList.toggle('hidden', on);
  mdPreviewEl.classList.toggle('hidden', !on);
  mdBtn.classList.toggle('active', on);
  // Buttons that edit the raw text bail out in preview mode; dim them so the
  // click isn't a silent no-op (Link and Todo especially looked broken).
  appEl.classList.toggle('md-mode', on);
}

mdBtn.addEventListener('click', () => setMdPreview(!mdOn()));

// ---------- Editing inside the markdown preview ----------
// Double-clicking a rendered block swaps it for a textarea holding that block's
// raw markdown; committing splices the lines back into the note.
let mdEditEl = null;   // the live textarea, if any

function mdAutoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function commitMdBlockEdit(cancel) {
  const ta = mdEditEl;
  if (!ta) return;
  mdEditEl = null;
  const t = activeTab();
  if (cancel || !t || t.id !== ta.dataset.tabId) { renderMdPreview(); return; }
  const start = Number(ta.dataset.line);
  const end = Number(ta.dataset.endLine);
  const prev = t.content;
  const lines = prev.split('\n');
  // The note may have changed underneath us (AI action, another window) — bail
  // rather than splice over the wrong lines.
  if (!(end < lines.length) || ta.value === ta.dataset.original) { renderMdPreview(); return; }
  lines.splice(start, end - start + 1, ...ta.value.split('\n'));
  t.content = lines.join('\n');
  noteEditForUndo(t, prev);
  setEditorText(t.content); // keep the hidden editor in step with the note
  renderMdPreview();
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
}

function beginMdBlockEdit(el) {
  const t = activeTab();
  if (!t || el.dataset.line === undefined) return;
  commitMdBlockEdit();
  const start = Number(el.dataset.line);
  const end = Number(el.dataset.endLine === undefined ? el.dataset.line : el.dataset.endLine);
  const lines = t.content.split('\n');
  if (!(end < lines.length)) return;
  const src = lines.slice(start, end + 1).join('\n');

  const ta = document.createElement('textarea');
  ta.className = 'md-block-edit';
  ta.value = src;
  ta.dataset.original = src;
  ta.dataset.line = String(start);
  ta.dataset.endLine = String(end);
  ta.dataset.tabId = t.id;
  ta.setAttribute('dir', detectDir(src));
  ta.spellcheck = false;
  el.replaceWith(ta);
  mdEditEl = ta;
  mdAutoGrow(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  ta.addEventListener('input', () => {
    ta.setAttribute('dir', detectDir(ta.value));
    mdAutoGrow(ta);
  });
  ta.addEventListener('blur', () => commitMdBlockEdit());
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation(); // don't let editor/global shortcuts see these keys
    if (e.key === 'Escape') { e.preventDefault(); commitMdBlockEdit(true); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitMdBlockEdit(); }
  });
}

mdPreviewEl.addEventListener('dblclick', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.md-block-edit')) return;
  // these already have their own click behaviour
  if (target.closest('.md-code-copy, .md-code-improve, .md-code-genimg, .md-img, .md-link, .md-todo-box')) return;
  const block = target.closest('[data-line]');
  if (!block || !mdPreviewEl.contains(block)) return;
  e.preventDefault();
  beginMdBlockEdit(block);
});

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
// The tab is created on dir 'auto', not 'ltr': that way every line picks its
// own side, so the English half stays left-aligned and the Persian half
// right-aligned instead of both being flattened to one direction.
const WHATS_NEW =
  "What's new in v" + CURRENT_VERSION + " ✨\n" +
  '\n' +
  '• Markdown got a lot bigger. Tables, ==highlight==, ~~strikethrough~~,\n' +
  '   sub~script~ and super^script^, footnotes, definition lists, nested lists,\n' +
  '   headings down to h6, backslash escapes and automatic links all render now.\n' +
  '• Right-click inside the editor → "Markdown Commands". Select some text,\n' +
  '   pick Heading 2, Blockquote, Highlight, Table — it writes the markdown for\n' +
  '   you, across every line you selected. Optional keyboard shortcuts for the\n' +
  '   same commands can be switched on in Settings (they are off by default).\n' +
  '• Fixed: writing "1." or "2." on a Persian line and switching to markdown\n' +
  '   scrambled the text. Numbers and bullets now stay on the correct side of\n' +
  // No Persian glyph on an English line: each line picks its own direction
  // from its own text, so one Persian digit here would flip the whole line.
  '   the line, in the editor and in the preview, and Persian-Indic digits are\n' +
  '   recognised as a numbered list too. Enter continues a list and\n' +
  '   auto-increments the number.\n' +
  '• Export now takes your images with it. "Export as file…" asks for a\n' +
  '   format: Markdown with an images folder beside it, a single self-contained\n' +
  '   Markdown file, plain text, a web page, a PDF, a PNG — or straight to the\n' +
  '   clipboard as an image.\n' +
  '• Fixed: exports stopped at the fold. The exported web page scrolls, a PDF\n' +
  '   runs over as many pages as the note needs, and a PNG is the whole note\n' +
  '   rather than the first screen of it. Code blocks and tables wrap into the\n' +
  '   page as well, so nothing stays hidden behind a scrollbar that a printed\n' +
  '   page or an image does not have.\n' +
  '• PromptPad is free and written by one person. If it has earned a place in\n' +
  '   your day, there is now a "Support PromptPad" link in Settings → About.\n' +
  '\n' +
  'You can close this tab — it won\'t come back until the next update.\n' +
  '\n' +
  '\n' +
  'تازه‌ها در نسخه ' + CURRENT_VERSION + ' ✨\n' +
  '\n' +
  '• مارک‌داون خیلی کامل‌تر شد. جدول، ==هایلایت==، ~~خط‌خورده~~،\n' +
  '   زیرنویس و بالانویس، پاورقی، لیست تعریف، لیست تودرتو،\n' +
  '   عنوان تا h6، کاراکتر فرار با \\ و لینک خودکار همه رندر می‌شن.\n' +
  '• داخل ویرایشگر راست‌کلیک کن ← «Markdown Commands». یک متن را\n' +
  '   انتخاب کن و Heading 2 یا Blockquote یا Highlight یا Table را بزن —\n' +
  '   خودش مارک‌داونش را می‌نویسد، روی همه‌ی خط‌هایی که انتخاب\n' +
  '   کردی. کلیدهای ترکیبی همین دستورها در تنظیمات قابل فعال‌شدنه\n' +
  '   (پیش‌فرض خاموشن).\n' +
  '• رفع ایراد: نوشتن «۱.» یا «2.» روی یک خط فارسی و رفتن به حالت\n' +
  '   مارک‌داون، متن را به‌هم می‌ریخت. حالا شماره‌ها و نقطه‌ها هم در\n' +
  '   ویرایشگر و هم در پیش‌نمایش سمت درست خط می‌مانند، و ارقام\n' +
  '   فارسی مثل «۱.» هم لیست شماره‌دار حساب می‌شوند. Enter لیست را\n' +
  '   ادامه می‌دهد و شماره را خودکار جلو می‌برد.\n' +
  '• خروجی حالا عکس‌هایت را هم با خودش می‌برد. «Export as file…» اول\n' +
  '   فرمت را می‌پرسد: مارک‌داون به همراه پوشه‌ی عکس‌ها، یک فایل\n' +
  '   مارک‌داون یکپارچه، متن ساده، صفحه‌ی وب، PDF، PNG — یا مستقیم\n' +
  '   کپی به کلیپ‌بورد به‌صورت عکس.\n' +
  '• رفع ایراد: خروجی‌ها از وسط بریده می‌شدند. حالا صفحه‌ی وب اسکرول\n' +
  '   می‌شود، پی‌دی‌اف به هر تعداد صفحه‌ای که نوت لازم دارد ادامه پیدا\n' +
  '   می‌کند، و عکس خروجی تمام نوت است نه فقط بخش قابل دیدن. بلوک‌های\n' +
  '   کد و جدول‌ها هم داخل صفحه می‌پیچند، پس چیزی پشت اسکرولی که در\n' +
  '   عکس و پی‌دی‌اف وجود ندارد پنهان نمی‌ماند.\n' +
  '• پرامپت‌پد رایگان است و یک نفر آن را می‌نویسد. اگر جایی در روزت باز\n' +
  '   کرده، حالا در تنظیمات ← درباره یک گزینه‌ی حمایت اضافه شده.\n' +
  '\n' +
  'این تب را می‌توانی ببندی — تا آپدیت بعدی دیگر برنمی‌گردد.';

// Only ever called from init(). The version marker lives in settings (global)
// rather than in the workspace, so creating a profile doesn't re-trigger it.
function maybeShowWhatsNew(hadSaved) {
  if (settings.lastVersion === CURRENT_VERSION) return;
  settings.lastVersion = CURRENT_VERSION;
  saveSettingsNow();
  // fresh installs just record the version; updates get the tab
  if (hadSaved) {
    const tab = {
      id: uid(), name: "What's new ✨", custom: true,
      content: WHATS_NEW, dir: 'auto', align: 'auto', color: null
    };
    state.tabs.push(tab);
    state.activeId = tab.id;
    setEditorText(tab.content);
    renderTabs();
    updateCounts();
    updatePlaceholderPanel();
    applyEditorAlign();
  }
  scheduleSave();
}

function showUpdateBanner(tag, url) {
  updateBannerTextEl.textContent = 'New version available: v' + tag.replace('v', '');
  updateBannerLinkEl.textContent = 'Download';
  updateBannerLinkEl.classList.remove('hidden');
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
  // Dismissing counts as having seen it — otherwise the announcement returns
  // on every launch until it's clicked, which is what makes a banner nagging.
  markFeatureSeen('proThemes');
});

// ---- In-app auto-update (electron-updater) with GitHub-API notify fallback ----
let updaterActive = false; // an update was reported by electron-updater

function showUpdaterBanner(text, actionLabel, onAction) {
  updateBannerTextEl.textContent = text;
  if (actionLabel) {
    updateBannerLinkEl.textContent = actionLabel;
    updateBannerLinkEl.classList.remove('hidden');
    updateBannerLinkEl.onclick = onAction;
  } else {
    updateBannerLinkEl.classList.add('hidden');
  }
  updateBannerEl.classList.remove('hidden');
}

// Updates install silently, so a feature that lives entirely inside Settings
// would otherwise never be found. Announce the Pro themes once, with a way
// straight to them, and never mention it again.
function maybeAnnounceProThemes(hadSaved) {
  // A brand-new install isn't "new" to anyone — those users meet the themes
  // as part of the app rather than as a change to it.
  if (!hadSaved) { markFeatureSeen('proThemes'); return; }
  if (settings.seenFeatures && settings.seenFeatures.proThemes) return;
  setTimeout(() => {
    showUpdaterBanner(
      tr('theme.announce', 'New in this update: Pro themes — Glass, Matrix, Old TV, Music and more.'),
      tr('theme.announceCta', 'Take a look'),
      () => {
        markFeatureSeen('proThemes');
        updateBannerEl.classList.add('hidden');
        openSettings();
        // Land them on the themes, not the top of a long settings page.
        setTimeout(() => {
          if (themeRow && themeRow.scrollIntoView) {
            themeRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }, 80);
      }
    );
  }, 1200); // let the window settle before anything slides in
}

// ---------- Support the app ----------
const DONATE_URL = 'https://donofa.ir/raminturne';

function openDonatePage() {
  try { window.api.openExternal(DONATE_URL); } catch (e) { console.error(e); }
}
function hideDonateBanner() { donateBannerEl.classList.add('hidden'); }

// Asked once per new version and never again: an update installs silently, so
// the launch right after it is the only natural moment to ask. Clicking or
// dismissing both close it for good — Settings → About keeps a permanent link
// for whenever the user feels like it.
function maybeShowDonatePrompt(hadSaved) {
  const seen = settings.donateSeenVersion === CURRENT_VERSION;
  // A fresh install has not been given anything yet; just record the version.
  if (!hadSaved || seen) {
    if (!seen) { settings.donateSeenVersion = CURRENT_VERSION; saveSettingsNow(); }
    return;
  }
  settings.donateSeenVersion = CURRENT_VERSION;
  saveSettingsNow();
  setTimeout(() => {
    // the update banner owns the shelf above the status bar; sit above it
    donateBannerEl.classList.toggle('stacked', !updateBannerEl.classList.contains('hidden'));
    donateBannerEl.classList.remove('hidden');
    // If they are not looking at PromptPad, a desktop toast carries the ask
    // instead of it going unseen behind another window.
    if (!document.hasFocus()) {
      Promise.resolve(window.api.notify({
        title: 'PromptPad v' + CURRENT_VERSION,
        body: tr('donate.notify', 'Updated. If PromptPad is useful to you, you can support its development.'),
        kind: 'donate'
      })).catch(() => {});
    }
  }, 2600); // let "What's new" and any update banner settle first
}

donateBannerLinkEl.addEventListener('click', () => { openDonatePage(); hideDonateBanner(); });
donateBannerCloseEl.addEventListener('click', hideDonateBanner);
donateBtn.addEventListener('click', openDonatePage);

// Glass sets the window's acrylic material, which Windows only accepts when
// the window is created — so this one theme change lands on the next launch.
function showRestartBanner() {
  showUpdaterBanner(
    tr('theme.restartGlass', 'Restart PromptPad to finish applying this theme.'),
    tr('theme.restartNow', 'Restart'),
    () => window.api.relaunchApp()
  );
}

if (window.api.onUpdaterEvent) {
  window.api.onUpdaterEvent((p) => {
    if (!p) return;
    if (p.type === 'available') {
      updaterActive = true;
      checkUpdateBtn.classList.add('update-available');
      checkUpdateLabel.textContent = 'Update available: v' + (p.version || '');
      showUpdaterBanner('Update available: v' + (p.version || ''), 'Download', async () => {
        showUpdaterBanner('Starting download…', null);
        const r = await window.api.updaterDownload();
        if (r && !r.ok) showUpdaterBanner('Download failed — try again later.', null);
      });
    } else if (p.type === 'progress') {
      showUpdaterBanner('Downloading update… ' + (p.percent || 0) + '%', null);
    } else if (p.type === 'downloaded') {
      showUpdaterBanner('Update v' + (p.version || '') + ' ready to install.', 'Restart & install', () => window.api.updaterInstall());
    } else if (p.type === 'none') {
      if (!updaterActive) { checkUpdateLabel.textContent = 'You\'re up to date ✓'; setTimeout(() => { checkUpdateLabel.textContent = 'Check for updates'; }, 3000); }
    } else if (p.type === 'error') {
      // Silent for the user, but leave the reason somewhere findable — this is
      // how the unsigned-build verification failure went unnoticed until 2.7.0.
      console.error('auto-update failed:', p.message);
      runUpdateCheck(true); // fall back to the notify flow
    }
  });
}

// Prefer electron-updater; fall back to the GitHub-API notify flow when it isn't
// supported (dev build, macOS unsigned, or module missing).
async function checkForUpdates(silent) {
  try {
    const res = await window.api.updaterCheck();
    if (res && res.ok) return; // updater events drive the UI
  } catch {}
  await runUpdateCheck(silent);
}

checkUpdateBtn.addEventListener('click', async () => {
  if (checkUpdateBtn.classList.contains('checking')) return;
  checkUpdateBtn.classList.add('checking');
  checkUpdateLabel.textContent = 'Checking…';
  await checkForUpdates(false);
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
    align: 'auto',
    color: null
  };
  state.tabs.push(tab);
  state.activeId = tab.id;
  showEditorView();
  setEditorText(tab.content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  applyEditorAlign();
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
  if (discoverActive()) return; // Discover has its own drop zone; don't hijack the drop
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
  if (discoverActive()) return; // let the Discover upload drop zone handle its own drops
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  e.preventDefault();

  // Saving each file is async, so a profile switch can land mid-loop; the epoch
  // fence stops the rest of the drop creating tabs in the wrong workspace.
  const epoch = profileEpoch;
  for (const f of Array.from(files)) {
    if (IMG_EXT_BY_MIME[f.type]) {
      const res = await saveImageBlob(f);
      if (epoch !== profileEpoch) return;
      if (res && res.filename) {
        ensureEditorTab();
        insertImageToken(res.filename);
      }
    } else if (/\.(txt|md|markdown)$/i.test(f.name)) {
      if (f.size > 2 * 1024 * 1024) continue; // 2 MB cap
      try {
        const text = await f.text();
        if (epoch !== profileEpoch) return;
        createTabFromFile(f.name.replace(/\.[^.]+$/, ''), text);
      } catch (err) {
        console.error('reading dropped file failed', err);
      }
    }
  }
});

// ========================================================================
// Discover — a shared, server-backed prompt gallery (Supabase: auth + DB +
// Storage). Everything lives in this section; integration points elsewhere are
// DISCOVER_ID, showDiscoverView(), switchToDiscover(), the #discoverBtn rail button.
// ========================================================================
let dcClient = null;
let dcSession = null;
let dcProfile = null;             // { id, username, is_admin }
let dcScreen = 'browse';          // 'browse' | 'upload' | 'admin'
let dcCategories = [];
let dcFilter = 'all';
let dcSearch = '';
let dcSort = 'new';               // 'new' (recent) | 'top' (most liked)
let dcMine = false;               // "My posts" filter (own submissions, any status)
let dcAuthMode = 'login';         // 'login' | 'register'
let dcPrefillPrompt = '';         // text handed off from "Share to Discover" to prefill Upload
let dcCurrentAudio = null;        // the one audio element allowed to play at a time
const DC_BUCKET = (window.DISCOVER_CONFIG && window.DISCOVER_CONFIG.IMAGE_BUCKET) || 'discover-images';
const DC_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GB Supabase free storage
const DC_MAX_AUDIO_BYTES = 8 * 1024 * 1024;      // final cap after compression
const DC_MAX_AUDIO_RAW_BYTES = 60 * 1024 * 1024; // raw upload cap (before compression)
const DC_AUDIO_KBPS = 96;                        // MP3 bitrate we re-encode music to
const DC_CATEGORY_SLUGS = ['website', 'image', 'music', 'video', 'software', 'game', 'other'];
let dcLikedPosts = new Set(); // post ids the current user has liked (for the visible feed)

// A bundled placeholder image per category, used when a post has no uploaded image.
function dcDefaultImage(category) {
  const slug = DC_CATEGORY_SLUGS.includes(category) ? category : 'other';
  return 'category-images/' + slug + '.jpg';
}

// ---- content filter (block +18 / profanity, English + Persian) ----
// Token-based: we split into words and match whole tokens (exact set) plus a
// few safe prefixes (stems). This avoids false positives from substrings — e.g.
// the Persian word «عکس» (photo) must NOT trip on «کس». Deliberately editable.
const DC_BAD_STEMS = [
  'fuck', 'fuk', 'shit', 'bitch', 'porn', 'pussy', 'masturbat', 'blowjob',
  'handjob', 'whore', 'cunt', 'nigger', 'faggot', 'hentai', 'dildo', 'orgasm',
  'pedophil', 'sex'
];
const DC_BAD_SET = new Set([
  // English exact
  'ass', 'asshole', 'bastard', 'dick', 'anal', 'cum', 'nude', 'nudes', 'nsfw',
  'xxx', 'boobs', 'slut', 'incest', 'rape', 'raped', 'raping',
  // Finglish (Persian in Latin)
  'kir', 'kos', 'koss', 'koon', 'kon', 'koni', 'kony', 'kuni', 'jende', 'jakesh',
  'koskesh', 'kire', 'kiram',
  // Persian script
  'کیر', 'کص', 'کس', 'کون', 'کونی', 'جنده', 'جاکش', 'کسکش', 'کسخل', 'گاییدن',
  'گایید', 'گاییدم', 'سکس', 'پورن', 'برهنه', 'لخت', 'اورگاسم', 'کوس', 'کوص', 'ساکزدن'
]);
function dcContentFlag(text) {
  const tokens = (text || '').toLowerCase()
    .split(/[\s.,،!؟?:;/\\()\[\]{}"'«»\-_+=*#@~\n\r\t]+/)
    .filter(Boolean);
  for (const tok of tokens) {
    if (DC_BAD_SET.has(tok)) return tok;
    if (DC_BAD_STEMS.some((s) => tok.startsWith(s))) return tok;
  }
  return null;
}

async function dcInit() {
  if (!window.DISCOVER_CONFIGURED || !window.supabase) return;
  try {
    dcClient = window.supabase.createClient(
      window.DISCOVER_CONFIG.SUPABASE_URL,
      window.DISCOVER_CONFIG.SUPABASE_ANON_KEY,
      { auth: { persistSession: true, autoRefreshToken: true } }
    );
  } catch (e) { console.error('Discover: client init failed', e); dcClient = null; return; }

  try {
    const { data } = await dcClient.auth.getSession();
    dcSession = (data && data.session) || null;
    if (dcSession) await dcLoadProfile();
    await dcLoadCategories();
  } catch (e) { console.error('Discover: session/categories load failed', e); }

  dcClient.auth.onAuthStateChange((_event, session) => {
    const prevUid = dcSession && dcSession.user && dcSession.user.id;
    const nextUid = session && session.user && session.user.id;
    dcSession = session || null;
    // A token refresh (fires when the app regains focus) keeps the same user —
    // don't re-render the whole view, that caused the "weird refresh" flicker.
    if (prevUid === nextUid) return;
    if (dcSession) {
      dcLoadProfile().then(() => {
        if (discoverActive()) dcRender();
        shRefresh(); // shared notes need the profile (username) as well as the session
        dcSyncAdminNotify();
      });
    } else {
      dcProfile = null;
      if (discoverActive()) dcRender();
      shRefresh();
      dcSyncAdminNotify();
    }
  });
}

async function dcLoadProfile() {
  if (!dcSession) { dcProfile = null; return; }
  try {
    const { data } = await dcClient
      .from('profiles').select('id,username,is_admin').eq('id', dcSession.user.id).single();
    dcProfile = data || null;
  } catch { dcProfile = null; }
}

async function dcLoadCategories() {
  try {
    const { data } = await dcClient.from('categories').select('*').order('sort');
    dcCategories = data || [];
  } catch { dcCategories = []; }
}

async function dcLogout() {
  try { await dcClient.auth.signOut(); } catch {}
  dcProfile = null;
  dcScreen = 'browse';
  dcRender();
  shRefresh(); // drop the live channels and the invitations bell with the session
  dcSyncAdminNotify();
}

// ---- admin: get told the moment a new post lands ----
// An admin's app listens for every INSERT on posts (RLS already limits that
// stream to admins, per the note in schema.sql section 8) and raises an
// in-app toast plus, if PromptPad isn't the focused window, a desktop
// notification — the same "in-app is enough when you're looking, a toast is
// for when you're not" split used for shared-note invites.
let dcAdminChan = null;
let dcPendingCount = 0;

async function dcOnPostArrived(row) {
  if (!row) return;
  let username = '';
  try {
    const { data } = await dcClient.from('profiles').select('username').eq('id', row.user_id).maybeSingle();
    username = (data && data.username) || '';
  } catch {}
  const who = username ? '@' + username : tr('admin.someone', 'Someone');
  showToast(tr('admin.newPost', 'New post from') + ' ' + who, row.title || '');
  // A new post is always inserted pending (enforce_post_rules forces it), so
  // the badge can just increment locally instead of a round trip.
  dcPendingCount += 1;
  dcUpdatePendingBadge();
  if (discoverActive() && dcScreen === 'admin') dcRenderAdmin(); // queue is on screen — refresh it
  if (document.hasFocus()) return;
  try {
    await window.api.notify({
      kind: 'admin-post',
      title: tr('admin.notifTitle', 'PromptPad — new post to review'),
      body: who + ' ' + tr('admin.notifBody', 'shared a prompt, pending your approval:') + ' “' + (row.title || '') + '”'
    });
  } catch (err) {
    console.error('notify failed', err);
  }
}

function dcSubscribeAdminPosts() {
  if (!dcClient || !dcSession || !dcProfile || !dcProfile.is_admin || dcAdminChan) return;
  dcAdminChan = dcClient.channel('ppadminposts:' + dcProfile.id);
  dcAdminChan.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'posts' },
    ({ new: row }) => dcOnPostArrived(row));
  dcAdminChan.subscribe();
}

function dcUnsubscribeAdminPosts() {
  if (!dcAdminChan) return;
  try { dcClient.removeChannel(dcAdminChan); } catch {}
  dcAdminChan = null;
}

// ---- persistent "pending approval" badge (title bar) ----
// A toast or a desktop notification is only seen if you happen to catch it —
// this is the "did I miss one?" answer that stays lit until the queue is
// actually empty, regardless of when you look.
function dcUpdatePendingBadge() {
  if (!dcAdminPostsBtn) return;
  const on = !!(dcProfile && dcProfile.is_admin);
  dcAdminPostsBtn.classList.toggle('hidden', !on);
  dcAdminPostsBadge.classList.toggle('hidden', !on || dcPendingCount <= 0);
  dcAdminPostsBadge.textContent = dcPendingCount > 9 ? '9+' : String(dcPendingCount);
}

// A real requery rather than local bookkeeping — moderation actions (approve/
// reject/delete) happen from several places, and re-asking the database is
// simpler than trying to keep a running count in sync with all of them.
async function dcRefreshPendingBadge() {
  if (!dcClient || !dcProfile || !dcProfile.is_admin) { dcPendingCount = 0; dcUpdatePendingBadge(); return; }
  try {
    const { count, error } = await dcClient
      .from('posts').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (error) throw error;
    dcPendingCount = count || 0;
  } catch (err) {
    console.error('pending count failed', err);
  }
  dcUpdatePendingBadge();
}

function dcOpenAdminFromBadge() {
  if (!dcProfile || !dcProfile.is_admin) return;
  dcScreen = 'admin';
  if (discoverActive()) dcRender();
  else switchToDiscover(); // switchToDiscover() no-ops (and skips the render) if already active
}

// Called everywhere the session/profile changes (alongside shRefresh —
// admin status is only known once dcLoadProfile has resolved).
function dcSyncAdminNotify() {
  if (dcProfile && dcProfile.is_admin) dcSubscribeAdminPosts();
  else dcUnsubscribeAdminPosts();
  dcRefreshPendingBadge();
}

if (dcAdminPostsBtn) dcAdminPostsBtn.addEventListener('click', dcOpenAdminFromBadge);

// Send selected text (from the right-click menu anywhere in the app) to the
// Discover Upload form as a ready-to-share prompt.
function shareTextToDiscover(text) {
  if (!window.DISCOVER_CONFIGURED || !dcClient) return;
  dcPrefillPrompt = (text || '').trim();
  dcScreen = 'upload';
  if (discoverActive()) dcRender();  // switchToDiscover no-ops if already active
  else switchToDiscover();
}

// ---- small DOM helpers ----
function dcEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function dcStatus(msg, kind) {
  const el = dcEl('div', 'dc-status' + (kind ? ' dc-' + kind : ''), msg);
  return el;
}

// ---- top-level render dispatch ----
function dcRender() {
  if (!discoverBodyEl) return;
  if (discoverHintEl) discoverHintEl.classList.toggle('hidden', !!settings.discoverHintDismissed);
  if (!window.DISCOVER_CONFIGURED || !dcClient) { dcRenderNotice(); return; }
  dcRenderNav();
  if (!dcSession) { dcRenderAuth(); return; }
  if (dcScreen === 'upload') dcRenderUpload();
  else if (dcScreen === 'admin' && dcProfile && dcProfile.is_admin) dcRenderAdmin();
  else dcRenderBrowse();
}

function dcRenderNotice() {
  discoverNavEl.innerHTML = '';
  discoverBodyEl.innerHTML = '';
  const box = dcEl('div', 'dc-empty');
  box.appendChild(dcEl('div', 'dc-empty-title', 'Discover isn’t set up yet'));
  box.appendChild(dcEl('div', 'dc-empty-sub',
    'Add your Supabase URL and key in src/discover-config.js (see discover-setup/DISCOVER-SETUP.md).'));
  discoverBodyEl.appendChild(box);
}

function dcRenderNav() {
  discoverNavEl.innerHTML = '';
  if (!dcSession) return;
  const nav = (label, screen) => {
    const b = dcEl('button', 'dc-nav' + (dcScreen === screen ? ' active' : ''), label);
    b.addEventListener('click', () => { dcScreen = screen; dcRender(); });
    return b;
  };
  discoverNavEl.appendChild(nav('Browse', 'browse'));
  discoverNavEl.appendChild(nav('Upload', 'upload'));
  if (dcProfile && dcProfile.is_admin) discoverNavEl.appendChild(nav('Admin', 'admin'));
  discoverNavEl.appendChild(dcEl('span', 'dc-account', '@' + ((dcProfile && dcProfile.username) || '…')));
  const out = dcEl('button', 'dc-nav dc-logout', 'Logout');
  out.addEventListener('click', dcLogout);
  discoverNavEl.appendChild(out);
}

// ---- auth screen ----
function dcRenderAuth() {
  discoverBodyEl.innerHTML = '';
  const wrap = dcEl('div', 'dc-auth');
  const tabs = dcEl('div', 'dc-auth-tabs');
  const loginTab = dcEl('button', 'dc-auth-tab' + (dcAuthMode === 'login' ? ' active' : ''), 'Sign in');
  const regTab = dcEl('button', 'dc-auth-tab' + (dcAuthMode === 'register' ? ' active' : ''), 'Register');
  loginTab.addEventListener('click', () => { dcAuthMode = 'login'; dcRenderAuth(); });
  regTab.addEventListener('click', () => { dcAuthMode = 'register'; dcRenderAuth(); });
  tabs.appendChild(loginTab); tabs.appendChild(regTab);
  wrap.appendChild(tabs);

  const form = dcEl('form', 'dc-form');
  let userInput;
  if (dcAuthMode === 'register') {
    userInput = dcEl('input', 'text-input');
    userInput.placeholder = 'Username'; userInput.autocomplete = 'off';
    form.appendChild(userInput);
  }
  const emailInput = dcEl('input', 'text-input');
  emailInput.type = 'email'; emailInput.placeholder = 'Email'; emailInput.autocomplete = 'off';
  const passInput = dcEl('input', 'text-input');
  passInput.type = 'password'; passInput.placeholder = 'Password (min 6 chars)'; passInput.autocomplete = 'off';
  form.appendChild(emailInput); form.appendChild(passInput);

  const submit = dcEl('button', 'dc-primary-btn', dcAuthMode === 'login' ? 'Sign in' : 'Create account');
  submit.type = 'submit';
  form.appendChild(submit);
  const status = dcEl('div', 'dc-form-status');
  form.appendChild(status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'dc-form-status';
    status.textContent = '';
    const email = emailInput.value.trim();
    const pass = passInput.value;
    if (!email || pass.length < 6) { status.textContent = 'Enter an email and a 6+ char password.'; return; }
    submit.disabled = true;
    submit.textContent = 'Please wait…';
    try {
      if (dcAuthMode === 'register') {
        const username = (userInput.value || '').trim() || email.split('@')[0];
        const { data, error } = await dcClient.auth.signUp({
          email, password: pass, options: { data: { username } }
        });
        if (error) throw error;
        if (!data.session) {
          status.classList.add('ok');
          status.textContent = 'Account created — check your email to confirm, then sign in.';
          dcAuthMode = 'login';
          submit.disabled = false;
          return;
        }
      } else {
        const { error } = await dcClient.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      }
      // onAuthStateChange will refresh; also refresh profile now
      const { data } = await dcClient.auth.getSession();
      dcSession = data && data.session;
      await dcLoadProfile();
      // land on Upload if we arrived here via "Share to Discover", else Browse
      dcScreen = dcPrefillPrompt ? 'upload' : 'browse';
      dcRender();
      shRefresh();
      dcSyncAdminNotify();
    } catch (err) {
      status.classList.add('err');
      status.textContent = (err && err.message) || 'Something went wrong.';
      submit.disabled = false;
      submit.textContent = dcAuthMode === 'login' ? 'Sign in' : 'Create account';
    }
  });

  wrap.appendChild(form);
  discoverBodyEl.appendChild(wrap);
}

// ---- browse screen ----
function dcCatLabel(slug) {
  const c = dcCategories.find((x) => x.slug === slug);
  return c ? c.label : (slug || '');
}

// Server-side caps (see enforce_post_rules in schema.sql) block this going
// forward, but a row inserted before that existed — or written straight from
// the SQL editor — can still carry an oversized title/prompt. Setting a
// megabyte of text as textContent lays out fine on its own, but combined with
// -webkit-line-clamp and a scrollable modal pane it's slow enough to feel like
// the whole tab hung. Clamp what's ever displayed, independent of storage.
// A little above the Upload form's own limits (DC_TITLE_MAX / DC_PROMPT_MAX
// below), so a legitimate post from before those existed isn't chopped, while
// staying nowhere near large enough to be the layout-freezing wall of text
// that got this whole thing added.
const DC_TITLE_DISPLAY_MAX = 300;
const DC_PROMPT_DISPLAY_MAX = 6000;
const DC_CARD_PROMPT_MAX = 600; // the card only ever shows ~4 clamped lines
function dcClamp(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function dcStatusLabel(status) {
  if (status === 'pending') return tr('status.pending', 'pending review');
  if (status === 'rejected') return tr('status.rejected', 'rejected');
  return status;
}

async function dcRenderBrowse() {
  discoverBodyEl.innerHTML = '';

  // Controls: search + category chips
  const controls = dcEl('div', 'dc-controls');
  const search = dcEl('input', 'text-input dc-search');
  search.placeholder = 'Search prompts…';
  search.value = dcSearch;
  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { dcSearch = search.value.trim(); dcLoadAndRenderFeed(feed); }, 250);
  });
  controls.appendChild(search);

  const chips = dcEl('div', 'dc-chips');
  const mkChip = (slug, label) => {
    const c = dcEl('button', 'dc-chip' + (dcFilter === slug ? ' active' : ''), label);
    c.addEventListener('click', () => { dcFilter = slug; dcRenderBrowse(); });
    return c;
  };
  chips.appendChild(mkChip('all', 'All'));
  dcCategories.forEach((c) => chips.appendChild(mkChip(c.slug, c.label)));

  // "My posts" toggle chip (only when signed in).
  if (dcProfile) {
    const mine = dcEl('button', 'dc-chip dc-chip-mine' + (dcMine ? ' active' : ''), 'My posts');
    mine.addEventListener('click', () => { dcMine = !dcMine; dcRenderBrowse(); });
    chips.appendChild(mine);
  }

  // New / Top sort toggle, sits at the end of the chip row.
  const sort = dcEl('div', 'dc-sort');
  const mkSort = (key, label) => {
    const b = dcEl('button', 'dc-sort-btn' + (dcSort === key ? ' active' : ''), label);
    b.addEventListener('click', () => { if (dcSort !== key) { dcSort = key; dcRenderBrowse(); } });
    return b;
  };
  sort.appendChild(mkSort('new', 'New'));
  sort.appendChild(mkSort('top', 'Top'));
  chips.appendChild(sort);

  controls.appendChild(chips);
  discoverBodyEl.appendChild(controls);

  const feed = dcEl('div', 'dc-feed');
  discoverBodyEl.appendChild(feed);
  dcLoadAndRenderFeed(feed);
}

async function dcLoadAndRenderFeed(feed) {
  feed.innerHTML = '';
  feed.appendChild(dcStatus('Loading…'));
  try {
    let q = dcClient
      .from('posts')
      .select('id,title,prompt,category,image_url,image_key,audio_url,audio_key,like_count,view_count,status,created_at,user_id,profiles!posts_user_id_fkey(username)')
      .limit(60);
    // "My posts" shows your own submissions incl. pending/rejected; otherwise approved only.
    if (dcMine && dcProfile) q = q.eq('user_id', dcProfile.id);
    else q = q.eq('status', 'approved');
    if (dcSort === 'top') q = q.order('like_count', { ascending: false }).order('created_at', { ascending: false });
    else q = q.order('created_at', { ascending: false });
    if (dcFilter !== 'all') q = q.eq('category', dcFilter);
    if (dcSearch) q = q.or(`title.ilike.%${dcSearch}%,prompt.ilike.%${dcSearch}%`);
    const { data, error } = await q;
    if (error) throw error;
    feed.innerHTML = '';
    if (!data || !data.length) {
      feed.appendChild(dcStatus(dcMine ? 'You haven’t shared any prompts yet.' : 'No prompts yet. Be the first to share one from the Upload tab.'));
      return;
    }
    await dcLoadLikes(data.map((p) => p.id));
    // One malformed or oversized post must never take the rest of the feed down
    // with it — render each card in its own try, and skip only that one on error.
    data.forEach((post) => {
      try { feed.appendChild(dcCard(post)); }
      catch (err) { console.error('dcCard failed for post', post && post.id, err); }
    });
  } catch (err) {
    feed.innerHTML = '';
    feed.appendChild(dcStatus((err && err.message) || 'Failed to load.', 'err'));
  }
}

// A compact, themed audio player (the native <audio controls> can't be styled).
function dcAudioPlayer(url) {
  const wrap = dcEl('div', 'dc-player');
  const audio = document.createElement('audio');
  audio.src = url; audio.preload = 'metadata';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" fill="currentColor"/></svg>';
  const play = dcEl('button', 'dc-player-btn'); play.type = 'button'; play.innerHTML = ICON_PLAY;
  const track = dcEl('div', 'dc-player-track');
  const fill = dcEl('div', 'dc-player-fill'); track.appendChild(fill);
  const time = dcEl('span', 'dc-player-time', '0:00');

  const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  play.addEventListener('click', (e) => { e.stopPropagation(); audio.paused ? audio.play() : audio.pause(); });
  audio.addEventListener('play', () => {
    // only one player at a time — pause whatever else is playing
    if (dcCurrentAudio && dcCurrentAudio !== audio) { try { dcCurrentAudio.pause(); } catch {} }
    dcCurrentAudio = audio;
    play.innerHTML = ICON_PAUSE;
  });
  audio.addEventListener('pause', () => { play.innerHTML = ICON_PLAY; });
  audio.addEventListener('ended', () => { play.innerHTML = ICON_PLAY; fill.style.width = '0%'; });
  audio.addEventListener('loadedmetadata', () => { time.textContent = '0:00 / ' + fmt(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
    time.textContent = fmt(audio.currentTime) + (audio.duration ? ' / ' + fmt(audio.duration) : '');
  });
  track.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = track.getBoundingClientRect();
    if (audio.duration) audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
  });
  wrap.appendChild(play); wrap.appendChild(track); wrap.appendChild(time); wrap.appendChild(audio);
  return wrap;
}

function dcCard(post) {
  const card = dcEl('div', 'dc-card');
  const imgUrl = post.image_url || dcDefaultImage(post.category);
  const im = dcEl('img', 'dc-card-img' + (post.image_url ? '' : ' is-default'));
  im.loading = 'lazy'; im.src = imgUrl; im.alt = '';
  im.addEventListener('click', () => dcOpenPost(post));
  card.appendChild(im);

  const body = dcEl('div', 'dc-card-body');
  const top = dcEl('div', 'dc-card-top');
  const titleEl = dcEl('div', 'dc-card-title', dcClamp(post.title, DC_TITLE_DISPLAY_MAX) || tr('card.untitled', 'Untitled'));
  titleEl.addEventListener('click', () => dcOpenPost(post));
  top.appendChild(titleEl);
  if (post.category) top.appendChild(dcEl('span', 'dc-card-cat', dcCatLabel(post.category)));
  body.appendChild(top);

  if (post.audio_url) body.appendChild(dcAudioPlayer(post.audio_url));

  const pr = dcEl('div', 'dc-card-prompt', dcClamp(post.prompt, DC_CARD_PROMPT_MAX));
  pr.addEventListener('click', () => dcOpenPost(post));
  body.appendChild(pr);

  const foot = dcEl('div', 'dc-card-foot');
  const footRow = dcEl('div', 'dc-card-footrow');
  const left = dcEl('div', 'dc-card-metaleft');
  const author = (post.profiles && post.profiles.username) ? '@' + post.profiles.username : 'anonymous';
  left.appendChild(dcEl('span', 'dc-card-author', author));
  if (post.view_count) left.appendChild(dcEl('span', 'dc-card-views', '👁 ' + post.view_count));
  if (dcMine && post.status && post.status !== 'approved') {
    left.appendChild(dcEl('span', 'dc-card-status', dcStatusLabel(post.status)));
  }
  footRow.appendChild(left);
  footRow.appendChild(dcLikeButton(post));
  foot.appendChild(footRow);

  const actions = dcEl('div', 'dc-card-actions');
  const useBtn = dcEl('button', 'dc-mini-btn dc-mini-primary', 'Use');
  useBtn.addEventListener('click', () => { addTabWithContent(post.title, post.prompt); });
  actions.appendChild(useBtn);
  const copyBtn = dcEl('button', 'dc-mini-btn', 'Copy');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(post.prompt || ''); copyBtn.textContent = 'Copied'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); } catch {}
  });
  actions.appendChild(copyBtn);
  if (settings.promptLabEnabled !== false) {
    const saveBtn = dcEl('button', 'dc-mini-btn', 'Save'); saveBtn.title = 'Save to Prompt Lab';
    saveBtn.addEventListener('click', () => dcSaveToLab(post, saveBtn));
    actions.appendChild(saveBtn);
  }
  if (dcProfile && (dcProfile.is_admin || dcProfile.id === post.user_id)) {
    const del = dcEl('button', 'dc-mini-btn dc-mini-danger', 'Delete');
    del.addEventListener('click', () => { dcDeletePost(post, card); dcRefreshPendingBadge(); });
    actions.appendChild(del);
  }
  foot.appendChild(actions);
  body.appendChild(foot);
  card.appendChild(body);
  return card;
}

// Save a Discover post into the local Prompt Lab (downloads its media locally).
async function dcSaveToLab(post, btn) {
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    let image = null, audio = null;
    if (post.image_url) {
      const blob = await (await fetch(post.image_url)).blob();
      image = await labSaveMedia(blob);
    }
    if (post.audio_url) {
      const blob = await (await fetch(post.audio_url)).blob();
      audio = await labSaveMedia(blob);
    }
    labItems().unshift({
      id: uid(), ts: Date.now(), title: post.title || tr('card.untitled', 'Untitled'), prompt: post.prompt || '',
      category: post.category || 'other', image, audio, video: null, file: null
    });
    scheduleSave();
    if (btn) btn.textContent = 'Saved ✓';
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = label || 'Save'; }
    alert((err && err.message) || 'Could not save to Lab.');
  }
}

// ---- likes ----
async function dcLoadLikes(ids) {
  dcLikedPosts = new Set();
  if (!dcProfile || !ids.length) return;
  try {
    const { data } = await dcClient.from('likes').select('post_id').eq('user_id', dcProfile.id).in('post_id', ids);
    (data || []).forEach((r) => dcLikedPosts.add(r.post_id));
  } catch {}
}
function dcUpdateLikeUI(btn, countEl, post) {
  btn.classList.toggle('liked', dcLikedPosts.has(post.id));
  if (countEl) countEl.textContent = post.like_count || 0;
}
function dcLikeButton(post) {
  const btn = dcEl('button', 'dc-like');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 21s-7-4.35-9.5-8.5C1 9 2.6 5.5 6 5.5c2 0 3.2 1.1 4 2.6.8-1.5 2-2.6 4-2.6 3.4 0 5 3.5 3.5 7C19 16.65 12 21 12 21z"/></svg>';
  const count = dcEl('span', 'dc-like-count', String(post.like_count || 0));
  btn.appendChild(count);
  dcUpdateLikeUI(btn, count, post);
  if (!dcProfile) { btn.disabled = true; btn.title = 'Sign in to like'; }
  btn.addEventListener('click', (e) => { e.stopPropagation(); dcToggleLike(post, btn, count); });
  return btn;
}
async function dcToggleLike(post, btn, countEl) {
  if (!dcProfile) return;
  const wasLiked = dcLikedPosts.has(post.id);
  if (wasLiked) { dcLikedPosts.delete(post.id); post.like_count = Math.max(0, (post.like_count || 0) - 1); }
  else { dcLikedPosts.add(post.id); post.like_count = (post.like_count || 0) + 1; }
  dcUpdateLikeUI(btn, countEl, post);
  try {
    const res = wasLiked
      ? await dcClient.from('likes').delete().eq('user_id', dcProfile.id).eq('post_id', post.id)
      : await dcClient.from('likes').insert({ user_id: dcProfile.id, post_id: post.id });
    if (res.error) throw res.error;
  } catch {
    // revert on failure
    if (wasLiked) { dcLikedPosts.add(post.id); post.like_count = (post.like_count || 0) + 1; }
    else { dcLikedPosts.delete(post.id); post.like_count = Math.max(0, (post.like_count || 0) - 1); }
    dcUpdateLikeUI(btn, countEl, post);
  }
}

// ---- post detail modal (image + full prompt side by side) ----
// Wrapped end to end: a click handler that throws normally just vanishes into
// the console, leaving the user staring at nothing with no idea it failed.
function dcOpenPost(post) {
  try { dcOpenPostUnsafe(post); }
  catch (err) {
    console.error('dcOpenPost failed', post && post.id, err);
    showToast("Couldn't open that post", '');
  }
}

function dcOpenPostUnsafe(post) {
  // count the view (fire-and-forget; can't be set directly by the client)
  try { dcClient.rpc('increment_post_view', { pid: post.id }); } catch {}
  const overlay = dcEl('div', 'dc-modal-overlay');
  const modal = dcEl('div', 'dc-modal');

  const imgPane = dcEl('div', 'dc-modal-media');
  const im = dcEl('img', post.image_url ? '' : 'is-default');
  im.src = post.image_url || dcDefaultImage(post.category);
  imgPane.appendChild(im);
  if (post.audio_url) imgPane.appendChild(dcAudioPlayer(post.audio_url));
  modal.appendChild(imgPane);

  const pane = dcEl('div', 'dc-modal-pane');
  const head = dcEl('div', 'dc-modal-head');
  head.appendChild(dcEl('div', 'dc-modal-title', dcClamp(post.title, DC_TITLE_DISPLAY_MAX) || tr('card.untitled', 'Untitled')));
  if (post.category) head.appendChild(dcEl('span', 'dc-card-cat', dcCatLabel(post.category)));
  pane.appendChild(head);
  pane.appendChild(dcEl('div', 'dc-modal-author',
    (post.profiles && post.profiles.username) ? '@' + post.profiles.username : 'anonymous'));
  pane.appendChild(dcEl('div', 'dc-modal-prompt', dcClamp(post.prompt, DC_PROMPT_DISPLAY_MAX)));

  const acts = dcEl('div', 'dc-modal-actions');
  const useBtn = dcEl('button', 'dc-primary-btn', 'Use this prompt');
  useBtn.addEventListener('click', () => { addTabWithContent(post.title, post.prompt); close(); });
  const copyBtn = dcEl('button', 'dc-mini-btn', 'Copy');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(post.prompt || ''); copyBtn.textContent = 'Copied'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); } catch {}
  });
  acts.appendChild(useBtn); acts.appendChild(copyBtn); acts.appendChild(dcLikeButton(post));
  if (settings.promptLabEnabled !== false) {
    const saveBtn = dcEl('button', 'dc-mini-btn', 'Save to Lab');
    saveBtn.addEventListener('click', () => dcSaveToLab(post, saveBtn));
    acts.appendChild(saveBtn);
  }
  if (dcProfile && dcProfile.id !== post.user_id) {
    const report = dcEl('button', 'dc-mini-btn', 'Report');
    report.addEventListener('click', () => dcReportPost(post, report));
    acts.appendChild(report);
  }
  pane.appendChild(acts);
  modal.appendChild(pane);

  const closeBtn = dcEl('button', 'dc-modal-close', '×');
  modal.appendChild(closeBtn);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    modal.querySelectorAll('audio').forEach((a) => { try { a.pause(); } catch {} });
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}

async function dcReportPost(post, btn) {
  if (!dcProfile) { alert('Sign in to report a post.'); return; }
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Reporting…'; }
  try {
    const { error } = await dcClient.from('reports').insert({ post_id: post.id, reporter_id: dcProfile.id });
    if (error && error.code !== '23505') throw error; // 23505 = already reported → fine
    if (btn) btn.textContent = 'Reported ✓';
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = label || 'Report'; }
    alert((err && err.message) || 'Could not report this post.');
  }
}

async function dcDeletePost(post, cardEl) {
  try {
    const keys = [post.image_key, post.audio_key].filter(Boolean);
    if (keys.length) { try { await dcClient.storage.from(DC_BUCKET).remove(keys); } catch {} }
    const { error } = await dcClient.from('posts').delete().eq('id', post.id);
    if (error) throw error;
    if (cardEl) cardEl.remove();
  } catch (err) {
    alert((err && err.message) || 'Delete failed.');
  }
}

// ---- upload screen ----
// Hard client-side stop, matching the server-side check in enforce_post_rules —
// a browser's native `maxlength` refuses to type or paste past the limit, so
// this is what actually keeps someone from putting a wall of spam in a post.
const DC_TITLE_MAX = 120;
const DC_PROMPT_MAX = 4000;

function dcRenderUpload() {
  discoverBodyEl.innerHTML = '';
  const form = dcEl('form', 'dc-form dc-upload');
  form.appendChild(dcEl('label', 'dc-label', 'Title'));
  const title = dcEl('input', 'text-input');
  title.placeholder = 'A short name for this prompt';
  title.maxLength = DC_TITLE_MAX;
  form.appendChild(title);

  form.appendChild(dcEl('label', 'dc-label', 'Category'));
  const cat = dcEl('select', 'text-input');
  dcCategories.forEach((c) => {
    const o = dcEl('option', null, c.label); o.value = c.slug; cat.appendChild(o);
  });
  form.appendChild(cat);

  const promptLabelRow = dcEl('div', 'dc-label-row');
  promptLabelRow.appendChild(dcEl('label', 'dc-label', 'Prompt'));
  const promptCount = dcEl('span', 'dc-char-count');
  promptLabelRow.appendChild(promptCount);
  form.appendChild(promptLabelRow);
  const prompt = dcEl('textarea', 'text-input dc-textarea');
  prompt.rows = 6; prompt.placeholder = 'Paste your prompt here…';
  prompt.maxLength = DC_PROMPT_MAX;
  // From "Share to Discover" — maxlength only stops typing/pasting, not a
  // value assigned from JS, so a large selection handed off this way still
  // needs its own clamp.
  if (dcPrefillPrompt) { prompt.value = dcPrefillPrompt.slice(0, DC_PROMPT_MAX); dcPrefillPrompt = ''; }
  const updateCount = () => {
    promptCount.textContent = prompt.value.length + ' / ' + DC_PROMPT_MAX;
    promptCount.classList.toggle('warn', prompt.value.length >= DC_PROMPT_MAX);
  };
  prompt.addEventListener('input', updateCount);
  updateCount();
  form.appendChild(prompt);

  // Image (optional) — click or drag & drop.
  form.appendChild(dcEl('label', 'dc-label', 'Image (optional)'));
  let imgFile = null;
  const drop = dcEl('div', 'dc-drop');
  drop.appendChild(dcEl('span', 'dc-drop-text', 'Drop an image here, or click to choose'));
  const fileInput = dcEl('input', 'hidden'); fileInput.type = 'file'; fileInput.accept = 'image/*';
  const preview = dcEl('img', 'dc-upload-preview hidden');
  const setImg = (f) => {
    if (!f || !f.type.startsWith('image/')) return;
    imgFile = f;
    preview.src = URL.createObjectURL(f);
    preview.classList.remove('hidden');
    drop.querySelector('.dc-drop-text').textContent = f.name;
  };
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => setImg(fileInput.files && fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); drop.classList.remove('dragover');
    setImg(e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  form.appendChild(drop); form.appendChild(fileInput); form.appendChild(preview);

  // Music file — only for the Music category.
  let audioFile = null;
  const audioWrap = dcEl('div', 'dc-audio-field hidden');
  audioWrap.appendChild(dcEl('label', 'dc-label', 'Music file (auto-compressed to MP3 ~96 kbps)'));
  const audioInput = dcEl('input', 'dc-file'); audioInput.type = 'file'; audioInput.accept = 'audio/*';
  audioInput.addEventListener('change', () => { audioFile = audioInput.files && audioInput.files[0]; });
  audioWrap.appendChild(audioInput);
  form.appendChild(audioWrap);
  const syncAudioField = () => audioWrap.classList.toggle('hidden', cat.value !== 'music');
  cat.addEventListener('change', syncAudioField);
  syncAudioField();

  const submit = dcEl('button', 'dc-primary-btn', 'Share to Discover');
  submit.type = 'submit';
  form.appendChild(submit);
  const status = dcEl('div', 'dc-form-status');
  form.appendChild(status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'dc-form-status'; status.textContent = '';
    // .slice() as a last-resort backstop — maxlength covers typing/pasting,
    // and the prefill path is clamped where it's set, but this is what makes
    // the limit unconditional regardless of how the field ended up this way.
    const t = title.value.trim().slice(0, DC_TITLE_MAX);
    const p = prompt.value.trim().slice(0, DC_PROMPT_MAX);
    if (!t || !p) { status.classList.add('err'); status.textContent = 'Title and prompt are required.'; return; }
    if (dcContentFlag(t + ' ' + p)) {
      status.classList.add('err');
      status.textContent = 'Blocked by the content filter — please remove +18 / offensive words.';
      return;
    }
    if (cat.value === 'music' && audioFile && audioFile.size > DC_MAX_AUDIO_RAW_BYTES) {
      status.classList.add('err'); status.textContent = 'Music file is too large (max 60 MB).'; return;
    }
    submit.disabled = true; submit.textContent = 'Sharing…';
    try {
      await dcPublishPost({
        title: t, prompt: p, category: cat.value,
        imageBlob: imgFile, audioBlob: (cat.value === 'music' ? audioFile : null),
        onStatus: (m) => { status.textContent = m; }
      });
      // A new post is pending until an admin approves it, so it won't show up
      // in the ordinary feed — land on "My posts" instead, where the pending
      // badge makes that visible, rather than dropping the user into a Browse
      // view where their own submission has just silently vanished.
      dcMine = true;
      dcScreen = 'browse';
      dcRender();
      showToast('Shared — waiting for admin approval', '');
    } catch (err) {
      status.classList.add('err');
      status.textContent = (err && err.message) || 'Upload failed.';
      submit.disabled = false; submit.textContent = 'Share to Discover';
    }
  });

  discoverBodyEl.appendChild(form);
}

// Re-encode an audio file to a smaller MP3 (client-side, via vendored lamejs).
// Falls back to the original file if the encoder is missing or decoding fails.
async function dcCompressAudio(file, kbps = DC_AUDIO_KBPS) {
  if (!window.lamejs) return file;
  let audio;
  try {
    const buf = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    audio = await ctx.decodeAudioData(buf);
    try { ctx.close(); } catch {}
  } catch { return file; } // unknown/unsupported codec — upload as-is

  try {
    const rate = audio.sampleRate;
    const channels = Math.min(2, audio.numberOfChannels);
    const left = audio.getChannelData(0);
    const right = channels > 1 ? audio.getChannelData(1) : null;
    const enc = new window.lamejs.Mp3Encoder(channels, rate, kbps);
    const block = 1152;
    const parts = [];
    const toInt16 = (f32, start, len) => {
      const out = new Int16Array(len);
      for (let i = 0; i < len; i++) {
        const s = Math.max(-1, Math.min(1, f32[start + i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    };
    for (let i = 0; i < left.length; i += block) {
      const len = Math.min(block, left.length - i);
      const chunk = channels > 1
        ? enc.encodeBuffer(toInt16(left, i, len), toInt16(right, i, len))
        : enc.encodeBuffer(toInt16(left, i, len));
      if (chunk.length) parts.push(new Int8Array(chunk));
    }
    const tail = enc.flush();
    if (tail.length) parts.push(new Int8Array(tail));
    const blob = new Blob(parts, { type: 'audio/mpeg' });
    return blob.size > 0 && blob.size < file.size ? blob : file;
  } catch { return file; }
}

// Compress/resize an image file to a small WebP blob (client-side).
function dcCompressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1280;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > max || h > max) {
        const s = Math.min(max / w, max / h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not process image')), 'image/webp', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not a valid image')); };
    img.src = url;
  });
}

// ---- admin screen ----
async function dcRenderAdmin() {
  discoverBodyEl.innerHTML = '';

  // Post approval — first thing on the page. Every new post starts pending
  // (see enforce_post_rules in schema.sql), so this is the queue an admin
  // actually opens this tab to work through; everything else below it is
  // occasional bookkeeping (storage, categories, users) that can wait.
  const modBox = dcEl('div', 'dc-admin-mod');
  modBox.appendChild(dcEl('div', 'dc-admin-h', 'Pending approval'));
  const list = dcEl('div', 'dc-mod-list');
  modBox.appendChild(list);
  discoverBodyEl.appendChild(modBox);

  list.appendChild(dcStatus('Loading…'));
  try {
    const { data, error } = await dcClient
      .from('posts')
      .select('id,title,status,category,image_url,image_key,audio_key,user_id,created_at,profiles!posts_user_id_fkey(username,is_blocked)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    list.innerHTML = '';
    if (!data.length) { list.appendChild(dcStatus('No posts yet.')); return; }
    // Pending-first: since every new post now starts pending, that's the queue
    // an admin actually needs to work through, not buried under old approved ones.
    const rank = { pending: 0, rejected: 1, approved: 2 };
    data.sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1));
    // One malformed/oversized row (the exact kind of post an admin most needs
    // to reach) must never take the whole moderation queue down with it.
    data.forEach((post) => {
      try { list.appendChild(dcModRow(post)); }
      catch (err) { console.error('dcModRow failed for post', post && post.id, err); }
    });
  } catch (err) {
    list.innerHTML = '';
    list.appendChild(dcStatus((err && err.message) || 'Failed to load.', 'err'));
  }

  // storage meter
  const meter = dcEl('div', 'dc-admin-meter');
  meter.appendChild(dcStatus('Calculating storage…'));
  discoverBodyEl.appendChild(meter);
  dcRenderStorageMeter(meter);

  // orphan-file cleanup (files left in Storage by a failed delete)
  const orphanBox = dcEl('div', 'dc-admin-orphan');
  orphanBox.appendChild(dcEl('div', 'dc-admin-h', 'Orphan files'));
  const orphanStatus = dcEl('div', 'dc-meter-label', 'Storage files with no matching post (e.g. from a failed delete).');
  const orphanBtn = dcEl('button', 'dc-mini-btn', 'Scan for orphans');
  orphanBtn.onclick = () => dcScanOrphans(orphanStatus, orphanBtn);
  orphanBox.appendChild(orphanStatus);
  orphanBox.appendChild(orphanBtn);
  discoverBodyEl.appendChild(orphanBox);

  // reports queue
  const reportsBox = dcEl('div', 'dc-admin-mod');
  reportsBox.appendChild(dcEl('div', 'dc-admin-h', 'Reports'));
  const reportsList = dcEl('div', 'dc-mod-list');
  reportsBox.appendChild(reportsList);
  discoverBodyEl.appendChild(reportsBox);
  dcRenderReports(reportsList);

  // users
  const usersBox = dcEl('div', 'dc-admin-mod');
  const usersHead = dcEl('div', 'dc-admin-h', 'Users');
  usersBox.appendChild(usersHead);
  const usersList = dcEl('div', 'dc-mod-list');
  usersBox.appendChild(usersList);
  discoverBodyEl.appendChild(usersBox);
  dcRenderUsers(usersList, usersHead);

  // add category
  const catBox = dcEl('div', 'dc-admin-cats');
  catBox.appendChild(dcEl('div', 'dc-admin-h', 'Categories'));
  const catRow = dcEl('div', 'dc-cat-row');
  dcCategories.forEach((c) => catRow.appendChild(dcEl('span', 'dc-chip', c.label)));
  catBox.appendChild(catRow);
  const addRow = dcEl('div', 'dc-cat-add');
  const slugI = dcEl('input', 'text-input'); slugI.placeholder = 'slug (e.g. video)';
  const labelI = dcEl('input', 'text-input'); labelI.placeholder = 'Label (e.g. Video)';
  const addBtn = dcEl('button', 'dc-mini-btn dc-mini-primary', 'Add');
  addBtn.addEventListener('click', async () => {
    const slug = slugI.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const label = labelI.value.trim();
    if (!slug || !label) return;
    try {
      const { error } = await dcClient.from('categories').insert({ slug, label, sort: dcCategories.length + 1 });
      if (error) throw error;
      await dcLoadCategories();
      dcRenderAdmin();
    } catch (err) { alert((err && err.message) || 'Could not add category.'); }
  });
  addRow.appendChild(slugI); addRow.appendChild(labelI); addRow.appendChild(addBtn);
  catBox.appendChild(addRow);
  discoverBodyEl.appendChild(catBox);
}

async function dcRenderStorageMeter(meter) {
  try {
    const { data, error } = await dcClient.from('posts').select('byte_size');
    if (error) throw error;
    const used = (data || []).reduce((s, r) => s + (r.byte_size || 0), 0);
    const pct = Math.min(100, Math.round((used / DC_QUOTA_BYTES) * 100));
    meter.innerHTML = '';
    meter.appendChild(dcEl('div', 'dc-admin-h', 'Image storage'));
    const bar = dcEl('div', 'dc-meter-bar');
    const fill = dcEl('div', 'dc-meter-fill');
    fill.style.width = pct + '%';
    if (pct > 85) fill.classList.add('warn');
    bar.appendChild(fill);
    meter.appendChild(bar);
    meter.appendChild(dcEl('div', 'dc-meter-label',
      `${dcFmtBytes(used)} of 1 GB used (${pct}%)`));
  } catch (err) {
    meter.innerHTML = '';
    meter.appendChild(dcStatus((err && err.message) || 'Could not read storage.', 'err'));
  }
}

// List every object path in the bucket (bucket layout is "<uid>/<file>").
async function dcListAllStoragePaths() {
  const out = [];
  const { data: roots } = await dcClient.storage.from(DC_BUCKET).list('', { limit: 1000 });
  for (const entry of (roots || [])) {
    if (entry.id) { out.push({ path: entry.name, size: (entry.metadata && entry.metadata.size) || 0 }); continue; }
    const { data: files } = await dcClient.storage.from(DC_BUCKET).list(entry.name, { limit: 1000 });
    for (const f of (files || [])) {
      if (!f.id) continue;
      out.push({ path: entry.name + '/' + f.name, size: (f.metadata && f.metadata.size) || 0 });
    }
  }
  return out;
}

// Find files in Storage not referenced by any post; then let the admin delete them.
async function dcScanOrphans(statusEl, btn) {
  btn.disabled = true; const label = 'Scan for orphans'; btn.textContent = 'Scanning…';
  try {
    const { data: posts } = await dcClient.from('posts').select('image_key,audio_key');
    const referenced = new Set();
    (posts || []).forEach((p) => { if (p.image_key) referenced.add(p.image_key); if (p.audio_key) referenced.add(p.audio_key); });
    const orphans = (await dcListAllStoragePaths()).filter((o) => !referenced.has(o.path));
    const bytes = orphans.reduce((s, o) => s + (o.size || 0), 0);
    if (!orphans.length) {
      statusEl.textContent = 'No orphan files — storage is clean. ✓';
      btn.textContent = label; btn.disabled = false; btn.onclick = () => dcScanOrphans(statusEl, btn);
      return;
    }
    statusEl.textContent = `${orphans.length} orphan file(s) · ${dcFmtBytes(bytes)}.`;
    btn.textContent = `Delete ${orphans.length} orphan(s)`; btn.disabled = false;
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Deleting…';
      try {
        for (let i = 0; i < orphans.length; i += 100) {
          await dcClient.storage.from(DC_BUCKET).remove(orphans.slice(i, i + 100).map((o) => o.path));
        }
        statusEl.textContent = `Deleted ${orphans.length} file(s), freed ${dcFmtBytes(bytes)}. ✓`;
      } catch (err) {
        statusEl.textContent = (err && err.message) || 'Delete failed.';
      }
      btn.textContent = label; btn.disabled = false; btn.onclick = () => dcScanOrphans(statusEl, btn);
    };
  } catch (err) {
    statusEl.textContent = (err && err.message) || 'Scan failed.';
    btn.textContent = label; btn.disabled = false; btn.onclick = () => dcScanOrphans(statusEl, btn);
  }
}

function dcFmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function dcModRow(post) {
  const row = dcEl('div', 'dc-mod-row');
  row.classList.add('dc-mod-row--' + (post.status || 'approved'));

  const thumb = dcEl('img', 'dc-mod-thumb' + (post.image_url ? '' : ' is-default'));
  thumb.loading = 'lazy';
  thumb.src = post.image_url || dcDefaultImage(post.category);
  thumb.alt = '';
  thumb.title = tr('admin.viewFull', 'Click to see the full post');
  // dcOpenPost needs a prompt to show; the admin list doesn't fetch that
  // column (title/category/image are enough for the list itself), so pull it
  // on demand only when the thumbnail is actually clicked.
  thumb.addEventListener('click', async () => {
    if (post.prompt != null) { dcOpenPost(post); return; }
    try {
      const { data } = await dcClient.from('posts').select('prompt').eq('id', post.id).maybeSingle();
      post.prompt = (data && data.prompt) || '';
    } catch { post.prompt = ''; }
    dcOpenPost(post);
  });
  row.appendChild(thumb);

  const info = dcEl('div', 'dc-mod-info');
  info.appendChild(dcEl('span', 'dc-mod-title', dcClamp(post.title, DC_TITLE_DISPLAY_MAX) || tr('card.untitled', 'Untitled')));
  const blocked = !!(post.profiles && post.profiles.is_blocked);
  const meta = dcEl('span', 'dc-mod-meta',
    `${(post.profiles && post.profiles.username) ? '@' + post.profiles.username : '—'} · ${dcStatusLabel(post.status)}`);
  if (blocked) meta.appendChild(dcEl('span', 'dc-mod-blocked', ' · blocked'));
  info.appendChild(meta);
  row.appendChild(info);
  const acts = dcEl('div', 'dc-mod-acts');
  const setStatus = async (status) => {
    try {
      const { error } = await dcClient.from('posts').update({ status }).eq('id', post.id);
      if (error) throw error;
      post.status = status;
      dcRenderAdmin();
      dcRefreshPendingBadge();
    } catch (err) { alert((err && err.message) || 'Update failed.'); }
  };
  if (post.status !== 'approved') {
    const ok = dcEl('button', 'dc-mini-btn dc-mini-primary', 'Approve');
    ok.addEventListener('click', () => setStatus('approved'));
    acts.appendChild(ok);
  }
  if (post.status !== 'rejected') {
    const no = dcEl('button', 'dc-mini-btn', 'Reject');
    no.addEventListener('click', () => setStatus('rejected'));
    acts.appendChild(no);
  }
  // Block / unblock the post's author (stops them posting or liking).
  if (post.user_id && (!dcProfile || post.user_id !== dcProfile.id)) {
    const blk = dcEl('button', 'dc-mini-btn' + (blocked ? ' dc-mini-primary' : ' dc-mini-danger'),
      blocked ? 'Unblock' : 'Block');
    blk.addEventListener('click', async () => {
      try {
        const { error } = await dcClient.from('profiles').update({ is_blocked: !blocked }).eq('id', post.user_id);
        if (error) throw error;
        dcRenderAdmin();
      } catch (err) { alert((err && err.message) || 'Failed to update user.'); }
    });
    acts.appendChild(blk);
  }
  const del = dcEl('button', 'dc-mini-btn dc-mini-danger', 'Delete');
  del.addEventListener('click', async () => { await dcDeletePost(post, null); dcRenderAdmin(); dcRefreshPendingBadge(); });
  acts.appendChild(del);
  row.appendChild(acts);
  return row;
}

// ---- admin: reports queue ----
async function dcRenderReports(list) {
  list.appendChild(dcStatus('Loading…'));
  try {
    const { data, error } = await dcClient
      .from('reports')
      .select('id,reason,created_at,post_id,posts(id,title,prompt,category,status,image_url,image_key,audio_url,audio_key,user_id,view_count,like_count,profiles!posts_user_id_fkey(username))')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    list.innerHTML = '';
    if (!data.length) { list.appendChild(dcStatus('No reports. ✓')); return; }
    const byPost = new Map();
    data.forEach((r) => {
      if (!byPost.has(r.post_id)) byPost.set(r.post_id, { post: r.posts, count: 0, ids: [] });
      const e = byPost.get(r.post_id); e.count++; e.ids.push(r.id);
    });
    byPost.forEach((e) => list.appendChild(dcReportRow(e)));
  } catch (err) {
    list.innerHTML = '';
    list.appendChild(dcStatus((err && err.message) || 'Failed to load reports.', 'err'));
  }
}

function dcReportRow(entry) {
  const post = entry.post;
  const row = dcEl('div', 'dc-mod-row');
  const info = dcEl('div', 'dc-mod-info');
  info.appendChild(dcEl('span', 'dc-mod-title', (post && post.title) || '(deleted post)'));
  info.appendChild(dcEl('span', 'dc-mod-meta',
    `${entry.count} report(s) · ${(post && post.profiles && post.profiles.username) ? '@' + post.profiles.username : '—'}`));
  row.appendChild(info);
  const acts = dcEl('div', 'dc-mod-acts');
  if (post) {
    const view = dcEl('button', 'dc-mini-btn', 'View');
    view.addEventListener('click', () => dcOpenPost(post));
    acts.appendChild(view);
    const del = dcEl('button', 'dc-mini-btn dc-mini-danger', 'Delete post');
    del.addEventListener('click', async () => { await dcDeletePost(post, null); dcRenderAdmin(); });
    acts.appendChild(del);
  }
  const dismiss = dcEl('button', 'dc-mini-btn', 'Dismiss');
  dismiss.addEventListener('click', async () => {
    try {
      const { error } = await dcClient.from('reports').delete().in('id', entry.ids);
      if (error) throw error;
      dcRenderAdmin();
    } catch (err) { alert((err && err.message) || 'Failed to dismiss.'); }
  });
  acts.appendChild(dismiss);
  row.appendChild(acts);
  return row;
}

// ---- admin: user list ----
async function dcRenderUsers(list, head) {
  list.appendChild(dcStatus('Loading…'));
  try {
    const { data, error } = await dcClient
      .from('profiles')
      .select('id,username,is_admin,is_blocked,created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    list.innerHTML = '';
    if (head) head.textContent = `Users (${data.length})`;
    if (!data.length) { list.appendChild(dcStatus('No users yet.')); return; }
    data.forEach((u) => list.appendChild(dcUserRow(u)));
  } catch (err) {
    list.innerHTML = '';
    list.appendChild(dcStatus((err && err.message) || 'Failed to load users.', 'err'));
  }
}

function dcUserRow(u) {
  const row = dcEl('div', 'dc-mod-row');
  const info = dcEl('div', 'dc-mod-info');
  const title = dcEl('span', 'dc-mod-title', '@' + (u.username || '—'));
  if (u.is_admin) title.appendChild(dcEl('span', 'dc-card-cat', 'admin'));
  info.appendChild(title);
  const meta = dcEl('span', 'dc-mod-meta', u.id + ' · ' + new Date(u.created_at).toLocaleDateString());
  if (u.is_blocked) meta.appendChild(dcEl('span', 'dc-mod-blocked', ' · blocked'));
  info.appendChild(meta);
  row.appendChild(info);
  const acts = dcEl('div', 'dc-mod-acts');
  const copyId = dcEl('button', 'dc-mini-btn', 'Copy ID');
  copyId.addEventListener('click', async () => { try { await navigator.clipboard.writeText(u.id); copyId.textContent = 'Copied'; setTimeout(() => copyId.textContent = 'Copy ID', 1200); } catch {} });
  acts.appendChild(copyId);
  if (!dcProfile || u.id !== dcProfile.id) {
    const blk = dcEl('button', 'dc-mini-btn' + (u.is_blocked ? ' dc-mini-primary' : ' dc-mini-danger'), u.is_blocked ? 'Unblock' : 'Block');
    blk.addEventListener('click', async () => {
      try {
        const { error } = await dcClient.from('profiles').update({ is_blocked: !u.is_blocked }).eq('id', u.id);
        if (error) throw error;
        dcRenderAdmin();
      } catch (err) { alert((err && err.message) || 'Failed to update user.'); }
    });
    acts.appendChild(blk);
  }
  row.appendChild(acts);
  return row;
}

// Reusable Discover publish path (used by the Upload form and Prompt Lab's Share).
// Takes raw blobs; compresses + uploads media, then inserts the post.
async function dcPublishPost({ title, prompt, category, imageBlob, audioBlob, onStatus }) {
  if (!dcClient || !dcSession || !dcProfile) throw new Error('Open the Discover tab and sign in first.');
  const note = (m) => { if (onStatus) onStatus(m); };
  if (dcContentFlag((title || '') + ' ' + (prompt || ''))) {
    throw new Error('Blocked by the content filter — remove +18 / offensive words.');
  }
  let image_url = null, image_key = null, audio_url = null, audio_key = null, byte_size = 0;
  if (imageBlob) {
    note('Compressing image…');
    const blob = await dcCompressImage(imageBlob);
    byte_size += blob.size;
    image_key = `${dcProfile.id}/${uid()}.webp`;
    note('Uploading image…');
    const up = await dcClient.storage.from(DC_BUCKET).upload(image_key, blob, { contentType: 'image/webp', upsert: false });
    if (up.error) throw up.error;
    image_url = dcClient.storage.from(DC_BUCKET).getPublicUrl(image_key).data.publicUrl;
  }
  if (category === 'music' && audioBlob) {
    note('Preparing music…');
    const out = await dcCompressAudio(audioBlob);
    if (out.size > DC_MAX_AUDIO_BYTES) throw new Error('Music is over 8 MB after compression.');
    const ext = (out.type === 'audio/mpeg' || out !== audioBlob) ? 'mp3' : (MEDIA_MIME_EXT[out.type] || 'mp3');
    audio_key = `${dcProfile.id}/${uid()}.${ext}`;
    note('Uploading music…');
    const up = await dcClient.storage.from(DC_BUCKET).upload(audio_key, out, { contentType: out.type || 'audio/mpeg', upsert: false });
    if (up.error) throw up.error;
    audio_url = dcClient.storage.from(DC_BUCKET).getPublicUrl(audio_key).data.publicUrl;
    byte_size += out.size;
  }
  note('Saving…');
  const { error } = await dcClient.from('posts').insert({
    user_id: dcProfile.id, title, prompt, category, image_url, image_key, audio_url, audio_key, byte_size
  });
  if (error) throw error;
}

// ========================================================================
// Prompt Lab — a LOCAL, personal library of prompts + media (state.promptLab).
// Media is saved into the images dir and served via ppimg://. Reuses the
// .dc-card / .dc-modal styles and dcAudioPlayer / dcDefaultImage helpers.
// ========================================================================
const LAB_CATEGORIES = [
  { slug: 'website', label: 'Website' }, { slug: 'image', label: 'Image' },
  { slug: 'music', label: 'Music' }, { slug: 'video', label: 'Video' },
  { slug: 'software', label: 'Software' }, { slug: 'game', label: 'Game' },
  { slug: 'other', label: 'Other' }
];
const MEDIA_MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv'
};
let labSearch = '';
let labFilter = 'all';
let labModalOpen = false;

function labCatLabel(slug) {
  const c = LAB_CATEGORIES.find((x) => x.slug === slug);
  return c ? c.label : (slug || '');
}
function labMediaUrl(name) { return name ? 'ppimg://' + name : null; }
function labPersist() { scheduleSave(); }

// Save any media blob locally; returns the stored filename (served via ppimg://).
async function labSaveMedia(blob) {
  try {
    const b64 = await blobToBase64(blob);
    const ext = (MEDIA_MIME_EXT[blob.type] || (blob.type && blob.type.split('/')[1]) || 'bin').replace(/[^a-z0-9]/gi, '');
    const res = await window.api.saveMedia(b64, ext);
    return res && res.filename;
  } catch (e) { console.error('lab save media failed', e); return null; }
}

function labRender() {
  if (!labBodyEl) return;
  if (labHintEl) labHintEl.classList.toggle('hidden', !!settings.promptLabHintDismissed);
  labRenderNav();
  labRenderBrowse();
}

if (labHintCloseEl) {
  labHintCloseEl.addEventListener('click', () => {
    settings.promptLabHintDismissed = true;
    if (labHintEl) labHintEl.classList.add('hidden');
    saveSettingsNow();
  });
}

function labRenderNav() {
  labNavEl.innerHTML = '';
  const add = dcEl('button', 'dc-nav dc-nav-primary', '+ Add');
  add.addEventListener('click', () => labAddModal(null));
  labNavEl.appendChild(add);
  const n = labItems().length;
  labNavEl.appendChild(dcEl('span', 'dc-account',
    n + ' ' + tr('lab.items', n === 1 ? 'item' : 'items')));
}

function labRenderBrowse() {
  labBodyEl.innerHTML = '';
  const controls = dcEl('div', 'dc-controls');
  const search = dcEl('input', 'text-input dc-search');
  search.placeholder = 'Search your prompts…'; search.value = labSearch;
  let t = null;
  search.addEventListener('input', () => {
    clearTimeout(t); t = setTimeout(() => { labSearch = search.value.trim().toLowerCase(); labRenderFeed(feed); }, 200);
  });
  controls.appendChild(search);
  const chips = dcEl('div', 'dc-chips');
  const mk = (slug, label) => {
    const c = dcEl('button', 'dc-chip' + (labFilter === slug ? ' active' : ''), label);
    c.addEventListener('click', () => { labFilter = slug; labRenderBrowse(); });
    return c;
  };
  chips.appendChild(mk('all', 'All'));
  LAB_CATEGORIES.forEach((c) => chips.appendChild(mk(c.slug, c.label)));
  controls.appendChild(chips);
  labBodyEl.appendChild(controls);
  const feed = dcEl('div', 'dc-feed');
  labBodyEl.appendChild(feed);
  labRenderFeed(feed);
}

function labRenderFeed(feed) {
  feed.innerHTML = '';
  let items = labItems().slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (labFilter !== 'all') items = items.filter((i) => i.category === labFilter);
  if (labSearch) items = items.filter((i) => ((i.title || '') + ' ' + (i.prompt || '')).toLowerCase().includes(labSearch));
  if (!items.length) {
    const empty = dcEl('div', 'dc-empty');
    empty.appendChild(dcEl('div', 'dc-empty-title', labItems().length ? 'Nothing matches.' : 'Your Prompt Lab is empty'));
    empty.appendChild(dcEl('div', 'dc-empty-sub', 'Click "+ Add", or just paste an image (Ctrl+V) to create your first prompt.'));
    feed.appendChild(empty);
    return;
  }
  items.forEach((it) => feed.appendChild(labCard(it)));
}

function labCard(item) {
  const card = dcEl('div', 'dc-card');
  if (item.video && !item.image) {
    const v = dcEl('video', 'dc-card-img'); v.src = labMediaUrl(item.video); v.muted = true; v.preload = 'metadata';
    v.addEventListener('click', () => labOpen(item));
    card.appendChild(v);
  } else {
    const im = dcEl('img', 'dc-card-img' + (item.image ? '' : ' is-default'));
    im.loading = 'lazy'; im.src = labMediaUrl(item.image) || dcDefaultImage(item.category); im.alt = '';
    im.addEventListener('click', () => labOpen(item));
    card.appendChild(im);
  }
  const body = dcEl('div', 'dc-card-body');
  const top = dcEl('div', 'dc-card-top');
  const title = dcEl('div', 'dc-card-title', item.title || tr('card.untitled', 'Untitled'));
  title.addEventListener('click', () => labOpen(item));
  top.appendChild(title);
  if (item.category) top.appendChild(dcEl('span', 'dc-card-cat', labCatLabel(item.category)));
  body.appendChild(top);
  if (item.audio) body.appendChild(dcAudioPlayer(labMediaUrl(item.audio)));
  const pr = dcEl('div', 'dc-card-prompt', item.prompt || '');
  pr.addEventListener('click', () => labOpen(item));
  body.appendChild(pr);
  const foot = dcEl('div', 'dc-card-foot');
  const actions = dcEl('div', 'dc-card-actions');
  const use = dcEl('button', 'dc-mini-btn dc-mini-primary', 'Use');
  use.addEventListener('click', () => addTabWithContent(item.title, item.prompt));
  actions.appendChild(use);
  const copy = dcEl('button', 'dc-mini-btn', 'Copy');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(item.prompt || ''); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy', 1200); } catch {}
  });
  actions.appendChild(copy);
  const edit = dcEl('button', 'dc-mini-btn', 'Edit');
  edit.addEventListener('click', () => labAddModal(item));
  actions.appendChild(edit);
  foot.appendChild(actions);
  body.appendChild(foot);
  card.appendChild(body);
  return card;
}

function labOpen(item) {
  const overlay = dcEl('div', 'dc-modal-overlay');
  const modal = dcEl('div', 'dc-modal');
  const media = dcEl('div', 'dc-modal-media');
  if (item.video) {
    const v = dcEl('video'); v.src = labMediaUrl(item.video); v.controls = true; media.appendChild(v);
  } else {
    const im = dcEl('img', item.image ? '' : 'is-default');
    im.src = labMediaUrl(item.image) || dcDefaultImage(item.category); media.appendChild(im);
  }
  if (item.audio) media.appendChild(dcAudioPlayer(labMediaUrl(item.audio)));
  modal.appendChild(media);

  const pane = dcEl('div', 'dc-modal-pane');
  const head = dcEl('div', 'dc-modal-head');
  head.appendChild(dcEl('div', 'dc-modal-title', item.title || tr('card.untitled', 'Untitled')));
  if (item.category) head.appendChild(dcEl('span', 'dc-card-cat', labCatLabel(item.category)));
  pane.appendChild(head);
  pane.appendChild(dcEl('div', 'dc-modal-prompt', item.prompt || ''));
  if (item.file && item.file.storedName) {
    const fileRow = dcEl('button', 'dc-modal-file', '📎 ' + (item.file.name || 'attachment'));
    fileRow.title = 'Open file';
    fileRow.addEventListener('click', () => { try { window.api.openFile(item.file.storedName); } catch {} });
    pane.appendChild(fileRow);
  }
  const acts = dcEl('div', 'dc-modal-actions');
  const use = dcEl('button', 'dc-primary-btn', 'Use this prompt');
  use.addEventListener('click', () => { addTabWithContent(item.title, item.prompt); close(); });
  acts.appendChild(use);
  const copy = dcEl('button', 'dc-mini-btn', 'Copy');
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(item.prompt || ''); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy', 1200); } catch {} });
  acts.appendChild(copy);
  const edit = dcEl('button', 'dc-mini-btn', 'Edit');
  edit.addEventListener('click', () => { close(); labAddModal(item); });
  acts.appendChild(edit);
  if (window.DISCOVER_CONFIGURED && settings.discoverEnabled) {
    const share = dcEl('button', 'dc-mini-btn', 'Share');
    share.addEventListener('click', () => labShare(item, share));
    acts.appendChild(share);
  }
  const del = dcEl('button', 'dc-mini-btn dc-mini-danger', 'Delete');
  del.addEventListener('click', () => { if (confirm('Delete this prompt from your Lab?')) { labDelete(item); close(); } });
  acts.appendChild(del);
  pane.appendChild(acts);
  modal.appendChild(pane);

  const closeBtn = dcEl('button', 'dc-modal-close', '×');
  modal.appendChild(closeBtn);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  function close() { media.querySelectorAll('audio,video').forEach((m) => { try { m.pause(); } catch {} }); overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}

function labDelete(item) {
  const arr = labItems();
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx >= 0) arr.splice(idx, 1);
  labPersist();
  if (labActive()) labRender();
}

// Add/edit modal — media on the left, fields on the right (Discover-detail look).
function labAddModal(item) {
  labModalOpen = true;
  const editing = !!item;
  const draft = { image: item ? item.image : null, audio: item ? item.audio : null, video: item ? item.video : null, file: item ? item.file : null };

  const overlay = dcEl('div', 'dc-modal-overlay');
  const modal = dcEl('div', 'dc-modal lab-edit-modal');

  const media = dcEl('div', 'dc-modal-media');
  const drop = dcEl('div', 'dc-drop lab-edit-drop');
  const dropText = dcEl('span', 'dc-drop-text', draft.image ? 'Drop / paste / click to replace the image' : 'Drop, paste, or click to add an image');
  drop.appendChild(dropText);
  const fileInput = dcEl('input', 'hidden'); fileInput.type = 'file'; fileInput.accept = 'image/*';
  const preview = dcEl('img', 'lab-edit-preview' + (draft.image ? '' : ' hidden'));
  if (draft.image) preview.src = labMediaUrl(draft.image);
  const setImage = async (blob) => {
    if (!blob || !blob.type || !blob.type.startsWith('image/')) return;
    dropText.textContent = 'Saving image…';
    const name = await labSaveMedia(blob);
    if (name) { draft.image = name; preview.src = labMediaUrl(name); preview.classList.remove('hidden'); dropText.textContent = 'Image added — drop again to replace'; }
    else dropText.textContent = 'Could not save image';
  };
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => setImage(fileInput.files && fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('dragover'); setImage(e.dataTransfer.files && e.dataTransfer.files[0]); });
  media.appendChild(drop); media.appendChild(fileInput); media.appendChild(preview);

  const extra = dcEl('div', 'lab-edit-extra');
  const mkPick = (label, has, accept, onFile) => {
    const btn = dcEl('button', 'dc-mini-btn', has ? label + ' ✓' : '+ ' + label); btn.type = 'button';
    const inp = dcEl('input', 'hidden'); inp.type = 'file'; inp.accept = accept;
    btn.addEventListener('click', () => inp.click());
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      btn.textContent = 'Saving…';
      const name = await labSaveMedia(f);
      btn.textContent = name ? label + ' ✓' : '+ ' + label;
      if (name) onFile(name);
    });
    extra.appendChild(btn); extra.appendChild(inp);
  };
  mkPick('Music', !!draft.audio, 'audio/*', (n) => { draft.audio = n; });
  mkPick('Video', !!draft.video, 'video/*', (n) => { draft.video = n; });
  // Any other file — stored via the app's file store (open/download later).
  const fileBtn = dcEl('button', 'dc-mini-btn', draft.file ? 'File ✓' : '+ File'); fileBtn.type = 'button';
  fileBtn.addEventListener('click', async () => {
    try {
      const picked = await window.api.pickFiles();
      if (picked && picked.length) { draft.file = picked[0]; fileBtn.textContent = 'File ✓'; }
    } catch {}
  });
  extra.appendChild(fileBtn);
  media.appendChild(extra);
  modal.appendChild(media);

  const pane = dcEl('div', 'dc-modal-pane');
  pane.appendChild(dcEl('div', 'dc-modal-title', editing ? 'Edit prompt' : 'New prompt'));
  const form = dcEl('form', 'dc-form');
  form.appendChild(dcEl('label', 'dc-label', 'Title'));
  const title = dcEl('input', 'text-input'); title.placeholder = 'A short name'; title.value = item ? (item.title || '') : '';
  form.appendChild(title);
  form.appendChild(dcEl('label', 'dc-label', 'Category'));
  const cat = dcEl('select', 'text-input');
  LAB_CATEGORIES.forEach((c) => { const o = dcEl('option', null, c.label); o.value = c.slug; cat.appendChild(o); });
  cat.value = (item && item.category) || 'other';
  form.appendChild(cat);
  form.appendChild(dcEl('label', 'dc-label', 'Prompt'));
  const prompt = dcEl('textarea', 'text-input dc-textarea'); prompt.rows = 7; prompt.placeholder = 'Your prompt…'; prompt.value = item ? (item.prompt || '') : '';
  form.appendChild(prompt);
  const save = dcEl('button', 'dc-primary-btn', editing ? 'Save changes' : 'Save to Lab'); save.type = 'submit';
  form.appendChild(save);
  const status = dcEl('div', 'dc-form-status'); form.appendChild(status);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const tt = title.value.trim(), pp = prompt.value.trim();
    if (!tt || !pp) { status.classList.add('err'); status.textContent = 'Title and prompt are required.'; return; }
    if (editing) {
      Object.assign(item, { title: tt, prompt: pp, category: cat.value, image: draft.image, audio: draft.audio, video: draft.video, file: draft.file });
    } else {
      labItems().unshift({ id: uid(), ts: Date.now(), title: tt, prompt: pp, category: cat.value, image: draft.image || null, audio: draft.audio || null, video: draft.video || null, file: draft.file || null });
    }
    labPersist(); close();
    if (labActive()) labRender();
  });
  pane.appendChild(form);
  modal.appendChild(pane);

  const closeBtn = dcEl('button', 'dc-modal-close', '×');
  modal.appendChild(closeBtn);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const onPaste = (e) => {
    if (document.activeElement === prompt || document.activeElement === title) return; // let text paste work
    const items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) { const b = it.getAsFile(); if (b) { e.preventDefault(); setImage(b); } return; }
    }
  };
  function close() { labModalOpen = false; overlay.remove(); document.removeEventListener('keydown', onKey); document.removeEventListener('paste', onPaste); }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.addEventListener('paste', onPaste);
  setTimeout(() => title.focus(), 30);
  return { setImage };
}

async function labShare(item, btn) {
  if (!window.DISCOVER_CONFIGURED || !settings.discoverEnabled) { alert('Discover is turned off (enable it in Settings → Tabs).'); return; }
  if (!dcClient || !dcSession) { alert('Open the Discover tab and sign in, then share again.'); switchToDiscover(); return; }
  if (!dcProfile) { alert('Loading your Discover profile — try again in a moment.'); return; }
  if (item.video && !confirm('Video isn’t shared to Discover (too large). Share the prompt' +
      (item.image ? ' + image' : '') + (item.category === 'music' && item.audio ? ' + music' : '') + '?')) return;
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Sharing…'; }
  try {
    let imageBlob = null, audioBlob = null;
    if (item.image) imageBlob = await (await fetch(labMediaUrl(item.image))).blob();
    if (item.category === 'music' && item.audio) audioBlob = await (await fetch(labMediaUrl(item.audio))).blob();
    await dcPublishPost({
      title: item.title, prompt: item.prompt, category: item.category, imageBlob, audioBlob,
      onStatus: (m) => { if (btn) btn.textContent = m; }
    });
    if (btn) btn.textContent = 'Shared ✓'; else alert('Shared to Discover!');
  } catch (err) {
    alert((err && err.message) || 'Share failed.');
    if (btn) { btn.disabled = false; btn.textContent = label || 'Share'; }
  }
}

// Paste an image while on the Lab browse screen → open the add modal with it.
document.addEventListener('paste', (e) => {
  if (!labActive() || labModalOpen) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  const items = e.clipboardData && e.clipboardData.items; if (!items) return;
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const blob = it.getAsFile();
      if (blob) { e.preventDefault(); const m = labAddModal(null); m.setImage(blob); }
      return;
    }
  }
});

// ========================================================================
// Shared notes — live collaboration
// ========================================================================
// One tab becomes a "shared note": a row in Supabase that other signed-in
// users are invited into by username. Everyone in the note edits the same text
// at the same time.
//
// The `shared_notes` row is the single source of truth, and its `rev` column is
// what puts every change in one agreed order. A client:
//
//   1. remembers the revision it last accepted (`base` + `rev`);
//   2. writes with `... where id = ? and rev = ?`, so the write only lands if
//      nothing else has been accepted meanwhile (a database trigger bumps rev);
//   3. on losing that race, re-reads the row, rebases its own text onto the
//      accepted revision with a line-level three-way merge, and tries again.
//
// Everyone therefore rebases onto the same sequence of revisions, which is what
// makes two buffers converge instead of quietly disagreeing. Peer-to-peer
// snapshot swapping does *not* have that property — with messages crossing in
// flight there is no common ancestor to merge against, and the two sides settle
// on different text (found by the fuzz test that drove this design).
//
// The merge (shMerge3) keeps both people's work when they're on different
// lines. On the same line the accepted revision wins, unless the local caret is
// sitting in it — then the local text is kept and pushed as the next revision,
// so nothing is yanked out from under a cursor mid-sentence.
//
// Realtime carries the accepted revision to the other clients the moment it
// lands (with postgres_changes on the row as the backstop), plus presence and
// the "…is typing" pings. It is delivery, never authority.
const shInvitesBtn = document.getElementById('invitesBtn');
const shInvitesBadge = document.getElementById('invitesBadge');
const shInvitesPanel = document.getElementById('invitesPanel');
const shInvitesList = document.getElementById('invitesList');
const shCollabBar = document.getElementById('collabBar');
const shCollabState = document.getElementById('collabState');
const shCollabPeople = document.getElementById('collabPeople');
const shCollabTyping = document.getElementById('collabTyping');
const shCollabShareBtn = document.getElementById('collabShareBtn');
const shShareOverlay = document.getElementById('shareOverlay');
const shShareClose = document.getElementById('shareClose');
const shShareNoteName = document.getElementById('shareNoteName');
const shShareInviteRow = document.getElementById('shareInviteRow');
const shShareUserInput = document.getElementById('shareUserInput');
const shShareRoleSelect = document.getElementById('shareRoleSelect');
const shShareInviteBtn = document.getElementById('shareInviteBtn');
const shShareStatus = document.getElementById('shareStatus');
const shSharePeople = document.getElementById('sharePeople');
const shShareLeaveBtn = document.getElementById('shareLeaveBtn');
const shShareLeaveDialog = document.getElementById('shareLeaveDialog');
const shShareLeaveLabel = document.getElementById('shareLeaveLabel');
const shShareLeaveText = document.getElementById('shareLeaveText');
const shShareLeaveCancel = document.getElementById('shareLeaveCancel');
const shShareLeaveConfirm = document.getElementById('shareLeaveConfirm');

const SH_PUSH_DELAY = 400;    // keystroke → write
const SH_RETRY_DELAY = 900;   // backoff after a write that errored outright
const SH_TYPING_TTL = 2600;   // how long a "typing" ping keeps someone lit up
const SH_LCS_CELLS = 250000;  // ceiling on the merge DP table (see shRegions)

let shInvites = [];              // pending invites addressed to me
const shLive = new Map();        // noteId → { chan, status, base, rev, peers, … }
let shInviteChan = null;         // realtime channel carrying my incoming invites
let shShareTabId = null;         // tab open in the Share dialog

function shConfigured() {
  return !!(window.DISCOVER_CONFIGURED && settings.collabEnabled !== false);
}
function shReady() {
  return !!(shConfigured() && dcClient && dcSession && dcProfile);
}
function shUid() {
  return (dcSession && dcSession.user && dcSession.user.id) || null;
}
function shName() {
  return (dcProfile && dcProfile.username) || 'me';
}
function shTabFor(noteId) {
  return state.tabs.find((t) => t.shareId === noteId) || null;
}
// True while the given tab's text lives in the editor DOM rather than t.content
// (markdown preview hides the editor and edits t.content directly).
function shTabIsLive(tab) {
  return !!(tab && tab.id === state.activeId && !tab.md &&
    !fsActive() && !aiChatActive() && !discoverActive() && !labActive());
}
function shBufferOf(tab) {
  return shTabIsLive(tab) ? getEditorText() : (tab.content || '');
}

// ---------- three-way line merge ----------
// Longest common subsequence over two line arrays, as matched index pairs.
function shLcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Express `side` as a list of edits against `base`: replace base[lo..hi) with
// `lines`. Common head/tail lines are trimmed first, which is what keeps the
// LCS table tiny for the usual case (one edited line in a long note).
function shRegions(base, side) {
  const limit = Math.min(base.length, side.length);
  let head = 0;
  while (head < limit && base[head] === side[head]) head++;
  let tail = 0;
  while (tail < limit - head &&
         base[base.length - 1 - tail] === side[side.length - 1 - tail]) tail++;

  const a = base.slice(head, base.length - tail);
  const b = side.slice(head, side.length - tail);
  if (!a.length && !b.length) return [];
  // Too big to diff line-by-line — treat the whole middle as one edit. That is
  // exactly what a wholesale rewrite (paste, AI action, undo) actually is.
  if (a.length * b.length > SH_LCS_CELLS) {
    return [{ lo: head, hi: head + a.length, lines: b }];
  }

  const regions = [];
  let bi = 0;
  let si = 0;
  for (const [pb, ps] of shLcsPairs(a, b)) {
    if (pb > bi || ps > si) regions.push({ lo: head + bi, hi: head + pb, lines: b.slice(si, ps) });
    bi = pb + 1;
    si = ps + 1;
  }
  if (bi < a.length || si < b.length) {
    regions.push({ lo: head + bi, hi: head + a.length, lines: b.slice(si) });
  }
  return regions;
}

// Merge `mine` and `theirs`, both descended from `base`. Edits that don't
// overlap are all kept. For the ones that do, `preferMine(lo, hi)` decides —
// see shWinsClash, which makes that call the same way on both machines so the
// two buffers can't settle on different text.
function shMerge3(baseTxt, mineTxt, theirsTxt, preferMine) {
  if (mineTxt === theirsTxt) return mineTxt;
  if (baseTxt === mineTxt) return theirsTxt;   // I changed nothing
  if (baseTxt === theirsTxt) return mineTxt;   // they changed nothing

  const base = baseTxt.split('\n');
  const edits = shRegions(base, mineTxt.split('\n')).map((r) => ({ ...r, mine: true }))
    .concat(shRegions(base, theirsTxt.split('\n')).map((r) => ({ ...r, mine: false })))
    .sort((x, y) => x.lo - y.lo || x.hi - y.hi);

  const out = [];
  let cursor = 0;
  let k = 0;
  while (k < edits.length) {
    // Gather every edit that touches this stretch of base. Two edits that start
    // at the same line clash even when one of them is a pure insertion (hi===lo).
    let lo = edits[k].lo;
    let hi = edits[k].hi;
    let end = k + 1;
    while (end < edits.length && (edits[end].lo < hi || edits[end].lo === lo)) {
      hi = Math.max(hi, edits[end].hi);
      end++;
    }
    const cluster = edits.slice(k, end);
    const clash = cluster.some((r) => r.mine) && cluster.some((r) => !r.mine);
    const keepMine = clash && !!preferMine(lo, hi);

    out.push(...base.slice(cursor, lo));
    let at = lo;
    for (const r of cluster) {
      if (clash && r.mine !== keepMine) continue;
      out.push(...base.slice(at, r.lo));
      out.push(...r.lines);
      at = Math.max(at, r.hi);
    }
    out.push(...base.slice(at, hi));
    cursor = hi;
    k = end;
  }
  out.push(...base.slice(cursor));
  return out.join('\n');
}

// ---------- editor patching ----------
// Rewrite only the lines that actually differ. setEditorText() would rebuild
// every line on every remote keystroke, which loses the caret and flickers
// image thumbnails in a long note.
function shPatchEditor(next) {
  const lines = next.split('\n');
  const cur = editorLines();
  for (let i = 0; i < lines.length; i++) {
    if (i < cur.length) {
      if (cur[i].textContent !== lines[i]) cur[i].replaceWith(makeLine(lines[i]));
    } else {
      editorEl.appendChild(makeLine(lines[i]));
    }
  }
  while (editorEl.children.length > lines.length) editorEl.lastElementChild.remove();
  updateLineDirs();
  updateEmptyState();
}

function shCaretPos() {
  const line = currentLine();
  if (!line) return null;
  const idx = editorLines().indexOf(line);
  if (idx < 0) return null;
  return { line: idx, offset: getCaretOffsetIn(line) || 0, text: line.textContent };
}

// Put the caret back on *its* line after a merge shifted the note around it.
// Search outward from where it was rather than taking the first textual match,
// so a repeated line elsewhere in the note doesn't steal the cursor.
function shRestoreCaret(pos, lines) {
  if (!pos) return;
  const els = editorLines();
  if (!els.length) return;
  let idx = -1;
  for (let d = 0; d < lines.length && idx < 0; d++) {
    if (pos.line - d >= 0 && lines[pos.line - d] === pos.text) idx = pos.line - d;
    else if (pos.line + d < lines.length && lines[pos.line + d] === pos.text) idx = pos.line + d;
  }
  if (idx < 0) idx = Math.min(pos.line, els.length - 1);
  const el = els[Math.min(idx, els.length - 1)];
  placeCaretInLine(el, Math.min(pos.offset, el.textContent.length));
}

// ---------- channels ----------
function shConnect(noteId) {
  if (!shReady() || shLive.has(noteId)) return;
  const tab = shTabFor(noteId);
  if (!tab) return;

  const rec = {
    chan: null,
    status: 'connecting',
    // The revision we last accepted: `base` is its text, `rev` its number. Both
    // move only when a revision is accepted — ours or someone else's.
    base: tab.shareBase != null ? tab.shareBase : (tab.content || ''),
    rev: Number(tab.shareRev) || 0,
    peers: [],
    typing: new Map(),   // uid → { username, until }
    typingSentAt: 0,
    typingTimer: null,
    pushTimer: null,
    pushing: false,
    wantPush: false
  };
  shLive.set(noteId, rec);

  const chan = dcClient.channel('ppnote:' + noteId, {
    config: { presence: { key: shUid() }, broadcast: { self: false } }
  });
  rec.chan = chan;

  // A revision that has already been accepted by the database, relayed by the
  // client that wrote it so the others don't wait on replication.
  chan.on('broadcast', { event: 'rev' }, ({ payload }) => {
    if (!payload || payload.from === shUid()) return;
    shApplyTitle(noteId, payload.title);
    shApplyRemote(noteId, String(payload.content || ''), Number(payload.rev) || 0);
  });

  chan.on('broadcast', { event: 'typing' }, ({ payload }) => {
    if (!payload || payload.from === shUid()) return;
    rec.typing.set(payload.from, { username: payload.username || '…', until: Date.now() + SH_TYPING_TTL });
    shUpdateBar();
    // One pending repaint, not one per ping — that's what clears "…is typing"
    // when the other side stops.
    clearTimeout(rec.typingTimer);
    rec.typingTimer = setTimeout(shUpdateBar, SH_TYPING_TTL + 60);
  });

  chan.on('presence', { event: 'sync' }, () => {
    const st = chan.presenceState() || {};
    rec.peers = Object.keys(st).map((key) => {
      const first = (st[key] && st[key][0]) || {};
      return { uid: first.uid || key, username: first.username || '…' };
    });
    shUpdateBar();
  });

  // The backstop for a relay that never arrived. Applying the same revision
  // twice is free — shApplyRemote only acts on a rev it hasn't seen.
  chan.on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'shared_notes', filter: 'id=eq.' + noteId },
    ({ new: row }) => {
      if (!row) return;
      shApplyTitle(noteId, row.title);
      shApplyRemote(noteId, String(row.content || ''), Number(row.rev) || 0);
    });

  // The owner ended the share, or someone was removed from it.
  chan.on('postgres_changes',
    { event: 'DELETE', schema: 'public', table: 'shared_notes', filter: 'id=eq.' + noteId },
    () => shDetach(noteId, true));
  chan.on('postgres_changes',
    { event: 'DELETE', schema: 'public', table: 'note_members', filter: 'note_id=eq.' + noteId },
    ({ old: row }) => { if (row && row.user_id === shUid()) shDetach(noteId, true); });

  chan.subscribe(async (status) => {
    const live = shLive.get(noteId);
    if (live !== rec) return; // a reconnect replaced us
    if (status === 'SUBSCRIBED') {
      rec.status = 'live';
      try { await chan.track({ uid: shUid(), username: shName() }); } catch {}
      await shPull(noteId);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      rec.status = 'offline';
    }
    shUpdateBar();
  });
}

function shDisconnect(noteId) {
  const rec = shLive.get(noteId);
  if (!rec) return;
  clearTimeout(rec.pushTimer);
  clearTimeout(rec.typingTimer);
  // Don't lose an edit that was still sitting on the debounce. shPush captures
  // what it needs synchronously, so it survives the removal just below.
  shPush(noteId);
  shLive.delete(noteId);
  try { if (rec.chan) dcClient.removeChannel(rec.chan); } catch {}
}

function shDisconnectAll() {
  Array.from(shLive.keys()).forEach(shDisconnect);
}

// Open a channel for every shared tab in the current profile, and close the
// ones whose tab is gone (closed, or left behind by a profile switch).
function shSyncChannels() {
  if (!shReady()) { shDisconnectAll(); shUpdateBar(); return; }
  const want = new Set(state.tabs.filter((t) => t.shareId).map((t) => t.shareId));
  Array.from(shLive.keys()).forEach((id) => { if (!want.has(id)) shDisconnect(id); });
  want.forEach((id) => { if (!shLive.has(id)) shConnect(id); });
  shUpdateBar();
}

async function shReadRow(noteId) {
  try {
    const { data, error } = await dcClient
      .from('shared_notes').select('title,content,rev').eq('id', noteId).maybeSingle();
    if (error) { console.error('shared note read failed', error); return null; }
    if (!data) { shDetach(noteId, true); return null; }  // deleted, or we were removed
    return data;
  } catch (err) {
    console.error('shared note read failed', err);
    return null;
  }
}

// Catch up with the row: on joining the channel, and after losing a write race.
async function shPull(noteId) {
  if (!shLive.has(noteId)) return;
  const row = await shReadRow(noteId);
  const rec = shLive.get(noteId);
  if (!row || !rec) return;
  shApplyTitle(noteId, row.title);
  shApplyRemote(noteId, String(row.content || ''), Number(row.rev) || 0);
  // Edits made while the app was closed (or offline) exist only here — nothing
  // else would ever notice them, so get them into the row now that we're back.
  const tab = shTabFor(noteId);
  if (tab && shBufferOf(tab) !== rec.base) shQueuePush(noteId, 0);
}

// A shared note has one name for everyone, so the tab name and the note title
// are the same string kept in step — renaming the tab renames it for the others.
function shApplyTitle(noteId, title) {
  const tab = shTabFor(noteId);
  if (!tab || title == null) return;
  const next = String(title).slice(0, 60);
  if (tab.name === next) return;
  tab.name = next;
  tab.custom = !!tab.name;
  renderTabs();
  if (shShareTabId === tab.id) {
    shShareNoteName.textContent = autoName(tab, state.tabs.indexOf(tab));
  }
  scheduleSave();
}

async function shPushTitle(tab) {
  if (!tab || !tab.shareId || tab.shareRole === 'viewer') return;
  const title = autoName(tab, state.tabs.indexOf(tab)).slice(0, 60);
  try {
    await dcClient.from('shared_notes').update({ title, updated_by: shUid() }).eq('id', tab.shareId);
  } catch (err) {
    console.error('shared note rename failed', err);
  }
}

// ---------- accepting a revision ----------
// Rebase this client's buffer onto revision `rev`. Applying a revision we've
// already accepted is a no-op, which is what makes the relay and the
// postgres_changes backstop safe to run side by side.
function shApplyRemote(noteId, content, rev) {
  const rec = shLive.get(noteId);
  const tab = shTabFor(noteId);
  if (!rec || !tab) return;
  if (!(rev > rec.rev)) return;

  const onScreen = shTabIsLive(tab);
  const mine = shBufferOf(tab);
  const caret = onScreen ? shCaretPos() : null;
  // A clash on the line the caret is in keeps the local text — and because the
  // rebase is then pushed as the next revision, that choice reaches everyone
  // instead of quietly disagreeing with the row.
  const merged = shMerge3(rec.base, mine, content, (lo, hi) =>
    !!caret && caret.line >= lo && caret.line <= hi);

  rec.base = content;
  rec.rev = rev;
  tab.shareBase = content;
  tab.shareRev = rev;

  if (merged !== mine) {
    tab.content = merged;
    if (onScreen) {
      shPatchEditor(merged);
      shRestoreCaret(caret, merged.split('\n'));
      updateCounts();
      updatePlaceholderPanel();
    } else if (tab.md && tab.id === state.activeId) {
      renderMdPreview();
    }
    // A note whose title is blank still auto-names itself from its first line.
    if (!tab.custom) { if (onScreen) updateActiveTabName(tab); else renderTabs(); }
    scheduleSave();
  }

  // Our rebase produced text the row doesn't have yet — it still has to land.
  if (merged !== content) shQueuePush(noteId, SH_PUSH_DELAY);
  shUpdateBar();
}

// ---------- writing a revision ----------
function shQueuePush(noteId, delay) {
  const rec = shLive.get(noteId);
  if (!rec) return;
  clearTimeout(rec.pushTimer);
  rec.pushTimer = setTimeout(() => shPush(noteId), delay == null ? SH_PUSH_DELAY : delay);
}

// Write the local text as the next revision, but only if nothing else has been
// accepted since the one we rebased onto — that `eq('rev', …)` is the whole
// concurrency story. Losing the race isn't an error: re-read, rebase, retry.
async function shPush(noteId) {
  const rec = shLive.get(noteId);
  const tab = shTabFor(noteId);
  if (!rec || !tab || tab.shareRole === 'viewer') return;
  if (rec.pushing) { rec.wantPush = true; return; }
  const body = shBufferOf(tab);
  if (body === rec.base) return;

  rec.pushing = true;
  try {
    const { data, error } = await dcClient
      .from('shared_notes')
      .update({ content: body, updated_by: shUid() })
      .eq('id', noteId).eq('rev', rec.rev)
      .select('content,rev,title');
    if (error) {
      console.error('shared note write failed', error);
      shQueuePush(noteId, SH_RETRY_DELAY);
      return;
    }
    if (data && data.length) {
      const row = data[0];
      rec.base = String(row.content || '');
      rec.rev = Number(row.rev) || rec.rev + 1;
      tab.shareBase = rec.base;
      tab.shareRev = rec.rev;
      shRelay(rec, row);
      return;
    }
    // No row came back: someone else's revision landed first. Take theirs and
    // rebase onto it — shApplyRemote queues the retry, but only if the rebase
    // still leaves us with something the row doesn't have.
    const row = await shReadRow(noteId);
    if (!row || !shLive.has(noteId)) return;
    shApplyTitle(noteId, row.title);
    shApplyRemote(noteId, String(row.content || ''), Number(row.rev) || 0);
  } catch (err) {
    console.error('shared note write failed', err);
  } finally {
    rec.pushing = false;
    if (rec.wantPush) { rec.wantPush = false; shQueuePush(noteId, 0); }
  }
}

// Hand the accepted revision straight to the other clients rather than making
// them wait for replication. Purely a shortcut — postgres_changes carries the
// same thing, and shApplyRemote ignores whichever arrives second.
function shRelay(rec, row) {
  if (rec.status !== 'live' || !rec.chan) return;
  try {
    rec.chan.send({
      type: 'broadcast', event: 'rev',
      payload: {
        content: String(row.content || ''), rev: Number(row.rev) || 0,
        title: row.title, from: shUid()
      }
    });
  } catch (err) {
    console.error('shared note relay failed', err);
  }
}

// Called whenever a shared tab's text may have changed. Cheap and idempotent —
// it no-ops when the buffer already matches the accepted revision, which is why
// doSave() can sweep every shared tab through it.
function shLocalEdit(tab) {
  if (!tab || !tab.shareId || tab.shareRole === 'viewer') return;
  const rec = shLive.get(tab.shareId);
  if (!rec || rec.status !== 'live') return;
  if (shBufferOf(tab) === rec.base) return;

  shQueuePush(tab.shareId, SH_PUSH_DELAY);

  // "…is typing" for the others, throttled well below the write rate.
  if (Date.now() - rec.typingSentAt > 1500) {
    rec.typingSentAt = Date.now();
    try {
      rec.chan.send({
        type: 'broadcast', event: 'typing',
        payload: { from: shUid(), username: shName() }
      });
    } catch {}
  }
}

// ---------- presence bar ----------
const SH_AVATAR_COLORS = TAB_COLORS.filter(Boolean);

function shColorFor(uid) {
  let h = 0;
  for (let i = 0; i < (uid || '').length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return SH_AVATAR_COLORS[h % SH_AVATAR_COLORS.length];
}

function shUpdateBar() {
  if (!shCollabBar) return;
  const tab = activeTab();
  const on = !!(tab && tab.shareId && shConfigured() &&
    !fsActive() && !aiChatActive() && !discoverActive() && !labActive());

  shCollabBar.classList.toggle('hidden', !on);
  const readonly = !!(on && tab.shareRole === 'viewer');
  editorEl.classList.toggle('collab-readonly', readonly);
  editorEl.setAttribute('contenteditable', readonly ? 'false' : 'plaintext-only');
  if (!on) return;

  const rec = shLive.get(tab.shareId);
  const status = rec ? rec.status : 'offline';
  shCollabState.className = 'collab-state ' + (status === 'live' ? 'live' : status === 'offline' ? 'offline' : '');
  shCollabState.title = status === 'live'
    ? tr('collab.live', 'Connected — edits are shared live')
    : status === 'offline'
      ? tr('collab.offline', 'Offline — your edits are saved and will sync when you reconnect')
      : tr('collab.connecting', 'Connecting…');

  const peers = (rec && rec.peers) || [];
  shCollabPeople.innerHTML = '';
  peers.slice(0, 6).forEach((p) => {
    const a = document.createElement('span');
    a.className = 'collab-avatar' + (p.uid === shUid() ? ' is-me' : '');
    a.style.background = shColorFor(p.uid);
    a.textContent = (p.username || '?').slice(0, 1);
    a.title = '@' + (p.username || '') + (p.uid === shUid() ? ' (' + tr('collab.you', 'you') + ')' : '');
    shCollabPeople.appendChild(a);
  });

  const now = Date.now();
  const typing = Array.from((rec ? rec.typing : new Map()).entries())
    .filter(([, v]) => v.until > now)
    .map(([, v]) => v.username);
  if (typing.length === 1) {
    shCollabTyping.textContent = '@' + typing[0] + ' ' + tr('collab.isTyping', 'is typing…');
  } else if (typing.length > 1) {
    shCollabTyping.textContent = typing.length + ' ' + tr('collab.areTyping', 'people are typing…');
  } else if (readonly) {
    shCollabTyping.textContent = tr('collab.viewOnly', 'View only');
  } else {
    shCollabTyping.textContent = peers.length > 1
      ? peers.length + ' ' + tr('collab.here', 'here')
      : tr('collab.aloneHere', 'Only you here');
  }
}

// ---------- turning a tab into a shared note ----------
async function shShareTab(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (!shConfigured()) {
    showToast('Shared notes are turned off', '');
    return;
  }
  if (!shReady()) {
    showToast('Sign in on the Discover tab first', '');
    switchToDiscover();
    return;
  }
  if (tab.shareId) { shOpenShareDialog(tabId); return; }

  if (tab.id === state.activeId) { commitMdBlockEdit(); syncEditorToState(); }
  const title = autoName(tab, state.tabs.indexOf(tab)).slice(0, 60);
  try {
    const { data, error } = await dcClient
      .from('shared_notes')
      .insert({ owner_id: shUid(), title, content: tab.content || '', dir: tab.dir || 'auto' })
      .select('id,rev')
      .single();
    if (error || !data) throw error || new Error('insert failed');
    tab.shareId = data.id;
    tab.shareRole = 'owner';
    tab.shareOwner = shName();
    tab.shareBase = tab.content || '';
    tab.shareRev = Number(data.rev) || 1;
    // Pin the name down: from here the tab name IS the note title everyone sees,
    // so it must not keep drifting with the first line of the text.
    tab.name = title;
    tab.custom = !!title;
    renderTabs();
    scheduleSave();
    shConnect(data.id);
    shUpdateBar();
    shOpenShareDialog(tabId);
  } catch (err) {
    console.error('share failed', err);
    showToast("Couldn't share that note", '');
  }
}

// Unlink a tab from its note. The text stays exactly where it is — it just goes
// back to being an ordinary local tab.
function shDetach(noteId, tell) {
  const tab = shTabFor(noteId);
  shDisconnect(noteId);
  if (tab) {
    const name = autoName(tab, state.tabs.indexOf(tab));
    delete tab.shareId;
    delete tab.shareRole;
    delete tab.shareOwner;
    delete tab.shareBase;
    delete tab.shareRev;
    renderTabs();
    scheduleSave();
    if (tell) showToast('Sharing ended for', name);
  }
  if (shShareTabId && tab && shShareTabId === tab.id) shCloseShareDialog();
  shUpdateBar();
}

// ---------- share dialog ----------
function shShareDialogOpen() { return !shShareOverlay.classList.contains('hidden'); }

function shOpenShareDialog(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || !tab.shareId) return;
  shShareTabId = tabId;
  shShareStatus.className = 'dc-form-status';
  shShareStatus.textContent = '';
  shShareUserInput.value = '';
  shShareNoteName.textContent = autoName(tab, state.tabs.indexOf(tab));
  shShareNoteName.setAttribute('dir', detectDir(shShareNoteName.textContent));

  const owner = tab.shareRole === 'owner';
  shShareInviteRow.classList.toggle('hidden', !owner);
  shShareLeaveBtn.textContent = owner
    ? tr('collab.stopSharing', 'Stop sharing')
    : tr('collab.leaveNote', 'Leave note');
  shShareOverlay.classList.remove('hidden');
  shRenderPeople(tab);
  if (owner) setTimeout(() => shShareUserInput.focus(), 40);
}

function shCloseShareDialog() {
  shShareOverlay.classList.add('hidden');
  shShareTabId = null;
}

async function shRenderPeople(tab) {
  shSharePeople.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'share-person';
  loading.textContent = tr('collab.loading', 'Loading…');
  shSharePeople.appendChild(loading);
  let rows = [];
  try {
    const { data } = await dcClient.rpc('note_member_list', { nid: tab.shareId });
    rows = data || [];
  } catch (err) {
    console.error('member list failed', err);
  }
  if (shShareTabId !== tab.id) return;   // dialog moved on while we waited

  shSharePeople.innerHTML = '';
  const rank = (r) => (r.role === 'owner' ? 0 : r.state === 'member' ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || String(a.username).localeCompare(String(b.username)));

  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'share-person' + (r.state === 'pending' ? ' pending' : '');

    const dot = document.createElement('span');
    dot.className = 'collab-avatar';
    dot.style.background = shColorFor(r.user_id);
    dot.textContent = (r.username || '?').slice(0, 1);
    row.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'share-person-name';
    name.textContent = '@' + (r.username || '') + (r.user_id === shUid() ? ' (' + tr('collab.you', 'you') + ')' : '');
    row.appendChild(name);

    const role = document.createElement('span');
    role.className = 'share-person-role';
    role.textContent = r.state === 'pending'
      ? tr('collab.invited', 'invited')
      : r.role === 'owner' ? tr('collab.owner', 'owner')
        : r.role === 'viewer' ? tr('collab.canView', 'can view')
          : tr('collab.canEdit', 'can edit');
    row.appendChild(role);

    // Only the owner prunes the roster, and never themselves.
    if (tab.shareRole === 'owner' && r.role !== 'owner') {
      const rm = document.createElement('button');
      rm.className = 'share-person-remove';
      rm.innerHTML = '&times;';
      rm.title = r.state === 'pending'
        ? tr('collab.cancelInvite', 'Cancel invitation')
        : tr('collab.removePerson', 'Remove from note');
      rm.addEventListener('click', () => shRemovePerson(tab, r, rm));
      row.appendChild(rm);
    }
    shSharePeople.appendChild(row);
  });
}

async function shRemovePerson(tab, person, btn) {
  btn.disabled = true;
  try {
    if (person.state === 'pending') {
      await dcClient.from('note_invites')
        .delete().eq('note_id', tab.shareId).eq('to_id', person.user_id).eq('status', 'pending');
    } else {
      await dcClient.from('note_members')
        .delete().eq('note_id', tab.shareId).eq('user_id', person.user_id);
    }
    shRenderPeople(tab);
  } catch (err) {
    console.error('remove failed', err);
    btn.disabled = false;
  }
}

const SH_INVITE_ERRORS = {
  no_user: 'No user with that username.',
  self: "That's you.",
  already_member: 'They are already in this note.',
  already_invited: 'They already have a pending invitation.',
  not_owner: 'Only the note owner can invite people.'
};

async function shSendInvite() {
  const tab = state.tabs.find((t) => t.id === shShareTabId);
  if (!tab || !tab.shareId) return;
  const username = shShareUserInput.value.trim();
  shShareStatus.className = 'dc-form-status';
  if (!username) { shShareStatus.textContent = tr('collab.enterUsername', 'Enter a username.'); return; }

  shShareInviteBtn.disabled = true;
  const label = shShareInviteBtn.textContent;
  shShareInviteBtn.textContent = tr('collab.sending', 'Sending…');
  try {
    const { data, error } = await dcClient.rpc('invite_to_note', {
      nid: tab.shareId, uname: username, r: shShareRoleSelect.value
    });
    if (error) throw error;
    if (data && data.ok) {
      shShareStatus.classList.add('ok');
      shShareStatus.textContent = tr('collab.inviteSent', 'Invitation sent to') + ' @' + (data.username || username);
      shShareUserInput.value = '';
      shRenderPeople(tab);
    } else {
      shShareStatus.classList.add('err');
      const key = (data && data.error) || '';
      shShareStatus.textContent = tr('collab.err.' + key, SH_INVITE_ERRORS[key] || 'Could not send that invitation.');
    }
  } catch (err) {
    shShareStatus.classList.add('err');
    shShareStatus.textContent = (err && err.message) || 'Could not send that invitation.';
  } finally {
    shShareInviteBtn.disabled = false;
    shShareInviteBtn.textContent = label;
  }
}

// "Stop sharing" (owner) deletes the note for everyone; "Leave note" (guest)
// only drops your own membership. Confirmed through an in-app dialog rather
// than window.confirm() — a native dialog can render behind this always-on-top
// window, and the renderer sits blocked waiting for a click the user can't
// reach, which looks exactly like the whole app freezing.
function shOpenLeaveDialog() {
  const tab = state.tabs.find((t) => t.id === shShareTabId);
  if (!tab || !tab.shareId) return;
  const owner = tab.shareRole === 'owner';
  shShareLeaveLabel.textContent = owner
    ? tr('collab.stopSharing', 'Stop sharing')
    : tr('collab.leaveNote', 'Leave note');
  shShareLeaveText.textContent = owner
    ? tr('collab.confirmStop', 'Stop sharing this note? Everyone else loses access — your copy stays.')
    : tr('collab.confirmLeave', 'Leave this note? Your copy of the text stays here.');
  shShareLeaveConfirm.textContent = owner
    ? tr('collab.stopSharing', 'Stop sharing')
    : tr('collab.leaveNote', 'Leave note');
  shShareLeaveDialog.classList.remove('hidden');
}

function shCloseLeaveDialog() {
  shShareLeaveDialog.classList.add('hidden');
}

async function shConfirmLeaveOrStop() {
  const tab = state.tabs.find((t) => t.id === shShareTabId);
  shCloseLeaveDialog();
  if (!tab || !tab.shareId) return;
  const owner = tab.shareRole === 'owner';
  const noteId = tab.shareId;
  shShareLeaveBtn.disabled = true;
  try {
    // Get any last edit into the row before we lose write access to it.
    const rec = shLive.get(noteId);
    if (rec) { clearTimeout(rec.pushTimer); await shPush(noteId); }
    if (owner) await dcClient.from('shared_notes').delete().eq('id', noteId);
    else await dcClient.from('note_members').delete().eq('note_id', noteId).eq('user_id', shUid());
  } catch (err) {
    console.error('leave/stop failed', err);
  } finally {
    shShareLeaveBtn.disabled = false;
  }
  shCloseShareDialog();
  shDetach(noteId, false);
  showToast(owner ? 'Stopped sharing' : 'Left the note', '');
}

// ---------- invitations ----------
async function shLoadInvites() {
  if (!shReady()) { shInvites = []; shRenderInvites(); return; }
  try {
    const { data, error } = await dcClient.rpc('my_note_invites');
    shInvites = error ? [] : (data || []);
  } catch (err) {
    console.error('invite load failed', err);
    shInvites = [];
  }
  shRenderInvites();
}

function shRenderInvites() {
  if (!shInvitesBtn) return;
  const n = shInvites.length;
  shInvitesBtn.classList.toggle('hidden', !shReady());
  shInvitesBtn.classList.toggle('has-invites', n > 0);
  shInvitesBadge.classList.toggle('hidden', n === 0);
  shInvitesBadge.textContent = n > 9 ? '9+' : String(n);

  shInvitesList.innerHTML = '';
  if (!n) {
    const empty = document.createElement('div');
    empty.className = 'invites-empty';
    empty.textContent = tr('collab.noInvites', 'No invitations right now.');
    shInvitesList.appendChild(empty);
    return;
  }
  shInvites.forEach((inv) => {
    const row = document.createElement('div');
    row.className = 'invite-row';

    const text = document.createElement('div');
    text.className = 'invite-text';
    const who = document.createElement('b');
    who.textContent = '@' + (inv.from_username || '');
    text.appendChild(who);
    text.appendChild(document.createTextNode(' ' + tr('collab.invitedYouTo', 'invited you to') + ' '));
    const noteName = document.createElement('span');
    noteName.textContent = '“' + (inv.note_title || 'a note') + '”';
    noteName.setAttribute('dir', detectDir(inv.note_title || ''));
    text.appendChild(noteName);
    row.appendChild(text);

    const role = document.createElement('div');
    role.className = 'invite-role';
    role.textContent = inv.role === 'viewer'
      ? tr('collab.asViewer', 'You can read it.')
      : tr('collab.asEditor', 'You can edit it with them.');
    row.appendChild(role);

    const actions = document.createElement('div');
    actions.className = 'invite-actions';
    const accept = document.createElement('button');
    accept.className = 'invite-btn invite-btn--accept';
    accept.textContent = tr('collab.accept', 'Accept');
    const decline = document.createElement('button');
    decline.className = 'invite-btn';
    decline.textContent = tr('collab.decline', 'Decline');
    accept.addEventListener('click', () => shRespondInvite(inv, true, [accept, decline]));
    decline.addEventListener('click', () => shRespondInvite(inv, false, [accept, decline]));
    actions.appendChild(accept);
    actions.appendChild(decline);
    row.appendChild(actions);

    shInvitesList.appendChild(row);
  });
}

async function shRespondInvite(inv, accept, btns) {
  btns.forEach((b) => { b.disabled = true; });
  let noteId = null;
  try {
    const { data, error } = await dcClient.rpc('respond_note_invite', { iid: inv.id, accept });
    if (error) throw error;
    if (data && data.ok && accept) noteId = data.note_id || inv.note_id;
  } catch (err) {
    console.error('invite response failed', err);
    btns.forEach((b) => { b.disabled = false; });
    return;
  }
  shInvites = shInvites.filter((i) => i.id !== inv.id);
  shRenderInvites();
  if (!shInvites.length) shCloseInvitesPanel();
  if (noteId) await shAdoptNote(noteId);
}

// Accepting an invite drops the note into the profile you're in right now, as a
// normal tab carrying a share badge.
async function shAdoptNote(noteId) {
  const existing = shTabFor(noteId);
  if (existing) { switchTab(existing.id); return; }

  let note = null;
  try {
    const { data } = await dcClient.rpc('my_shared_notes');
    note = (data || []).find((n) => n.id === noteId) || null;
  } catch (err) {
    console.error('shared note fetch failed', err);
  }
  if (!note) { showToast("Couldn't open that note", ''); return; }

  commitMdBlockEdit();
  syncEditorToState();
  const tab = {
    id: uid(),
    name: (note.title || '').slice(0, 60),
    custom: !!note.title,
    content: note.content || '',
    dir: note.dir || 'auto',
    align: 'auto',
    color: null,
    md: false,
    shareId: note.id,
    shareRole: note.role || 'editor',
    shareOwner: note.owner_username || '',
    shareBase: note.content || '',
    shareRev: Number(note.rev) || 0
  };
  state.tabs.push(tab);
  state.activeId = tab.id;
  showEditorView();
  setEditorText(tab.content);
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
  applyEditorAlign();
  applyMdView();
  scheduleSave();
  shConnect(note.id);
  shUpdateBar();
  showToast('Joined', '@' + (note.owner_username || '') + ' · ' + (note.title || ''));
}

// A new invite row landed for me.
async function shOnInviteArrived() {
  const before = new Set(shInvites.map((i) => i.id));
  await shLoadInvites();
  const fresh = shInvites.filter((i) => !before.has(i.id));
  if (!fresh.length) return;
  const inv = fresh[0];
  showToast('New invitation from', '@' + (inv.from_username || ''));
  // The in-app bell is enough when the user is already looking at PromptPad;
  // a desktop toast is for when they aren't.
  if (document.hasFocus()) return;
  try {
    await window.api.notify({
      kind: 'invite',
      title: tr('collab.notifTitle', 'PromptPad — shared note'),
      body: '@' + (inv.from_username || '') + ' ' +
        tr('collab.invitedYouTo', 'invited you to') + ' “' + (inv.note_title || '') + '”'
    });
  } catch (err) {
    console.error('notify failed', err);
  }
}

function shSubscribeInvites() {
  if (!shReady() || shInviteChan) return;
  const uid = shUid();
  shInviteChan = dcClient.channel('ppinvites:' + uid);
  shInviteChan.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'note_invites', filter: 'to_id=eq.' + uid },
    () => shOnInviteArrived());
  // Someone added me to a note directly (or an invite of mine was accepted
  // elsewhere) — refresh the badge either way.
  shInviteChan.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'note_members', filter: 'user_id=eq.' + uid },
    () => shLoadInvites());
  shInviteChan.subscribe();
}

function shUnsubscribeInvites() {
  if (!shInviteChan) return;
  try { dcClient.removeChannel(shInviteChan); } catch {}
  shInviteChan = null;
}

function shOpenInvitesPanel() {
  if (!shReady()) return;
  const r = shInvitesBtn.getBoundingClientRect();
  shInvitesPanel.classList.remove('hidden');
  const w = shInvitesPanel.offsetWidth;
  shInvitesPanel.style.top = Math.round(r.bottom + 6) + 'px';
  shInvitesPanel.style.left = Math.round(Math.max(6, Math.min(r.right - w, window.innerWidth - w - 6))) + 'px';
  shLoadInvites();
}

function shCloseInvitesPanel() { shInvitesPanel.classList.add('hidden'); }
function shInvitesPanelOpen() { return !shInvitesPanel.classList.contains('hidden'); }

// ---------- lifecycle ----------
// Sign-in, sign-out, and the Settings toggle all land here.
function shRefresh() {
  if (!shReady()) {
    shUnsubscribeInvites();
    shDisconnectAll();
    shInvites = [];
    shCloseInvitesPanel();
    shCloseLeaveDialog();
    if (shShareDialogOpen()) shCloseShareDialog();
    shRenderInvites();
    shUpdateBar();
    return;
  }
  shSubscribeInvites();
  shLoadInvites();
  shSyncChannels();
}

// ---------- wiring ----------
if (shInvitesBtn) {
  shInvitesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (shInvitesPanelOpen()) shCloseInvitesPanel();
    else shOpenInvitesPanel();
  });
}
document.addEventListener('click', (e) => {
  if (shInvitesPanelOpen() && !shInvitesPanel.contains(e.target) && !shInvitesBtn.contains(e.target)) {
    shCloseInvitesPanel();
  }
});

if (shCollabShareBtn) {
  shCollabShareBtn.addEventListener('click', () => {
    const t = activeTab();
    if (t && t.shareId) shOpenShareDialog(t.id);
  });
}
if (shShareClose) shShareClose.addEventListener('click', shCloseShareDialog);
if (shShareOverlay) {
  shShareOverlay.addEventListener('click', (e) => {
    if (e.target === shShareOverlay) shCloseShareDialog();
  });
}
if (shShareInviteBtn) shShareInviteBtn.addEventListener('click', shSendInvite);
if (shShareUserInput) {
  shShareUserInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); shSendInvite(); }
  });
}
if (shShareLeaveBtn) shShareLeaveBtn.addEventListener('click', shOpenLeaveDialog);
if (shShareLeaveCancel) shShareLeaveCancel.addEventListener('click', shCloseLeaveDialog);
if (shShareLeaveConfirm) shShareLeaveConfirm.addEventListener('click', shConfirmLeaveOrStop);
function shLeaveDialogOpen() { return !shShareLeaveDialog.classList.contains('hidden'); }

// Clicking the desktop toast brings the window forward — land on the invites.
if (window.api.onNotificationClick) {
  window.api.onNotificationClick((kind) => {
    if (kind === 'invite') setTimeout(shOpenInvitesPanel, 120);
    // the toast only brings the window forward — the banner does the asking
    if (kind === 'donate') donateBannerEl.classList.remove('hidden');
  });
}
window.addEventListener('focus', () => {
  try { window.api.stopFlash(); } catch {}
});

// ---------- Init ----------
(async function init() {
  // Platform-specific copy — the setting/shortcut itself already works
  // cross-platform, only the wording was hardcoded to Windows.
  if (window.api.platform === 'darwin') {
    const startupHintEl = document.getElementById('startupHint');
    if (startupHintEl) startupHintEl.textContent = 'Open PromptPad when your Mac starts';
  }

  const savedSettings = await window.api.loadSettings();
  settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  // ensure every toolbar key exists even if an older save lacked some
  settings.toolbar = { ...DEFAULT_SETTINGS.toolbar, ...(settings.toolbar || {}) };
  // fresh object, never the shared DEFAULT_SETTINGS.imageGen reference
  settings.imageGen = { ...DEFAULT_SETTINGS.imageGen, ...(settings.imageGen || {}) };
  settings.seenFeatures = { ...(settings.seenFeatures || {}) };
  settings.voice = { ...DEFAULT_SETTINGS.voice, ...(settings.voice || {}) };
  settings.ai = { ...DEFAULT_SETTINGS.ai, ...(settings.ai || {}) };
  settings.zenMode = false; // focus mode is per-session; never boot into a chromeless window
  settings.tabPosition = 'left'; // the top layout was removed — always the left rail
  // `helpLang` used to switch only the Settings help text; it's now the whole UI
  // language, so anyone who had it on Persian carries over.
  if (!savedSettings || savedSettings.language === undefined) {
    settings.language = settings.helpLang === 'fa' ? 'fa' : 'en';
  }
  // `editorJustify` was a boolean; it's now one mode of the 5-way editorAlign.
  if (savedSettings && savedSettings.editorAlign === undefined && savedSettings.editorJustify) {
    settings.editorAlign = 'justify';
  }
  // reflect real OS startup state
  try { settings.launchAtStartup = await window.api.getStartup(); } catch {}
  applySettings();

  // Re-enter handy (peek) dock if it was on last time — start collapsed. Do
  // this BEFORE the potentially-slow loadState() so the collapse (which also
  // reveals the window when it booted hidden) is never gated behind notes
  // loading; a cold-boot load stall used to leave a dead full-size window.
  if (settings.handyEnabled === false) settings.handyMode = false;
  if (settings.handyMode) {
    appEl.classList.add('handy-mode');
    appEl.classList.remove('handy-open');
    handyBtn.classList.add('active');
    handyBtn.title = tr('handy.exitTitle', 'Exit handy mode') + ' (' + handyShortcutLabel() + ')';
    window.api.handyEnter(settings.handyPosition);
  }

  // Profile registry first, so the chip is correct on the very first paint.
  try {
    const reg = await window.api.listProfiles();
    if (reg) { profiles = reg.profiles || []; activeProfileId = reg.activeProfileId || null; }
  } catch {}

  const hadSaved = await loadState();
  maybeShowWhatsNew(hadSaved);
  maybeAnnounceProThemes(hadSaved);
  maybeShowDonatePrompt(hadSaved);
  applyActiveView();
  renderProfileChip();

  const onTop = await window.api.getAlwaysOnTop();
  pinBtn.classList.toggle('active', onTop);

  try { applyMaximized(await window.api.isMaximized()); } catch {}

  buildCtxColorRow();

  // A quick-capture popup (separate window) forwards its text/image here; we
  // append it to Fast Save without the app window ever coming to the front.
  // A capture that lands mid profile-switch is queued rather than written into
  // a workspace that's about to be replaced (it would be lost) — see
  // drainPendingQc().
  window.api.onQcMessage((payload) => {
    if (profileSwitching) { pendingQc.push(payload); return; }
    handleQcMessage(payload);
  });
  // Push the saved quick-capture accelerator into main before enabling, so the
  // shortcut registers on the user's chosen combo (not just the built-in default).
  try { await window.api.setQuickCaptureShortcut(settings.quickCaptureShortcut); } catch {}
  if (settings.quickCaptureEnabled) {
    try {
      settings.quickCaptureEnabled = !!(await window.api.setQuickCapture(true));
    } catch { settings.quickCaptureEnabled = false; }
  }

  // Register the global show/hide-handy shortcut (falls back to the local
  // Ctrl+Shift+D handler if this fails, e.g. the combo is already taken).
  try {
    handyGlobalOK = !!(await window.api.setHandyShortcut(settings.handyShortcut));
  } catch { handyGlobalOK = false; }

  // Discover (shared prompt gallery) — connect to Supabase in the background.
  // Shared notes ride the same client, so they come up with it.
  dcInit().then(() => {
    if (discoverActive()) dcRender();
    shRefresh();
    dcSyncAdminNotify();
  });
  renderTabs(); // so the Discover rail entry shows if configured

  // close overlays with Escape (priority: lightbox > ctx menu > find bar > dialogs > overlays)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!cmdPalette.classList.contains('hidden')) { closeCommandPalette(); return; }
    if (shLeaveDialogOpen()) { shCloseLeaveDialog(); return; }
    if (shShareDialogOpen()) { shCloseShareDialog(); return; }
    if (shInvitesPanelOpen()) { shCloseInvitesPanel(); return; }
    if (!profileNameDialog.classList.contains('hidden')) { closeProfileNameDialog(); return; }
    if (!profileDeleteDialog.classList.contains('hidden')) { closeProfileDelete(); return; }
    if (profileMenuOpen()) { closeProfileMenu(); return; }
    if (!aiActionsMenu.classList.contains('hidden')) { hideAiActionsMenu(); return; }
    if (!mdCommandsMenu.classList.contains('hidden')) { hideMdCommandsMenu(); return; }
    if (settings.zenMode) { toggleZen(false); return; }
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
    if (mdOn() && !fsActive()) { setMdPreview(false); return; }
    if (!saveTemplateDialog.classList.contains('hidden')) { closeSaveTemplateDialog(); return; }
    if (!groupNameDialog.classList.contains('hidden')) { closeGroupDialog(); return; }
    if (!historyOverlay.classList.contains('hidden')) { closeHistory(); return; }
    if (!templatesOverlay.classList.contains('hidden')) { closeTemplates(); return; }
    if (!settingsOverlay.classList.contains('hidden')) { closeSettings(); return; }
  });

  if (!fsActive()) editorEl.focus();

  // auto-check for updates after short delay (silent — banner only if newer version found)
  if (settings.autoCheckUpdates) {
    setTimeout(() => checkForUpdates(true), 3000);
  }
})();
