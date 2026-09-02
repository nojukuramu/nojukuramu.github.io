# KaraokeNatin (web)

A karaoke room that runs entirely in browsers. One screen hosts and plays the video;
everyone else scans a QR code and their phone becomes a remote — search a song, queue it,
reorder, skip.

This is a stripped-down web port of the [KaraokeNatin desktop
app](https://github.com/nojukuramu/KaraokeNatin) (Tauri + Rust). The desktop version runs a
real server on the host machine. A GitHub Pages site cannot, so this version is built around
that constraint rather than pretending it away.

Live at **https://nojukuramu.github.io/karaokenatin/**

---

## How it connects without a backend

Two browsers can talk directly over a WebRTC data channel, but they cannot *find* each other
alone — someone has to pass the first connection details across. That is the only job given
away here:

```
Host screen ──── register "kn-ABC123" ────▶  public PeerJS broker  ◀──── "who is kn-ABC123?" ──── Guest phone
     ▲                                       (relays SDP + ICE only)                                  │
     └──────────────── WebRTC data channel, direct, everything else ────────────────────────────┘
```

The room code **is** the host's peer id (`kn-<code>`), so a guest needs nothing but the code
to find the host. The broker sees a handful of connection-setup messages and nothing else —
the queue, names, commands, and playback state never touch it.

The PeerJS wire protocol is implemented directly in [`js/peer.js`](js/peer.js) (~40 lines of
WebSocket); the PeerJS library itself is not used. There are no dependencies of any kind, no
build step, and no CDN — every byte is in this folder.

### What makes the connection hold up

Room connections are the part that actually breaks in the wild, so redundancy is layered:

- **Two brokers, not one.** The host registers on *all* of them simultaneously; a guest walks
  the list until one answers. Either can be down without the room noticing.
- **STUN + TURN.** Several STUN servers, plus a public TURN relay so links still form behind
  symmetric NAT, where plain peer-to-peer fails.
- **Heartbeats.** Every data channel pings; twenty seconds of silence is treated as death
  rather than waiting for a TCP timeout that may never come.
- **Backoff with jitter** on every reconnect, so a flapping network does not turn into a
  stampede — capped hard while the tab is on screen, because somebody is watching it.
- **Snapshot state.** The host broadcasts the whole room state on every change, so a guest
  that missed messages is correct again the moment one lands — no patch replay to get wrong.
- **Queued commands.** Anything you tap while offline is held and flushed when the channel
  reopens.
- **Session resume.** The host's room code, token, and queue survive a reload; guests are
  offered a rejoin. Reopening the same code puts everyone back in the same room.

### Coming back

The hard case is not a link that breaks — it is a *page* that stops. A pocketed phone, a
closed lid, a tab left behind for an hour: the socket still reports `open`, the timers that
would have noticed never ran, and the browser says nothing on the way back in. Everything the
page believed about its connection was frozen along with it, so none of it can be trusted.

- **Every wake-up is heard.** Visibility, `focus`, `online`, a bfcache restore (the only
  signal iOS Safari gives), and a clock-gap check for the case none of those fire at all — a
  laptop that slept with this tab in front, where the page never lost focus and every timer in
  it simply stopped. Both roles listen: a host nobody can find is as dead as a guest.
- **Ask, don't assume.** A channel that claims to be open is probed on wake, and rebuilt at
  once if it does not answer — rather than waiting out a silence timer that was not running
  anyway. The same silence measured *across* a freeze proves nothing, so it never kills a link
  that was fine.
- **One attempt at a time.** Reconnection is a single supervised attempt guarded by a
  generation counter, with every timer owned and cancellable. Wake-ups used to each start a
  fresh attempt without cancelling the one already scheduled — all sharing one connection id,
  so each new attempt made the host discard the previous link, whose close scheduled another
  attempt. A phone picked up twice could sit there retrying forever.
- **A stale id is not a lost room.** A broker holds a peer id for a while after the socket
  behind it dies, so a host that reconnects quickly is told its own room code is taken. It
  waits that out with the same token instead of believing it, and only surrenders the code
  after every broker has said so several times over. Renaming the room strands every guest
  holding the old one.
- **The host cleans up after itself.** On wake it re-registers, proves each guest link, and
  re-broadcasts the room — so the guest list is not full of people who left during the nap,
  and everyone still there is looking at the same queue.

## Search

Two independent public mirror networks, tried in order, several hosts at a time:

1. **Piped** — `/search?q=…&filter=videos`
2. **Invidious** — `/api/v1/search?q=…&type=video`

Whichever answers first wins, and the winner is remembered for next time. If both tiers are
exhausted the app says search is unavailable rather than spinning — and **pasting a YouTube
link always works**, since that path needs no mirror at all (title lookup falls back through
YouTube's own oembed, then Piped, then Invidious, then a bare playable entry).

Queries are quietly biased toward karaoke tracks: `anak` goes to the mirror as `anak karaoke`,
because this is a karaoke app and the official music video is almost never what you want. The
bias never appears in the search box — echoing back a query the user did not type reads as a
bug — and is skipped when they already said "karaoke" themselves. See `biasToKaraoke` in
`js/search.js`.

## Library

Saved songs and playlists live in this browser and nowhere else. Tap ☆ on any search result to
keep it, ＋ to file it into a playlist. The library opens **without a room** (`#/library`), so a
set list can be built on the couch and queued in one tap when the room opens; search works there
too. Playlists can be reordered, renamed, and exported to JSON — local-only storage is one
cleared cache away from gone, so it has to be something you can carry out.

The relationship with a room is one-way: a room borrows from your library, never the reverse.
Nothing another guest does can reach into it.

## Install

The app is a PWA — installable on a phone, a desktop, or an Android TV, where it opens
full-screen with no browser chrome. The Install button on the home screen fires the browser's
own prompt where one exists (Chromium), and shows the manual steps where it does not (Safari,
Firefox). A service worker precaches the shell, so the app and your library open with no
network; playback still needs one.

Icons are generated from the desktop app's icon by `tools/make-icons.py` and committed, so the
site keeps its no-build-step promise.

### Staying current

Installed, there is no address bar to reload from, so a cached shell would otherwise serve last
month's build forever. The page asks the service worker for a newer one on load, when it comes
back to the foreground (at most every 30 minutes), and on **Check for updates** in the footer
next to the running version. A new build parks itself in `waiting` rather than taking over
mid-song: the app offers it, and a reload swaps it in only once you accept — or a toast says so
if you are in a room at the time.

## Names

A queue is a list of turns and a turn belongs to somebody, so a room will not let an unnamed
guest in. The home screen's Join form asks for a name alongside the code, and someone arriving
straight from a QR link meets the same question before the connection is made. The name is
remembered in this browser, so it is asked once and never again — and it can be changed from the
Invite tab inside a room, where it may be edited but not emptied.

## Files

| Path | What it is |
|---|---|
| `index.html` | Both screens (home, room); no framework |
| `css/app.css` | One stylesheet, mobile-first |
| `js/peer.js` | Broker protocol, WebRTC links, host/guest roles |
| `js/room.js` | Room state and the rules for changing it |
| `js/search.js` | Piped → Invidious fallback, link parsing |
| `js/player.js` | YouTube IFrame API wrapper (host only) |
| `js/qr.js` | QR encoder, written from scratch (byte mode, v1–12, ECC L/M) |
| `js/library.js` | Saved songs and playlists, stored in the browser |
| `js/app.js` | Screens, wiring, and the host/guest seam |
| `sw.js` · `manifest.webmanifest` · `icons/` | Makes it installable and offline-capable |
| `tools/` | Tests and the icon generator — not served, not needed at runtime |

## Tests

```bash
node tools/qr-test.js         # QR conformance: module counts, block layouts, capacities
node tools/e2e.js             # two real browsers, one real WebRTC link (needs playwright)
node tools/reconnect-e2e.js   # leaving the browser and coming back           (playwright)
node tools/player-e2e.js      # playback state machine against a mock player  (playwright)
node tools/library-e2e.js     # library, playlists, export/import, karaoke bias (playwright)
node tools/install-e2e.js     # manifest, service worker, install button      (playwright)
```

`tools/e2e.js` boots a static server and a local stand-in for the broker
(`tools/broker.js`, a dependency-free WebSocket server), opens a host and a guest in
Chromium, and drives a full session: connect, search, queue, reorder, remove, sever the link
and reconnect, reload the host. It never contacts a public broker, Piped, or YouTube — the
YouTube API is deliberately blocked, which also exercises the degraded-player path.

`tools/reconnect-e2e.js` covers the other half of that: not a link cut, but a page that went
away. It hides the guest tab and restarts the host underneath it, fires a flurry of wake-ups at
a guest whose room has vanished and counts the retry loops that result, kills the host's
signalling socket the way a sleeping laptop does, and squats on the host's peer id with a
foreign token to check the room keeps its code rather than renaming itself. Each check stands
for a way the room used to stay broken; two of them fail outright against the previous
connection code.

`tools/library-e2e.js` builds a library with no room at all, checks it survives a reload and a
round-trip through export/import, and then joins a room to queue a playlist into it. It also
asserts the karaoke bias reaches the wire and never the input box.

`tools/install-e2e.js` checks the static installability contract (manifest fields, icon sizes,
a worker with a fetch handler) and then our behaviour around the prompt — deferring it, firing
it on click, remembering a dismissal, and falling back to manual instructions when no prompt
event ever arrives.

`tools/player-e2e.js` covers playback by serving a stand-in for the IFrame API that behaves
the way YouTube's really does in the two awkward cases: `loadVideoById` landing in `CUED`
instead of playing, and `playVideo` being ignored until the page has seen a user gesture. It
checks the CUED kick, the blocked-autoplay prompt, the tap that clears it, the state
reaching a guest, remote pause, `ENDED` advancing the queue, and volume/mute reaching the
player.

## Known limits

- **The host tab must stay open.** It is the player and the source of truth. It requests a
  screen wake lock where the browser allows one.
- **One tap on the host, once per session.** The desktop app plays straight away because a
  Tauri webview has no autoplay policy; a browser refuses to start audible video until the
  page has seen a user gesture. When the first song is queued from a phone and nobody has
  touched the host screen, the room puts up a tap-to-play prompt instead of appearing to
  hang. After that tap, songs start on their own for the rest of the session.
- **Very restrictive networks can block peer-to-peer entirely.** TURN covers most of it, but
  not a firewall that drops UDP and non-standard TCP alike.
- **Public brokers and mirrors are other people's infrastructure.** They go down. The
  fallbacks are why there are several of each, but "all of them at once" is possible.
- **Embedding is the video owner's choice.** A video that disallows embedding cannot play;
  the room reports it and skips.
- **The room code is the only door.** Anyone who has it can join, and six characters from a
  32-symbol alphabet is guessable given enough tries against a public broker. That is fine
  for a party in a living room and not fine for anything you would mind a stranger seeing.
  Close the room when you are done.

## Differences from the desktop app

| | Desktop (Tauri) | This |
|---|---|---|
| Signalling | Rust socket.io server on the host | Public PeerJS broker |
| Guest UI | Served over LAN HTTP by the host | Same static page, `#/r/<code>` |
| State | Rust `RwLock<RoomState>` | Host JS, snapshot-broadcast |
| Search | `rusty_ytdl` in-process | Piped / Invidious mirrors |
| Playlists, scoring, mic coverage | Yes | Not in this MVP |
