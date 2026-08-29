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

    // === Pro ===
    // These aren't palettes. Each one changes what the app *is* — a pane of
    // refracting glass, a dying CRT, black-and-white film, glyph rain, a
    // surface that moves with your music. `fx` names the runtime in fx.js and
    // the CSS class that reshapes the UI; `winBg` is the opaque colour handed
    // to the native window, which can't take the rgba values used here.
    synesthesia: {
      label: 'Synesthesia', type: 'pro', fx: 'keys', cssClass: 'fx-keys',
      // The app takes its colour from what you type: every letter maps to its
      // own hue, so a word paints a colour and a sentence drifts through a
      // range. Near-neutral at rest so the typed colour is the only colour.
      bg: '#0d0d11', text: '#e9e9f2', sidebar: '#0a0a0e', elevated: '#17171d',
      elevatedHi: '#22222b', accent: '#6f8cff', danger: '#ff6b81', winBg: '#0d0d11'
    },
    crt: {
      label: 'Old TV', type: 'pro', fx: 'crt', cssClass: 'fx-crt',
      bg: '#0a0f0a', text: '#8bf5a4', sidebar: '#060b06', elevated: '#0f1a10', elevatedHi: '#17281a',
      accent: '#4dff88', danger: '#ff6b5b', winBg: '#0a0f0a'
    },
    rain: {
      label: 'Matrix', type: 'pro', fx: 'rain', cssClass: 'fx-rain',
      // Deliberately low alpha: the rain lives behind these surfaces, so every
      // point of opacity here is a point of rain you can't see.
      bg: 'rgba(0,0,0,0.40)', text: '#8bff9e', sidebar: 'rgba(0,0,0,0.62)',
      elevated: 'rgba(0,26,9,0.72)', elevatedHi: 'rgba(0,48,17,0.80)',
      accent: '#00ff41', danger: '#ff3b3b', winBg: '#000000'
    },
    xp: {
      label: 'Windows XP', type: 'pro', cssClass: 'fx-xp theme-light',
      // Luna. #ece9d8 is the exact dialog beige, #0a55d4 the selection blue —
      // getting those two right is most of why it reads as XP at a glance.
      bg: '#ece9d8', text: '#0a0a0a', sidebar: '#eef3fd', elevated: '#ffffff',
      elevatedHi: '#cddef5', accent: '#0a55d4', danger: '#c1272d', winBg: '#ece9d8'
    },
    storm: {
      label: 'Storm', type: 'pro', fx: 'storm', cssClass: 'fx-storm',
      // Near-black — a night storm, not an overcast afternoon. Cloud cover
      // behind the UI, struck by lightning ambiently and again on every
      // keystroke. Surfaces stay translucent so the sky reads through.
      bg: 'rgba(2,3,6,0.68)', text: '#dfe4f0', sidebar: 'rgba(1,2,4,0.80)',
      elevated: 'rgba(10,13,20,0.82)', elevatedHi: 'rgba(18,22,32,0.88)',
      accent: '#8f9ac2', danger: '#ff8f7a', winBg: '#020306'
    },
    wound: {
      label: 'Wounds', type: 'pro', fx: 'wound', cssClass: 'fx-wound',
      // Near-black with the red already in it, so a fresh cut reads as part
      // of the app rather than as something drawn on top of it. Every
      // keystroke opens a slash where the caret is; it bleeds, then fades.
      bg: '#0c0708', text: '#e6d8d8', sidebar: '#080405', elevated: '#160d0f', elevatedHi: '#201315',
      accent: '#c2202b', danger: '#ff5a4d', winBg: '#0c0708'
    },
    ghost: {
      label: 'Ghosts', type: 'pro', fx: 'ghost', cssClass: 'fx-ghost',
      // Everything you delete lingers a few seconds where it stood. Colourless
      // on purpose — the only thing with a hue here is the accent, so a ghost
      // in the note's own grey is unmistakably a leftover of your own text.
      bg: '#0e0f11', text: '#dfe2e6', sidebar: '#0a0b0d', elevated: '#171a1d', elevatedHi: '#212528',
      accent: '#9fb3c8', danger: '#e0798a', winBg: '#0e0f11'
    },
    ink: {
      label: 'Ink', type: 'pro', fx: 'ink', cssClass: 'fx-ink theme-light',
      // Paper. Ink soaks in under the words on every keystroke, so the page
      // surfaces are translucent — every point of opacity here is a blot you
      // would not see.
      bg: 'rgba(244,241,233,0.44)', text: '#1b1a17', sidebar: 'rgba(233,228,216,0.68)',
      elevated: 'rgba(252,250,245,0.78)', elevatedHi: 'rgba(226,220,206,0.84)',
      accent: '#2b3a67', danger: '#a8321f', winBg: '#f4f1e9'
    },
    embers: {
      label: 'Embers', type: 'pro', fx: 'embers', cssClass: 'fx-embers',
      // Charcoal, with the fire kept at the bottom edge where the sparks come
      // from. The accent is the ember colour so the UI agrees with the flame.
      bg: '#120e0b', text: '#eadfd3', sidebar: '#0c0908', elevated: '#1d1613', elevatedHi: '#281e19',
      accent: '#ff8c32', danger: '#ff5a3c', winBg: '#120e0b'
    },
    circuit: {
      label: 'Circuit', type: 'pro', fx: 'circuit', cssClass: 'fx-circuit',
      // Board green under translucent panels, with current running out from
      // the caret on every keystroke.
      bg: 'rgba(6,15,13,0.56)', text: '#cfe9df', sidebar: 'rgba(4,11,10,0.74)',
      elevated: 'rgba(10,24,21,0.74)', elevatedHi: 'rgba(15,34,29,0.80)',
      accent: '#3ff0b0', danger: '#ff7a6b', winBg: '#040b09'
    },
    aurora: {
      label: 'Aurora', type: 'pro', fx: 'aurora', cssClass: 'fx-aurora',
      // A polar night: the ribbons are behind everything, so the surfaces are
      // translucent and the accent stays a cold white-blue rather than
      // competing with the light show.
      bg: 'rgba(6,10,20,0.58)', text: '#dbe6f5', sidebar: 'rgba(4,7,15,0.74)',
      elevated: 'rgba(12,18,32,0.74)', elevatedHi: 'rgba(18,26,44,0.82)',
      accent: '#9fe8d4', danger: '#ff8fa3', winBg: '#060a14'
    },
    starfall: {
      label: 'Starfall', type: 'pro', fx: 'starfall', cssClass: 'fx-starfall',
      // A clear night. The sky is behind everything, so the panels stay
      // translucent and dark enough that a comet crossing behind them still
      // reads clearly through the glass.
      bg: 'rgba(4,6,14,0.6)', text: '#dde4f5', sidebar: 'rgba(3,4,10,0.76)',
      elevated: 'rgba(8,10,20,0.78)', elevatedHi: 'rgba(14,17,32,0.86)',
      accent: '#bcd0ff', danger: '#ff8fa3', winBg: '#04060e'
    },
    zen: {
      label: 'Zen Garden', type: 'pro', fx: 'zen', cssClass: 'fx-zen theme-light',
      // Sand and stone. Typing rakes the garden and quiet smooths it back, so
      // the panels are translucent enough to show the furrows underneath.
      bg: 'rgba(238,231,215,0.42)', text: '#2a251c', sidebar: 'rgba(228,219,199,0.66)',
      elevated: 'rgba(248,243,232,0.76)', elevatedHi: 'rgba(222,212,190,0.84)',
      accent: '#6b7a5e', danger: '#a8503a', winBg: '#eee7d7'
    },
    blackout: {
      label: 'Blackout', type: 'pro', fx: 'blackout', cssClass: 'fx-blackout',
      // Candlelight: warm, and dimmer the longer you leave it. The palette is
      // deliberately a little brighter than it looks — the effect layer takes
      // light *away*, so the theme underneath has to have some to give.
      bg: '#14100c', text: '#f0e2cd', sidebar: '#0e0b08', elevated: '#211a13', elevatedHi: '#2d241a',
      accent: '#ffb347', danger: '#ff7a5c', winBg: '#14100c'
    },
    music: {
      label: 'Music', type: 'pro', fx: 'music', cssClass: 'fx-music',
      // Pale blue, and the accent stays put — the beat is shown by how far the
      // glow swings, not by cycling hue, which just reads as a colour animation
      // that happens to be running rather than as a response to the audio.
      bg: '#080b12', text: '#dce9fb', sidebar: '#050810', elevated: '#101825', elevatedHi: '#182338',
      accent: '#7fc4ff', danger: '#ff7a9c', winBg: '#080b12'
    },
    pulse: {
      label: 'Heartbeat', type: 'pro', fx: 'pulse', cssClass: 'fx-pulse',
      // A cardiac monitor wired to your typing speed. The ECG trace sweeps
      // behind the panels, so they're translucent — and the palette stays
      // near-black with the red already in it, the way the wards keep the
      // lights down so the monitor is the brightest thing in the room.
      bg: 'rgba(16,9,11,0.66)', text: '#eddadd', sidebar: 'rgba(10,5,7,0.80)',
      elevated: 'rgba(26,15,18,0.80)', elevatedHi: 'rgba(38,21,25,0.86)',
      accent: '#ff5c72', danger: '#ff4d4d', winBg: '#10090b'
    },
    deep: {
      label: 'Deep', type: 'pro', fx: 'deep', cssClass: 'fx-deep',
      // The water is behind everything, so the panels are translucent. This
      // palette is only where the dive starts: fx.js drives the column and
      // the accent from lit surface blue down to bioluminescent green as the
      // note gets longer, which is the whole theme.
      bg: 'rgba(6,18,28,0.52)', text: '#d6e8f2', sidebar: 'rgba(4,12,20,0.70)',
      elevated: 'rgba(9,24,36,0.74)', elevatedHi: 'rgba(14,34,50,0.82)',
      accent: '#7fd8e8', danger: '#ff8fa3', winBg: '#04101a'
    },
    kintsugi: {
      label: 'Kintsugi', type: 'pro', fx: 'kintsugi', cssClass: 'fx-kintsugi',
      // Black lacquer. The seams sit behind the panels rather than being
      // painted over them, so the surfaces are translucent — a gold vein has
      // to read through the window the way it reads through a mended bowl:
      // as part of the object, not as a line drawn on it.
      bg: 'rgba(18,14,11,0.62)', text: '#ece2d2', sidebar: 'rgba(12,9,7,0.78)',
      elevated: 'rgba(28,22,17,0.80)', elevatedHi: 'rgba(40,32,24,0.86)',
      accent: '#d4a24c', danger: '#d9604a', winBg: '#120e0b'
    },
    blueprint: {
      label: 'Blueprint', type: 'pro', fx: 'blueprint', cssClass: 'fx-blueprint',
      // Cyanotype: one blue and one cyan, and no third colour — a drawing
      // that uses a third colour stops reading as a drawing. Opaque, unlike
      // most of the Pro themes, because a drafting sheet is paper.
      bg: '#0e2c4b', text: '#c3e6f7', sidebar: '#0b2440', elevated: '#123356',
      elevatedHi: '#183f66', accent: '#5fd4f5', danger: '#ff9a7a', winBg: '#0e2c4b'
    },
    koi: {
      label: 'Koi', type: 'pro', fx: 'koi', cssClass: 'fx-koi',
      // Pond water seen from above. The fish swim behind the panels, so every
      // point of opacity here is a fish you cannot see.
      bg: 'rgba(10,26,24,0.54)', text: '#dcebe4', sidebar: 'rgba(6,18,17,0.72)',
      elevated: 'rgba(13,32,29,0.76)', elevatedHi: 'rgba(19,45,40,0.84)',
      accent: '#e8935c', danger: '#ff7a6b', winBg: '#081716'
    },
    tuxedo: {
      label: 'Tuxedo', type: 'vip', fx: 'tuxedo', cssClass: 'fx-tuxedo',
      // Black tie: the satin and its gold thread are the only two colours,
      // and the panels are translucent because the sheen travelling across
      // the cloth has to run under them, not stop at their edges.
      bg: 'rgba(10,9,8,0.60)', text: '#efe7d8', sidebar: 'rgba(6,5,4,0.80)',
      elevated: 'rgba(21,18,15,0.80)', elevatedHi: 'rgba(32,27,22,0.86)',
      accent: '#d9b45c', danger: '#c8503c', winBg: '#0a0908'
    },
    frost: {
      label: 'Frost', type: 'pro', fx: 'frost', cssClass: 'fx-frost',
      // The ice grows on top of the window rather than behind it, so unlike
      // most of these the panels are opaque — the frost has to read as being
      // on the glass in front of the app, which only works if there is a
      // solid app behind it.
      bg: '#0d1620', text: '#dcebf7', sidebar: '#0a111a', elevated: '#152232',
      elevatedHi: '#1e2f42', accent: '#8fd0f0', danger: '#f08a8a', winBg: '#0d1620'
    },
    sundial: {
      label: 'Sundial', type: 'pro', fx: 'sundial', cssClass: 'fx-sundial',
      // A window onto the actual sky, so the surfaces are translucent and the
      // palette is only what the room looks like at dusk. fx.js moves it from
      // here toward daylight or toward night depending on the clock, and
      // drives the accent from amber at the ends of the day to cold at noon.
      bg: 'rgba(16,20,30,0.56)', text: '#e6e9f0', sidebar: 'rgba(10,13,20,0.74)',
      elevated: 'rgba(22,27,38,0.76)', elevatedHi: 'rgba(32,39,52,0.84)',
      accent: '#e0a860', danger: '#f0836b', winBg: '#101420'
    },
    orrery: {
      label: 'Orrery', type: 'pro', fx: 'orrery', cssClass: 'fx-orrery',
      // Walnut and brass — a watch case, not a machine shop. Warm near-black
      // so the brass has something to be warm against, and translucent panels
      // because the movement runs underneath the whole window.
      bg: 'rgba(20,15,10,0.62)', text: '#ecdfc9', sidebar: 'rgba(13,10,6,0.80)',
      elevated: 'rgba(31,24,16,0.80)', elevatedHi: 'rgba(44,34,22,0.86)',
      accent: '#d6aa54', danger: '#d0603c', winBg: '#140f0a'
    },
    filings: {
      label: 'Filings', type: 'pro', fx: 'filings', cssClass: 'fx-filings theme-light',
      // Paper, because that is what the picture in the textbook is on. The
      // sheet is translucent so the filings arch under the words rather than
      // being fenced out of the editor.
      bg: 'rgba(240,238,232,0.62)', text: '#1c1f26', sidebar: 'rgba(226,224,216,0.80)',
      elevated: 'rgba(250,249,245,0.84)', elevatedHi: 'rgba(220,218,210,0.88)',
      accent: '#3d5a80', danger: '#a8321f', winBg: '#efede6'
    },


    // === VIP ===
    // A material each, and the same restraint in all of them: one metal, a
    // hairline double rule, and the name in wide capitals. Tuxedo (satin,
    // gold) sits above with the other fx entries — it predates the category.
    blackcard: {
      label: 'Black Card', type: 'vip', fx: 'blackcard', cssClass: 'fx-blackcard vip-card',
      // Machined matte black in platinum, not gold. A second gold theme
      // beside Tuxedo would make the whole category read as one idea said
      // twice, and cold metal against warm cloth is what makes it a set.
      bg: 'rgba(14,15,18,0.62)', text: '#e4e9ef', sidebar: 'rgba(9,10,12,0.80)',
      elevated: 'rgba(24,26,30,0.80)', elevatedHi: 'rgba(36,39,45,0.86)',
      accent: '#cbd5e0', danger: '#e0736b', winBg: '#0e0f12'
    },
    velvet: {
      label: 'Velvet', type: 'vip', fx: 'velvet', cssClass: 'fx-velvet vip-suite',
      // The opera box. The only warm-surfaced theme in the set, and the only
      // one whose light gathers around the caret rather than sweeping past
      // it — velvet is brushed by the hand, it does not glint.
      bg: 'rgba(40,12,22,0.60)', text: '#f2dfd2', sidebar: 'rgba(26,7,14,0.80)',
      elevated: 'rgba(54,17,30,0.80)', elevatedHi: 'rgba(72,24,40,0.86)',
      accent: '#d4ac60', danger: '#e2685f', winBg: '#1a070e'
    },
    marble: {
      label: 'Marble', type: 'vip', fx: 'marble', cssClass: 'fx-marble vip-suite theme-light',
      // Calacatta — white stone with gold in it. The light theme of the set,
      // and the only static one: a slab that shimmers reads as plastic.
      bg: 'rgba(250,249,245,0.58)', text: '#26221a', sidebar: 'rgba(240,237,229,0.76)',
      elevated: 'rgba(255,254,250,0.82)', elevatedHi: 'rgba(233,228,214,0.88)',
      accent: '#a3822f', danger: '#a8402f', winBg: '#f6f4ee'
    },
    cognac: {
      label: 'Cognac', type: 'vip', fx: 'cognac', cssClass: 'fx-cognac vip-card',
      // A bound volume: pebbled hide, and gold blocked into it the way a
      // spine is tooled. Leather absorbs light, so the surfaces here are the
      // least reflective in the set on purpose.
      bg: 'rgba(58,34,16,0.58)', text: '#f0e0c8', sidebar: 'rgba(38,22,10,0.78)',
      elevated: 'rgba(74,44,22,0.78)', elevatedHi: 'rgba(94,58,30,0.86)',
      accent: '#d8aa60', danger: '#e07a52', winBg: '#2a180b'
    },
    // Smoke (letters hidden in a puff on typing, revealed as it clears) was
    // tried and pulled — never read as natural enough to keep.
    //
    // Gunfire (sound theme: shot on type, reload on Space, a heavier round on
    // Enter) is parked for now — coming back once there's real gunshot audio
    // to drive it instead of a synthesized placeholder.
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
