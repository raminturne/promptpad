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
  promptLab: [], // { id, ts, title, prompt, category, image?, audio?, video? } — local personal prompt library
  blocks: null,  // { id, name, body } — reusable prompt pieces, typed as "@name". null = never seeded
  phPresets: []  // { id, name, values: { '[token]': 'value' } } — saved placeholder fills
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
  themeFont: true,              // let a theme that ships a typeface use it
  animations: true,             // panel slides, view fades, the rail closing
  fxVolume: 60,                 // 0-100, for the themes that make sound
  seenThemes: [],               // themes already shown to this user; the rest get a NEW mark
  favThemes: [],                // starred in the theme browser, shown first
  recentThemes: [],             // last few themes picked, after the starred ones
  blocksEnabled: true,          // "@" opens the block picker in a note
  slashEnabled: true,           // "/" opens the command picker in a note
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
    md: true, paste: true, copy: true, img: true, table: true, genimg: true, files: true
  },
  seenFeatures: {}, // { improve: true, aiChat: true, ... } — clears each button's "New" badge once used
  voice: { hfApiKey: '' }, // Hugging Face token for speech-to-text (Whisper)
  // Each user brings their own key for Chat / Improve / AI actions. The
  // `openrouterKey` name is unchanged from when OpenRouter was the only
  // backend, so existing saves keep working with no migration step.
  ai: {
    provider: 'openrouter', // openrouter | openai | google | anthropic | custom
    model: 'auto',          // 'auto' walks the provider's list; anything else pins one model
    openrouterKey: '',
    openaiKey: '',
    googleKey: '',
    anthropicKey: '',
    customUrl: '',          // any OpenAI-compatible endpoint (Groq, Ollama, LM Studio…)
    customKey: '',
    customModels: ''        // comma-separated, as typed
  },
  customAiActions: [], // { id, name, prompt } — user-written actions in the AI menu
  recentAiPrompts: [], // last few one-shot custom instructions, most recent first
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
const fullscreenBtn = document.getElementById('fullscreenBtn');
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
const fontRow = document.getElementById('fontRow');
const themeFontRow = document.getElementById('themeFontRow');
const toggleThemeFontEl = document.getElementById('toggleThemeFont');
const fxVolumeRange = document.getElementById('fxVolumeRange');
const fxVolumeValue = document.getElementById('fxVolumeValue');
const fxVolumeRow = document.getElementById('fxVolumeRow');
const toggleAnimationsEl = document.getElementById('toggleAnimations');
const toggleBlocksEl = document.getElementById('toggleBlocks');
const toggleSlashEl = document.getElementById('toggleSlash');
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
const voiceNoteBtn = document.getElementById('voiceNoteBtn');
const videoBtn = document.getElementById('videoBtn');
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
const lightboxVideoEl = document.getElementById('lightboxVideo');
const lightboxFsBtnEl = document.getElementById('lightboxFsBtn');
const lightboxCloseBtnEl = document.getElementById('lightboxCloseBtn');
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
// AI provider / model pickers and the per-provider key fields
const aiProviderSelectEl = document.getElementById('aiProviderSelect');
const aiModelSelectEl = document.getElementById('aiModelSelect');
const aiOpenaiKeyInputEl = document.getElementById('aiOpenaiKeyInput');
const aiGoogleKeyInputEl = document.getElementById('aiGoogleKeyInput');
const aiAnthropicKeyInputEl = document.getElementById('aiAnthropicKeyInput');
const aiCustomUrlInputEl = document.getElementById('aiCustomUrlInput');
const aiCustomKeyInputEl = document.getElementById('aiCustomKeyInput');
const aiCustomModelsInputEl = document.getElementById('aiCustomModelsInput');
const aiModelRefreshBtn = document.getElementById('aiModelRefresh');
const aiModelStatusEl = document.getElementById('aiModelStatus');
const AI_PROVIDER_FIELD_IDS = {
  openrouter: 'aiOpenrouterFields', openai: 'aiOpenaiFields', google: 'aiGoogleFields',
  anthropic: 'aiAnthropicFields', custom: 'aiCustomFields'
};
// Custom AI actions (settings list + the instruction dialog)
const customActionsListEl = document.getElementById('customActionsList');
const customActionAddBtn = document.getElementById('customActionAdd');
const aiCustomDialog = document.getElementById('aiCustomDialog');
const aiCustomInput = document.getElementById('aiCustomInput');
const aiCustomScope = document.getElementById('aiCustomScope');
const aiCustomSaveChk = document.getElementById('aiCustomSave');
const aiCustomNameRow = document.getElementById('aiCustomNameRow');
const aiCustomName = document.getElementById('aiCustomName');
const aiCustomCancel = document.getElementById('aiCustomCancel');
const aiCustomRun = document.getElementById('aiCustomRun');
const toolbarMainEl = document.getElementById('toolbarMain');
const toolbarOverflowBtnEl = document.getElementById('toolbarOverflowBtn');
const toolbarOverflowPanelEl = document.getElementById('toolbarOverflowPanel');
const linkDialog = document.getElementById('linkDialog');
const linkTextInput = document.getElementById('linkTextInput');
const linkUrlInput = document.getElementById('linkUrlInput');
const linkCancel = document.getElementById('linkCancel');
const linkSave = document.getElementById('linkSave');
const tableBtn = document.getElementById('tableBtn');
const tableDialog = document.getElementById('tableDialog');
const tableRowsInput = document.getElementById('tableRowsInput');
const tableColsInput = document.getElementById('tableColsInput');
const tableCancel = document.getElementById('tableCancel');
const tableSave = document.getElementById('tableSave');
// image context menu
const imgContextMenu = document.getElementById('imgContextMenu');
const textContextMenu = document.getElementById('textContextMenu');
const aiActionsMenu = document.getElementById('aiActionsMenu');
const mdCommandsMenu = document.getElementById('mdCommandsMenu');
const toggleImageResizeEl = document.getElementById('toggleImageResize');
const toggleImageDownloadEl = document.getElementById('toggleImageDownload');
const toggleMdImageFullSizeEl = document.getElementById('toggleMdImageFullSize');
const toggleMdShortcutsEl = document.getElementById('toggleMdShortcuts');
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

// Strong left-to-right letters. Digits, punctuation and spaces are NOT in here
// on purpose: a line that holds only "1." or "—" has no direction of its own,
// and forcing it to ltr is what used to throw the caret to the left edge in
// the middle of a Persian note.
const LTR_STRONG_RE = /[A-Za-z\u00C0-\u02AF\u0370-\u04FF\u1E00-\u1FFF\u2C60-\u2C7F\uA720-\uA7FF]/;

// The direction of one line, given what came before it. An empty or purely
// neutral line inherits `fallback` — the direction of the nearest line above
// that did have letters — so the caret stays on the side you were typing on
// instead of snapping back to the left on every Enter.
function lineDirFor(text, fallback) {
  const t = text || '';
  if (RTL_RE.test(t)) return 'rtl';
  if (LTR_STRONG_RE.test(t)) return 'ltr';
  return fallback === 'rtl' ? 'rtl' : 'ltr';
}

// Where a note with nothing directional in it starts: follow the UI language,
// so a Persian install opens a blank note with the caret on the right.
function uiDefaultDir() {
  return (settings && settings.language === 'fa') ? 'rtl' : 'ltr';
}

// Prompt-template blanks like [topic] or {name} — single line only.
const PLACEHOLDER_RE = /\[[^\[\]\r\n]+\]|\{[^{}\r\n]+\}/g;

// Inline image token: ![img](ppimg://<filename>) with an optional stored
// display width: ![img](ppimg://<filename>|<px>)
const IMG_TOKEN_RE = /!\[img\]\(ppimg:\/\/([a-zA-Z0-9._-]+)(?:\|(\d+))?\)/g;

function imgToken(filename, width) {
  return '![img](ppimg://' + filename + (width ? '|' + Math.round(width) : '') + ')';
}

// Inline video token, the same shape as the image one so everything that
// already understands "a media file with an optional stored display width"
// — resize, download, the markdown preview — needs one extra branch rather
// than a parallel implementation.
const VIDEO_TOKEN_RE = /!\[video\]\(ppimg:\/\/([a-zA-Z0-9._-]+)(?:\|(\d+))?\)/g;

function videoToken(filename, width) {
  return '![video](ppimg://' + filename + (width ? '|' + Math.round(width) : '') + ')';
}

// Inline voice token. The number after the pipe is the clip's length in
// milliseconds, not a width: a voice note is a fixed-size chip, and knowing
// how long it runs before the file has loaded is what lets the collapsed pill
// show "0:14" straight away instead of flashing a dash.
const VOICE_TOKEN_RE = /!\[voice\]\(ppimg:\/\/([a-zA-Z0-9._-]+)(?:\|(\d+))?\)/g;

function voiceToken(filename, ms) {
  return '![voice](ppimg://' + filename + (ms ? '|' + Math.round(ms) : '') + ')';
}

// m:ss, the way every voice message everywhere is labelled.
function clipLength(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
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
  const cleaned = (text || '')
    .replace(IMG_TOKEN_RE, '')
    .replace(VIDEO_TOKEN_RE, '')
    .replace(VOICE_TOKEN_RE, '')
    .replace(MDLINK_RE, '');
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

function animationsOn() { return settings.animations !== false; }

// Hide an element through its exit animation rather than dropping it. Without
// this every panel in the app opened with a slide and closed with a blink.
//
// `animationend` is the signal, with a timer behind it: an element that is
// display:none by the time the class lands never fires the event, and neither
// does one whose animation the reduced-motion rules collapsed to nothing.
function hideWithAnim(el, cls, after) {
  if (!el || el.classList.contains('hidden')) return;
  const finish = () => {
    if (!el.classList.contains(cls)) return;   // already finished
    el.classList.remove(cls);
    el.classList.add('hidden');
    if (after) after();
  };
  if (!animationsOn()) { el.classList.add('hidden'); if (after) after(); return; }
  el.classList.add(cls);
  const onEnd = (e) => {
    if (e.target !== el) return;               // a child's animation is not ours
    el.removeEventListener('animationend', onEnd);
    finish();
  };
  el.addEventListener('animationend', onEnd);
  setTimeout(() => { el.removeEventListener('animationend', onEnd); finish(); }, 400);
}

// Replay a one-shot CSS animation on an element. Removing the class, forcing
// a reflow and putting it back is the only way to restart one — without the
// reflow the browser coalesces both writes and nothing happens.
function replayAnim(el, cls) {
  if (!el || !animationsOn()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function setEditorText(text) {
  editorEl.innerHTML = '';
  const lines = (text || '').split('\n');
  for (const line of lines) editorEl.appendChild(makeLine(line));
  updateLineDirs();
  updateEmptyState();
  // The whole note was replaced — a tab switch, an undo, a whole-tab AI action.
  // Never fires on ordinary typing, which makes it the signal a theme effect
  // needs to re-read the note it's decorating (see the Ghosts theme in fx.js).
  document.dispatchEvent(new CustomEvent('pp:note-loaded'));
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
  const videoMatches = [...text.matchAll(VIDEO_TOKEN_RE)];
  const voiceMatches = [...text.matchAll(VOICE_TOKEN_RE)];
  const boldMatches = [...text.matchAll(MD_BOLD_RE)];
  const strikeMatches = [...text.matchAll(MD_STRIKE_RE)];
  const hiliteMatches = [...text.matchAll(MD_HILITE_RE)];
  const linkMatches = [...text.matchAll(MDLINK_RE)];
  // Only isolate the marker when the line actually needs it — an LTR line
  // reorders correctly on its own, and an extra span there is pure churn.
  const blockM = detectDir(text) === 'rtl' && !todoM ? text.match(MD_BLOCKMARK_RE) : null;
  el.classList.toggle('todo-done', !!(todoM && todoM[2] === 'x'));
  if (!phMatches.length && !todoM && !imgMatches.length && !videoMatches.length &&
      !voiceMatches.length && !boldMatches.length &&
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
    for (const m of videoMatches) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'img-token',
        file: m[1], width: m[2] ? Number(m[2]) : null, video: true });
    }
    // Voice is the one piece of media that renders where it is written rather
    // than under the line. That is the whole point of it: a note can say a
    // sentence, then a clip, then carry on in the same breath.
    for (const m of voiceMatches) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls: 'voice-token',
        file: m[1], ms: m[2] ? Number(m[2]) : 0 });
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
        // The literal token stays in the DOM (hidden) so getEditorText still
        // round-trips; the chip that follows carries no text of its own.
        if (r.cls === 'voice-token') el.appendChild(makeVoiceChip(r.file, r.ms));
        else if (r.file) imgs.push({ file: r.file, width: r.width, video: r.video });
      }
      last = r.end;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));

    // thumbnails after the text (contribute no textContent). Wrapped so a
    // resize handle can sit in the corner without disturbing editor text.
    for (const im of imgs) {
      el.appendChild(im.video ? makeVideoThumb(im.file, im.width)
                              : makeImgThumb(im.file, im.width));
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
  // Carries the last decided direction downward so blank / digits-only lines
  // keep the side you were typing on. Seeded from the first line that does
  // have letters, so a leading blank line above Persian text is RTL too.
  let carry = null;
  if (!forced) {
    for (const d of editorLines()) {
      const txt = d.textContent;
      if (RTL_RE.test(txt)) { carry = 'rtl'; break; }
      if (LTR_STRONG_RE.test(txt)) { carry = 'ltr'; break; }
    }
    if (!carry) carry = uiDefaultDir();
  }
  editorLines().forEach((d) => {
    if (!d.classList.contains('ln')) d.classList.add('ln');
    const want = forced || (carry = lineDirFor(d.textContent, carry));
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

// Bails on the first line that has any text, so the usual answer costs one
// property read. getEditorText() joined every line in the note into one string
// just to compare it with '' — on a long note that was a full copy of the text
// on every keystroke, on top of the copy handleEditorChanged already makes.
function editorIsEmpty() {
  // Mirrors getEditorText() === '' exactly: two blank lines join to '\\n',
  // which is NOT empty, so the line count matters as much as the text.
  let lines = 0;
  for (const n of editorEl.childNodes) {
    if (n.nodeType === 3) {
      if (n.textContent !== '') return false; // stray text
    } else if (n.nodeType === 1) {
      if (++lines > 1) return false;
      if (n.textContent !== '') return false;
    }
  }
  return true;
}

function updateEmptyState() {
  editorEl.classList.toggle('is-empty', editorIsEmpty());
}

// kept as a single entry point used around the app
function applyEditorDir() {
  updateLineDirs();
  updateEmptyState();
}

// Delegates to placeCaretInLine on the last .ln rather than collapsing a
// range selected over editorEl itself. The two look equivalent, but they are
// not: selectNodeContents(editorEl) + collapse(false) leaves the Range's
// container at the EDITOR level (offset = editorEl.childNodes.length), not
// inside the last line's text. currentLineSelection() cannot resolve a line
// from that container-level point and silently returns null — which every
// caller here happens to tolerate (the two/three lines below fall back to
// currentLine(), or to appending at the end), but a feature that reads the
// caret to decide what to insert (Insert table, splitting text around it)
// silently lost that information the moment the caret was placed this way.
function placeCaretEnd() {
  const lines = editorLines();
  const last = lines[lines.length - 1];
  if (last) { placeCaretInLine(last, last.textContent.length); return; }
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
  // A locked note auto-named from its first line would print the very text the
  // lock exists to hide, straight into the rail. A name the user typed is
  // their own choice and stays.
  if (tab.locked) return tr('lock.tabName', 'Locked note');
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
  // One trim, not two — this runs on every keystroke against the whole note.
  const len = text.trim().length;
  return len ? Math.max(Math.ceil(len / 4), 1) : 0;
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

  const typed = parsePhToken(token);

  const label = document.createElement('label');
  // A typed token's label is the part before the "|" — showing the whole
  // "[tone|formal, casual, funny]" would push the options off the row twice.
  label.textContent = typed ? typed.label : token;
  label.title = token;
  label.setAttribute('dir', detectDir(label.textContent));

  const input = typed
    ? document.createElement('select')
    : document.createElement('input');
  if (typed) {
    // A blank first option so opening the bar doesn't silently commit the
    // first choice to a note the user hasn't decided about yet.
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '—';
    input.appendChild(blank);
    typed.options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      input.appendChild(opt);
    });
  } else {
    input.type = 'text';
    input.placeholder = 'Type value…';
    // [date] / [time] / [clipboard] arrive already filled in; it's still just
    // a text box, so it can be edited or cleared before Enter.
    const auto = autoPhValue(token);
    if (auto) input.value = auto;
  }

  // suggest previously used values for this token
  const dl = document.createElement('datalist');
  dl.id = 'ph-dl-' + uid();
  const refreshSuggestions = () => {
    if (typed) return;
    dl.innerHTML = '';
    ((state.phValues && state.phValues[token]) || []).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      dl.appendChild(opt);
    });
  };
  refreshSuggestions();
  if (!typed) input.setAttribute('list', dl.id);

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
  confirmBtn.disabled = !String(input.value || '').trim();
  input.addEventListener('input', () => {
    confirmBtn.disabled = !input.value.trim();
    updatePreview();
  });
  if (typed) {
    // Picking from the list is the decision — there is nothing else to type,
    // so waiting for Enter as well would just be an extra key.
    input.addEventListener('change', () => {
      confirmBtn.disabled = !input.value;
      updatePreview();
      if (input.value) commit();
    });
  }
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
  // Reading the clipboard is async, so it's kicked off here and the panel
  // rebuilds itself if the text turns out to have changed.
  if (tokens.some((tok) => /clipboard/i.test(tok))) refreshPhClipboard();

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

// Move the "which one is open" highlight without touching the rail's DOM.
// renderTabs() tears the whole list down and rebuilds it, which is right when
// the list itself changed (added, closed, reordered, renamed) and wrong for a
// plain switch — every tab, badge and group header being replaced is what made
// clicking a tab look like the app reloading.
// The one tab that should animate into the rail on the next render. Cleared as
// soon as it is used, so a later rebuild (a rename, a reorder) doesn't replay
// the entrance on a row that has been sitting there.
let _tabEnterId = null;

function syncRailActive() {
  tabListEl.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === state.activeId);
  });
  updateFastSaveBtn();
  updateAiChatBtn();
  if (discoverBtn) discoverBtn.classList.toggle('active', discoverActive());
  if (promptLabBtn) promptLabBtn.classList.toggle('active', labActive());
}

function renderTabs() {
  const entering = _tabEnterId;
  _tabEnterId = null;
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
    if (tab.id === entering) el.className += ' tab-entering';
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

    // A locked note carries a padlock, open or shut depending on whether the
    // vault is — the difference between "nobody can read this" and "it is
    // readable right now on this machine" is worth showing at a glance.
    if (tab.locked) {
      const lockEl = document.createElement('span');
      lockEl.className = 'tab-lock';
      const shut = !vaultOpen();
      lockEl.innerHTML =
        '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
        '<rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
        (shut
          ? '<path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"'
          : '<path d="M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2"') +
        ' fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
      lockEl.title = shut
        ? tr('lock.badgeShut', 'Locked — encrypted on disk')
        : tr('lock.badgeOpen', 'Locked note, unlocked for this session');
      el.appendChild(lockEl);
    }

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
  replayAnim(editorBodyEl, 'view-entering');
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
  replayAnim(fastSaveViewEl, 'view-entering');
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
  replayAnim(aiChatViewEl, 'view-entering');
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
  replayAnim(discoverViewEl, 'view-entering');
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
  replayAnim(promptLabViewEl, 'view-entering');
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
  syncRailActive();
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
  syncRailActive();
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
  syncRailActive();
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
  syncRailActive();
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

// ---------- AI providers ----------
// Everything the UI needs to know about a backend, keyed by the id stored in
// settings.ai.provider. The model lists themselves live in main.js and arrive
// via aiProviders() at boot, so the two processes can't drift apart.
const AI_PROVIDER_META = {
  openrouter: {
    label: 'OpenRouter', keyField: 'openrouterKey',
    prefix: 'sk-or-v1-', signup: 'https://openrouter.ai/keys',
    input: 'aiApiKeyInput', free: true
  },
  openai: {
    label: 'OpenAI', keyField: 'openaiKey',
    prefix: 'sk-', signup: 'https://platform.openai.com/api-keys',
    input: 'aiOpenaiKeyInput'
  },
  google: {
    label: 'Google AI Studio', keyField: 'googleKey',
    prefix: 'AIza', signup: 'https://aistudio.google.com/apikey',
    input: 'aiGoogleKeyInput'
  },
  anthropic: {
    label: 'Anthropic (Claude)', keyField: 'anthropicKey',
    prefix: 'sk-ant-', signup: 'https://console.anthropic.com/settings/keys',
    input: 'aiAnthropicKeyInput'
  },
  custom: {
    label: 'Custom endpoint', keyField: 'customKey',
    prefix: '', signup: '',
    input: 'aiCustomUrlInput'
  }
};
const AI_PROVIDER_IDS = Object.keys(AI_PROVIDER_META);

// Model catalog from main.js — { [providerId]: { family, models } }.
let aiProviderCatalog = {};

function aiProvider() {
  const p = settings.ai && settings.ai.provider;
  return AI_PROVIDER_IDS.includes(p) ? p : 'openrouter';
}

// The active provider's key. Named aiKey() since that's what every existing
// call site uses; it just isn't OpenRouter-only any more.
function aiKey() {
  const meta = AI_PROVIDER_META[aiProvider()];
  return (settings.ai && settings.ai[meta.keyField]) || '';
}

// Models fetched from the provider with the user's own key, kept per provider
// so switching back and forth doesn't refetch. Persisted, because a model list
// is stable for days and a cold start shouldn't show a stale hard-coded list.
function aiModelCache() {
  if (!settings.ai.modelCache || typeof settings.ai.modelCache !== 'object') {
    settings.ai.modelCache = {};
  }
  return settings.ai.modelCache;
}

// Models offered for the active provider, best source first: what the provider
// actually told us, else the hand-typed list (custom endpoints), else the
// curated fallback that ships with the app.
function aiModelsFor(id) {
  const cached = aiModelCache()[id];
  if (cached && Array.isArray(cached.models) && cached.models.length) {
    return cached.models.map((m) => (typeof m === 'string' ? m : m.id));
  }
  if (id === 'custom') {
    return String((settings.ai && settings.ai.customModels) || '')
      .split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  const entry = aiProviderCatalog[id];
  return entry && Array.isArray(entry.models) ? entry.models : [];
}

// Same list, but keeping the free/paid split so the picker can group it —
// OpenRouter returns several hundred models and an ungrouped list is unusable.
function aiModelEntriesFor(id) {
  const cached = aiModelCache()[id];
  if (cached && Array.isArray(cached.models) && cached.models.length) {
    return cached.models.map((m) => (typeof m === 'string' ? { id: m, free: false } : m));
  }
  return aiModelsFor(id).map((m) => ({ id: m, free: false }));
}

// Everything main.js needs to make one request. Passed straight through the
// preload bridge, so the shape here is the contract.
function aiOpts() {
  const id = aiProvider();
  const ai = settings.ai || {};
  return {
    provider: id,
    model: ai.model || 'auto',
    apiKey: aiKey(),
    baseUrl: ai.customUrl || '',
    models: ai.customModels || ''
  };
}

// Can we actually make a call? A custom endpoint needs a URL and a model but
// no key (a local Ollama or LM Studio has none); everything else needs a key.
function aiReady() {
  if (aiProvider() === 'custom') {
    const ai = settings.ai || {};
    return !!String(ai.customUrl || '').trim() && aiModelsFor('custom').length > 0;
  }
  return !!aiKey();
}

// The settings field to focus when a call fails for want of credentials — so
// "no key" sends the user to the RIGHT input, not always OpenRouter's.
function aiKeyInputEl() {
  return document.getElementById(AI_PROVIDER_META[aiProvider()].input) || aiApiKeyInputEl;
}

// Shared by every "you have no key yet" path.
function promptForAiKey() {
  openSettings();
  // The key field for the current provider is only revealed by syncSettingsUI.
  setTimeout(() => { const el = aiKeyInputEl(); if (el) revealSetting(el).focus(); }, 60);
}

// Bilingual (English + Persian) onboarding card shown in AI Chat when there are
// no credentials yet. Parameterised by provider rather than forked per
// provider, so all five stay in sync.
function buildAiOnboardCard() {
  const id = aiProvider();
  const meta = AI_PROVIDER_META[id];
  const card = document.createElement('div');
  card.className = 'ai-onboard';

  if (id === 'custom') {
    card.innerHTML =
      '<div class="ai-onboard-title">✨ Set up your endpoint  ·  تنظیم سرویس دلخواه</div>' +
      '<div class="ai-onboard-body">' +
        '<p>You picked <b>Custom endpoint</b>. Add an OpenAI-compatible URL and at least one model name in Settings — a key is optional for local runtimes like Ollama or LM Studio.</p>' +
        '<hr class="ai-onboard-sep">' +
        '<p dir="rtl">حالتِ <b>سرویس دلخواه</b> رو انتخاب کردی. توی تنظیمات یه آدرسِ سازگار با OpenAI و حداقل یک نامِ مدل وارد کن — برای سرویس‌های محلی مثل Ollama یا LM Studio کلید لازم نیست.</p>' +
      '</div>' +
      '<div class="ai-onboard-actions">' +
        '<button type="button" class="ai-onboard-btn primary js-settings">Open Settings · تنظیمات</button>' +
      '</div>';
  } else {
    const freeEn = meta.free
      ? 'run on <b>your own free ' + meta.label + ' key</b>, so you get your own limits'
      : 'run on <b>your own ' + meta.label + ' key</b>';
    const freeFa = meta.free
      ? 'با <b>کلیدِ رایگانِ خودت</b> کار می‌کنن تا لیمیتِ خودتو داشته باشی'
      : 'با <b>کلیدِ ' + meta.label + ' خودت</b> کار می‌کنن';
    card.innerHTML =
      '<div class="ai-onboard-title">✨ Set up ' + meta.label + '  ·  فعال‌سازی هوش مصنوعی</div>' +
      '<div class="ai-onboard-body">' +
        '<p>AI Chat, <b>Improve</b> and the AI actions ' + freeEn + '. Takes ~1 minute:</p>' +
        '<ol>' +
          '<li>Tap <b>Get key</b> → sign in → create a key.</li>' +
          '<li>Copy it' + (meta.prefix ? ' (starts with <code>' + meta.prefix + '</code>)' : '') + '.</li>' +
          '<li>Tap <b>Open Settings</b> and paste it under “AI Chat &amp; actions”.</li>' +
        '</ol>' +
        '<hr class="ai-onboard-sep">' +
        '<p dir="rtl">چت هوش مصنوعی، <b>Improve</b> و اکشن‌های AI ' + freeFa + '. حدود ۱ دقیقه:</p>' +
        '<ol dir="rtl">' +
          '<li>روی <b>دریافت کلید</b> بزن → وارد شو → یه کلید بساز.</li>' +
          '<li>کپیش کن' + (meta.prefix ? ' (با <code>' + meta.prefix + '</code> شروع می‌شه)' : '') + '.</li>' +
          '<li>روی <b>باز کردن تنظیمات</b> بزن و زیر «AI Chat &amp; actions» بذارش.</li>' +
        '</ol>' +
      '</div>' +
      '<div class="ai-onboard-actions">' +
        '<button type="button" class="ai-onboard-btn primary js-get">Get key · دریافت کلید</button>' +
        '<button type="button" class="ai-onboard-btn js-settings">Open Settings · تنظیمات</button>' +
      '</div>';
    const get = card.querySelector('.js-get');
    if (get) get.addEventListener('click', () => window.api.openExternal(meta.signup));
  }

  card.querySelector('.js-settings').addEventListener('click', promptForAiKey);
  return card;
}

function renderAiMessages() {
  aiMessagesEl.innerHTML = '';
  const msgs = aiMessages();
  if (!aiReady()) {
    // no credentials yet → focus the onboarding (chat history reappears once set)
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
  if (!aiReady()) { renderAiMessages(); promptForAiKey(); return; }
  hideAiError();
  aiInputEl.value = '';
  aiAutoGrow();
  updateAiInputDir();

  aiMessages().push({ id: uid(), ts: Date.now(), role: 'user', text });
  seedThemesSeen();
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
    const res = await window.api.chatMessage(history, aiOpts());
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
  replayAnim(mdOn() ? mdPreviewEl : editorEl, 'note-entering');
  applyLockView();
  syncRailActive();
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
  _tabEnterId = tab.id;   // renderTabs animates this one row in
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

// A note whose text is still encrypted cannot be closed. Otherwise the lock
// protects the content from being *read* and not at all from being destroyed,
// which is the wrong half — anyone at the keyboard could throw away work they
// were never able to see. Unlocking first is the whole requirement.
function sealedGuard(ids) {
  const sealed = ids.filter((id) => {
    const t = state.tabs.find((x) => x.id === id);
    return t && t.locked && !vaultOpen();
  });
  if (!sealed.length) return true;
  showToast(sealed.length === 1
    ? tr('lock.noClose', 'That note is locked. Unlock it before closing it.')
    : tr('lock.noCloseMany', 'Some of those notes are locked. Unlock them first.'));
  return false;
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  if (!sealedGuard([id])) return;
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

  // Lock / remove lock. Only one of the two is ever offered, and a sealed note
  // hides everything that would read its (absent) text.
  const lockItem = document.getElementById('ctxLockItem');
  const unlockItem = document.getElementById('ctxUnlockItem');
  lockItem.classList.toggle('hidden', !!tab.locked);
  unlockItem.classList.toggle('hidden', !tab.locked);
  const sealed = !!tab.locked && !vaultOpen();
  ['copy', 'export', 'save-template', 'history', 'duplicate'].forEach((a) => {
    const el = ctxMenuEl.querySelector('[data-action="' + a + '"]');
    if (el) el.classList.toggle('hidden', sealed);
  });

  // Sharing needs the Discover backend and a signed-in account behind it.
  const shareItem = ctxMenuEl.querySelector('.ctx-share-item');
  if (shareItem) {
    shareItem.classList.toggle('hidden', !shConfigured() || !!tab.locked);
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
    case 'lock': lockNote(id); break;
    case 'remove-lock': removeLock(id); break;
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

// ---------- in-app confirm / alert ----------
//
// Never call window.confirm() or window.alert() from here. This window is
// always-on-top and frameless, and a native dialog inside one is a trap on
// Windows: the dialog can open *behind* the window, and the renderer sits
// blocked waiting for a click on something the user cannot see. Worse, when
// the dialog does go away the window often does not get keyboard focus back —
// it still looks focused, because it is painted over everything else, but
// every keystroke goes somewhere else and the only fix is to quit and reopen.
// That is the "sometimes I can't type any more" bug, and it was reachable from
// the Lab's delete button.
//
// These return a promise instead of blocking, so the renderer keeps running
// and the caller reads as if it were the native one:
//
//     if (await appConfirm('Delete this?')) …
//
// Focus is taken deliberately on open and handed back on close, to whatever
// had it before — usually the editor.
let appDialogDepth = 0;

function appDialog(opts) {
  const { message, confirmLabel, cancelLabel, danger } = opts;
  const returnFocus = document.activeElement;
  const sel = window.getSelection && window.getSelection().rangeCount
    ? window.getSelection().getRangeAt(0).cloneRange()
    : null;
  appDialogDepth++;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'app-dialog-overlay';

    const box = document.createElement('div');
    box.className = 'app-dialog';

    const text = document.createElement('p');
    text.className = 'app-dialog-text';
    text.textContent = message;
    box.appendChild(text);

    const row = document.createElement('div');
    row.className = 'app-dialog-actions';

    let cancelBtn = null;
    if (cancelLabel !== null) {
      cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'app-dialog-btn';
      cancelBtn.textContent = cancelLabel || tr('dialog.cancel', 'Cancel');
      cancelBtn.addEventListener('click', () => done(false));
      row.appendChild(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'app-dialog-btn app-dialog-primary' + (danger ? ' app-dialog-danger' : '');
    okBtn.textContent = confirmLabel || tr('dialog.ok', 'OK');
    okBtn.addEventListener('click', () => done(true));
    row.appendChild(okBtn);

    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Keydown is captured, so Escape here never reaches the app underneath and
    // closes a panel behind the dialog as well.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      else if (e.key === 'Tab') {
        // Two buttons, so the trap is just "wrap at the ends".
        const els = cancelBtn ? [cancelBtn, okBtn] : [okBtn];
        const i = els.indexOf(document.activeElement);
        e.preventDefault();
        els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(false); });

    okBtn.focus();

    let settled = false;
    function done(value) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      appDialogDepth = Math.max(0, appDialogDepth - 1);
      // Hand focus back where it came from. Without this the caret is gone
      // after the dialog closes and typing does nothing — which is the whole
      // reason this function exists.
      try {
        if (returnFocus && document.contains(returnFocus) && returnFocus.focus) {
          returnFocus.focus();
          if (sel && returnFocus.isContentEditable) {
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(sel);
          }
        }
      } catch (e) { /* the element went away with the thing we just deleted */ }
      resolve(value);
    }
  });
}

function appConfirm(message, opts) {
  return appDialog(Object.assign({ message }, opts || {}));
}

function appAlert(message, opts) {
  return appDialog(Object.assign({ message, cancelLabel: null }, opts || {}));
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
    if (!sealedGuard(ids)) return;
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
  templatesOverlay.classList.remove('hidden', 'closing');
}

function closeTemplates() {
  hideWithAnim(templatesOverlay, 'closing');
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
  // Snapshots are persisted as plain text. Taking one of a locked note would
  // write the very thing the lock encrypts straight back to disk.
  if (t.locked) return;
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
  state.tabs.forEach((t) => { if (t.shareId && !t.locked) shLocalEdit(t); });
  // Persist only durable tab fields. undo/redo stacks (up to 100 full copies
  // of a tab's content each) and checkpoint bookkeeping are session-only;
  // serializing them into every autosave made saves grow with typing history
  // and bloated the data file on disk.
  // A locked note is written as ciphertext only. Re-encrypting is skipped when
  // the text hasn't moved since the last time (AES is cheap, but this runs on
  // a 350ms debounce behind every keystroke).
  if (vaultOpen()) {
    for (const t of state.tabs) {
      if (!t.locked) continue;
      if (t.enc && t._encOf === t.content) continue;
      try {
        t.enc = await aesEncrypt(vaultKey, sealPayload(t));
        t._encOf = t.content;
      } catch (e) { console.error('encrypt on save failed', e); }
    }
  }
  const tabs = state.tabs.map(
    ({ undoStack, redoStack, pendingCheckpoint, checkpointTimer, _encOf, ...t }) =>
      (t.locked ? { ...t, content: '', snapshots: [] } : t)
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
  // null (never seeded) is deliberately distinct from [] (seeded, then emptied
  // by hand) — otherwise deleting every block would resurrect the starters on
  // the next launch.
  state.blocks = Array.isArray(saved.blocks) ? saved.blocks : seedBlocks();
  state.phPresets = Array.isArray(saved.phPresets) ? saved.phPresets : [];
  // A profile switch can land while the vault is open, but the key belongs to
  // the install rather than the profile — the incoming notes are still sealed
  // until something asks for them.
  state.tabs.forEach((t) => {
    if (t.locked) { t.content = ''; t.snapshots = []; delete t._encOf; }
  });
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
  applyLockView();
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
  // One read of the editor per keystroke. This used to call getEditorText()
  // twice — once through updateEmptyState() and once for t.content — which on a
  // long note meant building the entire text twice for every character typed.
  const text = getEditorText();
  editorEl.classList.toggle('is-empty', text === '');
  const t = activeTab();
  if (t) {
    const prevContent = t.content;
    t.content = text;
    if (t.content !== prevContent) noteEditForUndo(t, prevContent);
    // Shared note: push this keystroke out on its own (short) debounce rather
    // than waiting for the 350ms autosave to notice.
    if (t.shareId && !t.locked && t.content !== prevContent) shLocalEdit(t);
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

// Tab indents inside the note instead of moving focus out of the editor.
// Two spaces, because that is what markdown nesting (lists, code) expects; a
// real 	 would collapse differently in pre-wrap and break list detection.
// Shift+Tab removes one level from the start of the line.
const INDENT = '  ';

function indentLines(lines, out) {
  let changed = false;
  for (const line of lines) {
    const text = line.textContent;
    if (out) {
      const m = text.match(/^[ \t]{1,2}/);
      if (!m) continue;
      line.textContent = text.slice(m[0].length);
    } else {
      line.textContent = INDENT + text;
    }
    highlightLine(line);
    changed = true;
  }
  return changed;
}

editorEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  normalizeStrayNodes();

  // A selection covering more than one line indents the whole block, the way
  // every editor does it — otherwise Tab would wipe the selected text.
  const range = sel.getRangeAt(0);
  const all = editorLines();
  const touched = all.filter((l) => range.intersectsNode(l));
  if (!range.collapsed && touched.length > 1) {
    if (indentLines(touched, e.shiftKey)) {
      const r = document.createRange();
      r.setStart(touched[0], 0);
      r.setEnd(touched[touched.length - 1], touched[touched.length - 1].childNodes.length);
      sel.removeAllRanges();
      sel.addRange(r);
      handleEditorChanged();
    }
    return;
  }

  const s = currentLineSelection();
  if (!s) return;
  const text = s.line.textContent;
  if (e.shiftKey) {
    const m = text.match(/^[ \t]{1,2}/);
    if (!m) return;
    setLineText(s.line, text.slice(m[0].length), Math.max(0, s.start - m[0].length));
    return;
  }
  setLineText(s.line, text.slice(0, s.start) + INDENT + text.slice(s.end), s.start + INDENT.length);
});

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

// ---------- Video thumbnails (editor) ----------
// Same wrapper and the same resize handle as an image — a video in a note is
// a picture that moves, and everything downstream (resize, download, the
// context menu) already knows how to deal with .pp-img-wrap.
function makeVideoThumb(file, width) {
  const wrap = document.createElement('span');
  wrap.className = 'pp-img-wrap pp-video-wrap';
  wrap.setAttribute('contenteditable', 'false');
  wrap.dataset.file = file;

  const vid = document.createElement('video');
  vid.className = 'pp-img pp-video';
  vid.src = 'ppimg://' + file;
  vid.controls = true;
  // No autoplay and no preloaded stream: a note can hold several of these and
  // the point of the editor is the text, not the video.
  vid.preload = 'metadata';
  vid.draggable = false;
  if (width) {
    vid.style.width = width + 'px';
    vid.classList.add('pp-img-sized');
  }
  wrap.appendChild(vid);

  if (settings.imageResizable) {
    const handle = document.createElement('span');
    handle.className = 'pp-img-resize';
    handle.title = 'Drag to resize';
    wrap.appendChild(handle);
  }
  return wrap;
}

// ---------- Voice chips (editor) ----------
// Collapsed it is a pill the size of a word, so a clip sitting mid-sentence
// does not blow the line apart. Hovering it (or focusing it from the
// keyboard) slides the player open; moving away closes it again and stops
// playback, because a clip still talking from a chip you have scrolled past
// is worse than one that stopped early.
//
// Everything is a single <audio> created up front but with no src until the
// chip is first opened — a note with twenty clips in it should not open
// twenty files to render.
function makeVoiceChip(file, ms) {
  const wrap = document.createElement('span');
  wrap.className = 'pp-voice';
  wrap.setAttribute('contenteditable', 'false');
  wrap.tabIndex = 0;
  wrap.dataset.file = file;
  wrap.title = tr('voice.hover', 'Voice note — hover to play');

  const icon = document.createElement('span');
  icon.className = 'pp-voice-icon';
  icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
    '<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round"/></svg>';
  wrap.appendChild(icon);

  // The clock is a data attribute drawn by CSS content:attr(), not a text
  // node. getEditorText() reads the line's textContent, so anything with real
  // text inside the chip would be saved into the note — "0:04" ends up in the
  // middle of the sentence and comes back next launch as literal characters.
  // An <img> thumbnail gets this for free by having no text at all; a chip
  // that shows a number has to be built this way on purpose.
  const time = document.createElement('span');
  time.className = 'pp-voice-time';
  time.dataset.t = clipLength(ms);
  wrap.appendChild(time);

  // Everything from here on is what slides out.
  const panel = document.createElement('span');
  panel.className = 'pp-voice-panel';

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'pp-voice-play';
  play.tabIndex = -1;
  play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" ' +
    'fill="currentColor"/></svg>';
  panel.appendChild(play);

  const bar = document.createElement('span');
  bar.className = 'pp-voice-bar';
  const fill = document.createElement('span');
  fill.className = 'pp-voice-fill';
  bar.appendChild(fill);
  panel.appendChild(bar);

  wrap.appendChild(panel);

  const audio = document.createElement('audio');
  audio.preload = 'none';

  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    audio.src = 'ppimg://' + file;
  };

  const setIcon = (playing) => {
    play.innerHTML = playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1" ' +
        'fill="currentColor"/><rect x="13.4" y="5" width="3.6" height="14" rx="1" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
  };

  const toggle = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    load();
    if (audio.paused) { audio.play().catch(() => {}); } else { audio.pause(); }
  };
  play.addEventListener('mousedown', (e) => e.preventDefault()); // don't move the caret
  play.addEventListener('click', toggle);

  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    e.stopPropagation();
    load();
    const r = bar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const dur = audio.duration || (ms / 1000);
    if (dur) audio.currentTime = p * dur;
  });

  // One place decides what the chip says, because there are four things that
  // can change it — playing, seeking, stopping, and the rewind at the end —
  // and they were fighting. Setting currentTime = 0 when a clip finished
  // fired a timeupdate *after* the label had been put back to the clip's
  // length, and that handler unconditionally wrote the elapsed time, so a
  // finished clip always ended up reading 0:00.
  //
  // The rule: at the very start and not playing, the number is how long the
  // clip is. Anywhere else, it is where you are in it.
  const paint = () => {
    const dur = audio.duration || (ms / 1000);
    const at = audio.currentTime || 0;
    if (dur) fill.style.width = (at / dur * 100).toFixed(1) + '%';
    const atStart = at < 0.05 && audio.paused;
    time.dataset.t = atStart ? clipLength(ms || dur * 1000) : clipLength(at * 1000);
    wrap.classList.toggle('is-part', !atStart && audio.paused && at > 0.05);
  };

  audio.addEventListener('play', () => { setIcon(true); wrap.classList.add('is-playing'); });
  audio.addEventListener('pause', () => { setIcon(false); wrap.classList.remove('is-playing'); paint(); });
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('timeupdate', paint);
  // Reaching the end is the one thing that clears the position.
  audio.addEventListener('ended', () => {
    setIcon(false);
    wrap.classList.remove('is-playing');
    try { audio.currentTime = 0; } catch (e) {}
    paint();
    // Finished while the cursor was elsewhere: fold up. Still hovered means
    // the player stays open, ready to be played again.
    if (!hovered) wrap.classList.remove('is-open');
  });

  // Open on hover, close on leave.
  //
  // Closing never moves the playhead. Two separate versions of this got that
  // wrong: the first paused and rewound whenever the cursor left, so a clip
  // died a few pixels after you started it; the second let a playing clip run
  // on but still rewound a paused one, so pausing halfway and then moving the
  // mouse threw the position away. Where you are in a clip is yours — only
  // reaching the end clears it. The pill shows that position while collapsed,
  // so a half-played clip says 0:04 rather than pretending to be untouched.
  let shutTimer = null;
  let hovered = false;
  const collapse = () => {
    wrap.classList.remove('is-open');
    paint();
  };
  const open = () => {
    hovered = true;
    clearTimeout(shutTimer);
    load();
    wrap.classList.add('is-open');
    // Re-opening a clip that was left part-way has to show where it actually
    // is; without this the bar reads empty until playback resumes and moves
    // it, which looks like the position was lost after all.
    paint();
  };
  const shut = () => {
    hovered = false;
    clearTimeout(shutTimer);
    // A short grace period, so crossing a gap between the pill and the panel
    // during the slide does not snap it closed under the cursor.
    shutTimer = setTimeout(() => {
      if (!audio.paused) return;   // still talking — leave it be
      collapse();
    }, 180);
  };
  wrap.addEventListener('mouseenter', open);
  wrap.addEventListener('mouseleave', shut);
  wrap.addEventListener('focus', open);
  wrap.addEventListener('blur', shut);
  // Space or Enter on the focused chip plays it, so it is reachable without
  // a mouse at all.
  wrap.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') toggle(e);
  });

  wrap.appendChild(audio);
  return wrap;
}

// Persist a resized width back into the line's image token so it survives
// save/reload and the DOM round-trip.
function writeImgWidth(line, file, width) {
  if (!line) return;
  const text = line.textContent;
  let replaced = false;
  const rewrite = (make) => (m, f) => {
    if (!replaced && f === file) { replaced = true; return make(f, width); }
    return m;
  };
  const next = text
    .replace(IMG_TOKEN_RE, rewrite(imgToken))
    .replace(VIDEO_TOKEN_RE, rewrite(videoToken));
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
  const img = t.closest('.pp-img, .md-img, .md-video, .fs-msg-img, .gallery-img');
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

  // "Save as block" — selected text in the editor becomes a reusable @block.
  textCtxSelection = selectedTextFrom(target);
  const showBlock = editorEl.contains(target) && !mdOn()
    && settings.blocksEnabled !== false && !!textCtxSelection.trim();
  document.getElementById('ctxBlockSep').classList.toggle('hidden', !showBlock);
  document.getElementById('ctxBlockItem').classList.toggle('hidden', !showBlock);

  // "Share to Discover" — any selected text, anywhere, once Discover is set up.
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
  if (action === 'save-block') {
    const text = textCtxSelection;
    hideTextContextMenu();
    saveSelectionAsBlock(text);
    return;
  }
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

// Video goes in on its own line, exactly like an image.
function insertVideoToken(filename) {
  insertOwnLineToken(videoToken(filename));
}

// The shared half of insertImageToken: put `token` on a line of its own,
// after the line the caret is on.
function insertOwnLineToken(token) {
  const t = activeTab();
  if (!t) return;
  syncEditorToState();
  const prev = t.content;
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

// A voice note lands *at the caret*, not on a line of its own — the whole
// point is being able to drop one into the middle of a sentence. If the caret
// is not in the editor (you clicked the button straight from somewhere else)
// it goes on the end, which is the only sensible guess.
function insertVoiceToken(filename, ms) {
  const t = activeTab();
  if (!t) return;
  syncEditorToState();
  const prev = t.content;
  const token = voiceToken(filename, ms);

  const lines = t.content.split('\n');
  let lineIdx = lines.length - 1;
  let offset = lines[lineIdx] ? lines[lineIdx].length : 0;

  const line = currentLine();
  if (line) {
    const domIdx = editorLines().indexOf(line);
    if (domIdx !== -1) {
      lineIdx = domIdx;
      const o = getCaretOffsetIn(line);
      offset = o == null ? (lines[lineIdx] || '').length : o;
    }
  }

  const cur = lines[lineIdx] || '';
  offset = Math.min(offset, cur.length);
  // A clip butted straight against a word is unreadable once the chip is
  // drawn, so give it breathing room — but only where there isn't any.
  const before = cur.slice(0, offset);
  const after = cur.slice(offset);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  lines[lineIdx] = before + lead + token + trail + after;

  t.content = lines.join('\n');
  noteEditForUndo(t, prev);
  setEditorText(t.content);
  if (!mdOn()) {
    const el = editorLines()[lineIdx];
    if (el) {
      if (document.activeElement !== editorEl) editorEl.focus();
      placeCaretInLine(el, offset + lead.length + token.length + trail.length);
    }
  }
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
  if (mdOn()) renderMdPreview();
}

// ---------- voice notes: recording ----------
//
// Everything here is prefixed vnote*. The app already has a
// startVoiceRecording()/stopVoiceRecording() pair for speech-to-text,
// and a second function of the same name does not shadow it or clash at
// parse time — the later declaration simply wins, so clicking Record
// called the dictation code with no argument and died on sink.canStart().
// Nothing looked wrong until the button was pressed.
//
// One recorder at a time, driven from the status bar. While it runs the
// button turns into a live timer with a stop and a discard next to it, so the
// controls are where you were already looking rather than in a modal that
// covers the note you are recording about.
let vnoteRec = null;

function vnoteStopTracks(stream) {
  try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
}

async function vnoteStart() {
  if (vnoteRec) return;
  const t = activeTab();
  if (!t || mdOn() || fsActive()) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (err) {
    // Denied, or no input at all. Both are worth saying out loud — a button
    // that silently does nothing reads as broken.
    await appAlert(err && err.name === 'NotAllowedError'
      ? 'PromptPad needs permission to use your microphone.'
      : 'No microphone was found.');
    return;
  }

  // webm/opus is what Chromium gives us and what save-media already accepts;
  // the fallbacks are for the odd build without the opus muxer.
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

  let rec;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (err) {
    vnoteStopTracks(stream);
    await appAlert('This machine cannot record audio.');
    return;
  }

  const chunks = [];
  const startedAt = Date.now();
  rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });

  // The caret is remembered here rather than read at stop time: by then the
  // user has clicked the stop button and the editor selection is gone.
  const caretLine = currentLine();
  const caretOffset = caretLine ? getCaretOffsetIn(caretLine) : null;

  vnoteRec = { rec, stream, chunks, startedAt, caretLine, caretOffset, keep: true };

  rec.addEventListener('stop', async () => {
    const info = vnoteRec;
    vnoteRec = null;
    vnoteStopTracks(stream);
    vnoteSetUi(false);
    if (!info || !info.keep || !chunks.length) return;

    const ms = Date.now() - info.startedAt;
    // Under a third of a second is a slipped click, not a note.
    if (ms < 300) { showToast('Recording too short', ''); return; }

    const blob = new Blob(chunks, { type: chunks[0].type || mime || 'audio/webm' });
    const ext = /ogg/.test(blob.type) ? 'ogg' : 'webm';
    let filename = null;
    try {
      const b64 = await blobToBase64(blob);
      const res = await window.api.saveMedia(b64, ext);
      filename = res && res.filename;
    } catch (e) { console.error('voice save failed', e); }
    if (!filename) { await appAlert('Could not save that recording.'); return; }

    // Put the caret back where it was before the button was clicked, so the
    // clip lands mid-sentence where the user left off.
    if (info.caretLine && info.caretLine.isConnected && info.caretOffset != null) {
      editorEl.focus();
      placeCaretInLine(info.caretLine, info.caretOffset);
    }
    insertVoiceToken(filename, ms);
    showToast('Voice note added', '');
  });

  rec.start();
  vnoteSetUi(true);
}

function vnoteStop(keep) {
  if (!vnoteRec) return;
  vnoteRec.keep = keep !== false;
  try { vnoteRec.rec.stop(); } catch (e) {
    vnoteStopTracks(vnoteRec.stream);
    vnoteRec = null;
    vnoteSetUi(false);
  }
}

// The status-bar button swaps into the recording state; a timer ticks in it.
let vnoteTimer = null;
function vnoteSetUi(on) {
  if (!voiceNoteBtn) return;
  voiceNoteBtn.classList.toggle('is-recording', on);
  voiceNoteBtn.title = on ? 'Stop and insert' : 'Record a voice note';

  // A running clock is no use inside a closed flyout, and neither is the
  // discard cross. While it records the button comes out to the front of the
  // row; when it stops, the normal layout decides where it belongs again.
  if (on) {
    if (voiceNoteBtn.parentElement === toolbarOverflowPanelEl) {
      voiceNoteBtn.dataset.vnoteBorrowed = '1';
      toolbarMainEl.insertBefore(voiceNoteBtn, toolbarMainEl.firstChild);
      closeToolbarOverflow();
    }
  } else if (voiceNoteBtn.dataset.vnoteBorrowed === '1') {
    delete voiceNoteBtn.dataset.vnoteBorrowed;
    renderToolbarLayout();
  }

  clearInterval(vnoteTimer);
  if (on) {
    const label = voiceNoteBtn.querySelector('.vn-label');
    const tick = () => {
      if (!vnoteRec) return;
      if (label) label.textContent = clipLength(Date.now() - vnoteRec.startedAt);
    };
    tick();
    vnoteTimer = setInterval(tick, 200);
  } else {
    const label = voiceNoteBtn.querySelector('.vn-label');
    if (label) label.textContent = tr('voice.record', 'Record');
  }
}

if (voiceNoteBtn) {
  voiceNoteBtn.addEventListener('click', (e) => {
    // The cross inside the button throws the take away; anywhere else on it
    // stops and inserts.
    if (vnoteRec && e.target instanceof Element && e.target.closest('.vn-x')) {
      vnoteStop(false);
      showToast('Recording discarded', '');
      return;
    }
    if (vnoteRec) vnoteStop(true); else vnoteStart();
  });
}

// Escape abandons a take without reaching for the mouse.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && vnoteRec) {
    e.preventDefault();
    e.stopPropagation();
    vnoteStop(false);
    showToast('Recording discarded', '');
  }
}, true);

if (videoBtn) {
  videoBtn.addEventListener('click', async () => {
    if (mdOn() || fsActive() || !activeTab()) return;
    const res = await window.api.pickVideo();
    if (res && res.filename) insertVideoToken(res.filename);
  });
}

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
// Zooming a video used to hand its filename to an <img>, which cannot decode
// it: the overlay dimmed the app and then showed nothing at all. The element
// is chosen from the extension instead.
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|m4v)(?:$|\?)/i;

function openLightbox(src) {
  if (!src) return;
  const isVideo = VIDEO_EXT_RE.test(src);
  lightboxImgEl.classList.toggle('hidden', isVideo);
  lightboxVideoEl.classList.toggle('hidden', !isVideo);
  if (isVideo) {
    lightboxImgEl.removeAttribute('src');
    lightboxVideoEl.src = src;
    // Zooming a clip is a request to watch it, so it starts — muted playback
    // is not blocked and this is a local file, but be quiet about a failure
    // either way rather than throwing into the click handler.
    lightboxVideoEl.play().catch(() => {});
  } else {
    lightboxVideoEl.pause();
    lightboxVideoEl.removeAttribute('src');
    lightboxImgEl.src = src;
  }
  lightboxEl.classList.remove('hidden');
}

// Set when the overlay is what put the window into fullscreen, so closing it
// hands the window back rather than leaving the app fullscreen behind it.
let lightboxTookFullscreen = false;

async function closeLightbox() {
  lightboxEl.classList.add('hidden');
  lightboxImgEl.removeAttribute('src');
  try { lightboxVideoEl.pause(); } catch (e) {}
  lightboxVideoEl.removeAttribute('src');
  if (lightboxTookFullscreen) {
    lightboxTookFullscreen = false;
    try { applyFullscreen(await window.api.toggleFullscreen()); } catch (e) {}
  }
}

// Clicking the backdrop closes; clicking the video or the tools must not, or
// the play/pause, the scrubber and the buttons are all unusable.
lightboxEl.addEventListener('click', (e) => {
  if (e.target === lightboxVideoEl || lightboxVideoEl.contains(e.target)) return;
  if (e.target instanceof Element && e.target.closest('.lightbox-tools')) return;
  closeLightbox();
});

// Fullscreen for the overlay. The window goes fullscreen — the overlay
// already covers the window — which is the same route the app's own
// fullscreen button takes and the only one that completes here.
if (lightboxFsBtnEl) {
  lightboxFsBtnEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (settings.handyMode) return; // handy mode owns the window bounds
    // Remember whether we were the ones who turned it on, so closing the
    // overlay puts the window back the way it was found.
    if (!lightboxTookFullscreen) lightboxTookFullscreen = !(await window.api.isFullscreen());
    applyFullscreen(await window.api.toggleFullscreen());
  });
}
if (lightboxCloseBtnEl) {
  lightboxCloseBtnEl.addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
}
// Escape closes it too — the overlay covers the app, so there is nothing else
// the key could reasonably mean while it is up.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lightboxEl.classList.contains('hidden')) {
    e.preventDefault();
    e.stopPropagation();
    closeLightbox();
  }
}, true);

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

// ---------- Markdown table editing (+/- rows & columns) ----------
// Cells are re-split and re-joined on every edit rather than surgically
// patched — a table is a handful of short lines, and regenerating them
// canonically stays correct (escaped pipes included) without trying to
// preserve the original spacing byte-for-byte.
function splitTableRow(line) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  if (cells.length && !cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  return cells;
}
function joinTableRow(cells) {
  return '| ' + cells.map((c) => c.trim() || ' ').join(' | ') + ' |';
}

// A table's own data-line/data-end-line (see markdown.js's `at()`) span its
// header row through its last body row (or the alignment row, if it has no
// body rows yet) — exactly the range every edit here rewrites wholesale.
function tableLineRange(tableEl) {
  const t = activeTab();
  if (!t || !tableEl || tableEl.dataset.line === undefined) return null;
  const start = Number(tableEl.dataset.line);
  const end = Number(tableEl.dataset.endLine);
  const lines = t.content.split('\n');
  if (!(start >= 0 && end >= start && end < lines.length)) return null;
  return { t, lines, start, end };
}

function commitTableEdit(t, lines, start, end, newRows) {
  const prev = t.content;
  lines.splice(start, end - start + 1, ...newRows);
  t.content = lines.join('\n');
  noteEditForUndo(t, prev);
  setEditorText(t.content); // keep the hidden editor in step with the note
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
  renderMdPreview();
}

function tableEditColumn(tableEl, col, action) {
  commitMdBlockEdit();
  const ctx = tableLineRange(tableEl);
  if (!ctx) return;
  const { t, lines, start, end } = ctx;
  const header = splitTableRow(lines[start]);
  const alignRow = splitTableRow(lines[start + 1]);
  const bodyRows = lines.slice(start + 2, end + 1).map(splitTableRow);
  if (action === 'add') {
    header.push('Column ' + (header.length + 1));
    alignRow.push('---');
    bodyRows.forEach((r) => r.push(''));
  } else {
    if (header.length <= 1) { showToast(tr('table.needCol', 'A table needs at least one column')); return; }
    header.splice(col, 1);
    alignRow.splice(col, 1);
    bodyRows.forEach((r) => r.splice(col, 1));
  }
  commitTableEdit(t, lines, start, end,
    [joinTableRow(header), joinTableRow(alignRow), ...bodyRows.map(joinTableRow)]);
}

function tableEditRow(tableEl, row, action) {
  commitMdBlockEdit();
  const ctx = tableLineRange(tableEl);
  if (!ctx) return;
  const { t, lines, start, end } = ctx;
  const header = lines[start];
  const alignRow = lines[start + 1];
  const bodyRows = lines.slice(start + 2, end + 1);
  if (action === 'add') {
    const cols = splitTableRow(header).length;
    bodyRows.push(joinTableRow(Array(cols).fill('')));
  } else {
    if (row < 0 || row >= bodyRows.length) return;
    bodyRows.splice(row, 1);
  }
  commitTableEdit(t, lines, start, end, [header, alignRow, ...bodyRows]);
}

// Editing a cell's own text — click it (its inner .md-table-celltext span is
// contenteditable, NOT the cell itself, which also holds the delete-column
// button as a sibling — an editable cell including its own delete button let
// selecting-and-typing over the header delete the button, and let the
// button's own "×" leak into the saved text). Blur or Enter commits it back
// to the note. Escapes a literal "|" the user typed so it round-trips as one
// cell rather than splitting into two on the next parse; a pasted newline is
// folded to a space since a table row is exactly one source line.
function commitTableCellEdit(textEl) {
  const cellEl = textEl.closest('th, td');
  const table = textEl.closest('table');
  const ctx = tableLineRange(table);
  if (!ctx || !cellEl) return;
  const { t, lines, start, end } = ctx;
  const col = Number(cellEl.dataset.col);
  const isHeader = cellEl.tagName === 'TH';
  const tr = cellEl.closest('tr');
  const lineIdx = isHeader ? start : start + 2 + Number(tr && tr.dataset.row);
  if (!(lineIdx >= start && lineIdx <= end)) return;
  const cells = splitTableRow(lines[lineIdx]);
  if (!(col >= 0 && col < cells.length)) return;
  const newText = textEl.textContent.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
  if (cells[col].trim() === newText.trim()) return; // no real change — skip a no-op undo step
  cells[col] = newText;
  const newLine = joinTableRow(cells);
  if (newLine === lines[lineIdx]) return;
  const prev = t.content;
  lines[lineIdx] = newLine;
  t.content = lines.join('\n');
  noteEditForUndo(t, prev);
  setEditorText(t.content); // keep the hidden editor in step with the note
  updateCounts();
  updatePlaceholderPanel();
  scheduleSave();
  // Deliberately no renderMdPreview() here: this fires on blur, often because
  // the user just clicked into the NEXT cell to keep typing — replacing the
  // whole table's DOM at that moment would yank focus away from the cell
  // they meant to land in. The note and the cell's own displayed text already
  // match; the next unrelated render (tab switch, another edit) catches up
  // anything like a **bold** marker typed here that wants re-rendering.
}

// blur doesn't bubble, so this needs the capture phase to reach mdPreviewEl.
mdPreviewEl.addEventListener('blur', (e) => {
  const cell = e.target;
  if (cell instanceof Element && cell.matches('.md-table-celltext')) {
    commitTableCellEdit(cell);
  }
}, true);

// Enter commits a cell instead of inserting a line break — a table row is
// one source line, and every other line-oriented control in this app (Tab,
// list continuation) already treats Enter as "done", not "newline".
mdPreviewEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const cell = e.target;
  if (cell instanceof Element && cell.matches('.md-table-celltext')) {
    e.preventDefault();
    cell.blur();
  }
});

mdPreviewEl.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const delCol = t.closest('.md-table-delcol');
  if (delCol) { tableEditColumn(delCol.closest('table'), Number(delCol.dataset.col), 'delete'); return; }
  const addCol = t.closest('.md-table-addcol');
  if (addCol) { tableEditColumn(addCol.closest('table'), null, 'add'); return; }
  const delRow = t.closest('.md-table-delrow');
  if (delRow) { tableEditRow(delRow.closest('table'), Number(delRow.dataset.row), 'delete'); return; }
  const addRow = t.closest('.md-table-addrow');
  if (addRow) { tableEditRow(addRow.closest('table'), null, 'add'); return; }
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
  // A preview video keeps its own controls; only the surrounding frame zooms,
  // or clicking play would throw the clip into the overlay instead.
  const vid = t.closest('.md-video');
  if (vid) return;
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

// ---------- Table insertion ----------
// Builds a GFM table (header + alignment row + N empty body rows) and drops
// it in at the caret via the same execCommand path Paste uses — that fires
// the real 'input' pipeline (multi-line split into separate .ln divs,
// per-line RTL, undo), which a raw DOM write would not.
function buildTableMarkdown(rows, cols) {
  const header = Array.from({ length: cols }, (_, i) => 'Column ' + (i + 1));
  const alignRow = Array(cols).fill('---');
  const body = Array.from({ length: rows }, () => Array(cols).fill(''));
  return [joinTableRow(header), joinTableRow(alignRow), ...body.map(joinTableRow)].join('\n');
}

// Clicking the toolbar button moves focus off the contenteditable before the
// click handler runs (and the dialog's own number inputs take it again once
// open) — same problem Link insertion solves, and the same fix: the range is
// captured on mousedown, before any of that happens, and restored right
// before the text is actually inserted.
let tableSavedRange = null;
let pendingTableSel = null;

tableBtn.addEventListener('mousedown', () => {
  const sel = window.getSelection();
  tableSavedRange = (sel && sel.rangeCount && editorEl.contains(sel.anchorNode))
    ? sel.getRangeAt(0).cloneRange() : null;
});

function restoreTableRange() {
  if (!tableSavedRange || !editorEl.contains(tableSavedRange.commonAncestorContainer)) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  try { sel.addRange(tableSavedRange); return true; } catch { return false; }
}

function openTableDialog() {
  if (mdOn() || fsActive()) return;
  restoreTableRange();
  pendingTableSel = currentLineSelection();
  tableDialog.classList.remove('hidden');
  tableRowsInput.focus();
  tableRowsInput.select();
}
function closeTableDialog() {
  tableDialog.classList.add('hidden');
  tableSavedRange = null;
  pendingTableSel = null;
}
function confirmTable() {
  const rows = Math.max(1, Math.min(100, Number(tableRowsInput.value) || 1));
  const cols = Math.max(1, Math.min(20, Number(tableColsInput.value) || 1));
  const s = pendingTableSel;
  const hadRange = restoreTableRange(); // live selection back before the dialog closes and focus moves
  closeTableDialog();
  editorEl.focus();
  const md = buildTableMarkdown(rows, cols);
  // A table needs its own lines: if the caret sits mid-line, split whatever
  // is there onto its own line before/after the table rather than gluing
  // text onto the table's header or last row.
  let insertText = md;
  if (s && editorEl.contains(s.line)) {
    const text = s.line.textContent;
    if (text.slice(0, s.start).trim()) insertText = '\n' + insertText;
    if (text.slice(s.end).trim()) insertText += '\n';
  }
  const ok = hadRange && document.execCommand('insertText', false, insertText);
  if (!ok) {
    insertAtCaret(insertText);
    updateLineDirs();
    handleEditorChanged();
  }
  // Stays raw pipe text in the plain editor — inserting a table must not
  // flip the whole note into Markdown preview on its own. It renders as a
  // real table (with its cells directly editable) the moment the user turns
  // Markdown preview on themselves, same as any other table already there.
}
tableBtn.addEventListener('click', openTableDialog);
tableCancel.addEventListener('click', closeTableDialog);
tableSave.addEventListener('click', confirmTable);
[tableRowsInput, tableColsInput].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmTable(); }
    if (e.key === 'Escape') { closeTableDialog(); }
  });
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

// The built-in AI actions, in menu order. `id` is the key main.js looks up in
// AI_ACTION_PROMPTS — the prompts themselves stay in main so they only exist
// once. A `sep` entry draws a divider.
const BUILTIN_AI_ACTIONS = [
  { id: 'improve', label: 'Improve prompt', title: 'Improving…' },
  { id: 'translate', label: 'Translate (FA ⇄ EN)', title: 'Translating…' },
  { id: 'summarize', label: 'Summarize', title: 'Summarizing…' },
  { id: 'grammar', label: 'Fix grammar & spelling', title: 'Fixing grammar…' },
  { sep: true },
  { id: 'tone-professional', label: 'Make professional', title: 'Rewriting…' },
  { id: 'tone-casual', label: 'Make casual', title: 'Rewriting…' },
  { id: 'tone-concise', label: 'Make concise', title: 'Rewriting…' }
];

// Transient button title while each AI action runs.
const AI_ACTION_TITLES = {};
BUILTIN_AI_ACTIONS.forEach((a) => { if (a.id) AI_ACTION_TITLES[a.id] = a.title; });

function customAiActions() {
  if (!Array.isArray(settings.customAiActions)) settings.customAiActions = [];
  return settings.customAiActions;
}
function recentAiPrompts() {
  if (!Array.isArray(settings.recentAiPrompts)) settings.recentAiPrompts = [];
  return settings.recentAiPrompts;
}

// Remember a one-shot instruction so it's one click away next time. Most recent
// first, de-duplicated, capped at 5.
function rememberAiPrompt(prompt) {
  const p = String(prompt || '').trim();
  if (!p) return;
  const list = recentAiPrompts().filter((x) => x !== p);
  list.unshift(p);
  settings.recentAiPrompts = list.slice(0, 5);
  saveSettingsNow();
}

// Shared by every AI text action (Improve, Translate, Summarize, a custom
// instruction, …) — handles the network call and the button's generating/failed
// states; `applyFn(text)` decides what to do with the result (whole-tab
// replace, selection replace, code-block replace, …). `prompt` is set only for
// a custom action, where it IS the system prompt.
async function runAiTransform(btnEl, sourceText, action, applyFn, prompt) {
  if (!sourceText.trim()) return;
  // no credentials yet → send the user to the right field in Settings
  if (!aiReady()) { promptForAiKey(); return; }
  const defaultTitle = btnEl.title;
  // applyFn closes over the tab/selection this ran against; if the workspace
  // was swapped meanwhile, dropping the result beats writing it somewhere else.
  const epoch = profileEpoch;
  btnEl.disabled = true;
  btnEl.classList.add('generating');
  btnEl.title = (prompt ? 'Working…' : AI_ACTION_TITLES[action]) || 'Working…';
  try {
    const res = await window.api.aiTransform(action, sourceText, aiOpts(), prompt || '');
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

// ---------- Selection ranges ----------
// currentLineSelection() only understands a selection that sits inside ONE
// line: for anything wider its commonAncestorContainer is the editor itself, so
// it silently returns a zero-width caret. That used to make an AI action on a
// multi-line selection quietly rewrite the WHOLE TAB instead. This resolves a
// selection of any height to a line range: { from, to, start, end, text },
// where from/to are indices into editorLines() and start/end are character
// offsets within those two lines. Returns null when nothing is selected.
function currentSelectionRange() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.commonAncestorContainer)) return null;

  const lineOf = (node) => {
    let n = node;
    while (n && n !== editorEl && n.parentNode !== editorEl) n = n.parentNode;
    return n && n !== editorEl ? n : null;
  };
  const startLine = lineOf(range.startContainer);
  const endLine = lineOf(range.endContainer);
  if (!startLine || !endLine) return null;

  const lines = editorLines();
  let from = lines.indexOf(startLine);
  let to = lines.indexOf(endLine);
  if (from < 0 || to < 0) return null;

  // Character offset of a boundary within its own line.
  const offsetIn = (line, container, offset) => {
    const r = document.createRange();
    r.selectNodeContents(line);
    try { r.setEnd(container, offset); } catch { return 0; }
    return r.toString().length;
  };
  let start = offsetIn(startLine, range.startContainer, range.startOffset);
  let end = offsetIn(endLine, range.endContainer, range.endOffset);

  // A backwards drag can hand us the endpoints in reverse.
  if (from > to || (from === to && start > end)) {
    [from, to] = [to, from];
    [start, end] = [end, start];
  }
  if (from === to && start === end) return null;

  const texts = lines.map((d) => d.textContent);
  const text = from === to
    ? texts[from].slice(start, end)
    : [texts[from].slice(start), ...texts.slice(from + 1, to), texts[to].slice(0, end)].join('\n');
  return { from, to, start, end, text };
}

// Write an AI result back into the tab. `range` is null for a whole-tab action.
// Both paths rebuild the full content and go through noteEditForUndo, so a
// selection edit is a single undo step too (it wasn't, before). Only touches
// the DOM when the user is still on the originating tab — guards against a
// mid-flight tab switch.
function applyTransformResult(t, tabId, range, out) {
  if (!activeTab() || activeTab().id !== tabId) { if (!range) t.content = out; return; }
  const prev = t.content;
  let next;
  let caretLine = null;

  if (range) {
    const lines = getEditorText().split('\n');
    // The text moved underneath us (a shared note synced, say) — skip rather
    // than splice at offsets that no longer mean anything.
    if (range.to >= lines.length ||
        range.start > lines[range.from].length ||
        range.end > lines[range.to].length) return;
    const merged = lines[range.from].slice(0, range.start) + out + lines[range.to].slice(range.end);
    const mergedLines = merged.split('\n');
    next = [...lines.slice(0, range.from), ...mergedLines, ...lines.slice(range.to + 1)].join('\n');
    caretLine = range.from + mergedLines.length - 1;
  } else {
    next = out;
  }
  if (next === prev) return;

  noteEditForUndo(t, prev);
  t.content = next;
  setEditorText(next);
  updateCounts();
  updatePlaceholderPanel();
  if (!t.custom) renderTabs();
  scheduleSave();
  editorEl.focus();
  if (caretLine == null) {
    placeCaretEnd();
  } else {
    const line = editorLines()[caretLine];
    if (line) placeCaretInLine(line, line.textContent.length); else placeCaretEnd();
  }
}

// Runs an AI action on the current selection (of any height) if there is one,
// otherwise on the whole tab. `prompt` is set only for a custom instruction.
async function runTabAiAction(action, prompt, presetRange) {
  if (!aiOn() || mdOn() || fsActive() || !activeTab()) return;
  if (!aiReady()) { promptForAiKey(); return; }
  markFeatureSeen('improve');
  const t = activeTab();
  syncEditorToState();
  const tabId = t.id;
  // presetRange is captured before a dialog steals focus (which destroys the
  // live selection); without one, read the selection now.
  const range = presetRange !== undefined ? presetRange : currentSelectionRange();
  const source = range ? range.text : t.content;
  if (!source.trim()) return;

  // Shimmer the target text — the selected lines, or the whole editor — so it's
  // clear what the AI is working on.
  const workEls = range
    ? editorLines().slice(range.from, range.to + 1)
    : [editorEl];
  workEls.forEach((el) => el && el.classList.add('ai-working'));
  try {
    await runAiTransform(improveBtn, source, action,
      (out) => applyTransformResult(t, tabId, range, out), prompt);
  } finally {
    workEls.forEach((el) => el && el.classList.remove('ai-working'));
  }
}

function improvePromptNote() { return runTabAiAction('improve'); }

// ---------- AI actions menu ----------
// The selection captured when the menu opened. Everything downstream uses this
// rather than reading the live selection, because opening the custom-instruction
// dialog moves focus into a textarea and destroys the editor selection.
let aiMenuRange = null;

// The recent instructions currently drawn in the menu. Held as a snapshot so a
// row's index stays valid between render and click.
let aiMenuRecents = [];

function truncateLabel(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// One recent instruction: click the row to run it, ★ to keep it as a saved
// action, ✕ to forget it. dir="auto" so a Persian instruction reads correctly
// while the row itself stays laid out the same way.
function addRecentRow(prompt, idx) {
  const el = document.createElement('div');
  el.className = 'ctx-item ctx-dim ctx-item-recent';
  el.dataset.aiRecent = String(idx);

  const label = document.createElement('span');
  label.className = 'ctx-item-label';
  label.setAttribute('dir', 'auto');
  label.textContent = '↻ ' + truncateLabel(prompt, 28);
  label.title = prompt;
  el.appendChild(label);

  const btns = document.createElement('span');
  btns.className = 'ctx-item-btns';
  const mini = (cls, glyph, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctx-mini-btn ' + cls;
    b.textContent = glyph;
    b.title = title;
    btns.appendChild(b);
  };
  mini('js-pin', '★', tr('ai.pin', 'Keep as an action'));
  mini('js-forget', '✕', tr('ai.forget', 'Remove from recents'));
  el.appendChild(btns);

  aiActionsMenu.appendChild(el);
  return el;
}

// Rebuild the menu from the built-ins plus whatever the user has saved. Called
// on every open, so a newly saved action shows up immediately.
function renderAiActionsMenu() {
  aiActionsMenu.innerHTML = '';
  const add = (cls, text, data) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    if (data) Object.keys(data).forEach((k) => { el.dataset[k] = data[k]; });
    aiActionsMenu.appendChild(el);
    return el;
  };

  const scope = aiMenuRange
    ? tr('ai.onSelection', 'AI · on selection')
    : tr('ai.onTab', 'AI · on the whole tab');
  add('ctx-label', scope);

  BUILTIN_AI_ACTIONS.forEach((a) => {
    if (a.sep) { add('ctx-sep', ''); return; }
    add('ctx-item', tr('ai.' + a.id, a.label), { aiAction: a.id });
  });

  const saved = customAiActions();
  if (saved.length) {
    add('ctx-sep', '');
    saved.forEach((a) => add('ctx-item', '★ ' + truncateLabel(a.name, 34), { aiCustom: a.id }));
  }

  // Recents are throwaway by nature, so each one carries its own controls:
  // pin it to keep it as a real action, or drop it. Indices point into this
  // snapshot rather than being recomputed later, so deleting one can't shift
  // the row under a click.
  aiMenuRecents = recentAiPrompts().filter((p) => !saved.some((a) => a.prompt === p)).slice(0, 3);
  if (aiMenuRecents.length) {
    add('ctx-sep', '');
    aiMenuRecents.forEach((p, i) => addRecentRow(p, i));
  }

  add('ctx-sep', '');
  add('ctx-item', tr('ai.custom', 'Custom instruction…'), { aiCustom: '__new__' });
  if (saved.length) add('ctx-item', tr('ai.manage', 'Manage custom actions…'), { aiManage: '1' });
}

function showAiActionsMenu(x, y) {
  if (!aiOn() || mdOn() || fsActive() || !activeTab()) return;
  // Capture the selection BEFORE anything can steal focus.
  aiMenuRange = currentSelectionRange();
  hideTextContextMenu();
  renderAiActionsMenu();
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
  const item = e.target.closest('[data-ai-action],[data-ai-custom],[data-ai-recent],[data-ai-manage]');
  if (!item) return;

  // Pin / forget act on the row without running anything and without closing —
  // tidying up a few recents in one go shouldn't mean reopening the menu each
  // time. Handled before the run paths so a button click never fires the row.
  const mini = e.target.closest('.ctx-mini-btn');
  if (mini && item.dataset.aiRecent) {
    e.stopPropagation();
    const prompt = aiMenuRecents[Number(item.dataset.aiRecent)];
    if (!prompt) return;
    if (mini.classList.contains('js-pin')) {
      customAiActions().push({ id: uid(), name: truncateLabel(prompt, 30), prompt });
    }
    // Pinned or dropped, it leaves the recents list either way — once it's a
    // saved action, keeping a duplicate copy under "recent" is just noise.
    settings.recentAiPrompts = recentAiPrompts().filter((p) => p !== prompt);
    saveSettingsNow();
    renderCustomActionsList();
    renderAiActionsMenu();
    return;
  }

  const range = aiMenuRange;
  hideAiActionsMenu();

  if (item.dataset.aiAction) {
    runTabAiAction(item.dataset.aiAction, '', range);
  } else if (item.dataset.aiManage) {
    openSettings();
    setTimeout(() => revealSetting('customActionsList'), 60);
  } else if (item.dataset.aiRecent) {
    // Same snapshot the row was drawn from, so the index can't have drifted.
    const prompt = aiMenuRecents[Number(item.dataset.aiRecent)];
    if (prompt) {
      rememberAiPrompt(prompt); // re-running it makes it the most recent again
      runTabAiAction('custom', prompt, range);
    }
  } else if (item.dataset.aiCustom === '__new__') {
    openAiCustomDialog(range);
  } else if (item.dataset.aiCustom) {
    const found = customAiActions().find((a) => a.id === item.dataset.aiCustom);
    if (found) runTabAiAction('custom', found.prompt, range);
  }
});

// ---------- Custom instruction dialog ----------
// `aiCustomRange` holds the selection this run targets. It's captured when the
// menu opens (see aiMenuRange) because focusing the textarea below clears the
// editor's own selection.
let aiCustomRange = null;
// 'run' = fired from the AI menu against the note; 'add'/'edit' = opened from
// Settings, where the dialog only writes to the saved-actions list.
let aiCustomMode = 'run';

function openAiCustomDialog(range) {
  aiCustomMode = 'run';
  editingCustomActionId = null;
  aiCustomRange = range || null;
  aiCustomInput.value = '';
  aiCustomSaveChk.checked = false;
  aiCustomName.value = '';
  aiCustomNameRow.classList.add('hidden');
  aiCustomRun.textContent = tr('run', 'Run');
  const n = aiCustomRange ? aiCustomRange.text.length : 0;
  aiCustomScope.textContent = aiCustomRange
    ? tr('ai.scopeSel', 'Runs on your selection') + ' · ' + n
    : tr('ai.scopeTab', 'Runs on the whole tab');
  aiCustomDialog.classList.remove('hidden');
  aiCustomInput.focus();
}

function closeAiCustomDialog() {
  aiCustomDialog.classList.add('hidden');
  aiCustomRange = null;
  editingCustomActionId = null;
  aiCustomMode = 'run';
}

function confirmAiCustomDialog() {
  const prompt = aiCustomInput.value.trim();
  if (!prompt) { closeAiCustomDialog(); return; }
  const range = aiCustomRange;
  const save = aiCustomSaveChk.checked;
  const name = aiCustomName.value.trim();
  const editingId = editingCustomActionId;
  const mode = aiCustomMode;
  closeAiCustomDialog();

  // Opened from Settings — save only; there's no selection to run against.
  if (mode === 'edit') {
    const found = customAiActions().find((x) => x.id === editingId);
    if (found) { found.name = name || truncateLabel(prompt, 30); found.prompt = prompt; }
    saveSettingsNow();
    renderCustomActionsList();
    return;
  }
  if (mode === 'add') {
    customAiActions().push({ id: uid(), name: name || truncateLabel(prompt, 30), prompt });
    saveSettingsNow();
    renderCustomActionsList();
    return;
  }

  if (save) {
    customAiActions().push({ id: uid(), name: name || truncateLabel(prompt, 30), prompt });
    saveSettingsNow();
    renderCustomActionsList();
  } else {
    rememberAiPrompt(prompt);
  }
  runTabAiAction('custom', prompt, range);
}

aiCustomSaveChk.addEventListener('change', () => {
  aiCustomNameRow.classList.toggle('hidden', !aiCustomSaveChk.checked);
  if (aiCustomSaveChk.checked) aiCustomName.focus();
});
aiCustomCancel.addEventListener('click', closeAiCustomDialog);
aiCustomRun.addEventListener('click', confirmAiCustomDialog);
aiCustomDialog.addEventListener('keydown', (e) => {
  // Enter runs; Shift+Enter is a newline, since an instruction can be long.
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmAiCustomDialog(); }
  if (e.key === 'Escape') { e.preventDefault(); closeAiCustomDialog(); }
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
  applyBlockDirs(holder, forced, content);
  // The preview's buttons are app chrome, not content — same reasoning
  // covers a table's +/- rail (the delete button riding inside each header
  // cell, the whole extra add-column/delete-row cells, and the add-row row).
  holder.querySelectorAll(
    '.md-code-copy, .md-code-improve, ' +
    '.md-table-delcol, .md-table-ctlcell, .md-table-addrow-row'
  ).forEach((b) => b.remove());
  // Table cells are contenteditable in the live preview so you can click and
  // type into them — a static export must not carry that into the saved
  // document, or opening the HTML in a browser would let you "edit" it.
  holder.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
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

// A right-click anywhere puts away whichever flyout is open.
//
// The two handlers above close them on a *click*, and a right-click is not
// one: it fires contextmenu and mousedown and never a click. So opening the
// AI actions submenu and then right-clicking somewhere else left the submenu
// sitting on top of the fresh context menu, with two menus on screen at once
// and no way to tell which one the next key would go to.
//
// Capture phase, so it runs ahead of every specific contextmenu handler —
// including the ones that return early and open no menu at all, where the
// stale flyout would otherwise simply stay.
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  if (t instanceof Node && (aiActionsMenu.contains(t) || mdCommandsMenu.contains(t))) return;
  hideAiActionsMenu();
  hideMdCommandsMenu();
}, true);

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
    { id: 'settings', label: tr('cmd.settings', 'Settings'), hint: '', run: openSettings },
    { id: 'guide', label: tr('cmd.guide', 'Guide — what PromptPad can do'), hint: '', run: openGuide }
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




// ---------- Note lock ----------
// A locked note's text is encrypted on disk with AES-GCM. The key hierarchy is
// the usual one, and it exists for two reasons: changing the PIN must not mean
// re-encrypting every note, and a forgotten PIN must not mean losing them.
//
//   vaultKey            random 256-bit key; the only thing that touches notes
//     ├─ wrapped by PBKDF2(PIN, saltPin)
//     └─ wrapped by PBKDF2(recovery code, saltRec)
//
// Both wraps sit in settings. Neither the PIN nor the code is stored, and
// AES-GCM's own tag is the check that an unwrap succeeded — a wrong PIN throws
// rather than yielding a plausible-looking wrong key.
//
// `vaultKey` lives in memory only while the vault is open. Closing it (Lock
// now, or quitting) re-encrypts every open note and drops the plaintext.
const VAULT_ITERATIONS = 250000;

// The characters people misread off paper are all gone: I, O, L, 0 and 1. The
// recovery code is written down by hand exactly once, and an L read back as a
// 1 costs the user every locked note they have. 31 characters over 25 places
// is ~124 bits, so nothing is given up by the ones left out.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let vaultKey = null;              // CryptoKey while the vault is open
let pinDialogMode = null;         // 'setup' | 'unlock' | 'change' | 'recover'
let pinResolve = null;            // resolves the promise openPinDialog() handed out

function vaultCfg() {
  return settings.vault && settings.vault.v === 1 ? settings.vault : null;
}
function vaultExists() { return !!vaultCfg(); }
function vaultOpen() { return !!vaultKey; }

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

async function deriveWrapKey(secret, saltB64) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBuf(saltB64), iterations: VAULT_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(key, plaintext) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { iv: bufToB64(iv), ct: bufToB64(ct) };
}
async function aesDecrypt(key, blob) {
  const out = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(blob.iv) }, key, b64ToBuf(blob.ct));
  return new TextDecoder().decode(out);
}

function makeRecoveryCode() {
  const n = RECOVERY_ALPHABET.length;      // 31 — not a power of two
  const limit = Math.floor(256 / n) * n;   // 248: everything above is rejected
  let out = '';
  let picked = 0;
  while (picked < 25) {
    // Drawing a byte and taking it mod 31 would make the first eight letters
    // very slightly likelier than the rest. Rejecting the tail costs a few
    // extra bytes and leaves the code uniform.
    const batch = randomBytes(32);
    for (let i = 0; i < batch.length && picked < 25; i++) {
      if (batch[i] >= limit) continue;
      if (picked && picked % 5 === 0) out += '-';
      out += RECOVERY_ALPHABET[batch[i] % n];
      picked++;
    }
  }
  return out;
}
// Typed-in codes arrive with whatever spacing and case the user used.
function normalizeRecoveryCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Create the vault: a fresh key, wrapped under both the PIN and a new
// recovery code. Returns the code so it can be shown once.
async function createVault(pin) {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  const rawB64 = bufToB64(raw);
  const code = makeRecoveryCode();
  const saltPin = bufToB64(randomBytes(16));
  const saltRec = bufToB64(randomBytes(16));
  settings.vault = {
    v: 1, saltPin, saltRec,
    wrapPin: await aesEncrypt(await deriveWrapKey(pin, saltPin), rawB64),
    wrapRec: await aesEncrypt(await deriveWrapKey(normalizeRecoveryCode(code), saltRec), rawB64)
  };
  vaultKey = key;
  saveSettingsNow();
  return code;
}

// Unwrap with a PIN or a recovery code. Returns false on the wrong secret
// rather than throwing — a failed unwrap is an ordinary outcome here.
async function openVault(secret, which) {
  const cfg = vaultCfg();
  if (!cfg) return false;
  const isRec = which === 'recovery';
  const salt = isRec ? cfg.saltRec : cfg.saltPin;
  const wrap = isRec ? cfg.wrapRec : cfg.wrapPin;
  if (!salt || !wrap) return false;
  try {
    const rawB64 = await aesDecrypt(await deriveWrapKey(secret, salt), wrap);
    vaultKey = await crypto.subtle.importKey(
      'raw', b64ToBuf(rawB64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return true;
  } catch (e) {
    return false;
  }
}

// Re-wrap the existing key under a new PIN, leaving every note's ciphertext
// alone. Requires the vault to be open.
async function rewrapVault(newPin, newCode) {
  const cfg = vaultCfg();
  if (!cfg || !vaultKey) return null;
  const rawB64 = bufToB64(await crypto.subtle.exportKey('raw', vaultKey));
  if (newPin != null) {
    cfg.saltPin = bufToB64(randomBytes(16));
    cfg.wrapPin = await aesEncrypt(await deriveWrapKey(newPin, cfg.saltPin), rawB64);
  }
  let code = null;
  if (newCode) {
    code = makeRecoveryCode();
    cfg.saltRec = bufToB64(randomBytes(16));
    cfg.wrapRec = await aesEncrypt(
      await deriveWrapKey(normalizeRecoveryCode(code), cfg.saltRec), rawB64);
  }
  saveSettingsNow();
  return code;
}

// ---------- Locking notes ----------
function lockedTabs() { return state.tabs.filter((t) => t.locked); }

// What actually goes inside the ciphertext. The note's history has to travel
// with it: snapshots are stored as plain text, so a note locked after it had
// any would leave its own past sitting on disk next to the sealed present.
function sealPayload(t) {
  return JSON.stringify({ c: t.content || '', s: Array.isArray(t.snapshots) ? t.snapshots : [] });
}
function applySealPayload(t, json) {
  try {
    const o = JSON.parse(json);
    // Older shape (content only) never shipped, but a hand-edited file could
    // still hold one — treat anything unparseable as the text itself.
    t.content = typeof o.c === 'string' ? o.c : json;
    t.snapshots = Array.isArray(o.s) ? o.s : [];
  } catch (e) {
    t.content = json;
    t.snapshots = [];
  }
}

// Encrypt every open locked note and drop the plaintext, then forget the key.
// This is what "Lock now" and quitting both do.
async function closeVault() {
  if (vaultKey) {
    for (const t of lockedTabs()) {
      if (t.content || (t.snapshots && t.snapshots.length)) {
        try { t.enc = await aesEncrypt(vaultKey, sealPayload(t)); }
        catch (e) { console.error('re-lock failed', e); }
      }
      t.content = '';
      t.snapshots = [];
      delete t._encOf;
    }
  }
  vaultKey = null;
  const t = activeTab();
  if (t && t.locked) setEditorText('');
  applyLockView();
  renderTabs();
  scheduleSave();
}

// Decrypt every locked note into memory. Called once, right after the vault
// opens, so switching between locked tabs afterwards costs nothing.
async function revealLockedTabs() {
  if (!vaultKey) return;
  for (const t of lockedTabs()) {
    if (!t.enc) continue;
    try {
      applySealPayload(t, await aesDecrypt(vaultKey, t.enc));
      t._encOf = t.content;
    } catch (e) {
      console.error('decrypt failed for tab', t.id, e);
    }
  }
  const t = activeTab();
  if (t && t.locked) setEditorText(t.content || '');
  applyLockView();
  renderTabs();
  updateCounts();
  updatePlaceholderPanel();
}

// Ask for the PIN and check it, whether or not the vault is already open.
//
// "It is unlocked in this session" is not the same as "the person at the
// keyboard knows the PIN" — you may have unlocked it an hour ago and walked
// away. So everything that *undoes* the lock (taking it off a note, changing
// the PIN, wiping the vault) asks again, and only reading goes through
// ensureVaultOpen below.
async function confirmPin() {
  if (!vaultExists()) return false;
  return openPinDialog('verify');
}

// Make sure the vault is open, asking for the PIN if it isn't. Returns whether
// it ended up open, so callers can just bail on false.
async function ensureVaultOpen() {
  if (vaultOpen()) return true;
  if (!vaultExists()) return false;
  const ok = await openPinDialog('unlock');
  if (!ok) return false;
  await revealLockedTabs();
  return true;
}

async function lockNote(tabId) {
  const t = state.tabs.find((x) => x.id === tabId);
  if (!t || t.locked) return;
  // Sharing sends the note's text to the server in the clear, so the two are
  // mutually exclusive — locking one silently would stop the other side's copy
  // updating with no explanation.
  if (t.shareId) {
    showToast(tr('lock.noShared', 'Stop sharing this note before locking it'));
    return;
  }
  if (!vaultExists()) {
    const made = await openPinDialog('setup');
    if (!made) return;
  } else if (!(await ensureVaultOpen())) {
    return;
  }
  if (t === activeTab()) syncEditorToState();
  t.locked = true;
  try {
    t.enc = await aesEncrypt(vaultKey, sealPayload(t));
    t._encOf = t.content;
  } catch (e) {
    console.error('lock failed', e);
    t.locked = false;
    return;
  }
  renderTabs();
  applyLockView();
  scheduleSave();
  showToast(tr('lock.locked', 'Locked. It stays readable until you lock the vault or quit.'));
}

// Take the lock off for good: decrypt back to a plain note.
async function removeLock(tabId) {
  const t = state.tabs.find((x) => x.id === tabId);
  if (!t || !t.locked) return;
  // Asks even if the notes are already open — taking a lock off is the kind of
  // thing that should not be one click away from a session somebody left
  // unlocked.
  if (!(await confirmPin())) return;
  if (!vaultOpen()) return;
  if (t.enc && !t.content) {
    try { applySealPayload(t, await aesDecrypt(vaultKey, t.enc)); }
    catch (e) { console.error(e); return; }
  }
  t.locked = false;
  delete t.enc;
  delete t._encOf;
  if (t === activeTab()) setEditorText(t.content || '');
  renderTabs();
  applyLockView();
  updateCounts();
  scheduleSave();
}

// Whether the editor should be swapped for the lock pane right now.
function activeTabSealed() {
  const t = activeTab();
  return !!(t && t.locked && !vaultOpen());
}

function applyLockView() {
  const pane = document.getElementById('lockPane');
  if (!pane) return;
  const sealed = activeTabSealed();
  pane.classList.toggle('hidden', !sealed);
  // Everything that edits or reads the note has to go with it — leaving the
  // toolbar live over a sealed note means buttons that act on an empty string.
  editorEl.classList.toggle('hidden', sealed);
  document.querySelector('.app').classList.toggle('note-sealed', sealed);
  if (sealed) closeInlinePop();
}

// ---------- PIN dialog ----------
const pinDialog = document.getElementById('pinDialog');
const pinDialogLabel = document.getElementById('pinDialogLabel');
const pinDialogText = document.getElementById('pinDialogText');
const pinInput = document.getElementById('pinInput');
const pinInput2 = document.getElementById('pinInput2');
const pinError = document.getElementById('pinError');
const pinForgot = document.getElementById('pinForgot');
const pinCancel = document.getElementById('pinCancel');
const pinConfirm = document.getElementById('pinConfirm');

// Resolves true once the vault is open (or created), false if cancelled.
function openPinDialog(mode) {
  pinDialogMode = mode;
  pinInput.value = '';
  pinInput2.value = '';
  pinError.classList.add('hidden');
  const setup = mode === 'setup' || mode === 'change';
  const recover = mode === 'recover';
  const verify = mode === 'verify';
  pinInput2.classList.toggle('hidden', !setup);
  pinForgot.classList.toggle('hidden', mode !== 'unlock' && !verify);
  pinInput.type = recover ? 'text' : 'password';
  pinInput.placeholder = recover ? 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' : 'PIN';
  if (mode === 'setup') {
    pinDialogLabel.textContent = tr('lock.setupTitle', 'Set a PIN');
    pinDialogText.textContent = tr('lock.setupText',
      'This PIN encrypts your locked notes. It is never stored, so it cannot be reset — you will get a recovery code next.');
    pinConfirm.textContent = tr('lock.setupBtn', 'Set PIN');
  } else if (mode === 'change') {
    pinDialogLabel.textContent = tr('lock.changeTitle', 'Change your PIN');
    pinDialogText.textContent = tr('lock.changeText', 'Your notes are not re-encrypted — only the PIN that opens them changes.');
    pinConfirm.textContent = tr('save', 'Save');
  } else if (recover) {
    pinDialogLabel.textContent = tr('lock.recoverTitle', 'Enter your recovery code');
    pinDialogText.textContent = tr('lock.recoverText', 'The 25-character code from when you set the lock up. Dashes and case do not matter.');
    pinConfirm.textContent = tr('lock.recoverBtn', 'Recover');
  } else if (verify) {
    pinDialogLabel.textContent = tr('lock.verifyTitle', 'Confirm your PIN');
    pinDialogText.textContent = tr('lock.verifyText',
      'This undoes part of the lock, so it asks again even though the notes are open.');
    pinConfirm.textContent = tr('lock.verifyBtn', 'Confirm');
  } else {
    pinDialogLabel.textContent = tr('lock.unlockTitle', 'Enter your PIN');
    pinDialogText.textContent = tr('lock.unlockText', 'Opens every locked note until you lock them again or quit.');
    pinConfirm.textContent = tr('lock.unlockBtn', 'Unlock');
  }
  pinDialog.classList.remove('hidden');
  pinInput.focus();
  return new Promise((resolve) => { pinResolve = resolve; });
}

function closePinDialog(result) {
  pinDialog.classList.add('hidden');
  pinDialogMode = null;
  const r = pinResolve;
  pinResolve = null;
  pinInput.value = '';
  pinInput2.value = '';
  if (r) r(result);
}

function showPinError(msg) {
  pinError.textContent = msg;
  pinError.classList.remove('hidden');
}

async function confirmPinDialog() {
  const mode = pinDialogMode;
  const val = pinInput.value;
  if (mode === 'setup' || mode === 'change') {
    if (val.length < 4) { showPinError(tr('lock.tooShort', 'Use at least 4 characters')); return; }
    if (val !== pinInput2.value) { showPinError(tr('lock.mismatch', 'The two entries do not match')); return; }
    pinConfirm.disabled = true;
    try {
      if (mode === 'setup') {
        const code = await createVault(val);
        closePinDialog(true);
        await showRecoveryDialog(code);
      } else {
        await rewrapVault(val, false);
        closePinDialog(true);
        showToast(tr('lock.changed', 'PIN changed'));
      }
    } finally { pinConfirm.disabled = false; }
    syncLockUI();
    return;
  }

  pinConfirm.disabled = true;
  let ok = false;
  try {
    // Unwrapping is the check. A wrong PIN cannot produce a key that decrypts,
    // so there is nothing to compare against and nothing stored to leak.
    ok = mode === 'recover'
      ? await openVault(normalizeRecoveryCode(val), 'recovery')
      : await openVault(val, 'pin');
  } finally { pinConfirm.disabled = false; }

  if (!ok) {
    showPinError(mode === 'recover'
      ? tr('lock.badCode', 'That code does not match')
      : tr('lock.badPin', 'Wrong PIN'));
    pinInput.select();
    return;
  }
  closePinDialog(true);
  await revealLockedTabs();
  syncLockUI();
  // Recovering gets you in, but the PIN you forgot is still the one on the
  // vault — offer to replace it while you are demonstrably the owner.
  if (mode === 'recover') {
    const changed = await openPinDialog('change');
    if (changed) syncLockUI();
  }
}

pinConfirm.addEventListener('click', confirmPinDialog);
pinCancel.addEventListener('click', () => closePinDialog(false));
pinForgot.addEventListener('click', () => {
  closePinDialog(false);
  openPinDialog('recover').then((ok) => { if (ok) syncLockUI(); });
});
[pinInput, pinInput2].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmPinDialog(); }
    if (e.key === 'Escape') { e.preventDefault(); closePinDialog(false); }
  });
  el.addEventListener('input', () => pinError.classList.add('hidden'));
});

// ---------- Recovery code dialog ----------
const recoveryDialog = document.getElementById('recoveryDialog');
const recoveryCodeEl = document.getElementById('recoveryCode');
const recoveryCopy = document.getElementById('recoveryCopy');
const recoverySave = document.getElementById('recoverySave');
const recoveryAck = document.getElementById('recoveryAck');
const recoveryDone = document.getElementById('recoveryDone');
let recoveryResolve = null;

function showRecoveryDialog(code) {
  recoveryCodeEl.textContent = code;
  recoveryAck.checked = false;
  recoveryDone.disabled = true;
  recoveryDialog.classList.remove('hidden');
  return new Promise((resolve) => { recoveryResolve = resolve; });
}

recoveryAck.addEventListener('change', () => { recoveryDone.disabled = !recoveryAck.checked; });
recoveryCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(recoveryCodeEl.textContent).then(
    () => { recoveryCopy.textContent = tr('copied', 'Copied'); },
    () => {}
  );
});
recoverySave.addEventListener('click', () => {
  const nl = String.fromCharCode(10);
  const body = 'PromptPad recovery code' + nl + nl + recoveryCodeEl.textContent + nl + nl +
    'This is the only way into your locked notes if you forget your PIN.' + nl;
  window.api.exportNote('promptpad-recovery-code', body, 'txt');
});
recoveryDone.addEventListener('click', () => {
  recoveryDialog.classList.add('hidden');
  recoveryCopy.textContent = tr('copy', 'Copy');
  const r = recoveryResolve;
  recoveryResolve = null;
  if (r) r(true);
});

// ---------- Settings pane ----------
function syncLockUI() {
  const status = document.getElementById('lockStatus');
  if (!status) return;
  const setup = document.getElementById('lockSetupBtn');
  const change = document.getElementById('lockChangeBtn');
  const now = document.getElementById('lockNowBtn');
  const newCode = document.getElementById('lockNewCodeBtn');
  const n = lockedTabs().length;
  if (!vaultExists()) {
    status.textContent = tr('lock.statusNone', 'No PIN set yet.');
  } else {
    status.textContent =
      (n === 1 ? tr('lock.statusOne', '1 locked note.') : n + ' ' + tr('lock.statusMany', 'locked notes.')) +
      ' ' + (vaultOpen() ? tr('lock.statusOpen', 'Unlocked for this session.')
                         : tr('lock.statusShut', 'Locked.'));
  }
  setup.classList.toggle('hidden', vaultExists());
  change.classList.toggle('hidden', !vaultExists());
  newCode.classList.toggle('hidden', !vaultExists());
  now.classList.toggle('hidden', !vaultExists() || !vaultOpen());
  const removeAll = document.getElementById('lockRemoveAllBtn');
  const reset = document.getElementById('lockResetBtn');
  if (removeAll) removeAll.classList.toggle('hidden', !vaultExists());
  if (reset) reset.classList.toggle('hidden', !vaultExists());
}

// Take the lock off every note and throw the vault away. With the PIN in hand
// nothing is lost: each note is decrypted back to ordinary text first, and the
// next lock starts fresh with a new PIN and a new recovery code.
async function removeAllLocks() {
  if (!(await confirmPin())) return;
  if (!vaultOpen()) return;
  await revealLockedTabs();
  for (const t of lockedTabs()) {
    if (t.enc && !t.content) {
      try { applySealPayload(t, await aesDecrypt(vaultKey, t.enc)); } catch (e) { console.error(e); }
    }
    t.locked = false;
    delete t.enc;
    delete t._encOf;
  }
  vaultKey = null;
  delete settings.vault;
  saveSettingsNow();
  renderTabs();
  applyLockView();
  updateCounts();
  scheduleSave();
  syncLockUI();
  showToast(tr('lock.allRemoved', 'Every note is unlocked and the PIN is gone.'));
}

// The way out when the PIN and the recovery code are both gone. It cannot
// decrypt anything — that is the point of the lock — so the notes that are
// still sealed lose their text. Says so, in those words, with a count.
const lockResetDialog = document.getElementById('lockResetDialog');
const lockResetText = document.getElementById('lockResetText');
const lockResetAck = document.getElementById('lockResetAck');
const lockResetCancel = document.getElementById('lockResetCancel');
const lockResetGo = document.getElementById('lockResetGo');

function openLockResetDialog() {
  const sealed = lockedTabs().filter((t) => !t.content).length;
  lockResetText.textContent = sealed
    ? tr('lock.resetLoss', 'Nobody can read a locked note without the PIN, including PromptPad. ')
      + sealed + ' ' + tr('lock.resetLoss2',
        'note(s) are still encrypted and their text will be gone for good. Everything already open stays.')
    : tr('lock.resetSafe',
      'Nothing is encrypted at the moment, so no text is lost — this only clears the PIN so you can set a new one.');
  lockResetAck.checked = false;
  lockResetGo.disabled = true;
  lockResetDialog.classList.remove('hidden');
}

if (lockResetAck) {
  lockResetAck.addEventListener('change', () => { lockResetGo.disabled = !lockResetAck.checked; });
}
if (lockResetCancel) {
  lockResetCancel.addEventListener('click', () => hideWithAnim(lockResetDialog, 'closing'));
}
if (lockResetGo) {
  lockResetGo.addEventListener('click', () => {
    hideWithAnim(lockResetDialog, 'closing');
    for (const t of lockedTabs()) {
      // Anything still sealed becomes an empty note rather than a tab that
      // can never be opened again. Its name and place are kept.
      t.locked = false;
      delete t.enc;
      delete t._encOf;
      if (typeof t.content !== 'string') t.content = '';
    }
    vaultKey = null;
    delete settings.vault;
    saveSettingsNow();
    const t2 = activeTab();
    if (t2) setEditorText(t2.content || '');
    renderTabs();
    applyLockView();
    updateCounts();
    scheduleSave();
    syncLockUI();
    showToast(tr('lock.reset', 'The PIN is gone. You can set a new one whenever you like.'));
  });
}

document.getElementById('lockSetupBtn').addEventListener('click', async () => {
  await openPinDialog('setup');
  syncLockUI();
});
document.getElementById('lockChangeBtn').addEventListener('click', async () => {
  // The current PIN first, then the new one. Without the first step anyone who
  // found the app unlocked could change the PIN and lock the owner out.
  if (!(await confirmPin())) return;
  await revealLockedTabs();
  await openPinDialog('change');
  syncLockUI();
});
document.getElementById('lockNowBtn').addEventListener('click', async () => {
  await closeVault();
  syncLockUI();
});
document.getElementById('lockNewCodeBtn').addEventListener('click', async () => {
  if (!(await confirmPin())) return;
  const code = await rewrapVault(null, true);
  if (code) await showRecoveryDialog(code);
  syncLockUI();
});
document.getElementById('lockRemoveAllBtn').addEventListener('click', removeAllLocks);
document.getElementById('lockResetBtn').addEventListener('click', openLockResetDialog);
document.getElementById('lockPaneBtn').addEventListener('click', () => ensureVaultOpen());

// ---------- Typed placeholders & presets ----------
// A plain [topic] is a text box. Two things upgrade it:
//   [tone|formal, casual, funny]   a list, so the bar offers a dropdown
//   [date] [time] [clipboard]      known names that can fill themselves in
// Both are read off the token itself, so nothing has to be configured and a
// note carries its own form with it.
const PH_LIST_RE = /^[[{](.+?)\|(.+)[\]}]$/;

// Label and options for a token, or null when it's an ordinary placeholder.
function parsePhToken(token) {
  const m = String(token).match(PH_LIST_RE);
  if (!m) return null;
  const options = m[2].split(',').map((o) => o.trim()).filter(Boolean);
  if (!options.length) return null;
  return { label: m[1].trim(), options };
}

// What the token would say if it filled itself in — null for anything that
// isn't one of the known names. Matched on the bare word inside the brackets,
// so [date] and {date} behave the same.
function autoPhValue(token) {
  const bare = String(token).replace(/^[[{]|[\]}]$/g, '').trim().toLowerCase();
  const now = new Date();
  if (bare === 'date') return now.toLocaleDateString();
  if (bare === 'time') return now.toLocaleTimeString();
  if (bare === 'datetime') return now.toLocaleString();
  if (bare === 'clipboard') return _phClipboard;
  return null;
}

// The clipboard is read once when the fill bar rebuilds rather than per field:
// navigator.clipboard.readText() is async and prompts nothing in Electron, but
// calling it from inside a synchronous DOM build would mean rendering the row
// twice for every [clipboard] in the note.
let _phClipboard = '';
function refreshPhClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.readText) return;
  navigator.clipboard.readText().then((txt) => {
    const next = String(txt || '').trim();
    if (next === _phClipboard) return;
    _phClipboard = next;
    // Only rebuild if a [clipboard] token is actually on screen.
    if (placeholderFieldsEl.querySelector('[data-token*="clipboard" i]')) updatePlaceholderPanel();
  }).catch(() => {});
}

function phPresets() {
  if (!Array.isArray(state.phPresets)) state.phPresets = [];
  return state.phPresets;
}

// Values typed into the bar but not yet applied. This is what "save as preset"
// captures — once a value is applied the token is gone from the note, so there
// is nothing left to read back.
function currentPhDraft() {
  const out = {};
  Array.from(placeholderFieldsEl.children).forEach((row) => {
    const token = row.dataset.token;
    const field = row.querySelector('input, select');
    if (!token || !field) return;
    const val = String(field.value || '').trim();
    if (val) out[token] = val;
  });
  return out;
}

// Fill every token in the note the preset has a value for, in one pass. Done
// as a single content rewrite rather than a loop over fillPlaceholder so the
// whole preset is one undo step.
function applyPhPreset(preset) {
  const t = activeTab();
  if (!t || !preset || !preset.values) return;
  syncEditorToState();
  const tokens = findPlaceholderTokens(t.content);
  const hits = tokens.filter((tok) => preset.values[tok]);
  if (!hits.length) { showToast(tr('ph.presetNoMatch', 'Nothing in this note matches that preset')); return; }

  commitCheckpoint(t);
  const prevContent = t.content;
  let next = t.content;
  hits.forEach((tok) => {
    rememberPhValue(tok, preset.values[tok]);
    next = next.split(tok).join(preset.values[tok]);
  });
  t.content = next;
  t.undoStack = t.undoStack || [];
  t.undoStack.push(prevContent);
  if (t.undoStack.length > UNDO_LIMIT) t.undoStack.shift();
  t.redoStack = [];
  setEditorText(t.content);
  updateCounts();
  scheduleSave();
  updatePlaceholderPanel();
}

// ---------- Preset menu (the ≡ button in the fill bar) ----------
const phPresetBtn = document.getElementById('phPresetBtn');
const phPresetMenu = document.getElementById('phPresetMenu');
const phPresetDialog = document.getElementById('phPresetDialog');
const phPresetNameInput = document.getElementById('phPresetNameInput');
const phPresetSummary = document.getElementById('phPresetSummary');
const phPresetCancel = document.getElementById('phPresetCancel');
const phPresetSave = document.getElementById('phPresetSave');

let _phPendingDraft = null;

function hidePhPresetMenu() { phPresetMenu.classList.add('hidden'); }

function openPhPresetMenu() {
  const list = phPresets();
  phPresetMenu.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'ctx-label';
  label.textContent = tr('ph.presets', 'Presets');
  phPresetMenu.appendChild(label);

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'ctx-item ctx-item--disabled';
    empty.textContent = tr('ph.noPresets', 'None saved yet');
    phPresetMenu.appendChild(empty);
  } else {
    list.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'ctx-item';
      item.textContent = p.name;
      item.setAttribute('dir', detectDir(p.name));
      item.addEventListener('click', () => { hidePhPresetMenu(); applyPhPreset(p); });
      phPresetMenu.appendChild(item);
    });
  }

  const sep = document.createElement('div');
  sep.className = 'ctx-sep';
  phPresetMenu.appendChild(sep);
  const save = document.createElement('div');
  save.className = 'ctx-item';
  save.textContent = tr('ph.savePreset', 'Save typed values…');
  save.addEventListener('click', () => { hidePhPresetMenu(); openPhPresetDialog(); });
  phPresetMenu.appendChild(save);

  phPresetMenu.classList.remove('hidden');
  const r = phPresetBtn.getBoundingClientRect();
  const box = phPresetMenu.getBoundingClientRect();
  const left = Math.max(6, Math.min(r.left, window.innerWidth - box.width - 6));
  const top = Math.min(r.bottom + 4, window.innerHeight - box.height - 6);
  phPresetMenu.style.left = Math.round(left) + 'px';
  phPresetMenu.style.top = Math.round(Math.max(6, top)) + 'px';
}

function openPhPresetDialog() {
  const draft = currentPhDraft();
  const n = Object.keys(draft).length;
  if (!n) {
    showToast(tr('ph.presetEmpty', 'Type values into the fields first, then save them'));
    return;
  }
  _phPendingDraft = draft;
  phPresetNameInput.value = '';
  phPresetSummary.textContent = Object.keys(draft)
    .map((k) => k + ' → ' + draft[k])
    .join('  ·  ');
  phPresetDialog.classList.remove('hidden');
  phPresetNameInput.focus();
}

function closePhPresetDialog() {
  phPresetDialog.classList.add('hidden');
  _phPendingDraft = null;
}

function confirmPhPresetDialog() {
  const name = phPresetNameInput.value.trim();
  const draft = _phPendingDraft;
  closePhPresetDialog();
  if (!name || !draft) return;
  const existing = phPresets().find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.values = draft;
  else phPresets().push({ id: uid(), name, values: draft });
  renderPhPresetList();
  scheduleSave();
}

function renderPhPresetList() {
  const el = document.getElementById('phPresetList');
  if (!el) return;
  el.innerHTML = '';
  const list = phPresets();
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'set-hint custom-action-empty';
    empty.textContent = tr('ph.noPresetsHint',
      'No presets yet — fill the bar’s fields in a note, then Presets → Save typed values.');
    el.appendChild(empty);
    return;
  }
  list.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'custom-action-row';
    const text = document.createElement('div');
    text.className = 'custom-action-text';
    const name = document.createElement('span');
    name.className = 'custom-action-name';
    name.textContent = p.name;
    name.setAttribute('dir', detectDir(p.name));
    const vals = document.createElement('span');
    vals.className = 'custom-action-prompt';
    vals.textContent = Object.keys(p.values || {}).map((k) => k + ' → ' + p.values[k]).join(', ');
    text.appendChild(name);
    text.appendChild(vals);
    const btns = document.createElement('div');
    btns.className = 'custom-action-btns';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'custom-action-btn';
    del.textContent = tr('delete', 'Delete');
    del.addEventListener('click', () => {
      state.phPresets = phPresets().filter((x) => x.id !== p.id);
      renderPhPresetList();
      scheduleSave();
    });
    btns.appendChild(del);
    row.appendChild(text);
    row.appendChild(btns);
    el.appendChild(row);
  });
}

if (phPresetBtn) {
  phPresetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (phPresetMenu.classList.contains('hidden')) openPhPresetMenu();
    else hidePhPresetMenu();
  });
}
document.addEventListener('mousedown', (e) => {
  if (phPresetMenu.classList.contains('hidden')) return;
  if (!phPresetMenu.contains(e.target) && e.target !== phPresetBtn) hidePhPresetMenu();
});
if (phPresetCancel) phPresetCancel.addEventListener('click', closePhPresetDialog);
if (phPresetSave) phPresetSave.addEventListener('click', confirmPhPresetDialog);
if (phPresetNameInput) {
  phPresetNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmPhPresetDialog(); }
    if (e.key === 'Escape') closePhPresetDialog();
  });
}

// ---------- Blocks (@) and slash commands (/) ----------
// Two triggers, one popup. "@" inserts a *block* — a reusable piece of a
// prompt (a persona, an output format, your standing rules); "/" runs a
// command. They share the machinery because they're the same interaction:
// something typed in the note opens a list anchored at the caret, and picking
// an entry rewrites the text you typed to trigger it.
//
// The trigger must sit at a word start (line start or after whitespace).
// Without that guard "/" fires inside every URL and file path, and "@" inside
// every email address.
const INLINE_TRIGGER_RE = /(?:^|\s)([@/])([^\s@/]*)$/;

// Where the caret should land after a block is inserted. Borrowed from every
// snippet engine going; stripped before the text reaches the note.
const BLOCK_CARET = '$0';

// Starter blocks, written once into a workspace that has never had any. They
// exist to make "@" discoverable — a picker that opens empty teaches nothing.
function seedBlocks() {
  return [
    { id: uid(), name: 'persona',
      body: 'You are a [role] with deep experience in [field].\nAnswer as that person would.' },
    { id: uid(), name: 'json',
      body: 'Return your answer as JSON only — no prose, no code fence:\n{\n  "": ""\n}' },
    { id: uid(), name: 'rules',
      body: 'Rules:\n- Ask before assuming anything not stated here.\n- Say so plainly when you are unsure.\n- No filler, no preamble.' },
    { id: uid(), name: 'steps',
      body: 'Work through this step by step, then give the final answer on its own line.' }
  ];
}

function blocks() {
  if (!Array.isArray(state.blocks)) state.blocks = seedBlocks();
  return state.blocks;
}

// ---------- The popup ----------
const inlinePop = document.getElementById('inlinePop');
const inlinePopList = document.getElementById('inlinePopList');
const inlinePopFoot = document.getElementById('inlinePopFoot');

// Open state: which line the trigger sits in, the offsets it spans, and the
// entries currently drawn. `line` is held rather than re-derived because a
// pick has to rewrite exactly the text that opened the popup, and the caret
// may have moved by then.
let inlineCtx = null;
let inlineItems = [];
let inlineIdx = 0;

function inlineOpen() { return !!inlineCtx; }

function closeInlinePop() {
  if (!inlineCtx) return;
  inlineCtx = null;
  inlineItems = [];
  inlineIdx = 0;
  inlinePop.classList.add('hidden');
}

// Every command "/" offers, in menu order. Built fresh each time so the AI
// entries appear and disappear with the AI setting, exactly like the palette.
function slashCommands() {
  const out = [];
  const md = (key, name, hint) =>
    ({ name, hint, kind: 'md', run: () => runMdCommand(key) });

  if (aiOn()) {
    BUILTIN_AI_ACTIONS.forEach((a) => {
      if (a.sep) return;
      // "tone-professional" reads as "/professional" — the prefix is a
      // grouping detail of the menu, not something anyone would type.
      out.push({
        name: a.id.replace(/^tone-/, ''), hint: a.label, kind: 'ai',
        run: () => runTabAiAction(a.id)
      });
    });
    customAiActions().forEach((a) => {
      out.push({
        name: a.name, hint: 'Your action', kind: 'ai',
        run: () => runTabAiAction('custom', a.prompt)
      });
    });
  }

  out.push(md('todo', 'todo', 'Checklist item'));
  out.push(md('table', 'table', 'Insert a table'));
  out.push(md('codeblock', 'code', 'Code block'));
  out.push(md('quote', 'quote', 'Block quote'));
  out.push(md('ul', 'list', 'Bulleted list'));
  out.push(md('ol', 'numbered', 'Numbered list'));
  out.push(md('h1', 'h1', 'Heading 1'));
  out.push(md('h2', 'h2', 'Heading 2'));
  out.push(md('hr', 'divider', 'Horizontal rule'));
  out.push(md('link', 'link', 'Insert a link'));

  out.push({
    name: 'date', hint: new Date().toLocaleDateString(), kind: 'ins',
    run: () => insertAtCaret(new Date().toLocaleDateString())
  });
  out.push({
    name: 'time', hint: new Date().toLocaleTimeString(), kind: 'ins',
    run: () => insertAtCaret(new Date().toLocaleTimeString())
  });
  return out;
}

// Entries for a trigger, already filtered by what's been typed after it.
function inlineCandidates(trigger, query) {
  const all = trigger === '@'
    ? blocks().map((b) => ({
        name: b.name,
        hint: String(b.body || '').replace(/\s+/g, ' ').trim(),
        kind: 'block',
        run: () => insertBlockBody(b)
      }))
    : slashCommands();
  if (!query) return all.slice(0, 40);
  return all
    .map((c) => ({ c, s: cmdFuzzyScore(query, c.name) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .slice(0, 40)
    .map((x) => x.c);
}

function renderInlinePop() {
  inlinePopList.innerHTML = '';
  if (!inlineItems.length) {
    const empty = document.createElement('div');
    empty.className = 'ip-empty';
    empty.textContent = inlineCtx && inlineCtx.trigger === '@'
      ? tr('blocks.none', 'No block by that name')
      : tr('slash.none', 'No command by that name');
    inlinePopList.appendChild(empty);
  } else {
    inlineItems.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'ip-row' + (i === inlineIdx ? ' active' : '');
      row.dataset.idx = i;
      const name = document.createElement('span');
      name.className = 'ip-row-name';
      name.textContent = (inlineCtx.trigger === '@' ? '@' : '/') + c.name;
      row.appendChild(name);
      if (c.hint) {
        const hint = document.createElement('span');
        hint.className = 'ip-row-hint';
        hint.textContent = c.hint;
        hint.setAttribute('dir', detectDir(c.hint));
        row.appendChild(hint);
      }
      inlinePopList.appendChild(row);
    });
  }
  inlinePopFoot.textContent = tr('inline.pick', '↑↓ move · Enter insert · Esc close');
}

// Anchor the list to the caret, flipping above it when there's no room below.
function positionInlinePop() {
  const sel = window.getSelection();
  let rect = null;
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(true);
    rect = r.getBoundingClientRect();
  }
  if (!rect || (!rect.top && !rect.left)) {
    const line = currentLine();
    rect = line ? line.getBoundingClientRect() : null;
  }
  if (!rect) { closeInlinePop(); return; }

  inlinePop.classList.remove('hidden');
  const box = inlinePop.getBoundingClientRect();
  const gap = 4;
  let top = rect.bottom + gap;
  if (top + box.height > window.innerHeight - 6) {
    const above = rect.top - gap - box.height;
    top = above >= 6 ? above : Math.max(6, window.innerHeight - box.height - 6);
  }
  const left = Math.max(6, Math.min(rect.left, window.innerWidth - box.width - 6));
  inlinePop.style.top = Math.round(top) + 'px';
  inlinePop.style.left = Math.round(left) + 'px';
}

function setInlineActive(idx) {
  const rows = [...inlinePopList.querySelectorAll('.ip-row')];
  if (!rows.length) return;
  inlineIdx = (idx + rows.length) % rows.length;
  rows.forEach((r, i) => r.classList.toggle('active', i === inlineIdx));
  rows[inlineIdx].scrollIntoView({ block: 'nearest' });
}

// Re-read the line under the caret and decide whether the popup belongs open.
// Called on every editor input, so it stays cheap: one regex over the text
// before the caret on a single line.
function refreshInlinePop() {
  if (mdOn() || fsActive() || aiChatActive() || !activeTab()) { closeInlinePop(); return; }
  const blocksOn = settings.blocksEnabled !== false;
  const slashOn = settings.slashEnabled !== false;
  if (!blocksOn && !slashOn) { closeInlinePop(); return; }

  const line = currentLine();
  if (!line) { closeInlinePop(); return; }
  const off = getCaretOffsetIn(line);
  if (off == null) { closeInlinePop(); return; }
  const before = line.textContent.slice(0, off);
  const m = before.match(INLINE_TRIGGER_RE);
  if (!m) { closeInlinePop(); return; }

  const trigger = m[1];
  if (trigger === '@' && !blocksOn) { closeInlinePop(); return; }
  if (trigger === '/' && !slashOn) { closeInlinePop(); return; }

  const query = m[2];
  const start = off - (trigger.length + query.length);
  const items = inlineCandidates(trigger, query);
  // Nothing matches what's been typed — the user is writing prose that happens
  // to start with a slash, not picking from a list. Get out of the way.
  if (!items.length && query) { closeInlinePop(); return; }

  const keepIdx = inlineCtx && inlineCtx.trigger === trigger ? inlineIdx : 0;
  inlineCtx = { trigger, query, line, start, end: off };
  inlineItems = items;
  inlineIdx = Math.min(keepIdx, Math.max(0, items.length - 1));
  renderInlinePop();
  positionInlinePop();
}

// Replace [start, end) of `line` with `replacement`, which may carry newlines.
// A multi-line insert can't go through setLineText — it has to become several
// line divs, or the note ends up with a literal newline inside one line.
function replaceInLine(line, start, end, replacement, hasCaretMark) {
  const text = line.textContent;
  const head = text.slice(0, start);
  const tail = text.slice(end);
  const parts = String(replacement).split('\n');

  // Where the caret goes: the $0 marker if the block carried one, otherwise
  // the end of what was inserted.
  let caretLine = parts.length - 1;
  let caretCol = parts[parts.length - 1].length;
  if (hasCaretMark) {
    for (let i = 0; i < parts.length; i++) {
      const at = parts[i].indexOf(BLOCK_CARET);
      if (at !== -1) {
        parts[i] = parts[i].slice(0, at) + parts[i].slice(at + BLOCK_CARET.length);
        caretLine = i;
        caretCol = at;
        break;
      }
    }
  }
  if (caretLine === 0) caretCol += head.length;

  if (parts.length === 1) {
    setLineText(line, head + parts[0] + tail, caretCol);
    return;
  }
  const made = parts.map((p, i) => {
    if (i === 0) return makeLine(head + p);
    if (i === parts.length - 1) return makeLine(p + tail);
    return makeLine(p);
  });
  line.replaceWith(...made);
  made.forEach(highlightLine);
  updateLineDirs();
  placeCaretInLine(made[caretLine], caretCol);
  made[caretLine].scrollIntoView({ block: 'nearest' });
  handleEditorChanged();
}

function insertBlockBody(b) {
  const ctx = inlineCtx;
  if (!ctx) return;
  closeInlinePop();
  const body = String(b.body || '');
  replaceInLine(ctx.line, ctx.start, ctx.end, body, body.includes(BLOCK_CARET));
}

function runInlineActive() {
  const item = inlineItems[inlineIdx];
  const ctx = inlineCtx;
  if (!item || !ctx) { closeInlinePop(); return; }
  if (ctx.trigger === '@') { item.run(); return; }   // rewrites the line itself
  // A command consumes the "/query" that summoned it before it runs, so the
  // trigger text never survives into the note (and an AI action isn't handed
  // "/summarize" as part of its input).
  closeInlinePop();
  replaceInLine(ctx.line, ctx.start, ctx.end, '', false);
  try { item.run(); } catch (err) { console.error('slash command failed', err); }
}

// Keys are taken in the capture phase on the document: the editor's own Enter
// and Tab handlers live on #editor and would otherwise split the line before
// this ever saw the key.
document.addEventListener('keydown', (e) => {
  if (!inlineOpen() || e.isComposing) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setInlineActive(inlineIdx + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setInlineActive(inlineIdx - 1); }
  else if (e.key === 'Enter' || e.key === 'Tab') {
    if (!inlineItems.length) { closeInlinePop(); return; }
    e.preventDefault();
    e.stopPropagation();
    runInlineActive();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeInlinePop();
  }
}, true);

inlinePopList.addEventListener('mousemove', (e) => {
  const row = e.target.closest('.ip-row');
  if (row) setInlineActive(+row.dataset.idx);
});
// The editor must keep focus through the click, or the caret the insert is
// aimed at is gone by the time the handler runs.
inlinePop.addEventListener('mousedown', (e) => e.preventDefault());
inlinePopList.addEventListener('click', (e) => {
  const row = e.target.closest('.ip-row');
  if (!row) return;
  setInlineActive(+row.dataset.idx);
  runInlineActive();
});

editorEl.addEventListener('input', refreshInlinePop);
editorEl.addEventListener('blur', () => setTimeout(closeInlinePop, 60));
// Arrow keys and clicks move the caret off the trigger without firing input.
editorEl.addEventListener('keyup', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refreshInlinePop();
});
editorEl.addEventListener('mouseup', () => { if (inlineOpen()) refreshInlinePop(); });
window.addEventListener('resize', () => { if (inlineOpen()) positionInlinePop(); });

// ---------- Blocks: settings list + editor dialog ----------
const blocksListEl = document.getElementById('blocksList');
const addBlockBtn = document.getElementById('addBlockBtn');
const blockDialog = document.getElementById('blockDialog');
const blockDialogLabel = document.getElementById('blockDialogLabel');
const blockNameInput = document.getElementById('blockNameInput');
const blockBodyInput = document.getElementById('blockBodyInput');
const blockCancel = document.getElementById('blockCancel');
const blockSave = document.getElementById('blockSave');

let editingBlockId = null;

// Names are what gets typed after "@", so they can't hold whitespace or the
// trigger characters — the regex that opens the popup stops at all three.
function normalizeBlockName(raw) {
  return String(raw || '').trim().replace(/[\s@/]+/g, '-').slice(0, 32);
}

function uniqueBlockName(name, ignoreId) {
  const taken = new Set(
    blocks().filter((b) => b.id !== ignoreId).map((b) => String(b.name).toLowerCase())
  );
  if (!taken.has(name.toLowerCase())) return name;
  let n = 2;
  while (taken.has((name + '-' + n).toLowerCase())) n++;
  return name + '-' + n;
}

function renderBlocksList() {
  if (!blocksListEl) return;
  blocksListEl.innerHTML = '';
  const list = blocks();
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'set-hint custom-action-empty';
    empty.textContent = tr('blocks.empty', 'No blocks yet.');
    blocksListEl.appendChild(empty);
    return;
  }
  list.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'custom-action-row';
    const text = document.createElement('div');
    text.className = 'custom-action-text';
    const name = document.createElement('span');
    name.className = 'custom-action-name';
    name.textContent = '@' + b.name;
    const body = document.createElement('span');
    body.className = 'custom-action-prompt';
    body.textContent = String(b.body || '').replace(/\s+/g, ' ').trim();
    body.setAttribute('dir', detectDir(b.body || ''));
    text.appendChild(name);
    text.appendChild(body);
    const btns = document.createElement('div');
    btns.className = 'custom-action-btns';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'custom-action-btn';
    edit.textContent = tr('edit', 'Edit');
    edit.addEventListener('click', () => openBlockDialog(b.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'custom-action-btn';
    del.textContent = tr('delete', 'Delete');
    del.addEventListener('click', () => {
      state.blocks = blocks().filter((x) => x.id !== b.id);
      renderBlocksList();
      scheduleSave();
    });
    btns.appendChild(edit);
    btns.appendChild(del);
    row.appendChild(text);
    row.appendChild(btns);
    blocksListEl.appendChild(row);
  });
}

function openBlockDialog(id, presetBody) {
  editingBlockId = id || null;
  const b = id ? blocks().find((x) => x.id === id) : null;
  blockDialogLabel.textContent = b ? tr('blocks.edit', 'Edit block') : tr('blocks.new', 'New block');
  blockNameInput.value = b ? b.name : '';
  blockBodyInput.value = b ? b.body : (presetBody || '');
  blockDialog.classList.remove('hidden');
  (b ? blockBodyInput : blockNameInput).focus();
}

function closeBlockDialog() {
  blockDialog.classList.add('hidden');
  editingBlockId = null;
}

function confirmBlockDialog() {
  const body = blockBodyInput.value;
  let name = normalizeBlockName(blockNameInput.value);
  if (!name && !body.trim()) { closeBlockDialog(); return; }
  if (!name) name = 'block';
  name = uniqueBlockName(name, editingBlockId);
  const existing = editingBlockId ? blocks().find((b) => b.id === editingBlockId) : null;
  if (existing) {
    existing.name = name;
    existing.body = body;
  } else {
    blocks().push({ id: uid(), name, body });
  }
  closeBlockDialog();
  renderBlocksList();
  scheduleSave();
}

if (addBlockBtn) addBlockBtn.addEventListener('click', () => openBlockDialog(null));
if (blockCancel) blockCancel.addEventListener('click', closeBlockDialog);
if (blockSave) blockSave.addEventListener('click', confirmBlockDialog);
if (blockNameInput) {
  blockNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); blockBodyInput.focus(); }
    if (e.key === 'Escape') closeBlockDialog();
  });
}
if (blockBodyInput) {
  blockBodyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirmBlockDialog(); }
    if (e.key === 'Escape') closeBlockDialog();
  });
}

// Turn whatever is selected in the note into a block, with the dialog opened
// on it so it can be named. Wired to the editor's right-click menu.
function saveSelectionAsBlock(preset) {
  const range = preset === undefined ? currentSelectionRange() : null;
  const t = activeTab();
  const body = preset !== undefined ? preset : (range ? range.text : (t ? t.content : ''));
  if (!String(body || '').trim()) return;
  openSettings();
  setTimeout(() => {
    revealSetting('blocksList');
    openBlockDialog(null, body);
  }, 60);
}

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
    openSettings(voiceHfApiKeyInputEl);
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

// Real (OS-level) fullscreen — also covers the taskbar, unlike Maximize.
// Same source-of-truth reasoning as applyMaximized: it can be entered outside
// the app too (macOS green button, a window-manager shortcut).
let isFullscreen = false;
function applyFullscreen(on) {
  isFullscreen = !!on;
  appEl.classList.toggle('is-fullscreen', isFullscreen);
  fullscreenBtn.title = (isFullscreen ? tr('fullscreen.exit', 'Exit fullscreen') : tr('fullscreen.enter', 'Fullscreen')) + ' (F11)';
}
async function toggleFullscreen() {
  if (settings.handyMode) return; // handy mode owns the window bounds
  applyFullscreen(await window.api.toggleFullscreen());
}
fullscreenBtn.addEventListener('click', toggleFullscreen);
window.api.onFullscreenChange(applyFullscreen);

// Window motion goes straight to the effect layer. Nothing in the app itself
// wants it — it is only for themes that model something physical, and they
// are the only things that know what to do with it.
if (window.api.onWindowShove) {
  window.api.onWindowShove((v) => {
    if (window.PP_FX && v) PP_FX.shove(v.dx || 0, v.dy || 0);
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'F11') return;
  e.preventDefault();
  toggleFullscreen();
});

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
  if (window.PP_FX) {
    // Volume first: apply() may build the audio graph, and a sound theme
    // arriving at the module default would be loud for one keystroke.
    if (window.PP_FX.setVolume) window.PP_FX.setVolume((settings.fxVolume ?? 60) / 100);
    window.PP_FX.apply(t.fx || null);
  }
  // The native window can't take the rgba backgrounds the effect themes use.
  window.api.setBgColor(t.winBg || t.bg);
}

function applyFont(id) {
  // A theme may ship a typeface — Nostalgia does, where a smooth font over
  // dithered pixels breaks the illusion. It is only a default: the switch in
  // Settings hands the font picker back, and the theme still looks like
  // itself, just in your face rather than its own.
  const themed = THEMES[settings.theme] && THEMES[settings.theme].font;
  const useThemeFont = themed && settings.themeFont !== false;
  if (themeFontRow) themeFontRow.classList.toggle('hidden', !themed);
  if (toggleThemeFontEl) toggleThemeFontEl.checked = settings.themeFont !== false;
  if (fontRow) fontRow.classList.toggle('disabled', !!useThemeFont);
  if (useThemeFont) {
    document.documentElement.style.setProperty('--font', themed);
    return;
  }
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
  document.documentElement.classList.toggle('no-anim', !animationsOn());
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
  applyThemeTabBadge();
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
  { key: 'voice', label: 'Speech to Text', el: () => voiceBtn },
  { key: 'md', label: 'Markdown', el: () => mdBtn },
  { key: 'paste', label: 'Paste', el: () => pasteBtn },
  { key: 'copy', label: 'Copy', el: () => copyBtn },
  { key: 'img', label: 'Image', el: () => imgBtn },
  { key: 'record', label: 'Record', el: () => voiceNoteBtn },
  { key: 'video', label: 'Video', el: () => videoBtn },
  { key: 'table', label: 'Table', el: () => tableBtn },
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
// The flyout is positioned in viewport coordinates rather than against
// .status-actions. It has to be: the panel sits at bottom:100% of the status
// bar, which is *outside* it, and .statusbar carries `overflow: hidden` so
// that focus mode can animate its height to zero. Absolutely positioned, the
// whole panel was therefore clipped away — the chevron lit up, rotated, and
// showed nothing, which is exactly what "the arrow is broken" looks like.
//
// Fixed positioning takes it out of every ancestor's clip. The cost is having
// to place it by hand, which is the loop below: sit above the chevron, right-
// aligned to it, and slide back inside the window if that would hang off an
// edge.
function positionToolbarOverflow() {
  const btn = toolbarOverflowBtnEl.getBoundingClientRect();
  const p = toolbarOverflowPanelEl;
  p.style.left = '0px';
  p.style.top = '0px';
  // offsetWidth/Height, not getBoundingClientRect: this runs while the entry
  // animation's first frame is on the element, and that frame is scaled to
  // 93%. Measuring the scaled box put the panel eight pixels too low, sitting
  // on top of the button it is supposed to sit above. The offset properties
  // report the laid-out size and ignore transforms.
  const panel = { width: p.offsetWidth, height: p.offsetHeight };
  const GAP = 6, EDGE = 8;
  let left = btn.left;
  if (left + panel.width > window.innerWidth - EDGE) left = window.innerWidth - EDGE - panel.width;
  if (left < EDGE) left = EDGE;
  let top = btn.top - panel.height - GAP;
  const below = top < EDGE;
  if (below) top = btn.bottom + GAP;   // no room above: drop below
  p.style.left = Math.round(left) + 'px';
  p.style.top = Math.round(top) + 'px';
  // Grow out of the button rather than out of a corner that has nothing to do
  // with it: the origin follows wherever the panel ended up relative to it.
  const originX = Math.max(0, Math.min(panel.width, btn.left + btn.width / 2 - left));
  p.style.transformOrigin = originX.toFixed(1) + 'px ' + (below ? '0' : '100%');
}

let toolbarOverflowCloseTimer = null;

function openToolbarOverflow() {
  clearTimeout(toolbarOverflowCloseTimer);
  toolbarOverflowPanelEl.classList.remove('is-closing');
  toolbarOverflowPanelEl.classList.remove('hidden');
  toolbarOverflowBtnEl.classList.add('active');
  positionToolbarOverflow();
}

// `hidden` is display:none, so the panel cannot transition out of it — it has
// to finish animating first and only then be taken out of the layout.
function closeToolbarOverflow() {
  toolbarOverflowBtnEl.classList.remove('active');
  if (toolbarOverflowPanelEl.classList.contains('hidden')) return;
  clearTimeout(toolbarOverflowCloseTimer);
  toolbarOverflowPanelEl.classList.add('is-closing');
  toolbarOverflowCloseTimer = setTimeout(() => {
    toolbarOverflowPanelEl.classList.add('hidden');
    toolbarOverflowPanelEl.classList.remove('is-closing');
  }, 130);
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

  fitToolbar();
}

// Anything that does not fit in the row goes into the flyout.
//
// The row used to be `overflow-x: auto` with the scrollbar hidden, which meant
// the buttons past the edge were still there and simply could not be seen or
// reached: at the window's default width it wanted 1324px and had 541. From
// the outside that reads as "the buttons are gone", and the chevron looks
// broken because the thing you are looking for is not in it either.
//
// Buttons pushed in here are marked, so they are only borrowed: they go back
// to the row the moment the window is wide enough, and they are never written
// into settings.toolbarCollapsed, which stays the user's own choice.
function fitToolbar() {
  if (!toolbarMainEl || !toolbarOverflowPanelEl) return;

  // Give everything back first, in the saved order, so widening the window
  // undoes this and the row does not slowly drain into the flyout.
  const borrowed = [...toolbarOverflowPanelEl.children]
    .filter((el) => el.dataset.autoOverflow === '1');
  if (borrowed.length) {
    const order = settings.toolbarOrder || [];
    const collapsed = new Set(settings.toolbarCollapsed || []);
    borrowed.forEach((el) => { delete el.dataset.autoOverflow; });
    order.filter((k) => !collapsed.has(k)).forEach((k) => {
      const el = TOOLBAR_BUTTONS.find((b) => b.key === k)?.el();
      if (el) toolbarMainEl.appendChild(el);
    });
  }

  // Then take back only what genuinely does not fit. Measured after a layout
  // read, one button at a time from the end, because the widths differ.
  let guard = TOOLBAR_BUTTONS.length + 1;
  while (guard-- > 0 && toolbarMainEl.scrollWidth > toolbarMainEl.clientWidth + 1) {
    const last = toolbarMainEl.lastElementChild;
    if (!last) break;
    last.dataset.autoOverflow = '1';
    toolbarOverflowPanelEl.insertBefore(last, toolbarOverflowPanelEl.firstChild);
  }

  toolbarOverflowPanelEl.classList.toggle('empty', toolbarOverflowPanelEl.children.length === 0);
}

// The row's width changes with the window, the rail, and the fill panel.
let fitToolbarTimer = null;
function scheduleFitToolbar() {
  clearTimeout(fitToolbarTimer);
  fitToolbarTimer = setTimeout(fitToolbar, 80);
}
window.addEventListener('resize', scheduleFitToolbar);

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
  // A button that fitToolbar() borrowed is in the flyout because the window is
  // narrow, not because the user put it there — recording it as collapsed
  // would make a temporary shortage permanent, and it would never come back
  // when the window was widened again.
  const overflowKeys = [...toolbarOverflowPanelEl.children]
    .filter((el) => el.dataset.autoOverflow !== '1')
    .map((el) => el.dataset.toolbarKey).filter(Boolean);
  const borrowedKeys = [...toolbarOverflowPanelEl.children]
    .filter((el) => el.dataset.autoOverflow === '1')
    .map((el) => el.dataset.toolbarKey).filter(Boolean);
  settings.toolbarOrder = [...mainKeys, ...borrowedKeys, ...overflowKeys];
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
      // Dragging it makes wherever it lands a deliberate choice, so it stops
      // being one of fitToolbar()'s borrowed buttons.
      delete btn.dataset.autoOverflow;
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
// The side panel's slide is pure CSS: both widths are known, so a transition
// on `width` is the whole animation. The top bar is the awkward one — its open
// height is however tall the fields happen to be — so it gets the usual
// accordion treatment: pin max-height to the measured height, then drive it to
// zero (and back), releasing the cap afterwards so the row can still grow when
// a note gains a placeholder.
let phCollapseTimer = null;

function applyPlaceholderCollapsed(animate) {
  const c = !!settings.placeholderBarCollapsed;
  const side = settings.placeholderBarPosition === 'right';
  placeholderBarEl.classList.toggle('collapsed', c);
  editorBodyEl.classList.toggle('ph-collapsed', c);
  placeholderCollapseEl.classList.toggle('collapsed', c);
  placeholderCollapseEl.title = c ? tr('expand', 'Expand') : tr('collapse', 'Collapse');

  clearTimeout(phCollapseTimer);
  const fields = placeholderFieldsEl;
  if (side) { fields.style.maxHeight = ''; return; }

  if (!animate) {
    fields.style.maxHeight = c ? '0px' : '';
    return;
  }
  if (c) {
    fields.style.maxHeight = fields.scrollHeight + 'px';
    // One frame at the measured height, or the browser has no start value to
    // animate from and jumps straight to zero.
    requestAnimationFrame(() => {
      if (settings.placeholderBarCollapsed) fields.style.maxHeight = '0px';
    });
  } else {
    fields.style.maxHeight = fields.scrollHeight + 'px';
    phCollapseTimer = setTimeout(() => {
      if (!settings.placeholderBarCollapsed) fields.style.maxHeight = '';
    }, 260);
  }
}

placeholderCollapseEl.addEventListener('click', () => {
  settings.placeholderBarCollapsed = !settings.placeholderBarCollapsed;
  applyPlaceholderCollapsed(true);
  saveSettingsNow();
});

async function saveSettingsNow() {
  try { await window.api.saveSettings(settings); } catch (e) { console.error(e); }
}

// ---------- Settings: panel ----------
// ---------- Guide ----------
// Topics live in guide.js; this only renders them. The language switch is
// independent of the app's own — someone running the English interface may
// still want to read the Persian, and the other way round — but it opens on
// whichever the interface is set to, because that is the better guess.
const guideOverlay = document.getElementById('guideOverlay');
const guideNav = document.getElementById('guideNav');
const guideArticle = document.getElementById('guideArticle');
const guideLangSeg = document.getElementById('guideLangSeg');
const guideClose = document.getElementById('guideClose');
const openGuideBtn = document.getElementById('openGuideBtn');

let guideLang = 'en';
let guideTopic = null;

function guideTopics() { return Array.isArray(window.PP_GUIDE) ? window.PP_GUIDE : []; }

// The prose carries **bold**, `code` and nothing else. Built as elements
// rather than innerHTML: the text is ours, but there is no reason for a
// documentation renderer to be able to inject markup at all.
function renderGuideLine(text, into) {
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) into.appendChild(document.createTextNode(text.slice(last, m.index)));
    const el = document.createElement(m[1] ? 'b' : 'code');
    el.textContent = m[1] || m[2];
    into.appendChild(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
}

function renderGuideArticle() {
  const t = guideTopics().find((x) => x.id === guideTopic) || guideTopics()[0];
  if (!t) return;
  const rtl = guideLang === 'fa';
  guideArticle.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  guideArticle.innerHTML = '';
  guideArticle.scrollTop = 0;

  const h = document.createElement('h4');
  h.textContent = t.title[guideLang] || t.title.en;
  guideArticle.appendChild(h);

  if (t.img) {
    const img = document.createElement('img');
    img.className = 'guide-shot';
    img.src = 'guide-images/' + t.img;
    img.alt = t.title.en;
    // A missing screenshot leaves a broken-image box in the middle of the
    // article; dropping the element is quieter and the prose still stands.
    img.addEventListener('error', () => img.remove());
    guideArticle.appendChild(img);
  }

  (t.body[guideLang] || t.body.en || []).forEach((line) => {
    const p = document.createElement('p');
    renderGuideLine(line, p);
    guideArticle.appendChild(p);
  });
}

function renderGuideNav() {
  const rtl = guideLang === 'fa';
  guideNav.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  guideNav.innerHTML = '';
  guideTopics().forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'guide-nav-item' + (t.id === guideTopic ? ' active' : '');
    b.textContent = t.title[guideLang] || t.title.en;
    b.addEventListener('click', () => {
      guideTopic = t.id;
      renderGuideNav();
      renderGuideArticle();
    });
    guideNav.appendChild(b);
  });
  guideLangSeg.querySelectorAll('.seg-btn').forEach((el) => {
    el.classList.toggle('active', el.dataset.guidelang === guideLang);
  });
}

function openGuide() {
  guideLang = settings.language === 'fa' ? 'fa' : 'en';
  if (!guideTopic) guideTopic = (guideTopics()[0] || {}).id || null;
  guideOverlay.classList.remove('hidden', 'closing');
  renderGuideNav();
  renderGuideArticle();
}

function closeGuide() { hideWithAnim(guideOverlay, 'closing'); }

if (openGuideBtn) openGuideBtn.addEventListener('click', () => { closeSettings(); openGuide(); });
if (guideClose) guideClose.addEventListener('click', closeGuide);
if (guideOverlay) {
  guideOverlay.addEventListener('click', (e) => { if (e.target === guideOverlay) closeGuide(); });
}
if (guideLangSeg) {
  guideLangSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    guideLang = btn.dataset.guidelang;
    renderGuideNav();
    renderGuideArticle();
  });
}

// ---------- Theme browser ----------
// Two problems with a wall of 34px swatches: at that size every dark theme is
// the same dark square, and a swatch cannot show motion at all — which is the
// entire content of the Pro, Sound, Live and Playable themes.
//
// So: a card is the app in miniature, painted from the theme's own variables,
// and hovering one applies the theme to the real window for as long as the
// pointer is on it. The settings panel is drawn with the same variables, so
// the preview repaints the panel you are standing in — no separate render of
// anything, and the effect runtime you are previewing is the real one.
const themeBrowser = document.getElementById('themeBrowser');
const tbGrid = document.getElementById('tbGrid');
const tbFilters = document.getElementById('tbFilters');
const tbSearch = document.getElementById('tbSearch');
const tbFoot = document.getElementById('tbFoot');
const tbHint = document.getElementById('tbHint');


// Category order and labels, in one place — the swatch groups, the filter
// chips and the card footers all read from it, so a new category is one line.
// The old "Pro" was 25 entries with nothing in common but not being a plain
// palette. These say what actually drives the theme, which is the only thing
// that helps anyone find one.
//
// Each carries its own one-line explanation, shown under the chips when it is
// selected. Half these words do not explain themselves — "Reactive" and "Live"
// in particular could mean almost anything — and a category nobody can define
// is a category nobody clicks.
const THEME_KINDS = [
  { id: 'dark',     label: 'Dark',      hint: 'Plain dark palettes. Nothing moves.' },
  { id: 'light',    label: 'Light',     hint: 'Plain light palettes, for a lit room.' },
  { id: 'reactive', label: 'Reactive',  hint: 'Answers your keyboard — the window responds as you write.' },
  { id: 'nature',   label: 'Nature',    hint: 'Weather, water and sky, carrying on by themselves.' },
  { id: 'machines', label: 'Machines',  hint: 'Instruments and screens: traces, tape, current.' },
  { id: 'retro',    label: 'Nostalgia', hint: 'Places, drawn the way 1997 hardware drew them.' },
  { id: 'live',     label: 'Live',      hint: 'Reads the real world — the clock, the season, your speakers.' },
  { id: 'sound',    label: 'Sound',     hint: 'You hear these. Volume is at the bottom of this pane.' },
  { id: 'play',     label: 'Playable',  hint: 'You can touch them. Push things around with the cursor.' },
  { id: 'luxury',   label: 'Luxury',    hint: 'Rendered as a material: glass, gold, pearl, obsidian.' }
];
const TB_HINTS = {
  all: 'Every theme, newest first.',
  rec: 'A short list worth trying first.',
  fav: 'The ones you starred.'
};
const KIND_LABEL = {};
THEME_KINDS.forEach((k) => { KIND_LABEL[k.id] = k.label; });

let tbFilter = 'all';
// The card order for this visit to the pane. Held so that starring a theme or
// picking one never rearranges the board under the pointer; recomputed when
// the pane is next opened.
let tbOrder = null;
// Favourites as they stood when this visit began — see the note in
// renderThemeBrowser where it is filled.
let tbStarred = new Set();

// There was a hover preview here — pass over a card and the whole window took
// that theme on. It was pulled. Two things kept going wrong with it and both
// were symptoms of the same problem: a preview that fires on movement fires on
// movement you did not mean. The window growing as the pane opened slid cards
// under a stationary cursor; so did the grid re-laying out after a render.
// Each of those was fixable, and each fix was another guard on top of a
// feature nobody had asked to be that clever. Clicking a card applies it
// instantly and clicking another undoes that, which was always the honest
// version of the same idea.

function favThemes() {
  if (!Array.isArray(settings.favThemes)) settings.favThemes = [];
  return settings.favThemes;
}
function recentThemes() {
  if (!Array.isArray(settings.recentThemes)) settings.recentThemes = [];
  return settings.recentThemes;
}
function rememberTheme(key) {
  const list = recentThemes().filter((k) => k !== key);
  list.unshift(key);
  settings.recentThemes = list.slice(0, 6);
}

// ---------- Live preview ----------
// Applying a theme is already a pure function of settings.theme, so a peek is
// just that with the save left out. Debounced: dragging the pointer across a
// grid of cards would otherwise start and stop a dozen effect runtimes.
// Which card is the current theme. Nothing else is marked any more.
function markPeekingCard() {
  if (!tbGrid) return;
  tbGrid.querySelectorAll('.tb-card').forEach((el) => {
    el.classList.toggle('active', el.dataset.theme === settings.theme);
  });
}

// Clicking a card is the whole interaction now: it applies at once, and
// clicking a different one applies that instead.
function chooseTheme(key) {
  const prev = THEMES[settings.theme];
  settings.theme = key;
  rememberTheme(key);
  markThemeSeen(key);
  applySettings();
  renderThemeBrowser();
  saveSettingsNow();
  const t = THEMES[key];
  if (!!(prev && prev.needsRestart) !== !!(t && t.needsRestart)) showRestartBanner();
}

// ---------- Cards ----------
// The miniature is the app, not a diagram of it: the same title bar, the same
// rail with the same tab shapes, a note with real words in it and a real
// [placeholder], the same status bar. It is laid out at the window's actual
// proportions and scaled down, so what you are looking at is the thing you
// would get — every colour on it comes from the theme's own seven variables,
// which is also why a theme added tomorrow gets a correct card for free.
//
// What a still cannot show is motion, and for half of these that is the whole
// theme. That is what the hover preview is for: the card gets you close enough
// to know which one to hover.
function buildThemeMini(t, key) {
  const wrap = document.createElement('div');
  wrap.className = 'tb-mini';

  const app = document.createElement('div');
  app.className = 'tb-mini-app';
  app.style.background = t.winBg || t.bg;
  // Light themes need their hairlines dark and dark themes need them light,
  // or half the cards come out looking like they have no chrome at all.
  const light = /theme-light/.test(t.cssClass || '');
  const rule = light ? 'rgba(0,0,0,.13)' : 'rgba(255,255,255,.09)';

  // ---- title bar
  const bar = document.createElement('div');
  bar.className = 'tb-mini-bar';
  bar.style.background = t.sidebar;
  bar.style.borderBottom = '1px solid ' + rule;
  const dot = document.createElement('span');
  dot.className = 'tb-mini-dot';
  dot.style.background = t.accent;
  const brand = document.createElement('span');
  brand.className = 'tb-mini-brand';
  brand.style.color = t.text;
  brand.textContent = 'promptpad';
  bar.appendChild(dot);
  bar.appendChild(brand);
  const wins = document.createElement('span');
  wins.className = 'tb-mini-wins';
  for (let i = 0; i < 3; i++) {
    const w = document.createElement('i');
    w.style.background = t.text;
    wins.appendChild(w);
  }
  bar.appendChild(wins);

  // ---- body: rail + note
  const body = document.createElement('div');
  body.className = 'tb-mini-body';

  const rail = document.createElement('div');
  rail.className = 'tb-mini-rail';
  rail.style.background = t.sidebar;
  rail.style.borderRight = '1px solid ' + rule;
  ['new', 'templates', 'discover'].forEach((label) => {
    const pill = document.createElement('span');
    pill.className = 'tb-mini-pill';
    pill.style.color = t.text;
    pill.style.border = '1px solid ' + rule;
    pill.textContent = label;
    rail.appendChild(pill);
  });
  const active = document.createElement('span');
  active.className = 'tb-mini-pill tb-mini-pill--on';
  active.style.color = t.text;
  active.style.background = t.elevatedHi;
  active.style.boxShadow = 'inset 2px 0 0 ' + t.accent;
  active.textContent = 'tea landing';
  rail.appendChild(active);

  const note = document.createElement('div');
  note.className = 'tb-mini-note';
  note.style.background = t.bg;
  note.style.color = t.text;
  const p1 = document.createElement('div');
  p1.textContent = 'Write a landing page for';
  const p2 = document.createElement('div');
  p2.textContent = 'a tea company. Keep it';
  const p3 = document.createElement('div');
  p3.append('calm. Tone: ');
  const ph = document.createElement('span');
  ph.style.color = t.accent;
  ph.textContent = '[tone]';
  p3.appendChild(ph);
  const caret = document.createElement('span');
  caret.className = 'tb-mini-caret';
  caret.style.background = t.accent;
  p3.appendChild(caret);
  note.appendChild(p1);
  note.appendChild(p2);
  note.appendChild(p3);

  // The sketch: a few seconds of what the theme actually does, over the note
  // area rather than the whole card, so the miniature still reads as the app
  // — the rail and the title bar are half of why the card is convincing.
  if (window.PP_SKETCH && key && PP_SKETCH.has(key, t)) {
    const fx = document.createElement('canvas');
    fx.className = 'tb-mini-fx';
    fx.dataset.theme = key;
    note.appendChild(fx);
  }

  body.appendChild(rail);
  body.appendChild(note);

  // ---- status bar
  const foot = document.createElement('div');
  foot.className = 'tb-mini-foot';
  foot.style.background = t.elevated;
  foot.style.borderTop = '1px solid ' + rule;
  ['Todo', 'Improve', 'Voice'].forEach((label) => {
    const b = document.createElement('span');
    b.className = 'tb-mini-btn';
    b.style.color = t.text;
    b.style.border = '1px solid ' + rule;
    b.textContent = label;
    foot.appendChild(b);
  });

  app.appendChild(bar);
  app.appendChild(body);
  app.appendChild(foot);
  wrap.appendChild(app);
  return wrap;
}

// ---------- Card sketches ----------
// One rAF for the whole grid, at twelve frames a second, drawing only the
// cards that are actually on screen.
//
// Seventy live canvases is the obvious way to do this and the wrong one: it is
// seventy contexts, seventy timers' worth of work per frame, and most of them
// scrolled out of sight. One loop that skips anything outside the grid's box
// costs about as much as a single card did.
//
// Twelve frames a second on purpose, too. These are thumbnails; at sixty they
// would be smoother and would also be the most expensive thing in the app
// while you decide which colour you like.
let miniItems = [];
let miniRaf = null;
let miniLast = 0;

function stopMiniSketches() {
  if (miniRaf != null) cancelAnimationFrame(miniRaf);
  miniRaf = null;
  miniItems = [];
}

function startMiniSketches() {
  stopMiniSketches();
  if (!tbGrid || !window.PP_SKETCH) return;
  miniItems = [...tbGrid.querySelectorAll('canvas.tb-mini-fx')].map((el) => ({
    el, key: el.dataset.theme, theme: THEMES[el.dataset.theme], g: null, w: 0, h: 0
  })).filter((it) => it.theme);
  if (!miniItems.length) return;
  // With motion off, one frame each and no loop at all.
  if (!animationsOn()) { drawMiniFrame(performance.now()); return; }
  miniRaf = requestAnimationFrame(tickMini);
}

function drawMiniFrame(now) {
  const box = tbGrid.getBoundingClientRect();
  const time = now / 1000;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const it of miniItems) {
    const r = it.el.getBoundingClientRect();
    if (!r.width || r.bottom < box.top - 60 || r.top > box.bottom + 60) continue;
    if (!it.g || it.w !== Math.round(r.width) || it.h !== Math.round(r.height)) {
      it.w = Math.round(r.width);
      it.h = Math.round(r.height);
      it.el.width = Math.max(1, Math.round(it.w * dpr));
      it.el.height = Math.max(1, Math.round(it.h * dpr));
      it.g = it.el.getContext('2d');
      it.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    PP_SKETCH.draw(it.key, it.theme, it.g, it.w, it.h, time);
  }
}

function tickMini(now) {
  miniRaf = requestAnimationFrame(tickMini);
  if (now - miniLast < 80) return;
  miniLast = now;
  drawMiniFrame(now);
}

function starIcon(on) {
  return '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
    '<path d="M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85z"' +
    ' fill="' + (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.6"' +
    ' stroke-linejoin="round"/></svg>';
}

function themeMatches(key, t, q) {
  if (!q) return true;
  const hay = (t.label + ' ' + key + ' ' + (t.keywords || '') + ' ' +
    (KIND_LABEL[t.type] || t.type)).toLowerCase();
  return hay.includes(q) || cmdFuzzyScore(q, t.label) >= 0;
}

function renderThemeBrowser() {
  if (!tbGrid) return;
  const q = (tbSearch.value || '').trim().toLowerCase();

  // Filter chips, rebuilt each time so a category with nothing in it never
  // offers a chip that leads to an empty grid. Each carries its own count:
  // "Nature 5" answers "is it worth opening?" before you open it, and the
  // numbers also make the row scannable as a shape rather than a wall of
  // similar words.
  tbFilters.innerHTML = '';
  const counts = {};
  Object.values(THEMES).forEach((t) => { counts[t.type] = (counts[t.type] || 0) + 1; });
  const recCount = Object.values(THEMES).filter((t) => t.recommended).length;
  const chips = [{ id: 'all', label: tr('tb.all', 'All'), n: Object.keys(THEMES).length }]
    .concat(recCount ? [{ id: 'rec', label: tr('tb.rec', 'Recommended'), n: recCount, star: true }] : [])
    .concat(THEME_KINDS.filter((k) => counts[k.id]).map((k) => ({ ...k, n: counts[k.id] })))
    .concat(favThemes().length ? [{ id: 'fav', label: tr('tb.fav', 'Starred'), n: favThemes().length }] : []);
  chips.forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-chip' + (tbFilter === k.id ? ' active' : '') + (k.star ? ' tb-chip--rec' : '');
    const lab = document.createElement('span');
    lab.textContent = k.label;
    b.appendChild(lab);
    const n = document.createElement('i');
    n.className = 'tb-chip-n';
    n.textContent = String(k.n);
    b.appendChild(n);
    if (k.hint || TB_HINTS[k.id]) b.title = k.hint || TB_HINTS[k.id];
    b.addEventListener('click', () => {
      tbFilter = k.id;
      renderThemeBrowser();
    });
    tbFilters.appendChild(b);
  });

  if (tbHint) {
    const kind = THEME_KINDS.find((k) => k.id === tbFilter);
    const text = (kind && kind.hint) || TB_HINTS[tbFilter] || '';
    // Replayed rather than assigned, so switching category reads as the line
    // changing rather than as text quietly being different.
    if (tbHint.textContent !== text) {
      tbHint.textContent = text;
      replayAnim(tbHint, 'tb-hint-in');
    }
  }

  let entries = Object.entries(THEMES).filter(([key, t]) => themeMatches(key, t, q));
  if (tbFilter === 'fav') entries = entries.filter(([key]) => favThemes().includes(key));
  else if (tbFilter === 'rec') entries = entries.filter(([, t]) => t.recommended);
  else if (tbFilter !== 'all') entries = entries.filter(([, t]) => t.type === tbFilter);

  // Starred first, then recently used, then the declaration order — which is
  // the order the categories are written in themes.js.
  const favs = favThemes();
  // Read out here as well as inside the ordering block: the cards themselves
  // need it to know which of them to mark NEW.
  const fresh = unseenThemes();
  // The order is worked out once, when the pane opens, and then held for the
  // whole visit. Re-ranking on every render meant that picking a theme made it
  // "recent", which moved it — so the card you had just clicked jumped out
  // from under the cursor, and so did everything after it.
  if (!tbOrder) {
    // Which section each theme sits in is frozen for the visit, exactly as the
    // order is and for the same reason: starring a card would otherwise lift
    // it straight into the Starred section, and the card you just clicked
    // would leave from under the cursor. The star fills immediately; where the
    // card lives is settled next time the pane opens.
    tbStarred = new Set(favThemes());
    const recents = recentThemes();
    // Anything new since the last version this user opened goes to the very
    // front, ahead of favourites, until they have looked at the pane once.
    const rank = (key) =>
      (fresh.includes(key) ? -1 : (favs.includes(key) ? 0 : (recents.includes(key) ? 1 : 2)));
    const all = Object.keys(THEMES);
    tbOrder = all.slice().sort((a, b) => rank(a) - rank(b) || all.indexOf(a) - all.indexOf(b));
  }
  const pos = (key) => {
    const i = tbOrder.indexOf(key);
    return i === -1 ? tbOrder.length : i;      // a theme added mid-visit sorts last
  };
  entries.sort((a, b) => pos(a[0]) - pos(b[0]));

  tbGrid.innerHTML = '';
  stopMiniSketches();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'tb-empty';
    empty.textContent = tr('tb.none', 'No theme by that name');
    tbGrid.appendChild(empty);
    return;
  }

  // A section rule that spans the whole grid. Two of these turn a wall of
  // seventy cards into "here are eleven to try" followed by everything else,
  // which is the difference between a catalogue and a shop.
  const section = (title, note) => {
    const h = document.createElement('div');
    h.className = 'tb-sec';
    const a = document.createElement('span');
    a.className = 'tb-sec-title';
    a.textContent = title;
    h.appendChild(a);
    if (note) {
      const b = document.createElement('span');
      b.className = 'tb-sec-note';
      b.textContent = note;
      h.appendChild(b);
    }
    return h;
  };

  const makeCard = ([key, t], i) => {
    const card = document.createElement('div');
    card.className = 'tb-card' + (settings.theme === key ? ' active' : '');
    card.dataset.theme = key;
    // Staggered entrance, capped: past a dozen the delay stops reading as a
    // sequence and starts reading as the grid being slow.
    card.style.setProperty('--tb-i', String(Math.min(i, 11)));
    card.appendChild(buildThemeMini(t, key));

    const foot = document.createElement('div');
    foot.className = 'tb-card-foot';
    const name = document.createElement('span');
    name.className = 'tb-card-name';
    name.textContent = t.label;
    name.title = KIND_LABEL[t.type] || t.type;
    if (!seenThemeSet().includes(key) && seenThemeSet().length) {
      const tag = document.createElement('span');
      tag.className = 'tb-card-new';
      tag.textContent = tr('tb.new', 'NEW');
      foot.appendChild(tag);
    }
    const star = document.createElement('button');
    star.type = 'button';
    const on = favs.includes(key);
    star.className = 'tb-card-star' + (on ? ' on' : '');
    star.title = on ? tr('tb.unstar', 'Remove from favourites') : tr('tb.star', 'Add to favourites');
    star.innerHTML = starIcon(on);
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      settings.favThemes = on ? favs.filter((k) => k !== key) : favs.concat(key);
      saveSettingsNow();
      renderThemeBrowser();
    });
    foot.appendChild(name);
    foot.appendChild(star);
    card.appendChild(foot);

    card.addEventListener('click', () => chooseTheme(key));
    return card;
  };

  // Sections, only on the unfiltered and unsearched board. Once you have typed
  // a query or picked a category you have already said what you want, and
  // splitting the answer in two at that point is just in the way.
  //
  // Starred first, then recommended, then the rest — your own picks outrank a
  // list somebody else drew up, and a "recommended" shelf that pushes the user
  // past their own favourites every time is the kind of helpfulness nobody
  // asked for.
  const sectioned = tbFilter === 'all' && !q;
  const starred = sectioned ? entries.filter(([k]) => tbStarred.has(k)) : [];
  const rec = sectioned
    ? entries.filter(([k, t]) => t.recommended && !tbStarred.has(k))
    : [];
  if (starred.length || rec.length) {
    const rest = entries.filter(([k, t]) => !tbStarred.has(k) && !t.recommended);
    let i = 0;
    const put = (list) => list.forEach((e) => tbGrid.appendChild(makeCard(e, i++)));
    if (starred.length) {
      tbGrid.appendChild(section(tr('tb.starred', 'Starred'), tr('tb.yours', 'yours')));
      put(starred);
    }
    if (rec.length) {
      tbGrid.appendChild(section(tr('tb.rec', 'Recommended'), tr('tb.recNote', 'worth trying first')));
      put(rec);
    }
    if (rest.length) {
      tbGrid.appendChild(section(tr('tb.rest', 'Everything else'),
        rest.length + ' ' + tr('tb.themes', 'themes')));
      put(rest);
    }
  } else {
    entries.forEach((e, i) => tbGrid.appendChild(makeCard(e, i)));
  }
  startMiniSketches();
  markPeekingCard();
}

// Entering the pane clears the "new themes" mark and starts fresh; leaving it
// (a different tab, or closing Settings) has to end any peek in flight, or the
// window is left wearing a theme nobody chose.
function openThemeBrowser() {
  tbSearch.value = '';
  tbFilter = 'all';
  tbOrder = null;          // a fresh visit re-ranks; everything inside one does not
  renderThemeBrowser();
  // Two columns is not a board. Main grows the window only if it is smaller
  // than this and hands the old size back when the pane closes.
  // Swallowed: growing the window is a nicety, and an install where the
  // channel is missing should not raise an unhandled rejection over it.
  if (window.api.growWindow) window.api.growWindow(760, 640).catch(() => {});
}

// Marking on the way out, not on the way in: clearing them as the pane opened
// meant the NEW marks were gone in the same frame that drew them, which is the
// same as not having them.
function closeThemeBrowser() {
  stopMiniSketches();
  if (window.api.restoreWindow) window.api.restoreWindow().catch(() => {});
}

if (tbSearch) {
  tbSearch.addEventListener('input', renderThemeBrowser);
  tbSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); tbSearch.value = ''; renderThemeBrowser(); }
  });
}

// ---------- "New" marks ----------
// A theme the user has never had in front of them gets a dot, and the Theme
// tab carries one while any remain. Themes are added a few at a time in a
// release nobody reads the notes for; without this they simply go unnoticed
// at the bottom of a list of forty.
function seenThemeSet() {
  if (!Array.isArray(settings.seenThemes)) settings.seenThemes = [];
  return settings.seenThemes;
}
function unseenThemes() {
  const seen = seenThemeSet();
  // A fresh install has seen nothing, which would mark all 47. The first run
  // banks the whole list instead, so the mark only ever means "this one is new
  // to a version you already had".
  if (!seen.length) return [];
  return Object.keys(THEMES).filter((k) => !seen.includes(k));
}
// One theme, marked as seen. Clearing the whole list when the pane closed
// meant that opening it with two new themes in it and trying one banked both —
// the other lost its mark without ever having been looked at.
function markThemeSeen(key) {
  if (!key) return;
  const seen = seenThemeSet();
  if (seen.includes(key)) return;
  settings.seenThemes = seen.concat(key);
  saveSettingsNow();
  applyThemeTabBadge();
}

// The first run banks the whole catalogue: on a fresh install nothing is
// "new", and marking all fifty would be noise rather than news.
function seedThemesSeen() {
  if (seenThemeSet().length) return;
  settings.seenThemes = Object.keys(THEMES);
  saveSettingsNow();
  applyThemeTabBadge();
}
function applyThemeTabBadge() {
  const tab = document.querySelector('.set-tab[data-pane="theme"]');
  if (tab) tab.classList.toggle('has-new-badge', unseenThemes().length > 0);
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
  voiceHfApiKeyInputEl.value = (settings.voice && settings.voice.hfApiKey) || '';
  syncAiProviderUI();
  togglePlaceholdersEl.checked = settings.placeholdersEnabled;
  const vol = settings.fxVolume ?? 60;
  fxVolumeRange.value = vol;
  fxVolumeValue.textContent = vol + '%';
  // Only shown for the themes that actually make a sound — a permanent volume
  // slider on a notepad reads as a promise the other 30 themes don't keep.
  // Shown for the Sound category and for anything else that makes a noise —
  // Clockwork is a Machines theme with a ratchet on it.
  const th = THEMES[settings.theme] || {};
  fxVolumeRow.classList.toggle('hidden', th.type !== 'sound' && !th.sound);
  toggleAnimationsEl.checked = animationsOn();
  toggleBlocksEl.checked = settings.blocksEnabled !== false;
  toggleSlashEl.checked = settings.slashEnabled !== false;
  renderBlocksList();
  renderPhPresetList();
  syncLockUI();
  syncUpdaterStatus();
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

// ---------- Settings tabs ----------
// The panel is long, so it's split into panes (General / Appearance / …).
// Whichever pane you were last on is where Settings reopens.
const settingsTabsEl = document.getElementById('settingsTabs');
let settingsPane = 'general';

function setSettingsPane(id) {
  const panes = document.querySelectorAll('.settings-pane');
  if (!panes.length) return;
  if (![...panes].some((p) => p.dataset.pane === id)) id = 'general';
  const leaving = settingsPane;
  settingsPane = id;
  panes.forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== id));
  // Leaving the pane banks the "new theme" marks and hands the window size
  // back; entering it does the reverse.
  if (leaving === 'theme' && id !== 'theme') closeThemeBrowser();
  if (id === 'theme') openThemeBrowser();
  document.querySelectorAll('.set-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.pane === id);
  });
  const body = document.querySelector('.settings-body');
  if (body) body.scrollTop = 0;
}

if (settingsTabsEl) settingsTabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.set-tab');
  if (btn) setSettingsPane(btn.dataset.pane);
});

// Switches to whichever pane holds `el` and scrolls it into view. Used by the
// shortcuts into Settings (missing API key, "manage actions", the theme tour).
function revealSetting(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return null;
  const pane = el.closest('.settings-pane');
  if (pane) setSettingsPane(pane.dataset.pane);
  el.scrollIntoView({ block: 'center' });
  return el;
}

function openSettings(target) {
  syncSettingsUI();
  refreshStoragePathDisplay();
  setSettingsPane(settingsPane);
  settingsOverlay.classList.remove('hidden', 'closing');
  if (target) {
    const el = revealSetting(target);
    if (el && typeof el.focus === 'function') el.focus();
  }
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
  closeThemeBrowser();
  hideWithAnim(settingsOverlay, 'closing');
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

voiceHfApiKeyInputEl.addEventListener('change', () => {
  settings.voice = { ...settings.voice, hfApiKey: voiceHfApiKeyInputEl.value.trim() };
  saveSettingsNow();
});

// ---------- AI provider settings ----------
// Reflect settings.ai into the provider picker, the model list, and whichever
// per-provider key group is active.
function syncAiProviderUI() {
  const ai = settings.ai || {};
  const id = aiProvider();
  aiProviderSelectEl.value = id;
  AI_PROVIDER_IDS.forEach((p) => {
    const el = document.getElementById(AI_PROVIDER_FIELD_IDS[p]);
    if (el) el.classList.toggle('hidden', p !== id);
  });

  aiApiKeyInputEl.value = ai.openrouterKey || '';
  aiOpenaiKeyInputEl.value = ai.openaiKey || '';
  aiGoogleKeyInputEl.value = ai.googleKey || '';
  aiAnthropicKeyInputEl.value = ai.anthropicKey || '';
  aiCustomUrlInputEl.value = ai.customUrl || '';
  aiCustomKeyInputEl.value = ai.customKey || '';
  aiCustomModelsInputEl.value = ai.customModels || '';

  // Rebuild the model list for this provider, keeping the saved choice when it
  // still exists and falling back to Auto when it doesn't.
  const entries = aiModelEntriesFor(id);
  const wanted = ai.model || 'auto';
  aiModelSelectEl.innerHTML = '';
  const autoOpt = document.createElement('option');
  autoOpt.value = 'auto';
  autoOpt.textContent = tr('ai.auto', 'Auto — recommended');
  aiModelSelectEl.appendChild(autoOpt);

  const addOption = (parent, m) => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.id;
    parent.appendChild(o);
  };
  const free = entries.filter((m) => m.free);
  const paid = entries.filter((m) => !m.free);
  if (free.length && paid.length) {
    // OpenRouter mostly — hundreds of models, and which ones cost nothing is
    // the only distinction that matters at a glance.
    const gf = document.createElement('optgroup');
    gf.label = tr('ai.freeModels', 'Free');
    free.forEach((m) => addOption(gf, m));
    aiModelSelectEl.appendChild(gf);
    const gp = document.createElement('optgroup');
    gp.label = tr('ai.paidModels', 'Paid');
    paid.forEach((m) => addOption(gp, m));
    aiModelSelectEl.appendChild(gp);
  } else {
    entries.forEach((m) => addOption(aiModelSelectEl, m));
  }

  const ids = entries.map((m) => m.id);
  aiModelSelectEl.value = ids.includes(wanted) ? wanted : 'auto';
  if (aiModelSelectEl.value !== wanted) settings.ai = { ...settings.ai, model: aiModelSelectEl.value };

  // Say where this list came from, so "Auto" against a stale built-in list is
  // distinguishable from a list the provider actually confirmed.
  const cached = aiModelCache()[id];
  if (!aiModelBusy) {
    if (cached && cached.ts) {
      aiModelStatusEl.textContent =
        tr('ai.listLive', 'Loaded from your provider') + ' · ' + ids.length;
      aiModelStatusEl.classList.remove('model-status-warn');
    } else {
      aiModelStatusEl.textContent = tr('ai.listBuiltin', 'Built-in list — press ↻ to load the real one');
      aiModelStatusEl.classList.remove('model-status-warn');
    }
  }

  renderCustomActionsList();
}

// ---------- Live model list ----------
let aiModelBusy = false;

// Ask the provider which models this key can actually use. `silent` is for the
// automatic refresh after a key is pasted — that one shouldn't shout on failure,
// because the key may simply be half-typed.
async function refreshAiModels(silent) {
  if (aiModelBusy) return;
  const id = aiProvider();
  aiModelBusy = true;
  aiModelRefreshBtn.classList.add('spinning');
  aiModelStatusEl.classList.remove('model-status-warn');
  aiModelStatusEl.textContent = tr('ai.listLoading', 'Asking the provider…');
  try {
    const res = await window.api.aiListModels(aiOpts());
    aiModelBusy = false;
    // The user may have switched provider while this was in flight; a list
    // fetched for the old one must not be filed under the new one.
    if (aiProvider() !== id) { syncAiProviderUI(); return; }

    if (res && res.ok && Array.isArray(res.models) && res.models.length) {
      const prev = settings.ai.model;
      aiModelCache()[id] = { ts: Date.now(), models: res.models.slice(0, 400) };
      const stillThere = res.models.some((m) => m.id === prev);
      settings.ai = { ...settings.ai, model: (prev && prev !== 'auto' && !stillThere) ? 'auto' : prev };
      saveSettingsNow();
      syncAiProviderUI();
      if (prev && prev !== 'auto' && !stillThere) {
        aiModelStatusEl.textContent =
          tr('ai.listDropped', 'Your saved model is gone from this provider — switched to Auto') +
          ' · ' + res.models.length;
        aiModelStatusEl.classList.add('model-status-warn');
      }
      return;
    }
    if (silent) { syncAiProviderUI(); return; }
    aiModelStatusEl.textContent = (res && res.error) || tr('ai.listFailed', "Couldn't load the model list.");
    aiModelStatusEl.classList.add('model-status-warn');
  } catch (err) {
    aiModelBusy = false;
    if (!silent) {
      aiModelStatusEl.textContent = tr('ai.listFailed', "Couldn't load the model list.");
      aiModelStatusEl.classList.add('model-status-warn');
    }
  } finally {
    aiModelBusy = false;
    aiModelRefreshBtn.classList.remove('spinning');
  }
}

function setAiSetting(patch) {
  settings.ai = { ...settings.ai, ...patch };
  saveSettingsNow();
  if (aiChatActive()) renderAiMessages(); // reflect new credentials in the onboarding/empty state
}

aiProviderSelectEl.addEventListener('change', () => {
  // Reset the model on a provider switch — the old id belongs to another
  // catalog and would otherwise be sent to a backend that's never heard of it.
  settings.ai = { ...settings.ai, provider: aiProviderSelectEl.value, model: 'auto' };
  saveSettingsNow();
  syncAiProviderUI();
  if (aiChatActive()) renderAiMessages();
  // No list for this provider yet? Fetch quietly if we already have its key.
  if (!aiModelCache()[aiProvider()] && aiReady()) refreshAiModels(true);
});
aiModelSelectEl.addEventListener('change', () => setAiSetting({ model: aiModelSelectEl.value }));
aiModelRefreshBtn.addEventListener('click', () => refreshAiModels(false));

// Pasting a key is the moment we can finally ask that provider anything, so
// that's when the real model list gets pulled.
function onAiKeyEntered(patch) {
  setAiSetting(patch);
  if (aiReady()) refreshAiModels(true);
}
aiApiKeyInputEl.addEventListener('change', () => onAiKeyEntered({ openrouterKey: aiApiKeyInputEl.value.trim() }));
aiOpenaiKeyInputEl.addEventListener('change', () => onAiKeyEntered({ openaiKey: aiOpenaiKeyInputEl.value.trim() }));
aiGoogleKeyInputEl.addEventListener('change', () => onAiKeyEntered({ googleKey: aiGoogleKeyInputEl.value.trim() }));
aiAnthropicKeyInputEl.addEventListener('change', () => onAiKeyEntered({ anthropicKey: aiAnthropicKeyInputEl.value.trim() }));
aiCustomUrlInputEl.addEventListener('change', () => onAiKeyEntered({ customUrl: aiCustomUrlInputEl.value.trim() }));
aiCustomKeyInputEl.addEventListener('change', () => onAiKeyEntered({ customKey: aiCustomKeyInputEl.value.trim() }));
aiCustomModelsInputEl.addEventListener('change', () => {
  setAiSetting({ customModels: aiCustomModelsInputEl.value.trim() });
  syncAiProviderUI(); // the model dropdown is built from this field
});

// ---------- Custom AI actions (Settings list) ----------
function renderCustomActionsList() {
  if (!customActionsListEl) return;
  const list = customAiActions();
  customActionsListEl.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'set-hint custom-action-empty';
    empty.textContent = tr('ai.noCustom', 'No custom actions yet.');
    customActionsListEl.appendChild(empty);
    return;
  }
  list.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'custom-action-row';
    row.innerHTML =
      '<div class="custom-action-text">' +
        '<span class="custom-action-name"></span>' +
        '<small class="custom-action-prompt"></small>' +
      '</div>' +
      '<div class="custom-action-btns">' +
        '<button type="button" class="custom-action-btn js-edit" title="Edit">✎</button>' +
        '<button type="button" class="custom-action-btn js-del" title="Delete">🗑</button>' +
      '</div>';
    // textContent, not innerHTML — these strings are user input.
    row.querySelector('.custom-action-name').textContent = a.name;
    row.querySelector('.custom-action-prompt').textContent = a.prompt;
    row.querySelector('.js-edit').addEventListener('click', () => editCustomAction(a.id));
    row.querySelector('.js-del').addEventListener('click', () => {
      settings.customAiActions = customAiActions().filter((x) => x.id !== a.id);
      saveSettingsNow();
      renderCustomActionsList();
    });
    customActionsListEl.appendChild(row);
  });
}

// Editing reuses the run dialog: the name/prompt are pre-filled and Run saves
// the edit instead of firing a transform.
let editingCustomActionId = null;

function editCustomAction(id) {
  const a = customAiActions().find((x) => x.id === id);
  if (!a) return;
  aiCustomMode = 'edit';
  editingCustomActionId = id;
  aiCustomRange = null;
  aiCustomInput.value = a.prompt;
  aiCustomName.value = a.name;
  aiCustomSaveChk.checked = true;
  aiCustomNameRow.classList.remove('hidden');
  aiCustomScope.textContent = tr('ai.editing', 'Editing a saved action');
  aiCustomRun.textContent = tr('save', 'Save');
  aiCustomDialog.classList.remove('hidden');
  aiCustomInput.focus();
}

if (customActionAddBtn) {
  customActionAddBtn.addEventListener('click', () => {
    aiCustomMode = 'add';
    editingCustomActionId = null;
    aiCustomRange = null;
    aiCustomInput.value = '';
    aiCustomName.value = '';
    aiCustomSaveChk.checked = true;
    aiCustomNameRow.classList.remove('hidden');
    aiCustomScope.textContent = tr('ai.newAction', 'Saved to the AI actions menu');
    aiCustomRun.textContent = tr('save', 'Save');
    aiCustomDialog.classList.remove('hidden');
    aiCustomInput.focus();
  });
}

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

fxVolumeRange.addEventListener('input', () => {
  settings.fxVolume = Number(fxVolumeRange.value);
  fxVolumeValue.textContent = settings.fxVolume + '%';
  if (window.PP_FX && window.PP_FX.setVolume) window.PP_FX.setVolume(settings.fxVolume / 100);
});
fxVolumeRange.addEventListener('change', saveSettingsNow);

toggleThemeFontEl.addEventListener('change', () => {
  settings.themeFont = toggleThemeFontEl.checked;
  applyFont(settings.font);
  buildFontPicker();
  saveSettingsNow();
});

toggleAnimationsEl.addEventListener('change', () => {
  settings.animations = toggleAnimationsEl.checked;
  document.documentElement.classList.toggle('no-anim', !settings.animations);
  saveSettingsNow();
});

toggleBlocksEl.addEventListener('change', () => {
  settings.blocksEnabled = toggleBlocksEl.checked;
  if (!settings.blocksEnabled) closeInlinePop();
  saveSettingsNow();
});

toggleSlashEl.addEventListener('change', () => {
  settings.slashEnabled = toggleSlashEl.checked;
  if (!settings.slashEnabled) closeInlinePop();
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
  // fresh copies, never the shared DEFAULT_SETTINGS references
  settings.ai = { ...DEFAULT_SETTINGS.ai };
  settings.customAiActions = [];
  settings.recentAiPrompts = [];
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
  editorBodyEl.classList.add('ph-resizing');
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
  editorBodyEl.classList.remove('ph-resizing');
  document.body.style.cursor = '';
  saveSettingsNow();
});

// ---------- Find & Replace ----------
let findMatches = [];
let findIdx = 0;

const _findHL = CSS.highlights ? (() => { const h = new Highlight(); CSS.highlights.set('find-match', h); return h; })() : null;
const _curHL = CSS.highlights ? (() => { const h = new Highlight(); CSS.highlights.set('find-current', h); return h; })() : null;

function openFind(withReplace = false) {
  findBarEl.classList.remove('hidden', 'closing');
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
  hideWithAnim(findBarEl, 'closing');
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

// Flat char-by-char index of the editor: map[k] is the { textNode, offset }
// rendering character k of `text` (null for the newline between two lines).
// The text is accumulated here, one text node at a time, instead of being
// rebuilt from the map afterwards — that second pass allocated a
// one-character string per character in the note on every keystroke in the
// find box.
function buildPosMap() {
  const map = [];
  let text = '';
  const scan = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const nodeText = n.textContent;
      text += nodeText;
      for (let i = 0; i < nodeText.length; i++) map.push({ n, i });
    }
  };
  const lines = [...editorEl.children].filter((c) => c.tagName === 'DIV');
  if (!lines.length) {
    scan(editorEl);
    return { map, text };
  }
  for (let d = 0; d < lines.length; d++) {
    if (d > 0) { map.push(null); text += '\n'; } // newline between divs
    scan(lines[d]);
  }
  return { map, text };
}

// posMap is indexed by exactly the character offsets the search runs on, so
// both ends are a direct lookup. This used to walk the whole map once per
// match: typing one common letter into the find box on a long note cost
// (matches x characters) iterations — hundreds of millions of steps, and a
// multi-second freeze on every keystroke.
function makeRange(posMap, pos, len) {
  const startE = posMap[pos];
  const endE = posMap[pos + len - 1];
  if (!startE || !endE) return null; // a match starting or ending on a newline
  const r = new Range();
  r.setStart(startE.n, startE.i);
  r.setEnd(endE.n, endE.i + 1);
  return r;
}

function runFind() {
  clearFindHL();
  findMatches = [];
  const q = findInputEl.value;
  findInputEl.classList.remove('no-match');
  renderFindResults(q);
  if (!q) { findCountEl.textContent = ''; return; }

  const { map: posMap, text: fullText } = buildPosMap();
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
    // Handing CSS.highlights tens of thousands of ranges costs more in repaint
    // than the marks are worth (searching "e" in a long note). Paint a generous
    // prefix plus the current match; the counter and Enter / Shift+Enter
    // navigation still see every match.
    const HL_LIMIT = 3000;
    const painted = Math.min(findMatches.length, HL_LIMIT);
    for (let i = 0; i < painted; i++) {
      if (i === findIdx) continue;
      const r = makeRange(posMap, findMatches[i], q.length);
      if (r) _findHL.add(r);
    }
    const cur = makeRange(posMap, findMatches[findIdx], q.length);
    if (cur) _curHL.add(cur);
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
  // Re-rendering replaces the whole subtree, which resets the scroll to the
  // top. Put the reader back where they were — otherwise every AI action or
  // block edit throws them to the first line of a long note.
  const keepScroll = mdPreviewEl.scrollTop;
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
  applyBlockDirs(mdPreviewEl, forced, t ? t.content : '');
  if (keepScroll) mdPreviewEl.scrollTop = keepScroll;
}

// Per-block direction for rendered markdown. Same carry rule as the editor: a
// block with no letters of its own (a lone number, a divider, a code caption)
// takes the direction of the block above it rather than defaulting to ltr.
const MD_DIR_SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, ul, ol, dl, dt, dd, table, th, td';
function applyBlockDirs(root, forced, content) {
  if (forced) {
    root.querySelectorAll(MD_DIR_SEL).forEach((el) => el.setAttribute('dir', forced));
    return;
  }
  let carry = lineDirFor(content || '', uiDefaultDir());
  root.querySelectorAll(MD_DIR_SEL).forEach((el) => {
    carry = lineDirFor(el.textContent, carry);
    el.setAttribute('dir', carry);
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
  // Focus follows the pane you're now looking at. Without this the preview is
  // never the focused element, so PageDown / arrows / space scroll nothing —
  // the "can't scroll the preview from the keyboard" bug.
  if (on) mdPreviewEl.focus();
  else editorEl.focus();
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
  // Hand the preview the focus the editor would have had, so the keyboard can
  // scroll it. Only when nothing else is claiming focus — never yank it out of
  // the find box or a dialog.
  const act = document.activeElement;
  if (on && (!act || act === document.body || act === editorEl)) mdPreviewEl.focus();
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
  // these already have their own click behaviour — a table's cells are
  // directly editable now, so double-clicking one to select a word must not
  // swap the whole table for the raw-markdown textarea underneath it.
  if (target.closest('.md-code-copy, .md-code-improve, .md-img, .md-link, .md-todo-box, ' +
    '.md-table-delcol, .md-table-addcol, .md-table-delrow, .md-table-addrow, table')) return;
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
  if (!q) return;
  const repl = replaceInputEl.value;
  const pos = findMatches[findIdx];
  const prev = t.content;
  // findMatches are offsets into the EDITOR's text. That is normally the same
  // string as t.content, but not while the markdown preview owns the note
  // (syncEditorToState deliberately skips a tab in md mode, so edits made in
  // the preview never reach the hidden editor). Splicing a stale offset into
  // t.content would cut the note in the wrong place, so re-check first and
  // just refresh the search when it no longer lines up.
  if (prev.substr(pos, q.length).toLowerCase() !== q.toLowerCase()) { runFind(); return; }
  const newContent = prev.slice(0, pos) + repl + prev.slice(pos + q.length);
  t.content = newContent;
  // Without this the replacement is invisible to Ctrl+Z: setEditorText fires no
  // input event, so nothing else on this path ever pushes an undo step.
  noteEditForUndo(t, prev);
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
  const q = findInputEl.value;
  if (!q) return;
  const repl = replaceInputEl.value;
  const prev = t.content;
  const lower = t.content.toLowerCase();
  const qLower = q.toLowerCase();
  let result = '', last = 0, p = 0;
  while ((p = lower.indexOf(qLower, last)) !== -1) {
    result += t.content.slice(last, p) + repl;
    last = p + q.length;
  }
  result += t.content.slice(last);
  if (result === prev) return;
  takeSnapshot(t, true); // only once we know something actually changes
  t.content = result;
  noteEditForUndo(t, prev); // same reason as doReplaceOne — make it undoable
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
  'The biggest release yet. Two things you can write with, one you can lock,\n' +
  'and a theme collection that got out of hand.\n' +
  '\n' +
  '── WRITING ──────────────────────────────\n' +
  '\n' +
  '• Blocks — type @ and pick a piece of prompt you keep reusing. Personas,\n' +
  '   output formats, rules, step lists. Save any selection as a block from\n' +
  '   the right-click menu.\n' +
  '• Slash commands — type / for markdown and AI actions without leaving\n' +
  '   the keyboard.\n' +
  '• Placeholders grew up — give one a list and it becomes a dropdown, save\n' +
  '   a whole set of answers as a preset and refill a prompt in one click.\n' +
  '\n' +
  '── LOCKED NOTES ─────────────────────────\n' +
  '\n' +
  '• Lock a tab with a PIN and it is encrypted on disk — not hidden,\n' +
  '   encrypted. A locked note cannot be deleted until you unlock it, and\n' +
  '   removing the lock asks for the PIN again.\n' +
  '• You get a recovery code when you set the PIN. Keep it. There is also a\n' +
  '   reset in Settings that unlocks everything so you can start over.\n' +
  '\n' +
  '── THEMES ───────────────────────────────\n' +
  '\n' +
  '• 76 of them, and a proper browser to find one in. Every card is the app\n' +
  '   in miniature with the theme actually running on it — Koi shows fish,\n' +
  '   Last Train shows a train.\n' +
  '• Sorted by what drives them: Reactive, Nature, Machines, Nostalgia,\n' +
  '   Live, Sound, Playable, Luxury. Each category says what it means.\n' +
  '• Starred and Recommended sections, and search across names and keywords.\n' +
  '• Nostalgia is a new family: places drawn the way 1997 hardware drew them.\n' +
  '   Barrel Fire, Last Train, Snow Street, Ferris Wheel, Bedroom, Harbour,\n' +
  '   Alley — a snowy back street where a torch follows your caret.\n' +
  '• Drag the window and Tide sloshes; the water leans and rocks back.\n' +
  '\n' +
  '── EVERYTHING ELSE ──────────────────────\n' +
  '\n' +
  '• A full guide with pictures, in English and Persian, in Settings.\n' +
  '• Motion everywhere — panels, tabs, cards. Focus mode now folds the\n' +
  '   chrome away instead of blinking it out. Turn it all off in Settings.\n' +
  '• The keyboard themes use real recordings now, not synthesis.\n' +
  '• New fonts, and a switch for whether a theme may bring its own.\n' +
  '• A fresh install starts on Mono.\n' +
  '• Fixed: the updater opening GitHub instead of updating, the AI actions\n' +
  '   menu staying open behind a new right-click, and a long tail of others.\n' +
  '• Image generation has been removed. All three back ends turned out\n' +
  '   unreliable and one of them had been dead for months.\n' +
  '\n' +
  'You can close this tab — it won\'t come back until the next update.\n' +
  '\n' +
  '\n' +
  'تازه‌ها در نسخه ' + CURRENT_VERSION + ' ✨\n' +
  '\n' +
  'بزرگ‌ترین نسخه تا امروز. دو چیز که باهاشون می‌نویسی، یکی که قفلش می‌کنی،\n' +
  'و مجموعه‌ای از تم‌ها که از دست در رفت.\n' +
  '\n' +
  '── نوشتن ────────────────────────────────\n' +
  '\n' +
  '• بلاک‌ها — @ را بزن و تکه‌ای از پرامپت که مدام تکرارش می‌کنی را انتخاب کن.\n' +
  '   شخصیت، قالب خروجی، قواعد، فهرست مرحله‌ها. هر متن انتخاب‌شده را هم از\n' +
  '   منوی راست‌کلیک می‌توانی به‌عنوان بلاک ذخیره کنی.\n' +
  '• دستورهای اسلش — / را بزن تا مارک‌داون و کارهای هوش مصنوعی را بدون\n' +
  '   برداشتن دست از کیبورد اجرا کنی.\n' +
  '• جای‌گیرها بزرگ شدند — به یکی‌شان فهرست بده تا کشویی شود، و یک دسته\n' +
  '   جواب را به‌عنوان پیش‌تنظیم ذخیره کن تا پرامپت را با یک کلیک پر کنی.\n' +
  '\n' +
  '── یادداشت‌های قفل‌شده ───────────────────\n' +
  '\n' +
  '• یک تب را با پین قفل کن و روی دیسک رمزگذاری می‌شود — نه پنهان، رمزگذاری‌شده.\n' +
  '   یادداشتِ قفل تا بازش نکنی پاک نمی‌شود، و برداشتن قفل دوباره پین می‌خواهد.\n' +
  '• موقع ساختن پین یک کد بازیابی می‌گیری. نگهش دار. در تنظیمات هم یک ریست\n' +
  '   هست که همه‌چیز را باز می‌کند تا از اول شروع کنی.\n' +
  '\n' +
  '── تم‌ها ─────────────────────────────────\n' +
  '\n' +
  '• ۷۶ تا، و یک مرورگر درست‌وحسابی برای پیدا کردنشان. هر کارت خودِ برنامه\n' +
  '   است در مقیاس کوچک، با تمی که واقعاً رویش اجرا می‌شود — Koi ماهی نشان\n' +
  '   می‌دهد، Last Train قطار.\n' +
  '• دسته‌بندی بر اساس چیزی که تم را می‌گرداند: واکنشی، طبیعت، ماشین‌ها،\n' +
  '   نوستالژی، زنده، صدا، بازی‌شدنی، لوکس. هر دسته می‌گوید یعنی چه.\n' +
  '• بخش ستاره‌دارها و پیشنهادی‌ها، و جست‌وجو در نام و کلیدواژه‌ها.\n' +
  '• نوستالژی یک خانواده‌ی تازه است: مکان‌هایی که همان‌طور کشیده شده‌اند که\n' +
  '   سخت‌افزار ۱۹۹۷ می‌کشید. بشکه‌ی آتش، آخرین قطار، خیابان برفی، چرخ و فلک،\n' +
  '   اتاق‌خواب، بندر، و کوچه — کوچه‌ای برفی که چراغ‌قوه دنبال مکان‌نمای تو می‌گردد.\n' +
  '• پنجره را بکش، آب در تم Tide تکان می‌خورد؛ کج می‌شود و برمی‌گردد.\n' +
  '\n' +
  '── باقی چیزها ────────────────────────────\n' +
  '\n' +
  '• یک راهنمای کامل با تصویر، فارسی و انگلیسی، داخل تنظیمات.\n' +
  '• حرکت در همه‌جا — پنل‌ها، تب‌ها، کارت‌ها. حالت تمرکز حالا به‌جای پریدن،\n' +
  '   جمع می‌شود. همه‌اش را می‌توانی از تنظیمات خاموش کنی.\n' +
  '• تم‌های کیبورد حالا از ضبطِ واقعی استفاده می‌کنند، نه سنتز.\n' +
  '• فونت‌های تازه، و یک کلید برای اینکه تم اجازه داشته باشد فونت خودش را\n' +
  '   بیاورد یا نه.\n' +
  '• نصب تازه با تمِ Mono شروع می‌شود.\n' +
  '• رفع اشکال: آپدیتری که به‌جای آپدیت کردن گیت‌هاب را باز می‌کرد، منوی\n' +
  '   کارهای هوش مصنوعی که پشت راست‌کلیکِ بعدی باز می‌ماند، و یک دنباله‌ی بلند\n' +
  '   از بقیه.\n' +
  '• ساخت تصویر حذف شد. هر سه سرویسش غیرقابل‌اتکا از آب درآمدند و یکی‌شان\n' +
  '   ماه‌ها بود که اصلاً کار نمی‌کرد.\n' +
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
  // Held rather than bound to onclick: the button already has a click listener
  // that re-checks, and assigning onclick on top of it made a single click do
  // both — re-check *and* open the browser.
  pendingReleaseUrl = url;
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
let updaterActive = false;      // an update was reported by electron-updater
let pendingReleaseUrl = null;   // set when we fell back to the notify flow

// What the in-app updater can actually do on this machine, shown in About.
// "It just opens GitHub" has two completely different causes — a build that
// can never self-update, and one that tried and failed — and they look
// identical from the outside.
async function syncUpdaterStatus() {
  const el = document.getElementById('updaterStatusText');
  const err = document.getElementById('updaterErrorText');
  if (!el) return;
  let st = null;
  try { st = window.api.updaterStatus ? await window.api.updaterStatus() : null; } catch {}
  if (!st) { el.textContent = tr('upd.unknown', 'Update status unavailable.'); return; }
  if (st.supported) {
    el.textContent = tr('upd.inApp',
      'Updates install inside PromptPad — it downloads the new version and restarts into it.');
  } else {
    const why = {
      'macos-unsigned': tr('upd.mac',
        'On macOS PromptPad cannot update itself (the builds are not code-signed), so it opens the release page instead.'),
      'dev-build': tr('upd.dev', 'This is a development build, so updates open the release page instead.'),
      'module-missing': tr('upd.missing', 'The updater component is missing from this build, so updates open the release page instead.')
    }[st.reason];
    el.textContent = why || tr('upd.fallback', 'Updates open the release page in your browser.');
  }
  if (st.lastError) {
    err.textContent = tr('upd.lastError', 'Last updater error: ') + st.lastError;
    err.classList.remove('hidden');
  } else {
    err.classList.add('hidden');
  }
}

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
        setTimeout(() => setSettingsPane('theme'), 80);
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
  // Once a release has been found and the in-app updater couldn't fetch it,
  // the button's job is to open that release rather than look again.
  if (pendingReleaseUrl) { window.api.openExternal(pendingReleaseUrl); return; }
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
let dcPendingVerifyEmail = '';    // set after a signUp that needs email confirmation; '' otherwise
let dcResetStage = '';            // '' | 'email' | 'code' | 'newpass' — forgot-password flow
let dcResetEmail = '';            // email the reset code was sent to
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
  // verifyOtp(type:'recovery') hands back a real session before the user has
  // picked a new password — without this, dcSession being truthy would send
  // them straight past the "choose a new password" screen into the app.
  if (dcResetStage === 'newpass') { discoverNavEl.innerHTML = ''; dcRenderReset(); return; }
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
  if (dcPendingVerifyEmail) { dcRenderVerify(); return; }
  if (dcResetStage) { dcRenderReset(); return; }
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

  if (dcAuthMode === 'login') {
    const forgot = dcEl('button', 'dc-form-link', 'Forgot password?');
    forgot.type = 'button';
    forgot.addEventListener('click', () => {
      dcResetEmail = emailInput.value.trim();
      dcResetStage = 'email';
      dcRender();
    });
    const links = dcEl('div', 'dc-form-links');
    links.appendChild(forgot);
    form.appendChild(links);
  }

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
          dcPendingVerifyEmail = email;
          dcRender();
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

// A signUp that comes back without a session means Supabase requires email
// confirmation before login works — this is what actually stops a scripted
// signup flood from ever getting a usable account (it can create rows, but
// never a session to post/invite/approve with). The account confirms itself
// the same way most sites do it: a numeric code by email, entered here,
// which both confirms the account and logs it in via verifyOtp. Supabase's
// token length isn't guaranteed to be 6 digits (this project's is 8), so the
// input must not cap length at 6 — that silently truncated every code typed.
function dcRenderVerify() {
  discoverBodyEl.innerHTML = '';
  const wrap = dcEl('div', 'dc-auth');
  wrap.appendChild(dcEl('div', 'dc-form-note', 'Enter the code sent to ' + dcPendingVerifyEmail));

  const form = dcEl('form', 'dc-form');
  const codeInput = dcEl('input', 'text-input');
  codeInput.type = 'text'; codeInput.inputMode = 'numeric'; codeInput.maxLength = 12;
  codeInput.placeholder = 'Confirmation code'; codeInput.autocomplete = 'off';
  form.appendChild(codeInput);

  const submit = dcEl('button', 'dc-primary-btn', 'Confirm');
  submit.type = 'submit';
  form.appendChild(submit);
  const status = dcEl('div', 'dc-form-status');
  form.appendChild(status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = codeInput.value.trim();
    if (!token) {
      status.className = 'dc-form-status err';
      status.textContent = 'Enter the code from your email.';
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Please wait…';
    try {
      const { data, error } = await dcClient.auth.verifyOtp({
        email: dcPendingVerifyEmail, token, type: 'signup'
      });
      if (error) throw error;
      dcPendingVerifyEmail = '';
      dcSession = data && data.session;
      await dcLoadProfile();
      dcScreen = dcPrefillPrompt ? 'upload' : 'browse';
      dcRender();
      shRefresh();
      dcSyncAdminNotify();
    } catch (err) {
      status.className = 'dc-form-status err';
      status.textContent = (err && err.message) || 'Invalid or expired code.';
      submit.disabled = false;
      submit.textContent = 'Confirm';
    }
  });
  wrap.appendChild(form);

  const links = dcEl('div', 'dc-form-links');
  const resend = dcEl('button', 'dc-form-link', 'Resend code');
  resend.type = 'button';
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try {
      const { error } = await dcClient.auth.resend({ type: 'signup', email: dcPendingVerifyEmail });
      if (error) throw error;
      status.className = 'dc-form-status ok';
      status.textContent = 'Code resent.';
    } catch (err) {
      status.className = 'dc-form-status err';
      status.textContent = (err && err.message) || 'Could not resend the code.';
    } finally {
      resend.disabled = false;
    }
  });
  const back = dcEl('button', 'dc-form-link', 'Use a different email');
  back.type = 'button';
  back.addEventListener('click', () => { dcPendingVerifyEmail = ''; dcAuthMode = 'register'; dcRender(); });
  links.appendChild(resend); links.appendChild(back);
  wrap.appendChild(links);

  discoverBodyEl.appendChild(wrap);
}

function dcResetCancel() {
  dcResetStage = ''; dcResetEmail = ''; dcAuthMode = 'login'; dcRender();
}

// Forgot-password flow: email -> code (verifyOtp type 'recovery', which both
// confirms the code and hands back a real session) -> set a new password on
// that session via updateUser. Mirrors dcRenderVerify's shape/state machine.
function dcRenderReset() {
  discoverBodyEl.innerHTML = '';
  const wrap = dcEl('div', 'dc-auth');
  const form = dcEl('form', 'dc-form');
  const status = dcEl('div', 'dc-form-status');
  const links = dcEl('div', 'dc-form-links');
  const back = dcEl('button', 'dc-form-link', 'Back to sign in');
  back.type = 'button';
  back.addEventListener('click', dcResetCancel);

  if (dcResetStage === 'email') {
    wrap.appendChild(dcEl('div', 'dc-form-note', 'Enter your account email — we’ll send a reset code.'));
    const emailInput = dcEl('input', 'text-input');
    emailInput.type = 'email'; emailInput.placeholder = 'Email'; emailInput.autocomplete = 'off';
    emailInput.value = dcResetEmail;
    form.appendChild(emailInput);
    const submit = dcEl('button', 'dc-primary-btn', 'Send code');
    submit.type = 'submit';
    form.appendChild(submit);
    form.appendChild(status);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) { status.className = 'dc-form-status err'; status.textContent = 'Enter your email.'; return; }
      submit.disabled = true;
      submit.textContent = 'Please wait…';
      try {
        const { error } = await dcClient.auth.resetPasswordForEmail(email);
        if (error) throw error;
        dcResetEmail = email;
        dcResetStage = 'code';
        dcRender();
      } catch (err) {
        status.className = 'dc-form-status err';
        status.textContent = (err && err.message) || 'Could not send the reset code.';
        submit.disabled = false;
        submit.textContent = 'Send code';
      }
    });
    links.appendChild(back);
  } else if (dcResetStage === 'code') {
    wrap.appendChild(dcEl('div', 'dc-form-note', 'Enter the code sent to ' + dcResetEmail));
    const codeInput = dcEl('input', 'text-input');
    codeInput.type = 'text'; codeInput.inputMode = 'numeric'; codeInput.maxLength = 12;
    codeInput.placeholder = 'Reset code'; codeInput.autocomplete = 'off';
    form.appendChild(codeInput);
    const submit = dcEl('button', 'dc-primary-btn', 'Verify');
    submit.type = 'submit';
    form.appendChild(submit);
    form.appendChild(status);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = codeInput.value.trim();
      if (!token) { status.className = 'dc-form-status err'; status.textContent = 'Enter the code from your email.'; return; }
      submit.disabled = true;
      submit.textContent = 'Please wait…';
      try {
        const { data, error } = await dcClient.auth.verifyOtp({
          email: dcResetEmail, token, type: 'recovery'
        });
        if (error) throw error;
        dcSession = data && data.session;
        dcResetStage = 'newpass';
        dcRender();
      } catch (err) {
        status.className = 'dc-form-status err';
        status.textContent = (err && err.message) || 'Invalid or expired code.';
        submit.disabled = false;
        submit.textContent = 'Verify';
      }
    });
    const resend = dcEl('button', 'dc-form-link', 'Resend code');
    resend.type = 'button';
    resend.addEventListener('click', async () => {
      resend.disabled = true;
      try {
        const { error } = await dcClient.auth.resetPasswordForEmail(dcResetEmail);
        if (error) throw error;
        status.className = 'dc-form-status ok';
        status.textContent = 'Code resent.';
      } catch (err) {
        status.className = 'dc-form-status err';
        status.textContent = (err && err.message) || 'Could not resend the code.';
      } finally {
        resend.disabled = false;
      }
    });
    links.appendChild(resend); links.appendChild(back);
  } else if (dcResetStage === 'newpass') {
    wrap.appendChild(dcEl('div', 'dc-form-note', 'Choose a new password.'));
    const passInput = dcEl('input', 'text-input');
    passInput.type = 'password'; passInput.placeholder = 'New password (min 6 chars)'; passInput.autocomplete = 'off';
    form.appendChild(passInput);
    const submit = dcEl('button', 'dc-primary-btn', 'Save password');
    submit.type = 'submit';
    form.appendChild(submit);
    form.appendChild(status);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = passInput.value;
      if (pass.length < 6) { status.className = 'dc-form-status err'; status.textContent = 'Password needs 6+ characters.'; return; }
      submit.disabled = true;
      submit.textContent = 'Please wait…';
      try {
        const { error } = await dcClient.auth.updateUser({ password: pass });
        if (error) throw error;
        dcResetStage = ''; dcResetEmail = '';
        await dcLoadProfile();
        dcScreen = dcPrefillPrompt ? 'upload' : 'browse';
        dcRender();
        shRefresh();
        dcSyncAdminNotify();
      } catch (err) {
        status.className = 'dc-form-status err';
        status.textContent = (err && err.message) || 'Could not update the password.';
        submit.disabled = false;
        submit.textContent = 'Save password';
      }
    });
  }

  wrap.appendChild(form);
  if (dcResetStage !== 'newpass') wrap.appendChild(links);
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
    await appAlert((err && err.message) || 'Could not save to Lab.');
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
  if (!dcProfile) { await appAlert('Sign in to report a post.'); return; }
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Reporting…'; }
  try {
    const { error } = await dcClient.from('reports').insert({ post_id: post.id, reporter_id: dcProfile.id });
    if (error && error.code !== '23505') throw error; // 23505 = already reported → fine
    if (btn) btn.textContent = 'Reported ✓';
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = label || 'Report'; }
    await appAlert((err && err.message) || 'Could not report this post.');
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
    await appAlert((err && err.message) || 'Delete failed.');
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
    } catch (err) { await appAlert((err && err.message) || 'Could not add category.'); }
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
    } catch (err) { await appAlert((err && err.message) || 'Update failed.'); }
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
      } catch (err) { await appAlert((err && err.message) || 'Failed to update user.'); }
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
    } catch (err) { await appAlert((err && err.message) || 'Failed to dismiss.'); }
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
      } catch (err) { await appAlert((err && err.message) || 'Failed to update user.'); }
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

// ---------- multi-select ----------
// Ids rather than objects, so a selection survives a re-render, a filter
// change and an edit. Anything selected that has since been deleted is
// dropped by labSelection() rather than tracked, which keeps every other
// code path from having to care.
const labSelected = new Set();
let labAnchorId = null;   // for shift-click ranges
let labVisibleIds = [];   // what the feed is showing right now, in order

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
  // The feed is built first: it is what decides which ids are visible, and
  // the bar's "Select all" needs that list.
  const feed = dcEl('div', 'dc-feed');
  labRenderFeed(feed);
  feed.classList.toggle('has-selection', labSelected.size > 0);
  if (labSelected.size) labBodyEl.appendChild(labSelectionBar());
  labBodyEl.appendChild(feed);
}

// The live selection, in feed order, with anything deleted since dropped.
function labSelection() {
  const byId = new Map(labItems().map((i) => [i.id, i]));
  const out = [];
  for (const id of labSelected) {
    const it = byId.get(id);
    if (it) out.push(it); else labSelected.delete(id);
  }
  return out;
}

function labClearSelection() {
  if (!labSelected.size) return;
  labSelected.clear();
  labAnchorId = null;
  labRenderBrowse();
}

// Click behaviour on a card, matching the tab rail and every file manager:
// plain click selects only this one, ctrl/cmd toggles, shift extends from the
// last thing clicked. Plain click *while nothing is selected* is not a
// selection at all — it opens the prompt, which is what the card is for.
function labPick(item, e) {
  const id = item.id;
  if (e.shiftKey && labAnchorId) {
    const a = labVisibleIds.indexOf(labAnchorId);
    const b = labVisibleIds.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) labSelected.add(labVisibleIds[i]);
    } else {
      labSelected.add(id);
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (labSelected.has(id)) labSelected.delete(id); else labSelected.add(id);
    labAnchorId = id;
  } else {
    const only = labSelected.size === 1 && labSelected.has(id);
    labSelected.clear();
    if (!only) { labSelected.add(id); labAnchorId = id; }
  }
  labRenderBrowse();
}

// The bar only exists while something is selected — an always-visible toolbar
// with nothing to act on is just a row of disabled buttons.
function labSelectionBar() {
  const picked = labSelection();
  const bar = dcEl('div', 'lab-selbar');

  bar.appendChild(dcEl('span', 'lab-selbar-count',
    picked.length + ' ' + tr('lab.selected', picked.length === 1 ? 'selected' : 'selected')));

  // Move to category. The whole reason the selection exists for most people:
  // filing a pile of prompts at once instead of opening each one.
  const move = dcEl('select', 'lab-selbar-move');
  const ph = dcEl('option', '', tr('lab.moveTo', 'Move to…'));
  ph.value = ''; ph.disabled = true; ph.selected = true;
  move.appendChild(ph);
  LAB_CATEGORIES.forEach((c) => {
    const o = dcEl('option', '', c.label); o.value = c.slug; move.appendChild(o);
  });
  move.addEventListener('change', () => {
    const slug = move.value;
    if (!slug) return;
    const n = picked.length;
    picked.forEach((it) => { it.category = slug; });
    labPersist();
    labRenderBrowse();
    showToast(n + ' moved to ' + labCatLabel(slug), '');
  });
  bar.appendChild(move);

  const all = dcEl('button', 'dc-mini-btn', tr('lab.selectAll', 'Select all'));
  all.addEventListener('click', () => {
    labVisibleIds.forEach((id) => labSelected.add(id));
    labRenderBrowse();
  });
  bar.appendChild(all);

  const del = dcEl('button', 'dc-mini-btn dc-mini-danger', tr('lab.delete', 'Delete'));
  del.addEventListener('click', async () => {
    const n = picked.length;
    const ok = await appConfirm(
      n === 1
        ? 'Delete this prompt from your Lab?'
        : 'Delete ' + n + ' prompts from your Lab?',
      { danger: true, confirmLabel: tr('lab.delete', 'Delete') });
    if (!ok) return;
    const doomed = new Set(picked.map((i) => i.id));
    const arr = labItems();
    for (let i = arr.length - 1; i >= 0; i--) if (doomed.has(arr[i].id)) arr.splice(i, 1);
    labSelected.clear();
    labAnchorId = null;
    labPersist();
    labRenderBrowse();
    showToast(n === 1 ? 'Prompt deleted' : n + ' prompts deleted', '');
  });
  bar.appendChild(del);

  const clear = dcEl('button', 'lab-selbar-clear', '×');
  clear.title = tr('lab.clearSelection', 'Clear selection');
  clear.addEventListener('click', labClearSelection);
  bar.appendChild(clear);

  return bar;
}

function labRenderFeed(feed) {
  feed.innerHTML = '';
  let items = labItems().slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (labFilter !== 'all') items = items.filter((i) => i.category === labFilter);
  if (labSearch) items = items.filter((i) => ((i.title || '') + ' ' + (i.prompt || '')).toLowerCase().includes(labSearch));
  labVisibleIds = items.map((i) => i.id);
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
  const picked = labSelected.has(item.id);
  card.classList.toggle('is-picked', picked);

  // While a selection is running, a click anywhere on the card extends or
  // changes it instead of opening the prompt — otherwise you would have to
  // hold ctrl for every card after the first, and one slip would throw the
  // whole selection away and open a modal on top of it.
  const openOrPick = (e) => {
    if (labSelected.size || e.ctrlKey || e.metaKey || e.shiftKey) { labPick(item, e); return; }
    labOpen(item);
  };

  const pick = dcEl('button', 'lab-pick');
  pick.title = tr('lab.select', 'Select');
  pick.setAttribute('aria-pressed', picked ? 'true' : 'false');
  pick.addEventListener('click', (e) => { e.stopPropagation(); labPick(item, e); });
  card.appendChild(pick);

  if (item.video && !item.image) {
    const v = dcEl('video', 'dc-card-img'); v.src = labMediaUrl(item.video); v.muted = true; v.preload = 'metadata';
    v.addEventListener('click', openOrPick);
    card.appendChild(v);
  } else {
    const im = dcEl('img', 'dc-card-img' + (item.image ? '' : ' is-default'));
    im.loading = 'lazy'; im.src = labMediaUrl(item.image) || dcDefaultImage(item.category); im.alt = '';
    im.addEventListener('click', openOrPick);
    card.appendChild(im);
  }
  const body = dcEl('div', 'dc-card-body');
  const top = dcEl('div', 'dc-card-top');
  const title = dcEl('div', 'dc-card-title', item.title || tr('card.untitled', 'Untitled'));
  title.addEventListener('click', openOrPick);
  top.appendChild(title);
  if (item.category) top.appendChild(dcEl('span', 'dc-card-cat', labCatLabel(item.category)));
  body.appendChild(top);
  if (item.audio) body.appendChild(dcAudioPlayer(labMediaUrl(item.audio)));
  const pr = dcEl('div', 'dc-card-prompt', item.prompt || '');
  pr.addEventListener('click', openOrPick);
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
  del.addEventListener('click', async () => {
    if (await appConfirm('Delete this prompt from your Lab?', { danger: true, confirmLabel: 'Delete' })) {
      labDelete(item); close();
    }
  });
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
  if (!window.DISCOVER_CONFIGURED || !settings.discoverEnabled) { await appAlert('Discover is turned off (enable it in Settings → Tabs).'); return; }
  if (!dcClient || !dcSession) { await appAlert('Open the Discover tab and sign in, then share again.'); switchToDiscover(); return; }
  if (!dcProfile) { await appAlert('Loading your Discover profile — try again in a moment.'); return; }
  if (item.video && !await appConfirm('Video isn’t shared to Discover (too large). Share the prompt' +
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
    if (btn) btn.textContent = 'Shared ✓'; else await appAlert('Shared to Discover!');
  } catch (err) {
    await appAlert((err && err.message) || 'Share failed.');
    if (btn) { btn.disabled = false; btn.textContent = label || 'Share'; }
  }
}

// Escape drops the selection, Ctrl+A takes all of what is on screen. Both
// only while the Lab is the visible view and nothing is on top of it, so
// neither steals the shortcut from the editor.
document.addEventListener('keydown', (e) => {
  if (!labActive() || labModalOpen || appDialogDepth) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  if (e.key === 'Escape' && labSelected.size) {
    e.preventDefault(); e.stopPropagation();
    labClearSelection();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && labVisibleIds.length) {
    e.preventDefault();
    labVisibleIds.forEach((id) => labSelected.add(id));
    labRenderBrowse();
  }
}, true);

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

  // `out.push(...arr)` throws RangeError once arr passes the engine's argument
  // limit (~65k), so a merge on a note with more lines than that — a pasted log,
  // an exported chat — blew up instead of syncing. Push in bounded chunks.
  const pushAll = (dest, arr) => {
    const CHUNK = 8192;
    if (arr.length <= CHUNK) { dest.push(...arr); return; }
    for (let i = 0; i < arr.length; i += CHUNK) dest.push(...arr.slice(i, i + CHUNK));
  };

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

    pushAll(out, base.slice(cursor, lo));
    let at = lo;
    for (const r of cluster) {
      if (clash && r.mine !== keepMine) continue;
      pushAll(out, base.slice(at, r.lo));
      pushAll(out, r.lines);
      at = Math.max(at, r.hi);
    }
    pushAll(out, base.slice(at, hi));
    cursor = hi;
    k = end;
  }
  pushAll(out, base.slice(cursor));
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
// Boot is one long await chain over IPC, DOM wiring and the network. A throw
// anywhere in it used to reject silently and leave the window half-built with
// no clue why, so every stage is reported and the app is still left usable
// (settings and notes that did load are on screen; the rest degrades).
(async function init() {
  try {
    await bootstrap();
  } catch (err) {
    console.error('PromptPad failed to start cleanly', err);
    try { showToast('Something went wrong while starting up.'); } catch {}
  }
})();

async function bootstrap() {
  // Platform-specific copy — the setting/shortcut itself already works
  // cross-platform, only the wording was hardcoded to Windows.
  if (window.api.platform === 'darwin') {
    const startupHintEl = document.getElementById('startupHint');
    if (startupHintEl) startupHintEl.textContent = 'Open PromptPad when your Mac starts';
  }

  const savedSettings = await window.api.loadSettings();
  // A genuinely fresh install — no settings file at all — opens on Mono rather
  // than Forest. This is deliberately keyed on there being no saved object,
  // not on `theme` being absent: anyone who already has PromptPad keeps the
  // theme they chose, including if they chose Forest.
  const firstRun = !savedSettings || !Object.keys(savedSettings).length;
  settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  if (firstRun) settings.theme = 'mono';
  // Themes that have been withdrawn. Anyone sitting on one of these keys would
  // otherwise silently fall back to the default on their next launch.
  const GONE = {
    orrery: 'blueprint', clockwork: 'blueprint', murmuration: 'starfall', foundry: 'embers',
    // Withdrawn in 4.0. Static was noise with nothing behind it, and
    // Fireflies and Pollen were the same theme twice: small warm dots
    // drifting over a dark ground.
    staticsig: 'crt', fireflies: 'starfall', pollen: 'sundial',
    // Withdrawn in 4.0 as well.
    drivein: 'lasttrain',
    cornershop: 'snowstreet',
    kite: 'sundial'
  };
  if (GONE[settings.theme]) settings.theme = GONE[settings.theme];
  ['favThemes', 'recentThemes', 'seenThemes'].forEach((k) => {
    if (Array.isArray(settings[k])) settings[k] = settings[k].filter((x) => !GONE[x]);
  });
  // ensure every toolbar key exists even if an older save lacked some
  settings.toolbar = { ...DEFAULT_SETTINGS.toolbar, ...(settings.toolbar || {}) };
  settings.seenFeatures = { ...(settings.seenFeatures || {}) };
  settings.voice = { ...DEFAULT_SETTINGS.voice, ...(settings.voice || {}) };
  settings.ai = { ...DEFAULT_SETTINGS.ai, ...(settings.ai || {}) };
  // Arrays need the same guard as the nested objects: a save written before
  // these existed would otherwise leave them undefined.
  settings.customAiActions = Array.isArray(settings.customAiActions) ? settings.customAiActions : [];
  settings.recentAiPrompts = Array.isArray(settings.recentAiPrompts) ? settings.recentAiPrompts : [];
  // Model catalog lives in main.js so the two processes can't drift; pull it
  // once at boot. A failure here only costs the dropdown its options — Auto
  // still works, since main resolves the list itself on every call.
  try { aiProviderCatalog = (await window.api.aiProviders()) || {}; } catch { aiProviderCatalog = {}; }
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
  try { applyFullscreen(await window.api.isFullscreen()); } catch {}

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
    if (!guideOverlay.classList.contains('hidden')) { closeGuide(); return; }
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
    if (isFullscreen) { toggleFullscreen(); return; }
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
    if (!tableDialog.classList.contains('hidden')) { closeTableDialog(); return; }
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
}
