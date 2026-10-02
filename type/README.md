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

## The conversation

One time in ten thousand, a Normal Text challenge is a chat instead of a paragraph. Other
people talk; your lines are shown as faint phantom letters in the message box. Type one
and it is sent, and the room answers straight away. The clock only runs while you are
typing, not while the others are. It is meant to be a surprise, so nothing on the page
mentions it. To see one without waiting, open the page with `?convo`.

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
│   ├── words.js  rng.js  engine.js  highlight.js  store.js
│   ├── info.js         # the (i) sheet, lifted from hacks
│   └── update.js       # update flow, lifted from hacks
├── sw.js  manifest.webmanifest  assets/icons/
└── tools/validate.js  tools/e2e.js
```

## Checks

```
node tools/validate.js    # static checks + generators + typing maths (no dependencies)
node tools/e2e.js         # real Chromium via Playwright; skipped where it is not installed
```

## Updates

The service worker never takes over by itself (CLAUDE.md, "Every installable PWA gets
auto-update"). A new build waits; the page notices it on load, every 30 minutes, when it
comes back from hidden and when the network returns; and offers a one-line bar. If a
challenge is half typed, reloading is confirmed first. `window.TY_VERSION` in
`index.html` and `CACHE` in `sw.js` carry one number, checked by `tools/validate.js`;
bumping it publishes an update.
