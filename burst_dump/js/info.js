/* ============================================================
   BURST//DUMP — the info sheet

   Lifted from Type (type/js/info.js), which lifted it from Hacks, Magic
   Sandbox and RouteCast: one sheet, one scrim, one registry, delegated
   clicks on anything carrying data-info="<key>". The panel says one line;
   the explanation lives behind a small (i).
   Changed: the topics, which are this app's.

   Bodies are trusted HTML written in this file; nothing from a file the user
   adds ever reaches the sheet.
   ============================================================ */

const k = (s) => "<kbd>" + s + "</kbd>";

const TOPICS = {
  about: {
    title: "What this is",
    body:
      "<p>Drop in a folder of photos and a song, and BURST//DUMP cuts them into a fast photo-dump reel: on the beat, faster in the chorus, " +
      "slower in the quiet parts, in a mix of sixteen layouts.</p>" +
      "<p><b>Nothing is uploaded.</b> The photos are decoded, the song is analysed and the video is encoded on this device. Close the tab and they are gone.</p>" +
      "<p>The same seed and settings always give the same edit, so a reel you like can be made again. Reroll until it slaps.</p>"
  },
  keys: {
    title: "Keys",
    body:
      "<p>" + k("Space") + " play or pause · " + k("R") + " reroll · " + k("F") + " full screen · " + k("\u2190") + " " + k("\u2192") + " a second back or on · " +
      k("E") + " export.</p>"
  },
  photos: {
    title: "Photos and memory",
    body:
      "<p>Anything the browser can open: JPEG, PNG, WebP, GIF, BMP, AVIF. Camera RAW files and HEIC (iPhone's default) are skipped; " +
      "export them as JPEG first, or set the iPhone camera to <i>Most Compatible</i>.</p>" +
      "<p>Photos are shrunk as they load, to fit a memory budget scaled to this device. <b>Auto</b> picks the largest size that stays safely under it; " +
      "phones close a tab without warning when a page uses too much, so the budget is cautious.</p>" +
      "<p>Up to 1,000 photos. Over the maximum, the selection is an even sample, the first ones, or a random set.</p>"
  },
  rhythm: {
    title: "Rhythm",
    body:
      "<p><b>Follow the song</b> edits the way an editor cuts a montage: in four-bar phrases, one steady pattern per phrase, the pace changing where the music does. " +
      "A cut every few bars in a quiet intro, every bar or half bar in a verse, beats or eighths in a chorus. Within the bar the cuts follow the song's own groove, " +
      "its drum hits and, in calm vocal parts, its melody. Builds speed up into the drop, a bar where the band stops holds the picture, and every drop is a cut.</p>" +
      "<p><b>On the beat</b> cuts evenly on beats, halves or quarters of beats, whichever fits the length; with no song, at the BPM you type or tap.</p>" +
      "<p><b>On the melody</b> cuts where the lead line moves to a new note. <b>On the drums</b> cuts on kicks and snares.</p>" +
      "<p><b>Accelerate</b>, <b>decelerate</b>, <b>steady</b>, <b>bursts</b> and <b>random</b> ignore the music altogether.</p>"
  },
  length: {
    title: "Length",
    body:
      "<p><b>Fit the photos</b> (follow the song only): the music sets the pace, and the reel lasts as long as your photos do, ending at the end of a phrase. " +
      "Drop in all of them; <b>Pace</b> makes it calmer or busier.</p>" +
      "<p><b>Fixed length</b> ends on the bar line nearest the duration. <b>The whole song</b> runs from the start point to the end.</p>" +
      "<p>Either way the cuts are spread to suit the music, and every photo gets one. With more photos than the music can take without turning into a blur, " +
      "the reel shows an even sample and says so.</p>"
  },
  analysis: {
    title: "How the song is read",
    body:
      "<p>The song is analysed on this device, in the background, by <b>Essentia.js</b> (Music Technology Group, Universitat Pompeu Fabra), " +
      "the WebAssembly build of the library music researchers use. It is fetched once, about 2.5 MB, the first time a song is added, and kept for offline use.</p>" +
      "<p><b>Beats</b>: RhythmExtractor2013, which tracks the beat even where the kick drops out. <b>Bars</b>: the beat where low-end hits and chord changes agree. " +
      "<b>Melody</b>: Melodia, which follows the lead voice through a full mix and arrives a few seconds after the rest.</p>" +
      "<p><b>Sections</b> come from comparing every bar with every other: where the song stops sounding like itself is a boundary, preferably every four bars. " +
      "Each part is called quiet, verse, build or chorus by how loud and busy it is, and parts that repeat share a letter.</p>" +
      "<p>If Essentia cannot load (an old browser, no WebAssembly), a built-in tracker does all of it, less precisely, and the track card says so.</p>"
  },
  feel: {
    title: "Music feel",
    body:
      "<p>Five curves are read off the song: <b>energy</b> (loudness), <b>punch</b> (how percussive), <b>brightness</b>, <b>grit</b> (how noisy) and whether the lead is singing.</p>" +
      "<p><b>Pace</b>: energy speeds the cuts up and slows them down. <b>FX hits</b>: punchy moments get more flashes and glitches. " +
      "<b>Style pick</b>: bright passages lean to hard graphic layouts, dark ones to piles of prints. <b>Texture</b>: grit breathes the grain, brightness eases the vignette.</p>" +
      "<p>Each slider bends your own settings; at zero the song has no say.</p>"
  },
  lift: {
    title: "Melody lift",
    body:
      "<p>Placed prints (pile, pop, taped, stickers) sit higher on the frame when the lead line is high and lower when it is low, so the photos trace the tune.</p>"
  },
  pulse: {
    title: "Beat pulse",
    body:
      "<p>The whole frame swells for a tenth of a second on every beat, harder on the first beat of a bar. It keeps a long hold moving with the music between cuts.</p>"
  },
  styles: {
    title: "Style mix",
    body:
      "<p>Each lit chip is a layout the edit can use. It plays a <b>run</b> of photos in one layout, then switches.</p>" +
      "<p><b>Chaos</b> is how short the runs are: low holds a layout for a long stretch, high changes nearly every photo. " +
      "<b>Per style</b> sets each layout's run length yourself.</p>" +
      "<p>With a song, each part leans towards layouts that suit it: piles and stickers in quiet parts, full-frame slams and punch zooms in the chorus. " +
      "A new part always starts a new run.</p>"
  },
  seed: {
    title: "Seed",
    body: "<p>The number every random choice in the edit is drawn from. The same seed and settings give the exact same reel, every time.</p>"
  },
  export: {
    title: "Export",
    body:
      "<p><b>Fast</b>, wherever the browser can encode H.264 itself (Chrome and Edge; Safari and Firefox where they also encode the sound): " +
      "every frame is drawn and encoded straight to an MP4, with no dropped frames, and the tab can go to the background. " +
      "The export line says which one this browser gets.</p>" +
      "<p><b>Real time</b>, where the browser cannot encode video itself: the reel is recorded while it plays, so it takes as long as the reel and the tab " +
      "has to stay in front. Some browsers record WebM; the length is written into the file either way so galleries and social apps read it properly.</p>" +
      "<p>On a phone, <b>Share</b> sends the finished file straight to Photos, Instagram or a chat.</p>"
  },
  pace: {
    title: "Pace",
    body:
      "<p>With <b>fit the photos</b>, the song sets how fast the cuts come, and the reel runs as long as your photos last, ending at the end of a phrase.</p>" +
      "<p>Pace shifts that whole plan: each step halves or doubles the cuts in every phrase, so quiet parts stay quieter than the chorus. " +
      "Calmer uses more of the song for the same photos; busier gets through them sooner.</p>"
  },
  hero: {
    title: "Hero shots",
    body:
      "<p>The moment a chorus drops is the strongest cut in the reel. Hero shots puts the most striking photo nearby on it: the most colourful and contrasty one, " +
      "from no more than six places away, so a dump in date order still reads in date order.</p>" +
      "<p>Off, every photo plays exactly where your order puts it.</p>"
  },
  sync: {
    title: "Sync",
    body:
      "<p>Each cut is shown on the last video frame before its beat, about a hundredth to a fiftieth of a second early, never late. " +
      "People notice sound arriving before the picture far sooner than the reverse, and a flash with a click feels most together when the flash is slightly first.</p>" +
      "<p>The preview also allows for the delay your speakers or Bluetooth headphones report. If the cuts still feel late through yours, " +
      "nudge them earlier (minus); if early, later. The nudge goes into the export too.</p>"
  },
  update: {
    title: "Updates",
    body:
      "<p>BURST//DUMP keeps its own copy so it opens instantly and works offline. A new version is never applied in the middle of something: it waits, " +
      "and the bar at the top offers it. Your settings are kept; photos and the song have to be added again, because they were never stored.</p>"
  }
};

let sheet = null, scrim = null, titleEl = null, bodyEl = null, lastFocus = null;
const el = (id) => document.getElementById(id);

function ensure() {
  if (sheet) return true;
  sheet = el("info-sheet"); scrim = el("info-scrim"); titleEl = el("info-title"); bodyEl = el("info-body");
  return !!(sheet && titleEl && bodyEl);
}

export function open(key) {
  if (!ensure()) return false;
  const topic = TOPICS[key];
  if (!topic) return false;
  try { lastFocus = document.activeElement; } catch (e) { lastFocus = null; }
  titleEl.textContent = topic.title;
  bodyEl.innerHTML = topic.body;
  sheet.hidden = false;
  if (scrim) scrim.hidden = false;
  const close = el("info-close");
  if (close && close.focus) { try { close.focus(); } catch (e) {} }
  return true;
}

export function close() {
  if (!ensure() || sheet.hidden) return false;
  sheet.hidden = true;
  if (scrim) scrim.hidden = true;
  // back to whatever opened it, so a keyboard is not dropped at the top of the panel
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  lastFocus = null;
  return true;
}
export function isOpen() { return ensure() && !sheet.hidden; }

export function init() {
  if (!ensure()) return;
  const closeBtn = el("info-close");
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (scrim) scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) { e.stopImmediatePropagation(); close(); } }, true);
  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-info]") : null;
    if (!btn) return;
    e.preventDefault();
    open(btn.getAttribute("data-info"));
  });
}

export const has = (key) => !!TOPICS[key];
export const keys = () => Object.keys(TOPICS);
