# ARCO

A two-thumb instrument for a phone held sideways. Live at `/arco/`.

No samples anywhere — the four strings are digital waveguides running in an
AudioWorklet, so they are genuinely vibrating and bends, slides, double stops
and sympathetic decay fall out of the physics rather than being faked.

## The idea

Most phone instruments shrink a piano or a fretboard onto glass. You get an
octave and a half of unplayable slivers, no expression, and a layout whose note
names change the moment you change key. ARCO starts from two different premises.

**Discrete input is touch, continuous input is sensors.** A thumb is precise and
instant, so thumbs choose the notes. Tilt is coarse and drifts, so tilt only
shapes a note that a thumb already chose — contact point, brightness, bend. Most
sensor instruments get this backwards, which is why they are fun for a minute
and unplayable forever.

**Pitch is relative, not absolute.** The fingerboard is laid out in scale
degrees, not note names. `sol sol la sol do' ti` is Happy Birthday in every key,
with identical thumb motion. Learning a melody once means learning it in all
twelve keys, which is the only honest route to "master it and you can play
anything."

## How it is held

Landscape, both hands wrapped around the phone, fingers behind, one thumb per
bottom corner. Each thumb pivots at its corner, so both control surfaces are
arcs struck from those corners — matching the arc a thumb actually sweeps
rather than fighting it.

### Left thumb — the fingerboard

- **Angle** picks the scale degree. Diatonic degrees get wide wedges; chromatic
  ones get narrow slivers between them, the same white-key/black-key economy a
  piano uses, rotated into a fan and made relative to the tonic. *Diatonic lock*
  removes the slivers entirely and expands the seven remaining wedges.
- **Radius** picks the octave — three rings, so three octaves under one thumb.
- **Micro-movement inside a wedge** bends the pitch. The reference angle is
  captured on touch-down, so wherever you land is in tune and wiggling from
  there is vibrato. Wedges are sticky, so a resting thumb never flickers.

### Right thumb — the bow / picking hand

- **Radius** picks which of the four strings you are on. The innermost lane,
  where a relaxed thumb sits, is the melody voice; reaching outward adds the
  chord underneath it.
- **Motion** is what makes sound. In Pluck mode, crossing a string plucks it, so
  a slow sweep genuinely arpeggiates and a fast one strums; reversing direction
  on one lane is tremolo picking. In Bow mode the thumb *is* the bow — sound
  lives only while it keeps moving, and stopping stops the note.

### Tilt (optional)

Rolling the phone slides the contact point between over-the-neck and
up-against-the-bridge; tipping it forward and back bends. Tapping the back of
the phone strikes the body. Tilt never selects a pitch.

## Chords

The four strings are always a voicing of whatever degree the left thumb holds,
stacked bass to treble: root, third, fifth, and the degree itself an octave up.
Because the stack is built from the current mode, quality is automatic — `ii` is
minor, `V` is major, `vii°` is diminished, for free, in any key.

- **7th** swaps the fifth for the seventh, giving a root–third–seventh shell
  that stays clear on a phone speaker where a close four-note triad turns to mud.
- **Latch** freezes the chord under the lower three strings while the melody
  string keeps following the left thumb — comp underneath, tune on top, which is
  how you accompany yourself with only two thumbs.

## Learning

**learn** overlays a melody as a row of solfège targets and pulses the wedge to
aim for. Finish one, then hit **↻ new key**: the key changes and the shapes do
not move. That is the whole argument for the instrument, made in about fifteen
seconds.

## Desktop

`A W S E D F T G Y H U J` are the twelve degrees (the tracker/piano row, mapped
to degrees rather than notes), `Z`/`X` shift octave, `space` strums, `1`–`4`
pick one string.

## Files

| file | what it does |
| --- | --- |
| `js/theory.js` | degrees, modes, voicings, chord and roman-numeral naming — all relative to the tonic |
| `js/dsp-worklet.js` | four waveguide strings; noise-burst pluck and Smith/STK bow friction share one string model |
| `js/engine.js` | audio graph, body resonators, reverb, instrument presets |
| `js/input.js` | arc geometry, thumbs, sensors, keyboard |
| `js/render.js` | canvas: the fan, the strings, the readouts |
| `js/app.js` | toolbar, trainer, frame loop |

Needs AudioWorklet. Tilt needs HTTPS, and iOS asks permission on first use.
