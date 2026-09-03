# PromptPad theme prompt

Paste everything between the two lines into arena.ai (or any model), fill in
the **BRIEF** block at the bottom, and send. Everything above the brief is
fixed — it is the contract the code has to meet — so you only ever edit the
last part.

Written so a model with no access to the repository can still produce code
that drops straight in. The rules near the end are not style preferences; each
one is something that has already gone wrong in this app at least once.

---8<--- copy from here ---8<---

You are writing a **theme** for PromptPad, an Electron always-on-top notepad
for drafting AI prompts. A theme is two pieces of code plus a few lines of CSS.
I will paste your output straight into the project, so it has to compile and
follow the contract exactly. Do not restructure the app, do not add libraries,
do not use TypeScript or JSX. Plain ES2020 in the style described below.

## 1. The palette entry

Goes in `src/themes.js`, inside the `THEMES` object.

```js
  mytheme: {
    label: 'My Theme', type: 'nature', fx: 'mytheme', cssClass: 'fx-mytheme',
    keywords: 'searchable words, english and finglish',
    bg: 'rgba(11,17,26,0.62)', text: '#ccd6e0', sidebar: 'rgba(7,11,17,0.80)',
    elevated: 'rgba(17,25,36,0.82)', elevatedHi: 'rgba(26,36,50,0.88)',
    accent: '#7fb0c8', danger: '#e0685c', winBg: '#0b111a'
  },
```

- `type` is one of: `dark`, `light`, `reactive` (answers the keyboard),
  `nature`, `machines`, `retro` (a place drawn on 1997 hardware), `live`
  (reads the real clock or the speakers), `sound` (you hear it), `play` (you
  can push it around with the cursor), `luxury` (rendered as a material).
- `fx` is the runtime's name. Omit `fx` and `cssClass` for a plain palette
  with no animation.
- **If the effect draws behind the window, the panel colours must carry
  alpha** (`rgba(...)`) or the effect is invisible under them. `winBg` is the
  opaque colour behind everything and never has alpha.
- A light theme adds `theme-light` to `cssClass`.

## 2. The runtime

Goes in `src/fx.js`. Shape:

```js
  // ──────────────────────────────────────────────────────────────────────
  // My Theme — one sentence on what it is, then a paragraph on the one
  // idea that makes it work and why it is done this way and not the
  // obvious way.
  // ──────────────────────────────────────────────────────────────────────
  RUNTIMES.mytheme = {
    start() {
      const b = back();               // or layer(), see below
      if (!b) return;
      const c = makeCanvas(b, 'fx-mytheme-canvas');
      const ctx = c.ctx;

      const resize = () => { c.resize(); /* rebuild anything size-derived */ };
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        /* react to typing */
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        ctx.clearRect(0, 0, c.w, c.h);
        /* draw */
        rafId = requestAnimationFrame(tick);      // assign to rafId, always
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
      // closeAudio();   ← only if the theme made a sound
    }
  };
```

`stop()` must leave the DOM exactly as it found it. Every listener added in
`start()` comes off in `stop()`.

## 3. What you can call

Already defined in the file. Use them; do not redefine them.

**Layers**
- `back()` — the element *behind* the app. Panels sit on top, so use it for
  scenery. Needs an alpha palette.
- `layer()` — *over* the app, pointer-events none. Use it for things that
  must be in front of the text.
- `rafId` — module-level. Assign your `requestAnimationFrame` handle to it.
- `stopRaf()` — cancels it.

**Canvas**
- `makeCanvas(parent, className, scale)` → `{ canvas, ctx, w, h, resize() }`.
  `w`/`h` are CSS pixels; `scale` (optional, e.g. `1/3`) gives a smaller
  backing store stretched back up.
- `caretRect()` → `{ x, top, bottom, ... }` or `null`. Where the caret is on
  screen. Use it for anything that should happen where the user is writing.
- `editorTextStyle()` → `{ font, color }` — the editor's own font and colour.

**Low-resolution renderer** (for `retro` scenes; run these at 15fps)
- `makeRetro(parent, cellPx)` → an object with:
  - `W`, `H` — the buffer size in cells; `resize()`
  - `px(x, y, [r,g,b])` — one opaque cell
  - `blend(x, y, [r,g,b], a)` — one cell blended over what is there. **Light
    is always blend, never stipple.**
  - `rect(x, y, w, h, c)`
  - `vgrad(y0, y1, ramp, curve)` — a vertical gradient quantised to `ramp`
    (an array of colours) and ordered-dithered between the steps.
  - `stipple(x, y, w, h, c, cover)` — a dithered wash. For fog, smoke, dust —
    never for a lamp.
  - `hash(x, y)` → 0..1, deterministic. Use it for anything that must be in
    the same place every frame.
  - `flush()` — pushes the buffer to the canvas. Call once per frame, last.

**Sound** (only for `type: 'sound'`, and call `closeAudio()` in `stop()`)
- `audio()` → AudioContext or null. `setVolume(v)`, `closeAudio()`.
- `noiseBuf` — one second of white noise. `masterGain` — connect to this.
- `click(freq, q, gain, decay, at)` — a filtered noise burst.
- `thock(freq, gain, decay, at)` — a dull body hit.
- `metalHit(f0, gain, decay, at)` — struck metal (inharmonic partials).
- `impact(gain, decay, at)`, `scrape(dur, gain, at)`, `pluck(freq, gain, decay, at)`
- `noiseBed({ type, freq, q, gain })` → `{ gain, filter, set(v, over), stop() }`
  — a looping filtered noise layer.
- `playSample(name, gain, rate)` / `sampleBed(name, gain)` — use a real
  recording from `src/sounds/` if one is there; both return false/null when
  it is absent, so always have a synthesised fallback.

**Window motion**
- `onShove(fn)` → returns an unsubscribe. `fn(dx, dy)` is called with the
  window's drag velocity in px per 60Hz frame. Call the unsubscribe in
  `stop()`. Use it if the theme models something physical.

## 4. The CSS

One rule per canvas, appended to `src/styles.css`:

```css
.fx-mytheme-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
```

If the theme also needs to restyle the app chrome, `cssClass` is applied to
`.app`, so `.app.fx-mytheme .editor-area { … }` works.

## 5. Hard constraints

- **Content Security Policy**: no `data:` URIs, no external images, fonts or
  scripts. Everything is drawn in canvas or CSS gradients. An SVG background
  as a `data:` URI will silently not load.
- No `innerHTML` with anything but literal strings you wrote.
- No libraries, no imports, no build step. One file, plain functions.
- Never throw inside the animation tick. `requestAnimationFrame` is at the
  *end* of the tick, so one exception stops the theme permanently and looks
  like a blank window, not like a crash. Clamp indices; skip bad values.
- On resize, **carry state across**. Dragging a window edge fires resize
  continuously; rebuilding the scene each time makes it restart forty times
  during one drag. Scale existing positions into the new size instead.

## 6. Craft rules

Each of these is a mistake this app has already made.

- **Light is blended, not stippled.** A stippled cone puts a third of its
  pixels at full lamp colour and comes out as a hard triangle. A lit area is
  dim light over the whole area.
- **A lit window is a rectangle with a soft halo, not a bright dot.** One
  pixel is a star; a 1×2 block with a squashed falloff around it is a room
  with somebody in it.
- **Snow, sand and road at night are not white.** They are dark blue. They
  are white *only where a light reaches them* — and that contrast is the
  whole picture.
- **The middle of the window is the only clear space.** The note list covers
  roughly the left 20% and the placeholder panel the right 26%. Put the
  subject between them or half of it will be behind a panel.
- **The top of the window is behind the note text.** Keep anything with
  detail below about 30% height.
- **A silhouette needs a shape.** A skyline built from a sine is a hill;
  built from `hash` per block it is a row of buildings. Conifers come to
  points. Rectangles read as a town.
- **Retro scenes run at 15 frames a second** (`if (now < nextFrame) { rafId =
  requestAnimationFrame(tick); return; } nextFrame = now + 1000 / 15;`). That
  is the look; 60fps reads as modern.
- **Motion needs a cause.** A thing that translates without rotating reads as
  a sprite being dragged. A leaf tumbles; a gondola stays level while the
  wheel turns; a branch bends more at the tip than at the root.
- **Density matters more than brightness.** One particle per 200 cells reads
  as weather; one per 100 reads as static.

## 7. What to give me back

**One self-contained HTML page**, so I can watch the theme run before I paste
anything into the app. It must have two parts.

**Part one — a live preview.** A mock PromptPad window: a title bar, a
narrow list rail down the left, a note with a few lines of text in it, a
status bar along the bottom, all painted from the palette you chose, with the
effect running behind or in front of it exactly as it would in the app. Size
it about 880×600. Simulate typing on a timer so anything keyboard-driven can
be seen without me touching it.

To make that page stand alone, write a small throwaway shim for the helpers in
section 3 — `back()`, `layer()`, `makeCanvas`, `makeRetro`, `caretRect`,
`rafId`, `stopRaf`, and no-op stubs for the audio functions. Their exact
semantics are all specified above, so match them. **The shim is disposable and
I will delete it. The runtime must be written against the real API, not
against your shim** — if the two ever disagree, the real API wins.

**Part two — the code to keep**, below the preview, inside a `<pre>` I can
select and copy in one go:

1. The `themes.js` entry.
2. The complete `RUNTIMES.<name>` block, ready to paste — including the
   banner comment explaining the idea.
3. The CSS lines.

Do not minify, do not strip the comments, and do not fold the three into one
blob — I paste them into three different files.

Comment the code the way the samples above are commented: say **why**, not
what. A comment that restates the line is noise; a comment explaining why the
obvious approach was rejected is worth keeping.

If the page will not run for any reason, say so at the top rather than
shipping something that renders blank.

If any part of my brief is impossible under these constraints, say so in one
line and build the nearest thing that is possible — do not silently drop it.

## BRIEF — what I want

<!-- Write here, in English or Persian. Say what the place or the idea is,
     what should move, and what typing should do. Anything you leave out, you
     are handing to the model to decide.

     Example of a good brief:

       A rooftop at night in summer. Air-conditioning units, a water tank,
       washing lines, the glow of the city below the parapet. Warm, not cold.
       Typing should make the lights in the buildings behind flicker on one
       at a time. Category: retro. Name it "Rooftop".
-->

---8<--- copy to here ---8<---
