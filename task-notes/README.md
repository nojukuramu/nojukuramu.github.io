# Task Notes

A sticky-note task reminder webapp — installable as a desktop/mobile PWA, with rich reminder options, offline support, and all data saved locally in your browser.

Live at: **[nojukuramu.github.io/task-notes/](https://nojukuramu.github.io/task-notes/)**

## Features

- **Add tasks** via a `+` button that reveals an inline input; rapid sequential entry with Enter
- **Sticky-note cards** — colorful pastel notes (yellow, pink, blue, green, purple, gray), pinnable, prioritized
- **Rich reminders** per task:
  - *At a time* — one-shot or recurring (daily / weekly / weekdays / monthly / custom)
  - *Every…* — interval-based (e.g. every 30 minutes)
  - *Lead-time heads-up* — alert N minutes before the due time
  - *Auto-snooze* — re-alerts if you don't dismiss, with configurable frequency and a max-snoozes cap
  - *Quiet hours* — suppress alerts overnight and defer to morning
  - *Priority* (low / normal / high) — affects banner color and sort order
- **Tags** — label tasks and filter by tag
- **Subtasks / checklists** — break a task into steps
- **Search, filter, and sort** — search by text, filter by status (all / active / done / overdue) or tag, sort by newest / priority / due date / A–Z
- **Export / import** — download or upload a JSON backup
- **Two layout modes** — full editor view or compact sticky-note view; manual toggle + auto-responsive; pop-out any note into its own small window
- **Installable PWA** — install to desktop or home screen; works offline (app shell cached)
- **Web Notifications** — desktop alerts when the tab is backgrounded (requires permission)
- **LocalStorage persistence** — all data saved automatically in your browser; no server, no account

## Reminder engine — important note

Task Notes has **no backend server**, so reminders fire reliably while the app/tab is open.
- If the tab is **open** (even in background): alerts fire and Web Notifications appear.
- If the tab is **closed**: reminders cannot fire. When you reopen, any missed reminders catch up immediately, labeled "missed while closed."
- On **Chromium with the PWA installed**: best-effort background sync is registered but timing is not guaranteed.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `+` or `n` | Add a new task |
| `Enter` | Commit the new task (then immediately add another) |
| `Esc` | Cancel / close |
| `e` | Open editor for the focused task card |
| `Space` | Toggle done on focused task card |

## Local development

```
python3 -m http.server
# then open http://localhost:8000/task-notes/
```

The service worker and Web Notifications both work on `localhost` (it's a secure context).

## File structure

```
task-notes/
├── index.html              # App shell
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # Service worker (offline + notification actions)
├── offline.html            # Fallback when offline
└── static/
    ├── css/app.css         # All styles — light theme, sticky-note cards, modes
    ├── js/
    │   ├── model.js        # Task factory and data shapes
    │   ├── store.js        # localStorage persistence (versioned, migration-ready)
    │   ├── notify.js       # Notification permission + in-app banners
    │   ├── reminders.js    # Reminder engine (timestamp-based tick sweep)
    │   ├── search.js       # Filter / sort / search
    │   ├── modes.js        # Compact ↔ full layout switching + pop-out
    │   ├── ui.js           # All UI rendering and event wiring
    │   ├── pwa.js          # SW registration + install prompt
    │   └── app.js          # Bootstrap
    └── icons/              # PWA icons (192, 512, maskable, apple-touch, favicon)
```

## Roadmap

- Drag-and-drop reorder / manual sort
- Lists / projects / sections
- Calendar and "Today / Upcoming / Overdue" grouped views
- Cloud sync via user-supplied Gist or Drive (no first-party backend)
- Markdown / rich-text notes
- Attachments via IndexedDB
- Dark mode
- Streaks / completion history
- Sound packs / custom notification tones
- Multi-window board / kanban
