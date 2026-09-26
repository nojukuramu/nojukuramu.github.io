# nojukuramu.github.io

Personal GitHub Pages site. Each sub-folder is a self-contained static project that can be
visited directly at `https://nojukuramu.github.io/<folder>/`.

The root (`index.html`) is the landing page that ties the projects together. It sits on a drawn
sunset: one canvas, no libraries, where a single number — how far through the evening we are —
paints the sky, the sun and the rays it throws while it is low, tonight's real moon phase, the
clouds, four mountain ridges and the lake under them, and after dark the Milky Way, a meteor now
and then, and the lights of a far shore coming on one by one. Scrolling runs that number forward,
so the top of the page is golden hour and the bottom is a starry night; the dial in the corner can
take it over instead.

Its styles and scripts live in [`static/home/`](static/home/):

| File | What it is |
|------|------------|
| [`js/sky.js`](static/home/js/sky.js) | the scene — sky, sun, moon, cloud, birds, ridges, lake, rain, snow, fog, lightning |
| [`js/weather.js`](static/home/js/weather.js) | [Open-Meteo](https://open-meteo.com/) and the moon, so the drawn sky can follow the real one |
| [`js/ambience.js`](static/home/js/ambience.js) | wind, crickets, birds, rain and thunder, and the logo's cue, synthesised — there are no audio files |
| [`js/projects.js`](static/home/js/projects.js) | the ring of cards and the grid it folds into, and the small drawn scene on every card |
| [`js/motion.js`](static/home/js/motion.js) | everything else that moves: headings rising a word at a time, the ribbons, the counters, the mark at the bottom |
| [`js/splash.js`](static/home/js/splash.js) | the logo writing itself and flying into the header, one timeline with its sound, and the moment the device is measured |
| [`js/home.js`](static/home/js/home.js) | the glue: scroll, dial, sound, search palette |
| [`tools/validate.js`](static/home/tools/validate.js) | `node static/home/tools/validate.js` — the checks to run before committing |

Adding a project means adding one object to the `PROJECTS` array in
[`static/home/js/projects.js`](static/home/js/projects.js) — the carousel, the filters, the
ribbons, the counters and the search palette are all driven from it. A card's `motif` names one of
the drawing functions at the top of that file. The heading counts the projects in words and is
corrected from the list at run time, but the number is also written into the HTML for anyone
without scripts; the validator refuses to let the two disagree, and checks that the folder exists
and is in `sitemap.xml`.

**On the ring.** The projects are a ring of cards laid out by hand rather than by scroll-snap: one
float says where the ring is, every card's transform is a function of its distance from it, and a
spring pulls that float to the card it is heading for. That is what lets the side cards sit on a
curve, the ring loop, and a flick carry momentum. It takes a mouse drag, a touch swipe (vertical
swipes still scroll the page), a sideways trackpad swipe, the arrow keys, and Tab — focusing a card
turns the ring to it. A card at the side comes to the middle when clicked; only the one in the
spotlight opens.

While it is on screen and nobody is touching it, it tours itself, a card every six and a half
seconds, the lit dot filling as each stop runs out. Hovering or focusing pauses it; dragging,
clicking or pressing anything on it stops it for good, and the play button is the only way back.
It never tours under `prefers-reduced-motion`.

The grid button folds the same fourteen cards into a grid with the transforms taken off — where
the browser has View Transitions each card flies to its place, and elsewhere it simply swaps. The
choice is remembered. With the evening's sound on, each card that comes into the spotlight rings
its own note of the logo's pentatonic, so turning the ring plays a tune.

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

**On the splash.** It draws that same square. An ember waits at the corner while the device is
measured; then a spark runs the outline of the square, a pen of light writes the word inside it
letter by letter, shedding embers as it goes, the gold floods in with a shine crossing the letters
and a ring of light leaving them, and the mark flies up into its place in the header as the curtain
lifts — landing exactly on the header's own logo, which is the same geometry.

Every beat has a sound, synthesised like everything else here: a low swell and a rim tone — a wet
finger round a glass — while the spark runs the square, and a tick as it closes; a nib on paper
for each stroke and a bell the frame each letter lands (four notes up a major pentatonic, so there
is no wrong interval); an open fifth as the gold floods, with a shimmer that sweeps upward exactly
as long as the shine takes to cross; and air moving as the mark flies, panned towards the header,
with a soft tock when it lands.

The picture and the sound are one plan, not two things started together. The drawing is computed
every frame from the clock rather than left to CSS transitions, so a stalled frame is dropped,
never late. The sound books each beat on the audio clock for the moment it will be *heard* —
`getOutputTimestamp()` pairs the two clocks at the speaker, so output latency is included, and on
Bluetooth headphones that is a fifth of a second — and the drawing waits exactly that long before
its first frame. The nib's loudness and brightness follow the pen's own speed curve, the same curve
that moves the pen and throws its embers, so the loudest scratch is the fastest stroke. Measured in
the browser, each bell is booked within a tenth of a millisecond of its letter's landing, and the
letter completes on the next frame, never before. The cue peaks around -19 dBFS on the same meter
that puts the previous one at -16: a cue, not a fanfare.

Two things it will not do. It never plays if the visitor has muted the site — that is their
choice, and it is checked before anything else. And on a cold load browsers refuse to start audio
without a gesture, so most first visits are silent: nothing is faked, and nothing is queued to
startle anyone later. But the drawing keeps asking, and a click or a key part-way through brings
the sound in at the beat the picture has reached — beats already past are skipped, not played
late. "Replay the intro" in the search palette runs the whole thing again from a click, so it
always has its sound. Clicking the curtain or pressing Escape, Enter or Space skips it, and lets go
of whatever the sound had booked. Under `prefers-reduced-motion` there is no write to sync to, so
the logo is simply there and there is no cue at all.

The order it does things in matters. A scene repainting behind the black would starve the one
thing anybody can see. So the sequence is: measure first with a short burst of the real rendering
(`NJ.sky.probe()`, capped at eighteen frames or 600 ms) while only compositor animations move —
the waiting ember and the hairline under the mark, which is that measurement and not a fake
progress bar — let the verdict pick how much drawing this device can afford, write the logo while
the main thread is quiet, and start the scene as the curtain lifts. The flight is a Web Animation,
on the compositor, so the scene starting under it cannot make it stutter.

If `splash.js` never loads, a CSS animation clears the overlay on its own a few seconds in — a
broken script can never leave a black page. Once it has loaded it stands that animation down and
keeps the same promise with a timer of its own.

The same goes for everything that starts hidden. The hero's words wait under a class only
`splash.js` sets, and rise when it lifts the curtain (or after six seconds regardless). Every other
reveal hangs off `.motion`, which `motion.js` sets only once it is running and able to reveal
things again. A page where neither loads is simply all there.

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


## Working here

Standing instructions for changes to any project in this repository — reuse before you build,
every installable PWA gets an update path, and keep the interface quiet — are in
[`CLAUDE.md`](CLAUDE.md).

## Projects

| Path | Project | Description |
|------|---------|-------------|
| [`/magic_circles/`](magic_circles/) | **Magic Circles — A Certain RPG Game** | A magic-based RPG prototype where spells are *drawn*, not picked from a menu. Includes a canvas build, a Phaser.js edition, and a world-chunk editor. |
| [`/task-notes/`](task-notes/) | **Task Notes** | A notebook with a real alarm clock inside it — markdown notes, repeating alarms that ring until answered, notebooks, tags, five views, and offline background notifications. All data saved locally in the browser. See [`task-notes/README.md`](task-notes/README.md). |
| [`/3dtd/`](3dtd/) | **VELL** | A procedurally generated 3D tower defense on a drowned moor — free camera, walkable traps, endless promotions, day/night cycle, synthesised audio. See [`3dtd/README.md`](3dtd/README.md). |
| [`/the-wolf-game/`](the-wolf-game/) | **The Wolf Game** | Werewolf for a room full of phones. The night runs for everyone at once, first come first served: you pick a *house* and are then offered what your role can do at its door — so a Bodyguard who arrives after the pack finds a body instead of a charge, and a revived player gets the same night back. 35 roles, a phase clock the room's colour tracks from night to dawn to dusk, and rooms over WebRTC with no backend. A refactor of the old pass-the-phone build. See [`the-wolf-game/README.md`](the-wolf-game/README.md). |
| [`/karaokenatin/`](karaokenatin/) | **KaraokeNatin** | A karaoke room in the browser. One screen hosts and plays; guests scan a QR code and their phones become remotes — search, queue, reorder, skip. Peer-to-peer over WebRTC with no backend, installable as a PWA, with a local library of saved songs and playlists. See [`karaokenatin/README.md`](karaokenatin/README.md). |
| [`/hacks/`](hacks/) | **Hacks** | A movement shooter you are allowed to cheat in. Source's own movement code — bunny hop, air strafing and surfing fall out of it — with Apex's sprint, slide, wall climb and wall jump, six guns, and two blades that stick to any surface and lunge off it. Press H and write hacks in JavaScript — ESP, bone drawing, radars, aimbots, bhop scripts — that can read everything and change only you, with fourteen lessons from "hello" to projectile prediction. Bots, peer-to-peer rooms, rearrangeable phone controls. See [`hacks/README.md`](hacks/README.md). |
| [`/magic_sandbox/`](magic_sandbox/) | **Magic Sandbox** | The Loom Tower — a 3D top-down spell-crafting roguelite. Weave runes into elemental circles in the Spellforge, then ascend floor by floor. |
| [`/pwg/`](pwg/) | **Pinoy Word Games** | Hulaan ang dalawang salita — 100 cozy Filipino word levels, progress saved locally. See [`pwg/MANUAL.md`](pwg/MANUAL.md). |
| [`/antiafk/`](antiafk/) | **Anti-AFK** | Keeps a screen awake with a Screen Wake Lock held open behind a decoy video player. |
| [`/burst_dump/`](burst_dump/) | **Burst//Dump** | Cuts a folder of photos into a seeded photo-dump reel and records it to MP4/WebM in the browser. |
| [`/citybuilder/`](citybuilder/) | **SkyLine** | A pocket city sim — terraform, lay roads, zone a skyline that grows itself, with a day/night cycle and weather. |
| [`/routecast/`](routecast/) | **RouteCast** | A map navigator for cars and motorcycles that forecasts the weather *along* the route — each checkpoint read at the hour you are predicted to arrive there, colour-coded for risk, with vehicle-aware advice and a departure planner. Rides in a group over a phone-to-phone room, opens onto the public road with **PUBs**, draws a heat map of the roads you actually use, and keeps recording with the screen off. Built on OpenStreetMap, OSRM and Open-Meteo; no API keys. See [`routecast/README.md`](routecast/README.md). |
| [`/komyut/`](komyut/) | **TheCommuters** | A social app for directions. Community-filed commute routes — jeepney, bus, UV Express, tricycle, habal-habal, train, ferry — with stops in order, fares, votes that sink a route that no longer runs, comments, and a **validated** tag only moderators can move. Plans a trip across them with transfers, preferring the routes people have backed rather than the ones that merely look fast, and reads the weather along the line at the hour you would be there. Aimed at the Philippines, not limited to it. Reading needs no account. Supabase behind it, with the whole schema and every Row Level Security policy in [`komyut/supabase/schema.sql`](komyut/supabase/schema.sql). See [`komyut/README.md`](komyut/README.md). |
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