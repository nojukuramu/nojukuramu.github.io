# BURST//DUMP

Drop in a folder of photos and a song. BURST//DUMP reads the song's beats, bars,
melody and sections on the device, cuts a photo-dump reel to them in a mix of sixteen
layouts, and exports an MP4. Plain HTML, CSS and JavaScript, no build step, works
offline once loaded, and nothing is uploaded anywhere.

## Using it

1. **Photos**: pick a folder (or photos from the library on a phone), or drop one anywhere.
   Up to 1,000; they are shrunk on load to fit a memory budget scaled to the device.
2. **Music**: add a song. The rhythm switches to *follow the song*; the strip under the
   stage shows the song's sections, beats, melody line and where every cut lands. Drag
   it, or tap a part in the song map, to choose where the reel starts.
3. **Edit** and **Look**: rhythm, length, style mix, chaos, seed; aspect, effects, pulse.
4. **Export**: an MP4, saved and, on a phone, ready to share.

Keys: `Space` play · `R` reroll · `F` full screen · `←` `→` a second · `E` export.

## Rhythms

| Rhythm | Where the cuts go |
|--------|-------------------|
| **Follow the song** | On the beat grid, denser where the song is louder: bars in the intro, eighths in the chorus, a roll on the fill into it. |
| **On the beat** | Evenly on beats or their halves and quarters, whichever fits; with no song, at a typed or tapped BPM. |
| **On the melody** | Where the lead line starts a new note. |
| **On the drums** | On kicks and snares. |
| Accelerate, decelerate, steady, bursts, random | Ignore the music. |

All four music rhythms are the same procedure (`js/timeline.js`): build a grid of candidate
times from the tracked beats (bar, beat, eighth, sixteenth, ...), score each candidate by
grid level, the section's energy, and any drum hit or melody note on it, then keep the
best N at least 30 ms apart. Taking the top N of one ranking is what makes the cut density
follow the song while every cut stays on the grid.

**Let the song decide** makes the length an output: the whole song from the start point,
up to twice as dense with surplus photos (then an even sample), ending early on a bar
line when there are far too few.

## How the song is read

In a Web Worker (`js/analysis-worker.js`), so the preview never stalls, in two steps:
rhythm and structure first (a few seconds), then the melody, which refines the edit
when it arrives.

| What | How |
|------|-----|
| Beats, tempo | **Essentia.js** `RhythmExtractor2013` (degara), on the 44.1 kHz signal |
| Melody, notes | **Essentia.js** `PredominantPitchMelodia` behind `EqualLoudness`, segmented by `PitchContourSegmentation` |
| Bars | `js/mir.js`: the beat phase where low-end hits and chord changes agree (4/4) |
| Drum hits | SuperFlux-style spectral flux on a log-mel spectrogram, called kick, snare or hat by band |
| Sections | Bar-synchronous chroma, MFCC and loudness; a self-similarity matrix; Foote's checkerboard novelty; boundaries preferred every four bars; repeated parts share a letter; each part called quiet, verse, build or chorus by loudness, density and slope |
| Fills | A busy last half-bar leading into a chorus |
| Feel | Energy, brightness, punch, grit and melody-presence curves on a 0.1 s grid |
| Key | Krumhansl–Kessler profiles over the whole song's chroma |

Essentia (`vendor/essentia`, 2.5 MB) is imported only when a song is added, and the service
worker keeps it in a cache of its own across app updates. When it cannot load,
`js/mir.js` does everything itself: an autocorrelation tempo estimate and Ellis' dynamic-programming
beat tracker, and a harmonic-summation melody tracker. The song card says which
engine produced what.

Measured on generated songs with known answers (`tools/synth.mjs`), the built-in path
finds beats at an F-measure of 0.94–0.95 within about 20 ms, bars at 0.96, and every chorus
within a bar; Essentia's beats score 0.97–0.99 within about 7 ms, and Melodia names
82–95% of notes right.

## Exporting

- **Fast** (WebCodecs): every frame is drawn at its exact time, encoded to H.264, the
  soundtrack is mixed offline and encoded to AAC (Opus where AAC is missing), and
  `vendor/mp4-muxer.mjs` writes the MP4. No frame is dropped, and the tab can go to the
  background.
- **Real time** (MediaRecorder), where there is no H.264 encoder: the reel is recorded while
  it plays. The real duration is patched into the file, because MediaRecorder writes none
  (WebM) or a wrong one (Chromium's MP4), and galleries and social apps would cut it short.

Grain and glitch draw their randomness from the frame time, so the preview and the export
show the same frames, and exporting twice gives the same video.

## Files

```
index.html            the page; window.BD_VERSION
css/burst.css         desktop, phone, and phone held sideways
js/main.js            wiring: settings, player, strip, panes
js/timeline.js        the edit (pure, seeded)
js/render.js          drawing a frame
js/photos.js          decoding photos within a memory budget
js/audio.js           decoding, playback on the audio clock, the offline mix
js/analysis-worker.js the analysis, Essentia first
js/mir.js             the built-in analysis (pure; runs in Node too)
js/export.js          WebCodecs + mp4-muxer, and the MediaRecorder fallback
js/info.js            the (i) sheet, lifted from Type
js/update.js          update notice, lifted from Type
sw.js                 offline shell; waits to be asked before taking over
vendor/               mp4-muxer (MIT), Essentia.js (AGPL-3.0)
tools/validate.js     static checks, and the analysis and edit scored in Node
tools/e2e.js          the whole page in Chromium, at desktop and phone sizes
tools/synth.mjs       songs with the answers written down
```

`node tools/validate.js` before committing; `node tools/e2e.js [screenshot-dir]` needs
Playwright. Bumping `BD_VERSION` (and the cache name in `sw.js` with it) publishes an update.

## Licences

Essentia.js is AGPL-3.0 (Music Technology Group, Universitat Pompeu Fabra); BURST//DUMP
uses it unmodified, and its source is in this public repository next to the app.
mp4-muxer is MIT (Vanilagy). Both licence texts are in `vendor/`.
