# ARCO

A guitar for a phone held sideways. Live at `/arco/`.

No samples anywhere. The six strings are digital waveguides running in an
AudioWorklet, so they really vibrate, and hammer-ons, slides, bends and palm
mutes come out of the physics instead of being faked.

## The neck

The default layout is a guitar neck across the screen. The frets are on the
left, and the strings carry on into a body on the right. A guitarist already
knows the whole vocabulary, so nothing here needs a manual, and nothing is
off-limits: every fret of every string plays, in the key or not.

```
 ┌──┬─────┬─────┬─────┬─────┬─────┬──────────────┬─────┐
 │ e│     │     │     │     │     │              │ ////│
 │ B│     │     │     │     │     │    body      │ ////│
 │ G│     │  ●  │     │  ●  │     │  pick, strum │ mute│
 │ D│     │     │     │     │     │              │ ////│
 │ A│     │     │     │     │     │              │ ////│
 │ E│     │     │     │     │     │              │ ////│
 └──┴─────┴─────┴─────┴─────┴─────┴──────────────┴─────┘
  0    1     2     3     4     5    (drag the numbers to move up the neck)
```

### Fretting hand

- **The highest fret held on a string is the note**, as on a real neck. That
  one rule gives you everything else:
- **Hammer-on**: hold a fret and tap a higher one on the same string.
- **Pull-off**: lift the higher one again.
- **Slide**: move along the string. The pitch steps through the frets like a
  real slide does.
- **Bend**: push across the string. The note only goes up, whichever way you
  push, and one string's width is a whole step. Rocking it is vibrato.
- **Lift** to stop the string. **Flick off**, still moving as you leave, and
  it becomes a pull-off to the open string instead.
- The **open strings** sit in a column behind the nut. The column stays there
  wherever the window is on the neck, since open strings turn up in half of
  all riffs.

### Tap

With **tap** on (the default), a fret sounds the moment it is pressed, the
way two-handed tapping does. A riff then needs only one hand. That matters,
because the hard part of playing a phone is not the notes. It is timing two
thumbs against each other on glass that gives no feedback. With tap off, the
neck only stops the strings and the body makes the sound, as on a guitar.

### The body

- **Tap** a string to pick it, **sweep** across the strings to strum, and a
  quick **back-and-forth** on one string is tremolo picking.
- **Where** you pick sets the tone: round near the neck, bright and twangy
  near the bridge.
- The hatched strip at the bridge is a **palm mute**. The attack stays and the
  ring goes, so it is where chugs live.
- A strum skips the strings below your lowest fretted note, the way a chord is
  voiced from its root. Picking one of those strings on purpose still plays
  it, which is how pedal-tone riffs work.

### Shapes: what one finger holds

| shape | holds |
| --- | --- |
| **note** | one string, one fret |
| **power** | root, fifth and octave on the next two strings |
| **oct** | root and its octave two strings up, the string between muted |
| **chord** | the chord the key builds on that root, so it is minor on ii and major on V |

Shapes are worked out from the tuning rather than memorised, so they are
correct in drop and open tunings too. In Drop D, a power chord on the low
string sits on a single fret across three strings, which is the one-finger
shape that tuning exists for. The strings a
shape keeps quiet get an **x** at the nut, like on a chord chart, and nothing
sounds them. Sliding a held shape moves the whole chord.

The power chord includes the octave on purpose. A phone speaker cannot
reproduce a low E at all, and the octave is what lets it still say where the
root is.

### The rest

- **Key and mode** mark their scale on the neck, numbered from the root (in
  teal). They mark but never restrict, and they are what the chord shape
  builds from.
- **Setup** has the tuning (standard, drop D, half and whole step down, drop
  C, open G, open D, DADGAD), how many frets show at once, tab view (low E at
  the bottom, the default) or player view, and a **left-handed** mirror.
- **Bow** turns the body into a bow: moving along a string bows it, and the
  note lasts only while you keep moving.
- **Tilt**, when switched on, moves the tone between warm and bright, and
  tipping the phone forward and back bends every string together like a
  whammy bar.

## The arcs

ARCO's original layout is still one tap away in Setup. The left thumb sweeps a
fan of scale degrees: angle picks the degree, reaching further out jumps an
octave, and a small wiggle bends. The right thumb picks or bows four strings
that always voice the chord of that degree. The fan is laid out in degrees,
not note names, so a melody is the same thumb motion in every key. **7th**,
**latch** and **diatonic** belong to this layout.

## Learning

**learn** lines up a melody's notes at the top. On the neck the next note
pulses wherever it can be played in the current window, and any octave counts.
Finish, press **new key**, and find it again.

## Desktop

`A W S E D F T G Y H U J` play the key's degrees (on the neck, at the nearest
place in the window), `Z`/`X` change octave, `space` strums, `1`–`6` pick a
string by guitar numbering (1 is the high e), and the arrows move up and down
the neck. The mouse plays the neck too.

## Fullscreen, installing, updates

- **Double-tap the portrait screen** to go fullscreen and rotate in one
  gesture. This is bound to the portrait overlay only, never to the playing
  surface, because a fast repeated tap there is tremolo picking.
- **The fullscreen button** works at any time.
- **Install it** to launch fullscreen in landscape with no browser chrome. It
  plays with no network, since the strings are synthesised on the device.
  iPhone Safari has neither the Fullscreen API nor orientation lock, so there
  installing is the only real route to fullscreen, and the UI says so.
- **Updates** never swap themselves in mid-song. A new build installs and
  waits. A one-line bar offers it, and Setup shows the version with a manual
  check. This is the same `"skip-waiting"` handover as every other app here.
  `window.ARCO_VERSION` in `index.html` and `VERSION` in `sw.js` are one
  number, and bumping both is what publishes an update.

## Files

| file | what it does |
| --- | --- |
| `js/theory.js` | degrees, modes, voicings, chord and roman-numeral naming, all relative to the tonic |
| `js/dsp-worklet.js` | six waveguide strings; noise-burst pluck, palm mute and Smith/STK bow friction share one string model |
| `js/engine.js` | audio graph, body resonators, reverb, instrument presets |
| `js/input.js` | pointers, sensors and keyboard; the arc layout's geometry; switches layouts |
| `js/neck.js` | the neck: tunings, frets, shapes, hammer-ons, pull-offs, bends, picking, the position rail |
| `js/render.js` | canvas and sizing; draws the arcs |
| `js/fretboard.js` | draws the neck: cached board and scale layers, live strings, fingers |
| `js/info.js` | the info sheet behind every (i), lifted from RouteCast |
| `js/update.js` | notices and offers a new version, lifted from RouteCast |
| `js/shell.js` | fullscreen, orientation lock, install prompt, service worker |
| `js/app.js` | toolbar, Setup, remembered settings, trainer, frame loop |
| `sw.js` | caches the whole shell so it plays offline |
| `tools/validate.js` | `node tools/validate.js`: static checks, and the neck's behaviour against a fake engine |

Needs AudioWorklet. Tilt needs HTTPS, and iOS asks permission the first time.
Installing and the service worker need HTTPS too, so both are inert on
`file://` and active on the deployed site.
