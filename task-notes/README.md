# Task Notes

A notebook with a real alarm clock inside it. Markdown notes, alarms that actually ring,
and enough organisation to keep a few hundred of them straight — all in the browser, with
no account and no server.

Live at **[nojukuramu.github.io/task-notes/](https://nojukuramu.github.io/task-notes/)**

---

## What it does

### Notes

- **Markdown bodies** — headings, bold/italic/strikethrough, `code`, fenced blocks,
  quotes, links, `==highlight==`, bullet and numbered lists.
- **Checklists** that are part of the text (`- [ ] thing`). Tick them straight on the card;
  the progress bar and the `3/7` counter come from the body, so nothing can drift out of sync.
- **Nine colours**, pin, star, and four priority levels.
- **Tags** with autocomplete, and **notebooks** for coarser grouping.
- **Archive** for notes you want out of the way, **trash** for ones you probably want gone.
  Both are reversible; nothing is deleted until you say so twice.
- Duplicate, copy to clipboard, export a single note as `.md`.
- A formatting toolbar, `Ctrl+B` / `Ctrl+I`, and Enter continuing the list you are in.

### Alarms

Every note can carry **as many reminders as you like**, and each one is either:

| | |
|---|---|
| **⏰ Alarm** | Takes over the screen, rings, escalates in volume, vibrates, holds the screen awake, and keeps going until you answer it. |
| **🔔 Notification** | A quiet actionable toast plus a system notification. |

Schedules available per reminder:

- **Once** — a specific date and time.
- **Daily** — every day at a time.
- **Weekly** — any set of weekdays at a time.
- **Monthly** — the *n*th of the month; short months fall back to their last day.
- **Yearly** — a month and day.
- **Every…** — an interval of minutes, hours, days or weeks. Day and week intervals land on
  a wall-clock time and step by calendar days, so they survive daylight saving.

Plus, per reminder: an optional label, one of eight synthesised ringtones, volume,
vibration, an end date, whether it respects quiet hours, and an auto-snooze rule
("re-alert every 5 minutes, up to 3 times, if I don't answer").

Answering an alarm: **Snooze** (default or a picked duration up to a day), **Mark done**,
**Dismiss**, or **Open note**. A recurring alarm on a note you already ticked off will
un-tick it — which is what makes "water the plants, every Tuesday" behave sensibly.

### Finding things

- Views: **grid** (masonry), **list**, **board** (by priority/status), **agenda**
  (Overdue / Today / Tomorrow / This week / Later), **calendar** (a month of expanded
  recurrences).
- Scopes: All, Today, Upcoming, Overdue, Alarms, Starred, Completed, per-notebook,
  per-tag, Archive, Trash — each with a live count.
- Search with `#tag`, `is:done`, `is:open`, `is:alarm`, `is:pinned`, or plain text.
- Sort by manual order (drag to reorder), last edited, created, title, next alarm, or priority.
- **Multi-select** for bulk colour, tag, pin, complete, move to notebook, archive or delete.
- **Undo/redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) over every destructive action.
- A **command palette** (`Ctrl+K`) that searches notes and commands together.

### The rest

- Light / dark / system theme, seven accents, comfortable or compact density,
  12- or 24-hour clock, Monday or Sunday week start.
- Quiet hours — alarms landing inside the window wait until it ends.
- JSON backup export/import (replace or merge), plus a whole-library Markdown export.
- Installable PWA, fully offline, opens in its own window with shortcuts for
  New note / Today / Alarms.

---

## How reminders actually fire

This is the part the previous version got wrong, so it is worth being precise.

Notes live in **IndexedDB**, not `localStorage`. That single change is what makes
background alarms possible, because a service worker can read IndexedDB and
`localStorage` is off-limits to it.

There are three delivery paths, and the app uses whichever the browser supports:

1. **Notification Triggers** (`TimestampTrigger`, Chromium). Upcoming alerts are handed to
   the operating system in advance, so they fire **even with the app completely closed**.
   The app re-syncs up to 30 upcoming occurrences whenever the schedule changes.
2. **The service worker.** On `periodicsync` (or an explicit sweep) the worker reads
   IndexedDB, works out what is due using its own copy of the scheduling engine, posts the
   notifications itself, advances the schedules and tells any open tab to reload. Answering
   a notification's *Snooze* or *Mark done* action is applied directly to IndexedDB by the
   worker — no tab required.
3. **The page**, whenever a tab is open. It sleeps until the next reminder is due rather
   than polling, and re-checks on focus, visibility change and reconnect, so a laptop coming
   out of sleep catches up immediately.

Anything that was due while nothing was running is shown as a **missed alarm** on next
open, labelled with how late it is, rather than pretending it fired on time.

Two honest caveats:

- On browsers without Notification Triggers (Firefox, Safari), alarms can only fire while a
  tab or the installed app is running. The app says so plainly in the status strip instead
  of quietly failing. **Settings → Alarms → Keep timers running in background tabs** plays a
  loop of silence so the browser stops throttling timers in a backgrounded tab.
- iOS requires the app to be installed to the Home Screen before it will show notifications
  at all.

Only one open tab rings for a given firing; the others stand down via a short-lived lock.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `N` | New note |
| `/` | Focus search |
| `Ctrl`+`K` | Command palette |
| `E` | Edit the focused note |
| `Space` | Toggle done |
| `A` | Add an alarm |
| `P` / `S` | Pin / star |
| `X` | Add to selection |
| `#` | Archive |
| `Delete` | Move to trash |
| `1`–`5` | Grid / list / board / agenda / calendar |
| `Ctrl`+`Z`, `Ctrl`+`Shift`+`Z` | Undo, redo |
| `Esc` | Close, or clear search and selection |
| `?` | Shortcut list |

While an alarm is ringing: `S` snooze, `Enter` mark done, `D` or `Esc` dismiss.

---

## Local development

```
python3 -m http.server
# then open http://localhost:8000/task-notes/
```

Service workers, notifications and IndexedDB all work on `localhost` because it counts as a
secure context. There is no build step — every file is served exactly as it sits in the repo.

## File structure

```
task-notes/
├── index.html              # App shell
├── manifest.webmanifest    # PWA manifest, icons and shortcuts
├── sw.js                   # Offline cache + worker-side alarm engine
├── offline.html            # Fallback if even the cached shell is missing
└── static/
    ├── css/app.css         # Whole design system, light + dark
    ├── icons/              # PWA icons, badge, favicon
    └── js/
        ├── db.js           # IndexedDB wrapper       ─┐ loaded by the page
        ├── schedule.js     # Recurrence maths         ├─ and by the service
        ├── model.js        # Shapes and defaults     ─┘ worker, so DOM-free
        ├── store.js        # State, persistence, cross-tab sync, undo
        ├── markdown.js     # The markdown subset
        ├── audio.js        # Synthesised ringtones (no audio files)
        ├── notify.js       # Permissions, notifications, timestamp triggers
        ├── engine.js       # Page-side scheduler
        ├── alarm.js        # The ringing screen
        ├── ui.js           # Shell, views, cards, selection, drag
        ├── editor.js       # Note editor, alarm dialog, settings, palette
        └── app.js          # Bootstrap, shortcuts, PWA plumbing
```

`db.js`, `schedule.js` and `model.js` never touch `window` or `document` — that is what lets
`sw.js` `importScripts` them and run the same scheduling logic the page does.

## Data

Everything is stored in the `task-notes` IndexedDB database on your device:
`notes`, `notebooks`, and a `kv` store holding settings. Nothing is sent anywhere.
Notes from the old `localStorage` version (`task-notes:v1`) are imported automatically on
first run — subtasks become checklist lines, reminders become the closest new schedule — and
the old payload is kept under `task-notes:v1:archived` just in case.
