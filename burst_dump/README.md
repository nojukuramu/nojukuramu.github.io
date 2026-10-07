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
| **Follow the song** | Edited like a montage: in 4-bar phrases, one steady pattern per phrase, the pace changing where the music does (below). |
| **On the beat** | Evenly on beats or their halves and quarters, whichever fits; with no song, at a typed or tapped BPM. |
| **On the melody** | Where the lead line starts a new note. |
| **On the drums** | On kicks and snares. |
| Accelerate, decelerate, steady, bursts, random | Ignore the music. |

### Follow the song

`js/choreo.js` plans the cuts the way an editor cuts a montage to music, rather than
snapping cuts to whatever beat is nearest:

1. **Bars and phrases.** Every section is split into 4-bar phrases from its first downbeat.
   Cuts land on bar lines and, at their strongest, at the top of a phrase.
2. **One pace per phrase**, a power of two per bar: a cut every four or two bars in a quiet
   intro, every bar or half bar in a verse, beats or eighths in a chorus. Holding a pattern
   for a phrase and changing it where the music changes reads as edited; a cut on every
   beat reads as mechanical. Intensity per bar comes from the section type, loudness and
   punch; the densest a bar may get also depends on it, so a quiet intro never becomes a blur.
3. **Which beats.** The cuts in a bar keep an even spacing, and each may lean a sixteenth or
   two toward where the phrase accents: the metrical hierarchy (1, 3, 2 and 4, the ands)
   plus the phrase's own groove, read from its drum hits and, in calm vocal parts, from where
   the melody starts its notes.
4. **Builds, breaks, drops.** The phrase into a drop steps its pace up bar by bar; the half
   bar before a chorus rolls; a bar where the band stops holds the photo still; every
   section starts with a cut on its downbeat; every drop is a flash on a full-frame layout,
   with the most striking photo within six places moved onto it (*hero shots*).
5. **Exactly one cut per photo.** *Fit the photos* (the default) lets the music set the pace
   and ends at the end of the phrase where the photos run out; *Pace* shifts every phrase
   together by halvings and doublings. *Fixed length* and *the whole song* search one gain
   that raises or lowers every phrase together for the most cuts that fit, then add the rest
   as pickups at the ends of phrases, where a drummer would fill. With more photos than the
   music can take, the reel shows an even sample and says so.
6. **Picture slightly before sound.** Each cut goes on the last video frame at or before its
   beat less 8 ms, so it is on screen 8–25 ms early at 60 fps and never late. Viewers notice
   sound before picture at ~45 ms but picture before sound only at ~125 ms (ITU-R BT.1359),
   and a flash with a click feels simultaneous when the flash leads by 10–40 ms. The beat
   pulse leads by the same margin, *Sync nudge* adjusts it for a speaker that needs it, and
   the analysis itself is corrected for its measured bias (beats within 2 ms on test songs).
7. **Layout changes on phrase lines** (every phrase, two bars or bar with chaos); the reel
   **starts on a bar line** (the start point snaps to the nearest downbeat; *Best part*
   picks a start that reaches a chorus early, as short-video apps open on the hook) and
   **ends on one**, with the music fading out over the last hold.

Sources for the conventions: phrase-aligned cutting and varying the cut rate by section
([RouteNote](https://licensing.routenote.com/blog/?p=9560),
[Artlist](https://artlist.io/blog/how-to-add-music-to-a-video/)); anticipating the
downbeat with a cut on the last sixteenth, and avoiding cuts only on beat 1
([Filmdaft](https://filmdaft.com/how-to-edit-video-clips-to-the-beat-of-music-the-easy-way/));
setup, acceleration, pause and payoff around a drop
([CapCut](https://www.capcut.com/create/music-video-pacing-emotional-montage-rhythm));
audio-video timing tolerances ([ITU-R BT.1359 summary](https://www.tvtechnology.com/opinions/av-synchronization-how-bad-is-bad),
[visual-lead simultaneity](https://pmc.ncbi.nlm.nih.gov/articles/PMC5312923), [asynchrony windows](https://pmc.ncbi.nlm.nih.gov/articles/PMC4451240));
automatic music-video editing from beat and structure analysis
(Foote, Cooper & Girgensohn 2002; Hua, Lu & Zhang 2004, [Microsoft Research](https://www.microsoft.com/en-us/research/?p=151644)).

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
js/choreo.js          follow the song: the phrase-by-phrase cut plan (pure)
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
