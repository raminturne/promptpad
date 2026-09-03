// Ports the app's Pro-theme effect engine into the landing page's live demo.
//
// The site's theme playground runs the REAL fx.js from the desktop app rather
// than a re-creation, so the effects on the page are exactly the ones you get
// after installing. Keeping that honest means re-running this whenever the app
// gains or changes an effect:
//
//     node tools/port-fx-to-site.js    (from the app repo root)
//
// Override either end if your checkouts live elsewhere:
//     PROMPTPAD_SRC=... PROMPTPAD_SITE=... node tools/port-fx-to-site.js
//
// Only three things have to change, and all of them are the same idea: the app
// draws into the whole OS window, the site draws into one card.
//
//   1. canvas sizing   window.innerWidth/Height -> the demo container's box
//   2. CSS variables   documentElement.style    -> the demo container's style,
//                      so an effect that animates --accent (Aurora, Music)
//                      recolours the mock app and not the entire website
//   3. caret geometry   viewport coords          -> container-relative coords
//
// Everything else — every runtime, every constant, every comment — is carried
// over untouched.
const fs = require('fs');
const path = require('path');

const APP = process.env.PROMPTPAD_SRC || path.join(__dirname, '..', 'src');
const HERE = process.env.PROMPTPAD_SITE ||
  'E:/Claude Code/Website/RaminTurne.ir/promptpad';

function read(f) {
  const p = path.join(APP, f);
  if (!fs.existsSync(p)) {
    console.error('Cannot find ' + p + '\nSet PROMPTPAD_SRC to the app\'s src/ folder.');
    process.exit(1);
  }
  // The app repo checks out with CRLF on Windows; normalise so the patterns
  // below don't have to care which machine ran the port.
  return fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
}

const HEADER = (name) =>
  '/* ' + name + ' — ported from the PromptPad desktop app by\n' +
  '   tools/port-fx-to-site.js in that app\'s repo.\n' +
  '   Do not edit by hand: re-run the script instead, or the next port silently\n' +
  '   reverts your change. See that file for what the port rewrites and why. */\n';

// ---------- themes.js: pure data, carried over verbatim ----------
fs.writeFileSync(path.join(HERE, 'js/pp-themes.js'), HEADER('pp-themes.js') + read('themes.js'));

// ---------- fx.js: three scoped rewrites ----------
let fx = read('fx.js');
const before = fx;
let applied = { size: 0, vars: 0 };

// The container every effect lives inside. Resolved lazily: the demo markup is
// only built when the section scrolls into view.
const SHIM = `
  // --- site port -------------------------------------------------------
  // In the app these effects fill the OS window. Here they fill one card, so
  // every measurement is taken from that card instead.
  const fxRoot = () => document.getElementById('fxDemo') || document.documentElement;
  const fxW = () => { const r = fxRoot(); return r.clientWidth || 1; };
  const fxH = () => { const r = fxRoot(); return r.clientHeight || 1; };
  const fxVars = () => fxRoot().style;
  // ---------------------------------------------------------------------
`;
fx = fx.replace(/(\(function \(\) \{\n)(  const RUNTIMES = \{\};)/, '$1' + SHIM + '$2');
if (!/const fxRoot =/.test(fx)) { console.error('port: could not insert the shim'); process.exit(1); }

fx = fx.replace(/window\.innerWidth/g, () => { applied.size++; return 'fxW()'; });
fx = fx.replace(/window\.innerHeight/g, () => { applied.size++; return 'fxH()'; });
fx = fx.replace(/document\.documentElement\.style/g, () => { applied.vars++; return 'fxVars()'; });

// caretRect() returns viewport coordinates; the canvases are positioned inside
// the card, so every caret-following effect (the candle, wounds, circuit) would
// aim at an offset ghost of the real caret without this.
const CARET_FIX = `      const __b = fxRoot().getBoundingClientRect();
      const top = r.top - __b.top;
      const __left = r.left - __b.left;`;
const CARET_SRC = `      const top = r.top;`;
if (fx.indexOf(CARET_SRC) < 0) { console.error('port: caret hook not found'); process.exit(1); }
fx = fx.replace(CARET_SRC, CARET_FIX);
fx = fx.replace(
  `        x: r.left + width / 2, y: top + h / 2,
        top, bottom: top + h, left: r.left, right: r.left + width`,
  `        x: __left + width / 2, y: top + h / 2,
        top, bottom: top + h, left: __left, right: __left + width`
);

if (fx === before) { console.error('port: nothing changed — did the app source move?'); process.exit(1); }
fs.writeFileSync(path.join(HERE, 'js/pp-fx.js'), HEADER('pp-fx.js') + fx);

// ---------- the Pro-theme CSS ----------
// Split the stylesheet into top-level rules by brace depth (a regex can't do
// this: @keyframes and @media nest), then keep only the ones a Pro theme needs.
function topLevelRules(css) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') { depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1; }
    }
  }
  return out.filter(Boolean);
}

const css = read('styles.css');
const rules = topLevelRules(css).filter((r) => {
  const sel = r.slice(0, r.indexOf('{'));
  return /\bfx-/.test(sel) || /@keyframes\s+fx-/.test(sel);
});

const scoped = rules.map((r) => r
  // The app's layers cover the OS window; the demo's cover the card.
  .replace(/position:\s*fixed/g, 'position: absolute')
  // `body:has(.app.fx-x)` paints the page behind a translucent app. On the site
  // that would repaint the whole landing page, so it lands on the card instead.
  .replace(/\bbody:has\(/g, '#fxDemo:has(')
);

fs.writeFileSync(path.join(HERE, 'css/pp-fx.css'),
  HEADER('pp-fx.css').replace(/^\/\* /, '/* ') +
  '\n/* Scoped to #fxDemo: `position: fixed` becomes `absolute` and every\n' +
  '   `body:has(...)` becomes `#fxDemo:has(...)`, so an effect that paints the\n' +
  '   page behind a translucent window paints the demo card instead. */\n\n' +
  scoped.join('\n\n') + '\n');

console.log('ported pp-themes.js, pp-fx.js and pp-fx.css');
console.log('  canvas sizing rewrites : ' + applied.size);
console.log('  css variable rewrites  : ' + applied.vars);
console.log('  caret geometry         : container-relative');
console.log('  css rules scoped       : ' + scoped.length);
