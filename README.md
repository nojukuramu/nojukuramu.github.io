# nojukuramu.github.io

Personal GitHub Pages site. Each sub-folder is a self-contained static project that can be
visited directly at `https://nojukuramu.github.io/<folder>/`.

The root (`index.html`) is the landing page that ties the projects together. It sits on a drawn
sunset: one canvas, no libraries, where a single number — how far through the evening we are —
paints the sky, the sun, tonight's real moon phase, the clouds, four mountain ridges and the lake
under them. Scrolling runs that number forward, so the top of the page is golden hour and the
bottom is a starry night; the dial in the corner can take it over instead.

Its styles and scripts live in [`static/home/`](static/home/):

| File | What it is |
|------|------------|
| [`js/sky.js`](static/home/js/sky.js) | the scene — sky, sun, moon, cloud, birds, ridges, lake, rain, snow, fog, lightning |
| [`js/weather.js`](static/home/js/weather.js) | [Open-Meteo](https://open-meteo.com/) and the moon, so the drawn sky can follow the real one |
| [`js/ambience.js`](static/home/js/ambience.js) | wind, crickets, birds, rain and thunder, synthesised — there are no audio files |
| [`js/projects.js`](static/home/js/projects.js) | the carousel, and the small drawn scene on every card |
| [`js/splash.js`](static/home/js/splash.js) | the logo writing itself, and the moment the device is measured |
| [`js/home.js`](static/home/js/home.js) | the glue: scroll, dial, sound, search palette |

Adding a project means adding one object to the `PROJECTS` array in
[`static/home/js/projects.js`](static/home/js/projects.js) — the carousel, the filters and the
search palette are all driven from it. A card's `motif` names one of the drawing functions at the
top of that file.

**On the weather.** Nothing is sent anywhere until the visitor asks. The location pin in the
corner is the only thing that prompts; coordinates are rounded to two decimals (~1 km) before they
leave the page, the answer is cached in `localStorage` for twenty minutes, and clicking the
reading forgets all of it. A visit that never touches the pin makes no network request at all, and
every failure is silent — the sky just keeps running off the scroll. The moon phase is computed
locally from the date rather than fetched, and is accurate to within half a day.

**On the sound.** Off until asked, remembered afterwards, and it still waits for a click on every
visit, because a page that talks the moment it loads is rude even where browsers allow it.

**On the logo.** A 1:1 rounded square, black, with "noju" in Poppins SemiBold centred in it. No
webfont is involved: the four glyphs are committed as SVG outlines, and one geometry — the same
`viewBox`, plate and transform — is used by the header, the footer, the favicon and the splash,
so the mark cannot drift between them. The word is centred by the transform rather than by
padding, which is why it lands identically at 30 px and at 512.

**On the splash.** It draws that same square: the plate outlines itself, then the word is
stroked on letter by letter inside it, then flooded.

It has a sound, synthesised like everything else here — a low swell as the square lands, a nib on
paper for the length of each stroke, a small bell the instant each letter arrives (four notes up a
major pentatonic, so there is no wrong interval to land on), and an open fifth with a shimmer over
it as the fill floods in. The cue is scheduled from the same plan the drawing uses and against a
single audio timestamp, so a bell can never land on a letter that has not arrived, even if the
main thread stalls mid-animation. Rendered offline and measured, it peaks around -10 dBFS.

Two things it will not do. It never plays if the visitor has muted the site — that is their
choice, and it is checked before anything else. And on a cold load browsers refuse to start audio
without a gesture, so most first visits are silent: nothing is faked, and nothing is queued to
startle anyone later. Moving, scrolling or typing before the letters begin hands it the gesture in
time. Under `prefers-reduced-motion` there is no write to sync to, so there is no cue at all.

The order it does things in matters. `stroke-dashoffset` is a main-thread property, so a scene
repainting behind the black would starve the one thing anybody can see. So the sequence is:
measure first with a short burst of the real rendering (`NJ.sky.probe()`, capped at eighteen
frames or 600 ms), let the verdict pick how much drawing this device can afford, write the logo
while the main thread is quiet, and start the scene as the curtain lifts. The hairline under the
mark is that measurement, not a fake progress bar.

If `splash.js` never loads, a CSS animation clears the overlay on its own a few seconds in — a
broken script can never leave a black page.

**On other browsers.** The layout is checked for horizontal overflow at fourteen widths from
320 px up, with `overflow-x` neutralised so nothing is masked, and again with every modern
feature forced back to its fallback: no `svh`, no `overflow: clip`, no `backdrop-filter`, no
canvas `roundRect`, no Permissions API, no `StereoPannerNode`. That last pass is what an older
WebKit or Gecko actually gets, and the page survives all of it at once. Two notes for anyone
editing this:

- `body` must not carry a background. Once `html` has one, `body`'s stops propagating to the root
  and becomes an ordinary block background — and block backgrounds paint *above* negative
  z-index children, which buries the sky canvas completely.
- Don't put `vector-effect: non-scaling-stroke` on the splash glyphs. It puts the dash pattern in
  screen space while `getTotalLength()` reports user units, so the dash cycles exactly one period
  and the letters only ever look finished.

## Projects

| Path | Project | Description |
|------|---------|-------------|
| [`/magic_circles/`](magic_circles/) | **Magic Circles — A Certain RPG Game** | A magic-based RPG prototype where spells are *drawn*, not picked from a menu. Includes a canvas build, a Phaser.js edition, and a world-chunk editor. |
| [`/task-notes/`](task-notes/) | **Task Notes** | A notebook with a real alarm clock inside it — markdown notes, repeating alarms that ring until answered, notebooks, tags, five views, and offline background notifications. All data saved locally in the browser. See [`task-notes/README.md`](task-notes/README.md). |
| [`/3dtd/`](3dtd/) | **VELL** | A procedurally generated 3D tower defense on a drowned moor — free camera, walkable traps, endless promotions, day/night cycle, synthesised audio. See [`3dtd/README.md`](3dtd/README.md). |
| [`/the-wolf-game/`](the-wolf-game/) | **The Wolf Game** | Werewolf for a room full of phones. The night runs for everyone at once, first come first served: you pick a *house* and are then offered what your role can do at its door — so a Bodyguard who arrives after the pack finds a body instead of a charge, and a revived player gets the same night back. 35 roles, a phase clock the room's colour tracks from night to dawn to dusk, and rooms over WebRTC with no backend. A refactor of the old pass-the-phone build. See [`the-wolf-game/README.md`](the-wolf-game/README.md). |
| [`/karaokenatin/`](karaokenatin/) | **KaraokeNatin** | A karaoke room in the browser. One screen hosts and plays; guests scan a QR code and their phones become remotes — search, queue, reorder, skip. Peer-to-peer over WebRTC with no backend, installable as a PWA, with a local library of saved songs and playlists. See [`karaokenatin/README.md`](karaokenatin/README.md). |
| [`/magic_sandbox/`](magic_sandbox/) | **Magic Sandbox** | The Loom Tower — a 3D top-down spell-crafting roguelite. Weave runes into elemental circles in the Spellforge, then ascend floor by floor. |
| [`/pwg/`](pwg/) | **Pinoy Word Games** | Hulaan ang dalawang salita — 100 cozy Filipino word levels, progress saved locally. See [`pwg/MANUAL.md`](pwg/MANUAL.md). |
| [`/antiafk/`](antiafk/) | **Anti-AFK** | Keeps a screen awake with a Screen Wake Lock held open behind a decoy video player. |
| [`/burst_dump/`](burst_dump/) | **Burst//Dump** | Cuts a folder of photos into a seeded photo-dump reel and records it to MP4/WebM in the browser. |
| [`/citybuilder/`](citybuilder/) | **SkyLine** | A pocket city sim — terraform, lay roads, zone a skyline that grows itself, with a day/night cycle and weather. |
| [`/routecast/`](routecast/) | **RouteCast** | A map navigator for cars and motorcycles that forecasts the weather *along* the route — each checkpoint read at the hour you are predicted to arrive there, colour-coded for risk, with vehicle-aware advice and a departure planner. Built on OpenStreetMap, OSRM and Open-Meteo; no API keys. See [`routecast/README.md`](routecast/README.md). |
| [`/arco/`](arco/) | **ARCO** | A two-thumb instrument for a phone held sideways: four physically modelled strings, tilt-shaped tone, playable in all twelve keys. Offline, no samples. |

### Magic Circles

A static port of the `a_certain_rpg_game` prototype (originally a Flask blueprint served at
`/rpg`). Its highlight is the **magic-circle creation system**: trace polygons on a 12-node
ring to forge elements (3 sides = Air, 4 = Fire, 5 = Earth, 6 = Water), wrap them in circles,
stack layers into combos, and cast.

- **Hub / launcher:** [`magic_circles/index.html`](magic_circles/index.html)
- **Full documentation:** [`magic_circles/README.md`](magic_circles/README.md) — explains the
  magic system end to end (nodes, elements, runes, layers, power, the spell *spectrum*, and the
  casting pipeline) plus the Flask → static conversion notes.

### Task Notes

A local-first notes app with alarms that actually ring, installable as a PWA. Highlights:

- Markdown notes with inline checklists, nine colours, pin/star, priority, tags and notebooks
- Many alarms per note — once, daily, weekly, monthly, yearly or every-N — each either a
  full-screen ringing **alarm** or a quiet **notification**, with its own ringtone, volume,
  auto-snooze rule and end date
- Five views (grid, list, board, agenda, calendar), archive, trash, multi-select bulk edits,
  drag ordering, undo/redo, and a `Ctrl+K` command palette
- **Background alarms:** notes live in IndexedDB so the service worker can read them, decide
  what is due and post notifications with no tab open. On Chromium, Notification Triggers
  hand upcoming alarms to the OS so they fire with the app fully closed. Elsewhere alarms
  need a running tab, which the app states plainly, and anything genuinely missed is shown
  as a *missed alarm* rather than silently swallowed.
- All data stored in the `task-notes` IndexedDB database — no sign-in, no server. Data from
  the old `localStorage` version is imported automatically on first run.
- Offline-capable (service worker caches the app shell); installable via Chrome/Edge "Install"
  prompt or iOS Share → Add to Home Screen

- **App:** [`task-notes/index.html`](task-notes/index.html)
- **Full documentation:** [`task-notes/README.md`](task-notes/README.md)

## Repository layout

```
.
├── README.md          # You are here
├── magic_circles/     # A Certain RPG Game — static build (see its README)
│   ├── index.html     # Section hub
│   ├── play.html      # Canvas prototype
│   ├── phaser.html    # Phaser.js edition
│   ├── editor.html    # Chunk editor
│   ├── README.md      # Magic-circle system documentation
│   └── static/        # css / js / assets (game logic from source + minor bug-fixes)
└── task-notes/        # Task Notes — notes-with-alarms PWA (see its README)
    ├── index.html     # App shell
    ├── manifest.webmanifest
    ├── sw.js          # Service worker
    ├── offline.html   # Offline fallback
    ├── README.md      # Project documentation
    └── static/        # css / js / icons
```

## Notes

- Everything is **plain static HTML/CSS/JS** — no build step or server. Pages are designed to
  be served over HTTP (e.g. GitHub Pages); the Phaser edition fetches Phaser 3.80.1 from a CDN.
- To preview locally: `python3 -m http.server` from the repo root, then browse to the project
  folder.