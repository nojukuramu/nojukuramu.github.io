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

### What a night is allowed to tell you

Truth and belief are separate objects in this engine, and everything the village
can see is built out of belief.

- **During the night, a killing is secret.** A house whose occupant was killed
  ten minutes ago has a lit window, smoke from the chimney and a lamp on the
  porch, exactly like every other house. The roster still counts them. Only the
  people who caused it — and anybody who has been round — know otherwise.
- **The way to find out is to do something there.** Standing at a door tells you
  nothing. Committing an action does: try to guard somebody who is already dead
  and the night tells you, in your own role's words, why it did not work. That
  attempt costs you nothing but the seconds it took, and on this clock seconds
  are the real currency.
- **At dawn the village is told**, whether or not anybody reported it. Reporting
  does not unlock the news — it adds a name to it: who found them. Which is
  worth having, and occasionally worth lying about.
- **From that morning on the house carries the mark**, for everybody, for the
  rest of the game.
- **A Wolf Shaman's marked kill is in none of that.** It is never announced, and
  somebody who walks up to that door finds a dark house and nobody home. The
  village goes on counting a player it does not have.

There is one room setting on top of this — **"Don't believe anyone"** — which
takes the dawn announcement away entirely. With it on, the only bodies the
village ever hears about are the ones somebody went and reported, so an
unreported death stays a rumour for the rest of the game.

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

### The board is a valley, and the clock is the weather over it

The board is not a list of players. It is a landscape: a river with a bridge, a
road climbing from the ford to the square, fields behind fences, woods on the
slopes, and the houses set into the land at the depth they belong to. Four bands
from the treeline to the foreground, mist in the gaps, nearer things larger and
drawn last. Generated from the room code, so it is the same valley every time
you open that room and a different one for every room.

The geography is laid out *before* anything is placed in it, which is why the
village looks deliberate: the river, the road and the square are decided first,
and then houses are darted into each depth band and rejected until they land
somewhere a person would actually build — off the road, out of the water, clear
of the square and of each other, and preferably near enough the road to have a
track running down to the door. The bridge is drawn at the point where the road
and the river actually cross, not at a hard-coded guess.

Behind it, a drawn sky: a star field that fades in as the sun goes down, the sun
and the moon on opposite ends of one arc, a warm band along the ridge at sunrise
and sunset, clouds lit from wherever the sun is, birds crossing by day and bats
at night.

Both are driven by the same two numbers the phase clock produces — the hour, and
how much starlight is showing — so the sky, the valley and the interface can
never drift out of step. A five-minute discussion begins in morning light and
ends at noon; voting runs noon to dusk; the verdict drops into night and the
night comes back up to dawn. Nobody has to be told the phase is nearly over.
The room is already getting dark.

Every natural colour in the valley is a fixed pigment mixed with the sky, which
is the whole trick: `color-mix(pasture, sky)` is a green field at noon and a
blue-black one at midnight, with no second palette anywhere. On top of that the
ground takes a scrim keyed to the theme's own distance-from-noon, because mixing
alone cannot take a colour below the darkest thing in the mix.

Both light and dark modes are the same **Ash Blue** family. Surfaces move a lot
with the hour, ink barely moves — text that drifts with the light is text you
cannot read at dusk.

### It is one screen, and it never scrolls

A fixed frame, three rows, and a stage in the middle that must fit whatever is
in it at any size. Only a chat log or a genuinely unbounded list scrolls, inside
itself, and it is marked where it does. `tools/fit-test.js` walks every screen at
nine real viewport sizes — from a 320x568 phone to a TV — and fails if the
document is ever taller than the window or anything outside a marked pane has
overflowed.

### No emoji

Every glyph is a drawn stroke path in `js/ui/icons.js`, inheriting
`currentColor`. Emoji render as a different picture on every platform, are
full-colour blobs in a two-tone interface, and are the loudest possible signal
that a thing is a web page rather than a game. `tools/consistency.js` fails the
build if one gets back in, and checks that every glyph the data asks for is
actually drawn.

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
- **Sound**, synthesised from nothing. There is not one audio file in the repo
  and not one request: crickets are a 4.6 kHz sine chopped at 42 Hz, a wolf is a
  glide on two detuned saws with a long tail, a crow is a bandpassed saw chopped
  hard. The ambient bed follows the phase clock — crickets and an owl at night,
  birds by day — and one-shots duck it rather than stacking on it. Nothing plays
  until you have touched the screen.
- **Blood.** A death lands as a flash and a spatter across the glass; the
  running stain on the edges of the screen is the fraction of the village that
  is gone, so a game going badly looks like it. A house whose occupant died
  tonight stands with its door open and a pool at the threshold, pulsing until
  somebody raises the alarm.
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
    icons.js           every glyph, drawn. no emoji anywhere
    sound.js           the whole soundtrack, synthesised. no audio files
    theme.js           light/dark, and the time-of-day blend
    sky.js             the drawn sky: stars, sun, moon, hills, blood
    village.js         the valley: river, road, woods, houses at depth
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
node tools/engine-test.js    # 158 assertions, no browser, no network
node tools/consistency.js    #  22 checks for drift between files that must agree
node tools/fit-test.js       #   9 viewport sizes, nothing may scroll
node tools/sound-test.js     #  13 checks: every voice renders real audio
node tools/e2e.js            #  41 assertions: four real browsers, one real room
node tools/shots.js          # a screenshot of every screen in both themes
node tools/icon-sheet.js     # every glyph at every size, to look at
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
