// Shared theme + font tables, used by both the main renderer and the
// standalone quick-capture window so their colors always stay in sync.
(function () {
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

  const FONTS = {
    cascadia: { label: 'Cascadia',  stack: '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace' },
    consolas: { label: 'Consolas',  stack: 'Consolas, "Cascadia Code", ui-monospace, monospace' },
    jetbrains:{ label: 'JetBrains', stack: '"JetBrains Mono", Consolas, ui-monospace, monospace' },
    lucida:   { label: 'Lucida',    stack: '"Lucida Console", "Lucida Sans Typewriter", Consolas, monospace' },
    courier:  { label: 'Courier',   stack: '"Courier New", Courier, monospace' },
    system:   { label: 'System UI', stack: '"Segoe UI", Inter, system-ui, sans-serif' },
  };

  // Write a theme's palette onto :root as CSS variables. Shared so the main
  // window and the quick-capture popup resolve a theme name identically.
  function applyThemeVars(name, root) {
    const t = THEMES[name] || THEMES.forest;
    const r = (root || document.documentElement).style;
    r.setProperty('--bg', t.bg);
    r.setProperty('--text', t.text);
    r.setProperty('--sidebar', t.sidebar);
    r.setProperty('--elevated', t.elevated);
    r.setProperty('--elevated-hi', t.elevatedHi);
    r.setProperty('--accent', t.accent);
    r.setProperty('--danger', t.danger);
    return t;
  }

  window.PP_THEMES = THEMES;
  window.PP_FONTS = FONTS;
  window.PP_applyThemeVars = applyThemeVars;
})();
