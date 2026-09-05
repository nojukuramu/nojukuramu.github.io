# The Wolf Game

Werewolf for a room full of phones. Peer-to-peer over WebRTC, served as static
files from GitHub Pages, no accounts and no server of mine anywhere in it.

This is a refactor of the old pass-the-phone Wolf Game (`wolfgame-mobile`), and
it keeps every one of its 35 roles. What changed is everything about *when*
things happen.

---

## What is actually different

### The night is live, and first come first served

The old engine collected every night action into a bag and worked out the
consequences at dawn. That is the right design for one phone going round a
table, where "at the same time" has no meaning.

Here, thirty phones are awake at once and an action takes effect the moment it
is committed. A kill kills now. A shield only covers attacks that arrive after
it. A revival puts somebody back on their feet in time to take their own turn
the same night.

Which means being late is a real thing that can happen to you:

> The wolves settle on a house at 00:38. The Bodyguard picks that same door at
> 00:41. He does not fail to protect anybody — he opens the door and finds a
> body, and he is told so in the Bodyguard's own words.

That is not special-cased anywhere. It falls out of resolving in arrival order
and letting each house remember what has already happened to it.

The one action that cannot resolve on arrival is the pack's kill, because it is
not one player's decision. It resolves the instant it stops being open — when
the last living wolf has howled — rather than being deferred to dawn. A pack
that agrees early kills early, and everything the village does after that is
too late.

### Houses first, actions second

You do not pick an action and then a target. You walk up to a **door**, and are
then offered whatever your role can do *there*, given who is behind it and what
state they are in.

- Knocking is free and unrecorded. Scouting the village costs nothing.
- A visit only becomes a visit — the thing the Detective reads and the
  Engineer's trap catches — once you commit to something.
- Dead players still have houses. You can walk up to them.
- **Finding a body is not an action.** It happens to you when you knock, and
  the wording is the role's: a Bodyguard arriving too late and a wolf arriving
  second do not read the same, because they are not the same mistake.
- **Reporting is an action, it is free, and the killer may report their own
  work.** The village is told at dawn who found the body. It is never told
  whether finding it was a coincidence.

### The room's colour is a readout of the clock

Every phase names where the sun is when it starts and where it is when it ends.
The theme paints the blend continuously, so a five-minute discussion begins in
morning light and ends at noon; voting runs noon to dusk; the verdict drops into
night and the night comes back up to dawn.

Nobody has to be told the phase is nearly over. The room is already getting dark.

Both light and dark modes are the same **Ash Blue** family, and the time of day
tints whichever one you are in. Surfaces move a lot, ink barely moves — text
that drifts with the light is text you cannot read at dusk.

### Other things that are new

- **Rooms**, with a host as the single source of truth, co-hosts, approval at
  the door, kicking, and seating. Lifted from KaraokeNatin, which already runs
  this transport in anger.
- **Per-player snapshots.** The host never broadcasts state; it builds a
  redacted view *per recipient, per broadcast*. See "Redaction" below.
- **Cats and Dogs really cannot talk.** The restriction is applied on the host,
  to the text, before it is stored.
- **Cult recruitment is a real offer**, answered by the target on their own
  phone, instead of a 70% dice roll.
- **Fullscreen** and an **install button** (it is a proper PWA, offline shell
  and all).
- Settings **grouped by the question a host is actually asking** — clock, rules,
  room, events, look — rather than one column of unrelated checkboxes.

### Rules that changed on purpose

Two legacy behaviours were incoherent rather than merely unusual, and are now
what they were plainly written to mean:

- **Archangel.** The old engine both killed it and demoted it, so the
  retribution text fired over a corpse. It now *survives* the attempt, stripped
  to an ordinary Villager, and the people who came for it die. One enormous
  one-shot.
- **Solo roles no longer block a win they cannot reach.** A Jester who was never
  hanged used to keep a village of two people awake forever — no wolves left to
  kill anybody, no majority to hang anybody, and a condition that could not be
  met or ruled out. There is also a stalemate check of last resort, so a room
  can never sit through a game that has no ending.

---

## Layout

```
data/
  list_of_roles.json   every role: display, actions, which doors they light up
  list_of_events.json  festival, pandemic, blood moon, curfew, long night
  game_flow.json       the round, as data — durations, sky, capabilities, next
  sky.json             seven times of day, as full sets of theme tokens
js/
  net/peer.js          WebRTC over a public signalling rendezvous (from KaraokeNatin)
  engine/
    protocol.js        every message that crosses the wire
    roles.js           the registry: joins data to behaviour, and checks the join
    resolver.js        what happens, in the order it happens  ← the heart
    state.js           the shape of a room, and every knob a host can turn
    clock.js           the phase machine, and the sky it paints
    win.js             who has won, checked after anything that could change it
    events.js          the things that go wrong on top of everything else
    view.js            thirty different truths, built from one  ← the redaction
    engine.js          the thing that runs the game
  roles/               one file per role. 35 of them, plus _generic.js
  ui/
    theme.js           light/dark, and the time-of-day blend
    screens.js         the drawing half
  app.js               the wiring half: transport, identity, who may ask what
tools/                 tests, the local broker stand-in, the icon generator
```

### Adding a role

1. Add an entry to `data/list_of_roles.json` — name, team, lore, and the
   actions, each with a `houses` selector saying which doors it lights up.
2. Write `js/roles/<id>.js` with a handler per action and any passive hooks.
3. Add the `<script>` to `index.html`.

`roles.link()` refuses to start if those disagree in either direction: a handler
for an action the data has never heard of, or a declared action with nothing to
run it. That is deliberate — the alternative is a role that silently does
nothing on the one night it mattered.

Hooks a role may implement: `onKilled` (veto a death), `onDeath`, `onLynch`,
`onSomeoneDied`, `onFindBody` (the words at a door), `onConsent`, `onPhaseEnd`,
`brief` (what the role card shows tonight).

### Changing the flow

Edit `data/game_flow.json`. The engine walks that list and does not know what a
"discussion" is — it knows a phase has a duration, a sky, a set of capabilities,
and a name for what comes next. Reordering the round, inserting a phase, or
giving one its own clock is an edit to that file.

---

## Redaction

The host is the only place the game exists. There is no server to check
anything, so "may I see this" and "may I do this" are decided in exactly two
files: `engine/view.js` and `engine/engine.js`.

`view.js` is a **whitelist**, and has to stay one. Redacting by deleting fields
means the day somebody adds `state.night.shields`, the Doctor's target leaks to
every phone in the room and nothing anywhere errors. Building the view field by
field means a new field is invisible until somebody decides who may see it.

The tests assert this directly: no shield, no visit log, no quiz answer key and
no pack tally reaches a phone that should not have it.

---

## Tests

```
node tools/engine-test.js    # 107 assertions, no browser, no network
node tools/consistency.js    #  16 checks for drift between files that must agree
node tools/e2e.js            #  37 assertions: four real browsers, one real room
node tools/shots.js          # a screenshot of every screen in both themes
node tools/make-icons.py     # regenerate the app icon
```

`e2e.js` never touches a public broker: `tools/broker.js` is a ~120-line local
stand-in for the PeerJS signalling protocol, so the suite runs with no egress
and no dependency on anybody else's uptime. The WebRTC link itself is real, and
so is the timing case it exists to prove.

## Signalling

There is no backend. GitHub Pages serves static files, so the only thing missing
for peer-to-peer is a meeting point — somewhere two browsers can swap SDP offers
before they talk directly. The public PeerJS brokers are borrowed for exactly
that and nothing else: a handful of JSON messages keyed by peer id, and then
they are out of the way. The room code *is* the host's peer id.

A six-character code against a public broker is guessable given enough tries,
which is why approval at the door is on by default. It turns "anyone who guesses
the code is in" into "anyone who guesses the code is in a lobby".
