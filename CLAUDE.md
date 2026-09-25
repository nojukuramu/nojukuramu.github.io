# Working in this repository

Standing instructions for anyone — human or agent — making changes here. These
apply to **every** project folder, not just the one being worked on. When a
project's own `CLAUDE.md` or `README.md` says something more specific, that
wins for that project; these are the defaults.

## Reuse before you build

**Always look for an existing implementation in another app in this repository
before writing a new one.** Reusing a feature is better than inventing a second
version of it. This is a site of a dozen static apps that have independently
solved the same problems, and every time one of them is solved twice the two
copies start drifting apart.

The reuse has to be real, not aspirational. In practice it means one of:

- **Lift the file.** `routecast/static/js/peer.js` is KaraokeNatin's transport
  with one namespace changed, and `routecast/static/js/qr.js` is its QR
  encoder. Say so at the top of the copy, and name where it came from.
- **Keep the protocol.** Where lifting the whole file does not fit, keep the
  wire format and the vocabulary identical — the service workers across this
  repository all answer the same `"skip-waiting"` message, so the update flow
  reads the same in all of them.
- **Copy the shape.** At minimum, follow the structure the working version
  already uses, so somebody who has read one has read them all.

Before adding anything non-trivial, grep for it:

```
grep -rln "<the thing>" --include=*.js --include=*.html . | grep -v vendor
```

Only write a fresh implementation when the existing one genuinely does not fit,
**or when the user explicitly asks for a new one.** If you do, say in the
commit message which existing version you looked at and why it did not fit.

## Every installable PWA gets auto-update

**Any app here that registers a service worker must be able to notice a new
version and offer it to the user.** A cached app with no update path is a phone
quietly running a build from three deploys ago, with a fix in it the user was
told about and cannot see. This is not optional and it is not a nice-to-have.

The pattern, already implemented in `the-wolf-game`, `karaokenatin` and
`routecast` — copy one of them rather than writing a fourth:

1. **The worker never takes over on its own.** No `skipWaiting()` inside
   `install`. A new build installs, parks itself in `waiting`, and stays there.
   Swapping code out from under somebody mid-session is the failure this
   replaces.
2. **The worker hands over when the page asks**, and the word is always the
   same:
   ```js
   self.addEventListener("message", function (e) {
     if (e.data === "skip-waiting") self.skipWaiting();
   });
   ```
3. **The page watches the registration**: `reg.waiting` on load,
   `updatefound` → the installing worker's `statechange`, and a
   `controllerchange` listener that reloads — but only when there *was* a
   controller before, since the first worker claiming a page is an install,
   not an update.
4. **The page checks periodically**: on load, every ~30 minutes while visible,
   when it comes back from hidden, and when the network returns. Each check is
   one conditional request for `sw.js`.
5. **The user is prompted, and decides.** A dismissible one-line bar offering a
   reload, plus a version line somewhere permanent with a manual "Check for
   updates". If a reload would interrupt something (a ride, a room, a game in
   progress), confirm first.
6. **One version number.** The page declares it (`window.RC_VERSION` or
   equivalent) and the worker's cache name carries the same value, with a check
   in the project's validation tool that refuses to let the two drift apart.
   Bumping it is what publishes an update.

### Where this stands today

Audited at the time of writing. Anything in the second or third list is a bug waiting to be
reported as "the app is stuck on an old version", and should be brought up to the pattern the
next time that app is touched — reusing `routecast/static/js/update.js` or
`the-wolf-game/js/app.js` rather than writing a fourth version.

| App | Worker waits | Page prompts |
|-----|--------------|--------------|
| `routecast` | yes | yes |
| `komyut` | yes | yes |
| `magic_sandbox` | yes | yes |
| `the-wolf-game` | yes | yes |
| `karaokenatin` | yes | yes |
| `hacks` | yes | yes |
| `task-notes` | yes | **no** — the worker waits for a handover nobody ever asks for |
| `arco` | yes | **no** |
| `pwg` | **no** — `skipWaiting()` in `install` | partial |
| `3dtd`, `antiafk`, `burst_dump`, `citybuilder`, `magic_circles` | **no** | **no** |

## Keep the interface quiet

**The UI says one line; the explanation lives somewhere you can go and get it.**
A pane you have to read is a pane nobody reads.

- A hint under a field or a switch is **one short line**. If it needs a
  paragraph, the paragraph does not belong on the pane.
- Long copy — what a feature does, what it costs, what it shares, why a default
  is what it is — goes in a **popup/sheet opened from a small (i)** beside the
  thing it explains. See `routecast/static/js/info.js` for the implementation:
  one sheet, one registry of topics, delegated clicks, copy in one file so the
  same explanation can be reached from several places without drifting.
- Keep the copy in **one place**, not inline in the markup. It makes the HTML
  shorter and the explanations findable.
- Empty states are one line. A list explaining itself while it has nothing in it
  is a paragraph nobody asked for.
- Warnings that carry a real consequence (sharing a location publicly, deleting
  something) stay visible and short; the detail behind them goes in the sheet.

## House style, across every project

- **No build step, no framework, no bundler.** Plain HTML, CSS and JavaScript.
  Dependencies are vendored under the project's `vendor/`.
- **No emoji in source.** Every glyph is an inline SVG. The validation tools
  enforce this.
- **No API keys**, and therefore no service that needs one. A key in a public
  script is a donation, not a secret.
- **Nothing leaves the device that does not have to.** Where an app shares
  anything — a position, a name — it is opt-in, it says what it shares, and
  there is a way to stop it that is always within one tap.
- **Comments explain the decision, not the syntax.** Say why the obvious
  approach was not taken; the code already says what it does.
- **Run the project's own checks before committing.** Most folders have a
  `tools/validate.js` or similar; `node tools/validate.js` from the project
  directory. If a change adds an invariant worth keeping, add a check for it.
