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
      label: 'Synesthesia', type: 'reactive', fx: 'keys', cssClass: 'fx-keys',
      // The app takes its colour from what you type: every letter maps to its
      // own hue, so a word paints a colour and a sentence drifts through a
      // range. Near-neutral at rest so the typed colour is the only colour.
      bg: '#0d0d11', text: '#e9e9f2', sidebar: '#0a0a0e', elevated: '#17171d',
      elevatedHi: '#22222b', accent: '#6f8cff', danger: '#ff6b81', winBg: '#0d0d11'
    },
    crt: {
      label: 'Old TV', type: 'machines', fx: 'crt', cssClass: 'fx-crt',
      bg: '#0a0f0a', text: '#8bf5a4', sidebar: '#060b06', elevated: '#0f1a10', elevatedHi: '#17281a',
      accent: '#4dff88', danger: '#ff6b5b', winBg: '#0a0f0a'
    },
    rain: {
      label: 'Matrix', type: 'machines', fx: 'rain', cssClass: 'fx-rain',
      // Deliberately low alpha: the rain lives behind these surfaces, so every
      // point of opacity here is a point of rain you can't see.
      bg: 'rgba(0,0,0,0.40)', text: '#8bff9e', sidebar: 'rgba(0,0,0,0.62)',
      elevated: 'rgba(0,26,9,0.72)', elevatedHi: 'rgba(0,48,17,0.80)',
      accent: '#00ff41', danger: '#ff3b3b', winBg: '#000000'
    },
    xp: {
      label: 'Windows XP', type: 'machines', cssClass: 'fx-xp theme-light',
      // Luna. #ece9d8 is the exact dialog beige, #0a55d4 the selection blue —
      // getting those two right is most of why it reads as XP at a glance.
      bg: '#ece9d8', text: '#0a0a0a', sidebar: '#eef3fd', elevated: '#ffffff',
      elevatedHi: '#cddef5', accent: '#0a55d4', danger: '#c1272d', winBg: '#ece9d8'
    },
    storm: {
      recommended: true,
      label: 'Storm', type: 'nature', fx: 'storm', cssClass: 'fx-storm',
      // Near-black — a night storm, not an overcast afternoon. Cloud cover
      // behind the UI, struck by lightning ambiently and again on every
      // keystroke. Surfaces stay translucent so the sky reads through.
      bg: 'rgba(2,3,6,0.68)', text: '#dfe4f0', sidebar: 'rgba(1,2,4,0.80)',
      elevated: 'rgba(10,13,20,0.82)', elevatedHi: 'rgba(18,22,32,0.88)',
      accent: '#8f9ac2', danger: '#ff8f7a', winBg: '#020306'
    },
    wound: {
      label: 'Wounds', type: 'reactive', fx: 'wound', cssClass: 'fx-wound',
      // Near-black with the red already in it, so a fresh cut reads as part
      // of the app rather than as something drawn on top of it. Every
      // keystroke opens a slash where the caret is; it bleeds, then fades.
      bg: '#0c0708', text: '#e6d8d8', sidebar: '#080405', elevated: '#160d0f', elevatedHi: '#201315',
      accent: '#c2202b', danger: '#ff5a4d', winBg: '#0c0708'
    },
    ghost: {
      recommended: true,
      label: 'Ghosts', type: 'reactive', fx: 'ghost', cssClass: 'fx-ghost',
      // Everything you delete lingers a few seconds where it stood. Colourless
      // on purpose — the only thing with a hue here is the accent, so a ghost
      // in the note's own grey is unmistakably a leftover of your own text.
      bg: '#0e0f11', text: '#dfe2e6', sidebar: '#0a0b0d', elevated: '#171a1d', elevatedHi: '#212528',
      accent: '#9fb3c8', danger: '#e0798a', winBg: '#0e0f11'
    },
    ink: {
      label: 'Ink', type: 'reactive', fx: 'ink', cssClass: 'fx-ink theme-light',
      // Paper. Ink soaks in under the words on every keystroke, so the page
      // surfaces are translucent — every point of opacity here is a blot you
      // would not see.
      bg: 'rgba(244,241,233,0.44)', text: '#1b1a17', sidebar: 'rgba(233,228,216,0.68)',
      elevated: 'rgba(252,250,245,0.78)', elevatedHi: 'rgba(226,220,206,0.84)',
      accent: '#2b3a67', danger: '#a8321f', winBg: '#f4f1e9'
    },
    embers: {
      label: 'Embers', type: 'nature', fx: 'embers', cssClass: 'fx-embers',
      // Charcoal, with the fire kept at the bottom edge where the sparks come
      // from. The accent is the ember colour so the UI agrees with the flame.
      bg: '#120e0b', text: '#eadfd3', sidebar: '#0c0908', elevated: '#1d1613', elevatedHi: '#281e19',
      accent: '#ff8c32', danger: '#ff5a3c', winBg: '#120e0b'
    },
    circuit: {
      label: 'Circuit', type: 'reactive', fx: 'circuit', cssClass: 'fx-circuit',
      // Board green under translucent panels, with current running out from
      // the caret on every keystroke.
      bg: 'rgba(6,15,13,0.56)', text: '#cfe9df', sidebar: 'rgba(4,11,10,0.74)',
      elevated: 'rgba(10,24,21,0.74)', elevatedHi: 'rgba(15,34,29,0.80)',
      accent: '#3ff0b0', danger: '#ff7a6b', winBg: '#040b09'
    },
    aurora: {
      label: 'Aurora', type: 'nature', fx: 'aurora', cssClass: 'fx-aurora',
      // A polar night: the ribbons are behind everything, so the surfaces are
      // translucent and the accent stays a cold white-blue rather than
      // competing with the light show.
      bg: 'rgba(6,10,20,0.58)', text: '#dbe6f5', sidebar: 'rgba(4,7,15,0.74)',
      elevated: 'rgba(12,18,32,0.74)', elevatedHi: 'rgba(18,26,44,0.82)',
      accent: '#9fe8d4', danger: '#ff8fa3', winBg: '#060a14'
    },
    starfall: {
      label: 'Starfall', type: 'nature', fx: 'starfall', cssClass: 'fx-starfall',
      // A clear night. The sky is behind everything, so the panels stay
      // translucent and dark enough that a comet crossing behind them still
      // reads clearly through the glass.
      bg: 'rgba(4,6,14,0.6)', text: '#dde4f5', sidebar: 'rgba(3,4,10,0.76)',
      elevated: 'rgba(8,10,20,0.78)', elevatedHi: 'rgba(14,17,32,0.86)',
      accent: '#bcd0ff', danger: '#ff8fa3', winBg: '#04060e'
    },
    zen: {
      label: 'Zen Garden', type: 'reactive', fx: 'zen', cssClass: 'fx-zen theme-light',
      // Sand and stone. Typing rakes the garden and quiet smooths it back, so
      // the panels are translucent enough to show the furrows underneath.
      bg: 'rgba(238,231,215,0.42)', text: '#2a251c', sidebar: 'rgba(228,219,199,0.66)',
      elevated: 'rgba(248,243,232,0.76)', elevatedHi: 'rgba(222,212,190,0.84)',
      accent: '#6b7a5e', danger: '#a8503a', winBg: '#eee7d7'
    },
    blackout: {
      recommended: true,
      label: 'Blackout', type: 'reactive', fx: 'blackout', cssClass: 'fx-blackout',
      // Candlelight: warm, and dimmer the longer you leave it. The palette is
      // deliberately a little brighter than it looks — the effect layer takes
      // light *away*, so the theme underneath has to have some to give.
      bg: '#14100c', text: '#f0e2cd', sidebar: '#0e0b08', elevated: '#211a13', elevatedHi: '#2d241a',
      accent: '#ffb347', danger: '#ff7a5c', winBg: '#14100c'
    },
    music: {
      label: 'Music', type: 'live', fx: 'music', cssClass: 'fx-music',
      // Pale blue, and the accent stays put — the beat is shown by how far the
      // glow swings, not by cycling hue, which just reads as a colour animation
      // that happens to be running rather than as a response to the audio.
      bg: '#080b12', text: '#dce9fb', sidebar: '#050810', elevated: '#101825', elevatedHi: '#182338',
      accent: '#7fc4ff', danger: '#ff7a9c', winBg: '#080b12'
    },
    pulse: {
      label: 'Heartbeat', type: 'reactive', fx: 'pulse', cssClass: 'fx-pulse',
      // A cardiac monitor wired to your typing speed. The ECG trace sweeps
      // behind the panels, so they're translucent — and the palette stays
      // near-black with the red already in it, the way the wards keep the
      // lights down so the monitor is the brightest thing in the room.
      bg: 'rgba(16,9,11,0.66)', text: '#eddadd', sidebar: 'rgba(10,5,7,0.80)',
      elevated: 'rgba(26,15,18,0.80)', elevatedHi: 'rgba(38,21,25,0.86)',
      accent: '#ff5c72', danger: '#ff4d4d', winBg: '#10090b'
    },
    deep: {
      label: 'Deep', type: 'reactive', fx: 'deep', cssClass: 'fx-deep',
      // The water is behind everything, so the panels are translucent. This
      // palette is only where the dive starts: fx.js drives the column and
      // the accent from lit surface blue down to bioluminescent green as the
      // note gets longer, which is the whole theme.
      bg: 'rgba(6,18,28,0.52)', text: '#d6e8f2', sidebar: 'rgba(4,12,20,0.70)',
      elevated: 'rgba(9,24,36,0.74)', elevatedHi: 'rgba(14,34,50,0.82)',
      accent: '#7fd8e8', danger: '#ff8fa3', winBg: '#04101a'
    },
    kintsugi: {
      label: 'Kintsugi', type: 'luxury', fx: 'kintsugi', cssClass: 'fx-kintsugi',
      // Black lacquer. The seams sit behind the panels rather than being
      // painted over them, so the surfaces are translucent — a gold vein has
      // to read through the window the way it reads through a mended bowl:
      // as part of the object, not as a line drawn on it.
      bg: 'rgba(18,14,11,0.62)', text: '#ece2d2', sidebar: 'rgba(12,9,7,0.78)',
      elevated: 'rgba(28,22,17,0.80)', elevatedHi: 'rgba(40,32,24,0.86)',
      accent: '#d4a24c', danger: '#d9604a', winBg: '#120e0b'
    },
    blueprint: {
      label: 'Blueprint', type: 'machines', fx: 'blueprint', cssClass: 'fx-blueprint',
      // Cyanotype: one blue and one cyan, and no third colour — a drawing
      // that uses a third colour stops reading as a drawing. Opaque, unlike
      // most of the Pro themes, because a drafting sheet is paper.
      bg: '#0e2c4b', text: '#c3e6f7', sidebar: '#0b2440', elevated: '#123356',
      elevatedHi: '#183f66', accent: '#5fd4f5', danger: '#ff9a7a', winBg: '#0e2c4b'
    },
    koi: {
      label: 'Koi', type: 'nature', fx: 'koi', cssClass: 'fx-koi',
      // Pond water seen from above. The fish swim behind the panels, so every
      // point of opacity here is a fish you cannot see.
      bg: 'rgba(10,26,24,0.54)', text: '#dcebe4', sidebar: 'rgba(6,18,17,0.72)',
      elevated: 'rgba(13,32,29,0.76)', elevatedHi: 'rgba(19,45,40,0.84)',
      accent: '#e8935c', danger: '#ff7a6b', winBg: '#081716'
    },
    tuxedo: {
      label: 'Tuxedo', type: 'luxury', fx: 'tuxedo', cssClass: 'fx-tuxedo',
      // Black tie: the satin and its gold thread are the only two colours,
      // and the panels are translucent because the sheen travelling across
      // the cloth has to run under them, not stop at their edges.
      bg: 'rgba(10,9,8,0.60)', text: '#efe7d8', sidebar: 'rgba(6,5,4,0.80)',
      elevated: 'rgba(21,18,15,0.80)', elevatedHi: 'rgba(32,27,22,0.86)',
      accent: '#d9b45c', danger: '#c8503c', winBg: '#0a0908'
    },
    frost: {
      label: 'Frost', type: 'reactive', fx: 'frost', cssClass: 'fx-frost',
      // The ice grows on top of the window rather than behind it, so unlike
      // most of these the panels are opaque — the frost has to read as being
      // on the glass in front of the app, which only works if there is a
      // solid app behind it.
      bg: '#0d1620', text: '#dcebf7', sidebar: '#0a111a', elevated: '#152232',
      elevatedHi: '#1e2f42', accent: '#8fd0f0', danger: '#f08a8a', winBg: '#0d1620'
    },
    sundial: {
      label: 'Sundial', type: 'live', fx: 'sundial', cssClass: 'fx-sundial',
      // A window onto the actual sky, so the surfaces are translucent and the
      // palette is only what the room looks like at dusk. fx.js moves it from
      // here toward daylight or toward night depending on the clock, and
      // drives the accent from amber at the ends of the day to cold at noon.
      bg: 'rgba(16,20,30,0.56)', text: '#e6e9f0', sidebar: 'rgba(10,13,20,0.74)',
      elevated: 'rgba(22,27,38,0.76)', elevatedHi: 'rgba(32,39,52,0.84)',
      accent: '#e0a860', danger: '#f0836b', winBg: '#101420'
    },
    filings: {
      label: 'Filings', type: 'machines', fx: 'filings', cssClass: 'fx-filings theme-light',
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
      label: 'Black Card', type: 'luxury', fx: 'blackcard', cssClass: 'fx-blackcard vip-card',
      // Machined matte black in platinum, not gold. A second gold theme
      // beside Tuxedo would make the whole category read as one idea said
      // twice, and cold metal against warm cloth is what makes it a set.
      bg: 'rgba(14,15,18,0.62)', text: '#e4e9ef', sidebar: 'rgba(9,10,12,0.80)',
      elevated: 'rgba(24,26,30,0.80)', elevatedHi: 'rgba(36,39,45,0.86)',
      accent: '#cbd5e0', danger: '#e0736b', winBg: '#0e0f12'
    },
    velvet: {
      label: 'Velvet', type: 'luxury', fx: 'velvet', cssClass: 'fx-velvet vip-suite',
      // The opera box. The only warm-surfaced theme in the set, and the only
      // one whose light gathers around the caret rather than sweeping past
      // it — velvet is brushed by the hand, it does not glint.
      bg: 'rgba(40,12,22,0.60)', text: '#f2dfd2', sidebar: 'rgba(26,7,14,0.80)',
      elevated: 'rgba(54,17,30,0.80)', elevatedHi: 'rgba(72,24,40,0.86)',
      accent: '#d4ac60', danger: '#e2685f', winBg: '#1a070e'
    },
    marble: {
      label: 'Marble', type: 'luxury', fx: 'marble', cssClass: 'fx-marble vip-suite theme-light',
      // Calacatta — white stone with gold in it. The light theme of the set,
      // and the only static one: a slab that shimmers reads as plastic.
      bg: 'rgba(250,249,245,0.58)', text: '#26221a', sidebar: 'rgba(240,237,229,0.76)',
      elevated: 'rgba(255,254,250,0.82)', elevatedHi: 'rgba(233,228,214,0.88)',
      accent: '#a3822f', danger: '#a8402f', winBg: '#f6f4ee'
    },
    fountain: {
      recommended: true,
      label: 'Fountain', type: 'luxury', fx: 'fountain', cssClass: 'fx-fountain vip-suite',
      // What people will actually type looking for it — the browser's search
      // reads these alongside the label.
      keywords: 'water ripple splash basin onyx gold ab favvare',
      // Water is the material here, the way satin is Tuxedo's and stone is
      // Marble's — an onyx basin seen from above, with the rim's gold caught
      // in the ripples. Deliberately not Deep (below the surface) or Koi (a
      // pond with fish in it): this one is the surface itself, and it moves
      // only because you are typing into it. The panels are translucent
      // because the water runs underneath the whole window, not around it.
      bg: 'rgba(8,17,23,0.56)', text: '#dff0f4', sidebar: 'rgba(5,11,15,0.76)',
      elevated: 'rgba(12,25,33,0.78)', elevatedHi: 'rgba(18,36,46,0.84)',
      accent: '#d6aa5c', danger: '#e2685f', winBg: '#081117'
    },
    typewriter: {
      label: 'Typewriter', type: 'sound', fx: 'typewriter', cssClass: 'fx-typewriter theme-light',
      keywords: 'sound audio typewriter bell carriage paper seda mashin',
      // Paper and ribbon-ink. The only light theme in Sound, because the other
      // one in this category is a keyboard and this one is a machine you feed
      // a sheet into — they should not look like the same object.
      bg: '#efe9dc', text: '#2a231c', sidebar: '#e4dcca', elevated: '#f7f2e7',
      elevatedHi: '#ddd3bd', accent: '#8a5a3c', danger: '#a8321f', winBg: '#efe9dc'
    },
    downpour: {
      recommended: true,
      label: 'Downpour', type: 'sound', fx: 'downpour', cssClass: 'fx-downpour',
      keywords: 'rain storm thunder water glass sound audio baran seda',
      // Wet slate. The window is the glass you are looking through, so the
      // panels stay translucent and nothing in the palette is warm.
      bg: 'rgba(16,22,30,0.56)', text: '#dbe6ee', sidebar: 'rgba(10,15,21,0.76)',
      elevated: 'rgba(23,31,42,0.78)', elevatedHi: 'rgba(34,45,58,0.86)',
      accent: '#8fb8d8', danger: '#e8798a', winBg: '#101620'
    },
    hearth: {
      label: 'Hearth', type: 'sound', fx: 'hearth', cssClass: 'fx-hearth',
      keywords: 'fire crackle wood warm campfire sound audio atish seda',
      // A dark room with one fire in it. Opaque, unlike most: the light is
      // thrown *onto* the app from the bottom edge, so there is nothing
      // behind it to see.
      bg: '#171210', text: '#eaddd0', sidebar: '#100c0a', elevated: '#221a16',
      elevatedHi: '#2f241e', accent: '#ff9440', danger: '#ff6242', winBg: '#171210'
    },
    koto: {
      label: 'Koto', type: 'sound', fx: 'koto', cssClass: 'fx-koto',
      keywords: 'music strings pluck pentatonic instrument sound audio saz seda',
      // Paper and lacquer, and almost nothing else — the strings drawn across
      // the window are the only thing on it, and they need a quiet ground.
      bg: '#14100e', text: '#e6dccb', sidebar: '#0e0b09', elevated: '#1f1915',
      elevatedHi: '#2c231d', accent: '#c9a86a', danger: '#c9604a', winBg: '#14100e'
    },
    moon: {
      label: 'Moon', type: 'live', fx: 'moon', cssClass: 'fx-moon',
      keywords: 'moon lunar phase night sky mah live calendar',
      // A clear night, and nothing in the palette competes with the disc:
      // the moon is the only bright thing, and how bright depends on what
      // the real phase is tonight.
      bg: 'rgba(7,10,20,0.58)', text: '#dde4f2', sidebar: 'rgba(4,6,13,0.76)',
      elevated: 'rgba(11,15,27,0.78)', elevatedHi: 'rgba(18,24,40,0.85)',
      accent: '#c8d6f0', danger: '#e8798a', winBg: '#070a14'
    },
    constellation: {
      recommended: true,
      label: 'Constellation', type: 'play', fx: 'constellation', cssClass: 'fx-constellation',
      keywords: 'stars draw connect night sky play interactive setare',
      // A clear night and nothing else. The only colour in it is the line you
      // are drawing, so the palette gets out of the way entirely.
      bg: 'rgba(6,8,18,0.58)', text: '#dce3f5', sidebar: 'rgba(3,5,12,0.78)',
      elevated: 'rgba(10,13,26,0.78)', elevatedHi: 'rgba(17,22,40,0.86)',
      accent: '#9fc0ff', danger: '#e8798a', winBg: '#06081a'
    },
    silk: {
      label: 'Silk', type: 'play', fx: 'silk', cssClass: 'fx-silk',
      keywords: 'web spider silk cloth verlet pluck play interactive tar',
      // Dark, because a web is only visible when it catches light against
      // something darker. The web is drawn over the app rather than behind it
      // — you are meant to be able to reach it.
      bg: '#0b0d10', text: '#e2e8ee', sidebar: '#07090b', elevated: '#141820',
      elevatedHi: '#1e242e', accent: '#cfe0ee', danger: '#e0798a', winBg: '#0b0d10'
    },
    bubbles: {
      label: 'Bubbles', type: 'play', fx: 'bubbles', cssClass: 'fx-bubbles',
      keywords: 'bubbles pop play interactive mouse water hobab',
      // Deep teal so a rim of light on a bubble has something to be a rim
      // against. Very translucent: they rise behind the panels and the whole
      // point is being able to see one coming and go and get it.
      bg: 'rgba(6,20,26,0.50)', text: '#d8ecf2', sidebar: 'rgba(4,13,17,0.72)',
      elevated: 'rgba(9,26,33,0.74)', elevatedHi: 'rgba(14,38,47,0.82)',
      accent: '#5fd0e0', danger: '#ff7a8a', winBg: '#061419'
    },
    // === Nostalgia ===
    // Scenes, not effects. Each one is a place drawn the way 1997 hardware
    // drew places: a fifth of the resolution, five or six colours, ordered
    // dithering between them, whole-pixel movement and fifteen frames a
    // second. They share one renderer (makeRetro in fx.js) so they are all
    // the same machine looking at different things.
    nostalgia: {
      recommended: true,
      label: 'Barrel Fire', type: 'retro', fx: 'nostalgia', cssClass: 'fx-retro',
      keywords: 'snow winter street fire barrel city ps1 pixel dither barf atish',
      // A street at night, so the fire is the only warm thing in it. The
      // panels are translucent: the scene has three planes and hiding two of
      // them behind the editor would leave an effect rather than a place.
      bg: 'rgba(14,18,38,0.54)', text: '#dbe6ff', sidebar: 'rgba(9,11,26,0.76)',
      elevated: 'rgba(20,26,52,0.78)', elevatedHi: 'rgba(32,42,76,0.86)',
      accent: '#ffab52', danger: '#ff6b7a', winBg: '#0a0c1e',
      font: '"MS Gothic", NSimSun, SimSun, "MS Sans Serif", "Courier New", monospace'
    },
    sunset: {
      label: 'Sunset', type: 'retro', fx: 'sunset', cssClass: 'fx-retro',
      keywords: 'beach sea sun palm sunset warm ps1 retro daryā ghorub',
      // The warm one, and the only light-ish sky in the set. Deep enough
      // still that the text holds against it, because half the window is
      // banded orange.
      bg: 'rgba(40,20,44,0.56)', text: '#ffeede', sidebar: 'rgba(24,12,28,0.78)',
      elevated: 'rgba(56,28,54,0.78)', elevatedHi: 'rgba(78,40,68,0.86)',
      accent: '#ffb968', danger: '#ff6b5a', winBg: '#281430',
      font: '"MS Gothic", NSimSun, SimSun, "MS Sans Serif", "Courier New", monospace'
    },
    sandbox: {
      recommended: true,
      label: 'Sandbox', type: 'play', fx: 'sandbox', cssClass: 'fx-sandbox',
      keywords: 'sand grains desert dune play interactive mouse shen',
      // Dusk over a desert, so warm quartz has something cool to sit against.
      // Very translucent: the heap builds up behind the panels and the whole
      // point is watching it get deeper, which every point of opacity here
      // takes away.
      bg: 'rgba(14,13,18,0.50)', text: '#ece3d6', sidebar: 'rgba(9,8,12,0.72)',
      elevated: 'rgba(22,20,26,0.72)', elevatedHi: 'rgba(32,29,36,0.80)',
      accent: '#d6b274', danger: '#e2705c', winBg: '#0e0d12'
    },
    almanac: {
      label: 'Almanac', type: 'live', fx: 'almanac', cssClass: 'fx-almanac',
      keywords: 'season calendar snow leaves blossom nowruz yalda taghvim',
      // A neutral, slightly cool room — deliberately uncommitted, because the
      // season is what colours it and a palette with an opinion of its own
      // would fight whatever month it happens to be. The accent here is only
      // the winter default; fx.js rewrites it from the real date.
      bg: 'rgba(12,14,19,0.56)', text: '#e2e6ee', sidebar: 'rgba(8,10,14,0.74)',
      elevated: 'rgba(19,22,29,0.76)', elevatedHi: 'rgba(28,32,41,0.84)',
      accent: '#9fc4e8', danger: '#e8798a', winBg: '#0c0e13'
    },
    mechanical: {
      label: 'Mechanical', type: 'sound', fx: 'mechanical', cssClass: 'fx-mechanical',
      keywords: 'sound audio keyboard switch click clack seda',
      // Almost no colour and almost no motion, because the theme is the
      // sound. Warm keycap beige against a switch-plate black, and opaque —
      // there is nothing behind this one to see through to.
      bg: '#111110', text: '#e6ded0', sidebar: '#0b0b0a', elevated: '#1b1a18',
      elevatedHi: '#262421', accent: '#d8c3a0', danger: '#e0705c', winBg: '#111110'
    },
    nightvision: {
      recommended: true,
      label: 'Nightvision', type: 'machines', fx: 'nightvision', cssClass: 'fx-nightvision',
      // A tactical HUD: green leaning to blue, a signal that never quite
      // holds still. This is an effect, not a material, so — unlike its
      // VIP neighbours — the panels stay plainly translucent with no double
      // hairline, and it reads through them the way an optic overlay would.
      bg: 'rgba(4,14,12,0.58)', text: '#c9f5e6', sidebar: 'rgba(2,9,8,0.76)',
      elevated: 'rgba(6,20,17,0.76)', elevatedHi: 'rgba(10,30,25,0.84)',
      accent: '#22e6b8', danger: '#ff4d6a', winBg: '#020806'
    },
    // Smoke (letters hidden in a puff on typing, revealed as it clears) was
    // tried and pulled — never read as natural enough to keep.
    //
    // Gunfire (sound theme: shot on type, reload on Space, a heavier round on
    // Enter) is parked for now — coming back once there's real gunshot audio
    // to drive it instead of a synthesized placeholder.

    // === Added in 3.9 ===
    // Two plain palettes and eighteen runtimes. Grouped here rather than
    // scattered into the blocks above so a later reader can see at a glance
    // what arrived together.

    basalt: {
      label: 'Basalt', type: 'dark',
      keywords: 'lava rock stone volcanic basalt dark sang atashfeshan',
      // Cooled lava. The blue-black is genuinely what basalt looks like in
      // shade — it is not a neutral grey, it leans cold — and the accent is
      // the heat still down in the cracks. Nothing moves; the palette is the
      // whole theme.
      bg: '#12151a', text: '#c9ccd4', sidebar: '#0d1014', elevated: '#1b1f26',
      elevatedHi: '#242932', accent: '#c9662e', danger: '#e0605a'
    },
    vellum: {
      label: 'Vellum', type: 'light', cssClass: 'theme-light fx-vellum',
      keywords: 'paper parchment manuscript calf warm grain kaghaz pust',
      // Manuscript skin, not paper: warmer and slightly uneven, with oxblood
      // for the accent because that is what a rubricator actually had. The
      // grain is a CSS overlay, so this still costs nothing to run.
      bg: '#f2ebdc', text: '#2b2318', sidebar: '#e8dfcb', elevated: '#faf5e9',
      elevatedHi: '#ded2b8', accent: '#8c2f24', danger: '#a8322c'
    },

    cursive: {
      label: 'Cursive', type: 'reactive', fx: 'cursive', cssClass: 'fx-cursive',
      keywords: 'ink pen handwriting write stroke nib khat ghalam',
      // Ink on a dark ground, so the stroke a letter pays out reads as wet
      // and the drying is visible. Warm near-black rather than grey — this is
      // meant to feel like a desk lamp, not a screen.
      bg: '#14110d', text: '#e8dfd0', sidebar: '#0f0d09', elevated: '#1e1a14',
      elevatedHi: '#292319', accent: '#c9a86a', danger: '#d9705e', winBg: '#14110d'
    },

    tide: {
      label: 'Tide', type: 'nature', fx: 'tide', cssClass: 'fx-tide',
      keywords: 'sea ocean water wave beach moon tide darya joz madd',
      bg: 'rgba(9,20,28,0.58)', text: '#d5e6ec', sidebar: 'rgba(6,14,20,0.78)',
      elevated: 'rgba(14,28,38,0.80)', elevatedHi: 'rgba(20,40,52,0.86)',
      accent: '#6fb3c4', danger: '#e0796e', winBg: '#09141c'
    },

    scope: {
      label: 'Oscilloscope', type: 'machines', fx: 'scope', cssClass: 'fx-scope',
      keywords: 'oscilloscope crt phosphor trace lissajous wave signal moj',
      bg: 'rgba(4,10,8,0.62)', text: '#a8e6c0', sidebar: 'rgba(2,6,5,0.80)',
      elevated: 'rgba(7,16,12,0.82)', elevatedHi: 'rgba(11,25,18,0.88)',
      accent: '#3ee88a', danger: '#ff7a5c', winBg: '#040a08'
    },
    telex: {
      label: 'Telex', type: 'machines', fx: 'telex', cssClass: 'fx-telex',
      keywords: 'teleprinter tape baudot punch paper telegraph noar kaghaz',
      // Machine grey and oiled paper. The tape is the only bright thing, so
      // everything else sits back.
      bg: 'rgba(22,21,19,0.62)', text: '#d8d3c8', sidebar: 'rgba(15,14,13,0.80)',
      elevated: 'rgba(31,29,26,0.82)', elevatedHi: 'rgba(43,40,36,0.88)',
      accent: '#c2b280', danger: '#d9705e', winBg: '#161513'
    },

    lasttrain: {
      recommended: true,
      label: 'Last Train', type: 'retro', fx: 'lasttrain', cssClass: 'fx-lasttrain',
      keywords: 'train station platform night ps1 retro fog rail ghatar istgah',
      bg: 'rgba(10,12,18,0.62)', text: '#c8ccd8', sidebar: 'rgba(6,8,12,0.80)',
      elevated: 'rgba(16,19,27,0.82)', elevatedHi: 'rgba(24,28,38,0.88)',
      accent: '#e0b552', danger: '#e0685c', winBg: '#0a0c12'
    },
  snowstreet: {
    label: 'Snow Street ’97', type: 'retro', fx: 'snowstreet', cssClass: 'fx-snowstreet',
    keywords: 'ps1 playstation retro snow winter night street shop market neon city skyline lamp barf zemestan shab khiyabon maghaze shahr nostalgi',
    bg: 'rgba(10,14,24,0.60)', text: '#d5dbe6', sidebar: 'rgba(6,9,16,0.80)',
    elevated: 'rgba(16,22,36,0.82)', elevatedHi: 'rgba(26,34,52,0.88)',
    accent: '#f0b060', danger: '#e0685c', winBg: '#0a0e18'
  },

    // === Nostalgia, second set ===
    // Four more places on the same 1997 renderer. Deliberately not four more
    // cold streets: a fairground at dusk, a room indoors, a lot full of cars
    // facing a screen, and half a frame of water.

    fair: {
      recommended: true,
      label: 'Ferris Wheel', type: 'retro', fx: 'fair', cssClass: 'fx-fair',
      keywords: 'fair funfair ferris wheel carousel dusk ps1 retro shahrbazi charkh o falak',
      // Dusk, not night: the palette has to hold a warm horizon under a cold
      // sky or the whole point of the hour is lost.
      bg: 'rgba(22,17,30,0.62)', text: '#e4d6d0', sidebar: 'rgba(14,11,20,0.80)',
      elevated: 'rgba(32,24,42,0.82)', elevatedHi: 'rgba(46,34,56,0.88)',
      accent: '#e8a05c', danger: '#e0685c', winBg: '#16111e'
    },
    bedroom: {
      label: 'Bedroom', type: 'retro', fx: 'bedroom', cssClass: 'fx-bedroom',
      keywords: 'bedroom room tv television late night ps1 retro otagh televizion',
      // Everything here is lit by the television, so the palette is what a
      // room looks like with one grey-blue light in it and nothing else.
      bg: 'rgba(20,18,26,0.62)', text: '#d6d2dc', sidebar: 'rgba(13,12,18,0.80)',
      elevated: 'rgba(28,26,36,0.82)', elevatedHi: 'rgba(40,37,50,0.88)',
      accent: '#b9a6d6', danger: '#e0736b', winBg: '#14121a'
    },
    harbour: {
      label: 'Harbour', type: 'retro', fx: 'harbour', cssClass: 'fx-harbour',
      keywords: 'harbour harbor dock port ferry lighthouse water ps1 retro bandar fanoos daryaii',
      bg: 'rgba(11,17,26,0.62)', text: '#ccd6e0', sidebar: 'rgba(7,11,17,0.80)',
      elevated: 'rgba(17,25,36,0.82)', elevatedHi: 'rgba(26,36,50,0.88)',
      accent: '#7fb0c8', danger: '#e0685c', winBg: '#0b111a'
    },

    alley: {
      recommended: true,
      label: 'Alley', type: 'retro', fx: 'alley', cssClass: 'fx-alley',
      keywords: 'alley noir detective snow brick lamp street night kooche barf karagah cheragh',
      // Taken from a detective game: one warm light in a cold picture. The
      // accent is the lamp, and it is the only colour in the scene.
      // Nearly no chrome. Every other theme puts 60-80% of a panel colour over
      // the effect; here that was the whole problem — the reference has no UI
      // on it at all, so a scene copied faithfully and then covered by a
      // 62%-opaque editor is a scene nobody can see. The text stays legible
      // because it is near-white on a night street, which is the one lighting
      // condition where a bare label works.
      bg: 'rgba(10,13,26,0.14)', text: '#eef2fa', sidebar: 'rgba(6,8,17,0.34)',
      elevated: 'rgba(16,20,36,0.40)', elevatedHi: 'rgba(25,30,50,0.52)',
      accent: '#f3c775', danger: '#e08a8a', winBg: '#04060d'
    },

    cicadas: {
      label: 'Cicadas', type: 'sound', fx: 'cicadas', cssClass: 'fx-cicadas',
      keywords: 'cicada summer night insect chorus heat sound audio zanjare seda',
      bg: 'rgba(14,17,12,0.60)', text: '#dbe2d0', sidebar: 'rgba(9,11,8,0.78)',
      elevated: 'rgba(21,25,18,0.80)', elevatedHi: 'rgba(31,36,26,0.86)',
      accent: '#c3d47a', danger: '#e0846e', winBg: '#0e110c'
    },
    wind: {
      label: 'Wind', type: 'sound', fx: 'wind', cssClass: 'fx-wind',
      keywords: 'wind gale storm house gust rattle sound audio baad seda',
      bg: 'rgba(15,17,20,0.60)', text: '#d4d9de', sidebar: 'rgba(10,11,13,0.78)',
      elevated: 'rgba(22,25,29,0.80)', elevatedHi: 'rgba(33,37,43,0.86)',
      accent: '#93a8bd', danger: '#e0736b', winBg: '#0f1114'
    },
    chimes: {
      label: 'Chimes', type: 'sound', fx: 'chimes', cssClass: 'fx-chimes',
      keywords: 'chime tube bell doorway metal ring sound audio zang seda',
      bg: '#131519', text: '#dde1e6', sidebar: '#0e1013', elevated: '#1c1f24',
      elevatedHi: '#262a31', accent: '#b9c6cf', danger: '#e0736b', winBg: '#131519'
    },

    marbles: {
      label: 'Marbles', type: 'play', fx: 'marbles', cssClass: 'fx-marbles',
      keywords: 'marble glass ball roll physics play game tile',
      bg: 'rgba(16,18,22,0.60)', text: '#dbdfe6', sidebar: 'rgba(11,12,15,0.78)',
      elevated: 'rgba(23,26,31,0.80)', elevatedHi: 'rgba(34,38,45,0.86)',
      accent: '#7fb0d9', danger: '#e0736b', winBg: '#101216'
    },
    rippleink: {
      label: 'Ripple Ink', type: 'play', fx: 'rippleink', cssClass: 'fx-rippleink',
      keywords: 'marbling ebru suminagashi ink swirl stir play morakab',
      bg: 'rgba(14,13,17,0.58)', text: '#ddd8e2', sidebar: 'rgba(9,8,11,0.78)',
      elevated: 'rgba(21,19,25,0.80)', elevatedHi: 'rgba(31,28,37,0.86)',
      accent: '#9d7fd9', danger: '#e0736b', winBg: '#0e0d11'
    },
    pendulums: {
      label: 'Pendulums', type: 'play', fx: 'pendulums', cssClass: 'fx-pendulums',
      keywords: 'pendulum wave swing physics rack play avizan',
      bg: 'rgba(17,16,20,0.60)', text: '#dcd9e0', sidebar: 'rgba(11,10,13,0.78)',
      elevated: 'rgba(25,23,29,0.80)', elevatedHi: 'rgba(36,33,42,0.86)',
      accent: '#c9a86a', danger: '#e0736b', winBg: '#111014'
    },

    obsidian: {
      label: 'Obsidian', type: 'luxury', fx: 'obsidian', cssClass: 'fx-obsidian vip-suite',
      keywords: 'obsidian glass volcanic black fracture sheen luxury sang siah',
      // Black on black. The fractures are the only thing with a value, and
      // they are cold — obsidian catches a blue-white, never a warm light.
      bg: 'rgba(7,8,10,0.66)', text: '#d4d8de', sidebar: 'rgba(4,5,6,0.82)',
      elevated: 'rgba(12,14,17,0.84)', elevatedHi: 'rgba(19,22,26,0.90)',
      accent: '#8fa3b8', danger: '#d9685e', winBg: '#07080a'
    },
    nacre: {
      label: 'Nacre', type: 'luxury', fx: 'nacre', cssClass: 'fx-nacre vip-suite theme-light',
      keywords: 'nacre pearl shell iridescent mother of pearl luxury sadaf',
      // Pale and cool so the interference colours have somewhere to land. A
      // saturated palette here would fight the only thing the theme does.
      bg: 'rgba(232,236,238,0.70)', text: '#26303a', sidebar: 'rgba(216,224,228,0.82)',
      elevated: 'rgba(244,247,248,0.86)', elevatedHi: 'rgba(206,218,224,0.90)',
      accent: '#6d7f96', danger: '#b8443c', winBg: '#e8ecee'
    },
  };

  // Every stack ends in a Persian-capable fallback. The display faces below are
  // Latin-only, and a font falls back per *character*, not per family — without
  // this a mixed note renders its Persian in whatever the browser picks, which
  // is rarely the same size or weight as the Latin around it.
  const FA = '"Vazir", "Vazirmatn", "Segoe UI", Tahoma, "Geeza Pro"';

  const FONTS = {
    // ── Monospace: what a prompt is usually written in.
    cascadia: { label: 'Cascadia',  stack: '"Cascadia Code", "Cascadia Mono", Consolas, ' + FA + ', ui-monospace, monospace' },
    consolas: { label: 'Consolas',  stack: 'Consolas, "Cascadia Code", ' + FA + ', ui-monospace, monospace' },
    jetbrains:{ label: 'JetBrains', stack: '"JetBrains Mono", "Fira Code", "IBM Plex Mono", Consolas, ' + FA + ', ui-monospace, monospace' },
    lucida:   { label: 'Lucida',    stack: '"Lucida Console", "Lucida Sans Typewriter", Consolas, ' + FA + ', monospace' },
    courier:  { label: 'Courier',   stack: '"Courier New", Courier, ' + FA + ', monospace' },
    system:   { label: 'System UI', stack: '"Segoe UI", Inter, system-ui, ' + FA + ', sans-serif' },

    // ── Serif. Prose reads differently in a serif, and a prompt is prose.
    // Sitka was drawn by Matthew Carter specifically for reading on screen;
    // it is the one on this list worth trying first.
    sitka:    { label: 'Sitka',     stack: '"Sitka Text", Sitka, "Iowan Old Style", Palatino, Georgia, ' + FA + ', serif' },
    cambria:  { label: 'Cambria',   stack: 'Cambria, "Palatino Linotype", Palatino, Georgia, ' + FA + ', serif' },
    constantia: { label: 'Constantia', stack: 'Constantia, "Iowan Old Style", Georgia, ' + FA + ', serif' },

    // ── Humanist sans: softer than Segoe, with actual stroke character.
    candara:  { label: 'Candara',   stack: 'Candara, Optima, "Avenir Next", "Segoe UI", ' + FA + ', sans-serif' },
    corbel:   { label: 'Corbel',    stack: 'Corbel, "Avenir Next", "Segoe UI", ' + FA + ', sans-serif' },
    // DIN-descended and slightly condensed — fits more line on a narrow window,
    // which is the shape this app usually lives in.
    bahnschrift: { label: 'Bahnschrift', stack: 'Bahnschrift, "Avenir Next Condensed", "Helvetica Neue", "Segoe UI", ' + FA + ', sans-serif' },

    // ── Handwritten. Not for a long document; very good for a scratch note,
    // which is what half the tabs in this app are.
    ink:      { label: 'Ink Free',  stack: '"Ink Free", "Bradley Hand", "Marker Felt", "Segoe Print", ' + FA + ', cursive' },
    script:   { label: 'Script',    stack: '"Segoe Script", "Snell Roundhand", "Apple Chancery", "Ink Free", ' + FA + ', cursive' }
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
