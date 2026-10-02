# nojukuramu.github.io

Personal GitHub Pages site. Each sub-folder is a self-contained static project that can be
visited directly at `https://nojukuramu.github.io/<folder>/`.

The root (`index.html`) is the landing page that ties the projects together, and it is dressed as
a camera: a black body with a fine grain to it, machined chrome where the hand goes, numerals
engraved rather than printed, and one red mark — the index a dial turns against. Colour belongs to
the projects; everything else is black, white and metal. Scrolling it is less like scrolling a page
than like operating the thing: the page opens behind a shut iris, the hero lifts away while a lens
rises into its place, and from there every detent of the scroll turns a chrome dial round the lens
by one project — the iris swings shut, the next project is behind it, the iris swings open.

Its styles and scripts live in [`static/home/`](static/home/):

| File | What it is |
|------|------------|
| [`js/projects.js`](static/home/js/projects.js) | the list every part of the page is drawn from, and a small drawn scene for each project |
| [`js/iris.js`](static/home/js/iris.js) | the aperture: nine blades as geometry, used full screen by the intro and behind the lens's glass |
| [`js/wheel.js`](static/home/js/wheel.js) | the hero and the shutter wheel — one pinned scene driven by the scroll |
| [`js/sheet.js`](static/home/js/sheet.js) | the contact sheet: every project at once, developing as it comes into view |
| [`js/intro.js`](static/home/js/intro.js) | the shutter opening on the page |
| [`js/motion.js`](static/home/js/motion.js) | everything else that moves, and `glide`, the one way the page scrolls itself |
| [`js/film.js`](static/home/js/film.js) | film simulations: one filter over everything that is a picture |
| [`js/sound.js`](static/home/js/sound.js) | detents, the shutter, focus beeps and the rewind motor, synthesised — there are no audio files |
| [`js/home.js`](static/home/js/home.js) | the glue: sound, rewind, search palette |
| [`tools/validate.js`](static/home/tools/validate.js) | `node static/home/tools/validate.js` — the checks to run before committing |
| [`tools/e2e.js`](static/home/tools/e2e.js) | `node static/home/tools/e2e.js` — the page used in a real browser |

Adding a project means adding one object to the `PROJECTS` array in
[`static/home/js/projects.js`](static/home/js/projects.js) — the dial's engravings, the frames of
the contact sheet, the filters, the strips of film, the counters and the search palette are all
driven from it. A project's `motif` names one of the drawing functions at the top of that file. The
headings that count the projects are corrected from the list at run time, but the number is also
written into the HTML for anyone without scripts; the validator refuses to let the two disagree,
and checks that the folder exists and is in `sitemap.xml`.

**On the wheel.** The hero and the projects are one `position: sticky` stage inside a section as
tall as the scroll it takes: one screen to rise out of the hero, three-fifths of a screen per
project, a little at the end. One number does all of it — `pos`, where the dial is, in projects.
The dial's angle is a function of it, the iris is shut at every half and open at every whole, and
the project on show is whichever whole it is nearest. The scroll becomes `pos` through a curve with
a flat stretch either side of every whole number, so a frame holds still for a while before the
next one starts to come round. Between the scroll and the drawing sits the spring the old ring of
cards used, a touch under-damped: a mouse wheel moves the page in jumps, and the spring is what
turns those into a dial being turned and lets it land on a detent with a small clunk. Left to rest
between two frames, the page glides to the nearer one; nothing else is snapped. It also turns with
the arrow keys, the two step buttons, a click on an engraving, or — with a mouse — by taking hold
of the dial and turning it. Touch is left alone: on a phone the lens is most of the screen, and
taking the scroll away from it would trap the thumb.

The screen height the scene is measured in is held steady while a phone's toolbar slides in and
out, and only re-measured on a change of width or a large change of height, so the scene never
jumps under the reader's thumb.

**On the lens.** It is CSS and one canvas. The rings are discs of conic gradient — a conic gradient
is what turned metal looks like under one light — and the shading layers never turn: only the
engravings on top of them do, the way light stays where it is while a real ring goes round under
it. The engravings are SVG text on arcs. Behind the glass is a canvas drawing the project's own
scene, the same drawing its frame on the contact sheet holds still, and over it the iris and the
violet and green a coated lens throws back.

**On the iris.** It is drawn as geometry, not as nine images turned about a pin. The opening is a
regular polygon; continue each of its sides past the corner until it meets the rim, and those rays
cut the ring outside the polygon into nine identical pieces — the blades. So one blade is computed
a frame and the other eight are `<use>`s of it, and a gradient laid across the first follows each
copy round. At an opening of zero the polygon is a point and the blades are nine slices meeting in
the middle. The viewfinder's readout along the foot of the scene reads its aperture back in third
stops, so it says F22 as the shutter closes, and its shutter speed is really the scroll's.

**On the contact sheet.** The whole roll at once, for anyone who would rather scan than turn. The
frames arrive as negatives and develop as they come into view: a white layer in `difference` over
the picture is its negative, an orange one in `multiply` is the film base, and fading the two out
is the print coming up in the tray. Only one frame is ever animated — the one under the pointer,
or on a screen with nothing to hover, the one nearest the middle.

**On the film.** The chip in the header winds through six simulations, each one CSS filter applied
to everything that is a picture — the scene behind the lens, the frames, the marks that carry a
project's colour — and never to the chrome or the type. They are named for what they do rather
than after anybody's film stock. The choice is remembered in this browser only.

**On the sound.** Off until asked, remembered afterwards, and it still waits for a click on every
visit, because a page that talks the moment it loads is rude even where browsers allow it. With it
on, the dial ticks four times a step as it turns, the shutter goes as each frame comes up, two
short beeps answer the click that turned it on, and rewinding the roll runs a motor.

**On the logo.** A 1:1 rounded square, black, with "noju" in Poppins SemiBold centred in it. No
webfont is involved: the four glyphs are committed as SVG outlines, and one geometry — the same
`viewBox`, plate and transform — is used by the header, the footer, the favicon and the 404 page,
and is copied from the header by the intro and by the mark that writes itself at the end of the
roll. The validator checks every copy against the others.

**On the intro.** The page opens the way a lens does: behind nine blades wider than the screen's
diagonal, with the mark on them, and after a breath the shutter goes and the blades swing open on
the hero. The motion is computed each frame from the clock, a click or a key hurries it to the
opening, and "Replay the intro" in the search palette runs it again. If `intro.js` never loads, a
CSS animation clears the black on its own a few seconds in; once it has loaded it keeps the same
promise with a timer of its own. Under `prefers-reduced-motion` there is no intro, the wheel
switches frames without the iris, and everything that would have moved is simply there.

**On other browsers.** `tools/e2e.js` checks the layout for horizontal overflow at eleven widths
from 320 px up, top to bottom, with `main`'s clip taken off so nothing is masked, and runs the page
with reduced motion and with scripts off. Three notes for anyone editing this:

- Nothing may set `overflow` on `html` or `body`. Body's overflow is handed to the viewport, where
  `clip` becomes `hidden` and the page stops scrolling at all; it is clipped on `main` instead, and
  with `clip`, not `hidden`, because `hidden` would make `main` a scroller and unpin the stage.
- A class the scripts put on `<html>` must never also be an element's class. The intro's overlay and
  the root's "intro is running" flag once shared one, and the whole document became a fixed,
  clipped, fading box — without an error. The validator checks this too.
- An SVG element turned by CSS turns about its view box's origin with `transform-origin: 0 0`, not
  `50% 50%`: the reference box starts at the origin, wherever the `viewBox` puts it.


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
| [`/type/`](type/) | **Type** | A typing trainer that never runs out of things to type. Sentences, terminal sessions (bash, zsh, fish, PowerShell, cmd, a Python prompt, SQLite — one-liners or multi-command sequences), code in sixteen languages, and random keyboard characters, all generated from seeds so the next challenge is almost never one you have seen. The page reshapes itself to match — a document, a terminal, a code editor, big keycaps — and the keyboard goes straight into it, with no box to click. See [`type/README.md`](type/README.md). |
| [`/hacks/`](hacks/) | **Hacks** | A movement shooter you are allowed to cheat in. Source's own movement code — bunny hop, air strafing and surfing fall out of it — with Apex's sprint, slide, wall climb and wall jump, six guns, and two blades that stick to any surface and lunge off it. Press H and write hacks in JavaScript — ESP, bone drawing, radars, aimbots, bhop scripts — that can read everything and change only you, with fourteen lessons from "hello" to projectile prediction. Bots, peer-to-peer rooms, rearrangeable phone controls. See [`hacks/README.md`](hacks/README.md). |
| [`/magic_sandbox/`](magic_sandbox/) | **Magic Sandbox** | The Loom Tower — a 3D top-down spell-crafting roguelite. Weave runes into elemental circles in the Spellforge, then ascend floor by floor. |
| [`/pwg/`](pwg/) | **Pinoy Word Games** | Hulaan ang dalawang salita — 100 cozy Filipino word levels, progress saved locally. See [`pwg/MANUAL.md`](pwg/MANUAL.md). |
| [`/antiafk/`](antiafk/) | **Anti-AFK** | Keeps a screen awake with a Screen Wake Lock held open behind a decoy video player. |
| [`/burst_dump/`](burst_dump/) | **Burst//Dump** | Cuts a folder of photos into a seeded photo-dump reel and records it to MP4/WebM in the browser. |
| [`/citybuilder/`](citybuilder/) | **SkyLine** | A pocket city sim — terraform, lay roads, zone a skyline that grows itself, with a day/night cycle and weather. |
| [`/routecast/`](routecast/) | **RouteCast** | A map navigator for cars and motorcycles that forecasts the weather *along* the route — each checkpoint read at the hour you are predicted to arrive there, colour-coded for risk, with vehicle-aware advice and a departure planner. Rides in a group over a phone-to-phone room, opens onto the public road with **PUBs**, draws a heat map of the roads you actually use, and keeps recording with the screen off. Built on OpenStreetMap, OSRM and Open-Meteo; no API keys. See [`routecast/README.md`](routecast/README.md). |
| [`/komyut/`](komyut/) | **TheCommuters** | A social app for directions. Community-filed commute routes — jeepney, bus, UV Express, tricycle, habal-habal, train, ferry — with stops in order, fares, votes that sink a route that no longer runs, comments, and a **validated** tag only moderators can move. Plans a trip across them with transfers, preferring the routes people have backed rather than the ones that merely look fast, and reads the weather along the line at the hour you would be there. Aimed at the Philippines, not limited to it. Reading needs no account. Supabase behind it, with the whole schema and every Row Level Security policy in [`komyut/supabase/schema.sql`](komyut/supabase/schema.sql). See [`komyut/README.md`](komyut/README.md). |
| [`/arco/`](arco/) | **ARCO** | A guitar for a phone held sideways: six physically modelled strings on a real neck — hammer-ons, pull-offs, slides, bends, power chords, palm mutes — with the original two-thumb arcs as a second layout. Offline, no samples. |

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