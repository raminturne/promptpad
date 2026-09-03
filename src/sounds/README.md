# Sounds

The sound themes look here first and fall back to their built-in synthesis
when a file is missing. Nothing to configure — drop a file in with the right
name and it is used from the next launch.

| File | Used by | Notes |
|---|---|---|
| `rain` | Downpour | looped continuously |
| `thunder` | Downpour | one roll, played occasionally |
| `fire` | Hearth | looped continuously |
| `key1` … `key12` | Mechanical, Typewriter | one keystroke each, picked at random; as few as one, up to twelve |
| `space` | Mechanical, Typewriter | the spacebar |
| `enter` | Mechanical, Typewriter | the return key |
| `back` | Typewriter | backspace |

`.ogg`, `.mp3` and `.wav` are all accepted, tried in that order, so `rain.ogg`
wins over `rain.wav` if both are present.

## What is in here now

**The keystrokes are real recordings.** `key1` … `key12`, `space`, `enter` and
`back` were cut out of two public-domain recordings of somebody typing, from
Wikimedia Commons:

* [Typing fast.ogg](https://commons.wikimedia.org/wiki/File:Typing_fast.ogg) — public domain
* [Typing medium speed.ogg](https://commons.wikimedia.org/wiki/File:Typing_medium_speed.ogg) — public domain

Public domain, so there is nothing to attribute and nothing to comply with —
which is why these two and not the better-sounding mechanical-keyboard
recording on the same site, which is CC BY and would put an attribution
obligation on the app.

Regenerate them with:

    npx electron tools/make-key-samples.js

That script downloads both recordings, finds every strike in them by onset
detection, cuts each one from just before its attack to the end of its decay,
normalises it, and picks fifteen. Space and Return are the two *dullest*
strikes it finds — the big keys are the low ones — and Backspace is the
brightest. The rest are spread across the whole recording rather than taken
from one word, because twelve consecutive keys of one sentence all sound the
same and the point of having twelve is that they do not.

**`rain`, `fire` and `thunder` are still synthesised**, rendered offline by
`tools/make-sounds.js`, which can afford far more detail than the realtime
engine: the rain loop is twenty seconds carrying four thousand separate
droplet impacts. Regenerate them with:

    node tools/make-sounds.js

## Replacing them with real recordings

Save over the file with the same base name and the theme picks it up. If you
add `rain.ogg` next to an existing `rain.wav`, the `.ogg` wins; delete the one
you do not want to avoid confusion.

Two things to get right:

**Loops must actually loop.** `rain` and `fire` play end-to-end forever, so
any level difference or waveform step between the last sample and the first is
a tick you will hear once a lap. Cut on a zero crossing and match the level at
both ends. The generator handles this by rendering an overrun and folding it
back over the head with an equal-power crossfade, so the first sample and the
last are adjacent in the source — worth doing the same by hand in an editor if
you are cutting from a longer take.

**Keystrokes should not all be identical.** Two matching presses in a row is
what gives a synthetic keyboard away, well before the timbre does. Record a
handful of different keys rather than one key twelve times; the app already
adds a little pitch variation on top.

Mono is fine and halves the size. Ogg Vorbis at `-q:a 6` is a good default for
the long beds and preserves the loop exactly (Ogg carries a sample-accurate
granule position, so the decoder returns precisely the samples that went in).
Keep short transients like keystrokes lossless — they are only a few KB, and a
5ms attack is the one thing a transform codec smears.
