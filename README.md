# nojukuramu.github.io

Personal GitHub Pages site. Each sub-folder is a self-contained static project that can be
visited directly at `https://nojukuramu.github.io/<folder>/`.

The root (`index.html`) is a small interactive landing page — **"The Atelier"** — that ties the
projects together: light/dark themes, a command palette (`/`), an *Elemental Echo* minigame, and a
discreet, multi-step treasure hunt for the curious. (Start at the ✦ in the footer.)

## Projects

| Path | Project | Description |
|------|---------|-------------|
| [`/magic_circles/`](magic_circles/) | **Magic Circles — A Certain RPG Game** | A magic-based RPG prototype where spells are *drawn*, not picked from a menu. Includes a canvas build, a Phaser.js edition, and a world-chunk editor. |
| [`/task-notes/`](task-notes/) | **Task Notes** | Installable PWA sticky-note reminders — add tasks, set interval/datetime alerts, auto-snooze, tags, subtasks, and more. All data saved locally in the browser. |

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

A browser-based sticky-note reminder app installable as a PWA. Highlights:

- Add, color, pin, tag, and subtask tasks
- Rich reminders: interval-based, datetime (with recurring), auto-snooze, lead-time heads-up, quiet hours
- **Reminder caveat:** reminders fire reliably while the app is open. There is no backend server, so alerts
  cannot reach you when the tab is fully closed — missed reminders catch up immediately on next open.
- All data stored in `localStorage` (namespaced key `task-notes:v1`) — no sign-in, no server
- Offline-capable (service worker caches app shell); installable via Chrome/Edge "Install" prompt or iOS Share → Add to Home Screen

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
└── task-notes/        # Task Notes — sticky-note reminder PWA
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