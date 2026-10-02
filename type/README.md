# Type

A typing trainer that never runs out of things to type. Open it and start typing:
there is no box to click, because the page keeps one focused for you. Plain HTML, CSS
and JavaScript, no build step, no dependencies, works offline once loaded, and nothing
leaves the device.

## The categories

| Category | What you type |
|----------|---------------|
| **Mixed** (default) | Text, Terminal or Code, chosen at random each time. Random keys are left out on purpose. |
| **Text** | Ordinary sentences: short sayings and made-up little scenes. |
| **Terminal** | Shell commands from bash, zsh, fish, PowerShell, cmd, a Python prompt and SQLite. Short is one command. Medium and long are *sessions*: four to eleven commands that belong together, with Enter between them. The prompt follows `cd` and is shown but not typed. |
| **Code** | Small snippets from sixteen languages (JavaScript, TypeScript, Python, C, C++, Java, C#, Go, Rust, Ruby, PHP, Kotlin, SQL, HTML, CSS, Bash) in a code editor with line numbers and syntax colour. Indentation is shown but not typed: Enter lands the cursor on the next line's first character. |
| **Keys** | Random keyboard characters from a random part of the keyboard: brackets and operators one time, digits and the shifted row the next. |

Each has three lengths: short, medium, long.

## Keys

`Esc` a new challenge · `Tab` the same one again · `Enter` the next one, once you have finished · `Alt+1`..`Alt+5` switch category.
Mistakes stay on screen in red until you backspace over them, and a challenge ends when the whole thing is right.
Pasting is switched off.

## Where the challenges come from

Nothing is stored as a finished challenge. Each is built from a seed:

- **Text** mixes about eighty hand-written lines with a sentence composer (a subject, a deed, a setting) that yields tens of thousands of distinct sentences.
- **Terminal** and **Code** are *templates with holes*: file names, directories, hosts, ports, function names, types, numbers and strings are filled per challenge, in the language's own naming style. Holes keep their value within a challenge, so `mkdir reports` is followed by `cd reports`.
- **Keys** draws groups from a mix of character sets chosen per challenge.

The same `(category, length, seed)` is always the same challenge, which is what makes
Tab ("again") exact. The seed is shown in the footer, and `?seed=abc123` opens the page on it.
The last 300 challenges are remembered in the browser so the same text is not dealt twice.
`node tools/validate.js` regenerates thousands of them and counts the repeats.

## Racing

The **Race** button opens three ways in. Everyone gets the same challenge (the host picks a
seed and every browser builds it with the same generator) and types it at the same moment
after a 3-2-1.

| Way in | How it works |
|--------|--------------|
| **Private room** | Create a room and send the six-letter code, or the link (`?room=CODE`). The host picks category and length; guests press ready; the host starts. |
| **Public rooms** | A host who leaves "private" off is listed for everyone. The list is live: join any room still in its lobby. |
| **Quick match** | Walks into the fullest open room, or starts one and waits. The race starts by itself a few seconds after a second player arrives. If two people press the button at the same instant, the larger room code gives way to the smaller, so exactly one room survives. |

There is no game server. Rooms are WebRTC data channels and the room code is the host's
peer id; the public list is a directory held by whichever browser got there first, and a
free public PeerJS broker only introduces browsers to each other. `js/peer.js` and
`js/lobby.js` are lifted from Hacks (which lifted them from KaraokeNatin), and
`tools/validate.js` checks `peer.js` is still Hacks' file with only the namespace changed.

What a race shares: your name, how many characters you have right, your speed and your
finishing time. Never the text. Nothing is sent unless you open the Race screen, and
Leave stops it at once. The host is the referee: a finishing time that would need more
than thirty characters a second is not ranked.

## The conversation

One time in ten thousand, a Normal Text challenge is a chat instead of a paragraph. Other
people talk; your lines are shown as faint phantom letters in the message box. Type one
and it is sent, and the room answers straight away. The clock only runs while you are
typing, not while the others are. It is meant to be a surprise, so nothing on the page
mentions it.

There are 32 scripts in six kinds:

| Kind | What it is |
|------|------------|
| `explain` | A breakup where you are the one explaining what the other is pointing out. |
| `left` | A breakup where you are the one being left. |
| `sweet` | Long, warm messages: an anniversary, a goodnight across time zones, a thank-you letter, a goodbye to a best friend. |
| `ghost` | Trying to impress someone who never replies. "Seen 9:43 pm" and nothing else. |
| `funny` | Support loops, a mother sending soup by bus, a wrong number, a missing casserole dish. |
| `casual` | Ordinary friends. |

To see one without waiting, open the page with `?convo`, or ask for a kind: `?convo=left`,
`?convo=ghost`. Conversations never appear in a race.

## The look

Warm paper, ink outlines, hard offset shadows, and keys that sit proud of the page and press
down. Light everywhere except the terminal, which stays a dark window because that is what a
terminal is. One hot red for the caret and the numbers, a sun yellow for whatever you can
press. System fonts only.

## Layout

```
type/
├── index.html          # the page: toolbar, five faces, result, footer
├── css/type.css
├── js/
│   ├── main.js         # the page: focus, input, painting, the controls
│   ├── gen.js          # one door to every generator
│   ├── gen-text.js  gen-terminal.js  gen-code.js  gen-keys.js  convo.js
│   ├── fill.js         # template holes, kept consistent within a challenge
│   ├── mp.js           # racing: the lobby screens, the countdown, lanes, results
│   ├── race.js         # the rules of a race (settings, listings, ranking), no DOM or network
│   ├── lobby.js  peer.js   # rooms and the public list, lifted from hacks
│   ├── words.js  rng.js  engine.js  highlight.js  store.js
│   ├── info.js         # the (i) sheet, lifted from hacks
│   └── update.js       # update flow, lifted from hacks
├── sw.js  manifest.webmanifest  assets/icons/
└── tools/validate.js  tools/e2e.js  tools/mp-e2e.js  tools/broker.js
```

## Checks

```
node tools/validate.js    # static checks + generators + typing maths (no dependencies)
node tools/e2e.js         # real Chromium via Playwright; skipped where it is not installed
node tools/mp-e2e.js      # several browsers racing over real WebRTC through a local stand-in broker
```

## Updates

The service worker never takes over by itself (CLAUDE.md, "Every installable PWA gets
auto-update"). A new build waits; the page notices it on load, every 30 minutes, when it
comes back from hidden and when the network returns; and offers a one-line bar. If a
challenge is half typed, reloading is confirmed first. `window.TY_VERSION` in
`index.html` and `CACHE` in `sw.js` carry one number, checked by `tools/validate.js`;
bumping it publishes an update.
