# Role interactions: a test-case catalogue

What happens when two roles, a corpse and a clock meet in the same doorway.

`tools/role-interaction-test.js` runs every case below that can be expressed as
an assertion — `node tools/role-interaction-test.js`, no browser, no network,
same harness as `tools/engine-test.js`.

**All twenty-three bugs below are fixed.** The audit was written first and
changed no game logic: where the engine was wrong, the test pinned the *current*
behaviour and reported the bug separately, so the suite stayed green while
refusing to let the bug disappear quietly. The fixes came after, and every one
of them was made by flipping the assertion that pinned it — which is why each
case below still names the bug it was written for, and why re-breaking any of
them turns the suite red.

Each entry keeps its original finding for the record and adds a **Fixed** line
saying what changed. The twenty-two **UNSPEC** questions are untouched: they are
design calls, not defects, and somebody has to decide them.

Each case is marked:

| Mark | Meaning |
| --- | --- |
| **PASS** | The engine does the right thing, and the test holds it there. |
| **FIXED** | A real bug, since fixed. Numbered `BUG-nn`, cross-referenced from the test output; the case that found it now asserts the fix. |
| **UNSPEC** | Neither the data, the README nor the code comments say what should happen. The engine picked an answer by accident. Numbered `SPEC-nn` — somebody has to decide. |

Totals: **96 cases, 337 assertions, 23 bugs — all fixed — and 22 unspecified
questions still open.**

---

## The short list, worst first — all fixed

| # | Bug | Where | Fixed by |
| --- | --- | --- | --- |
| 1 | **BUG-23** An unannounced death crashes the host on the following night | `js/engine/resolver.js:229-236`, `:403-408`, `:51-58` | `endNight` marks the night closed, `beginNight` carries a corpse's body forward, `bodyText` survives a missing one, and a death in daylight is announced |
| 2 | **BUG-16** Kicking a player mid-night orphans their house and crashes the host | `js/app.js:289` × `js/engine/resolver.js:197` | a kick below the lobby keeps the seat; knock/perform/packVote/allTurnsSpent refuse an unoccupied house |
| 3 | **BUG-17** A second game in the same room makes every repeat death instantly public | `js/engine/engine.js:103-110` | `assignRoles` clears `announcedDead` and every player's death bookkeeping |
| 4 | **BUG-15** Spectators get houses, turns, and a place in the win arithmetic | `js/engine/resolver.js:50-63`, `js/engine/win.js:16-21` | `living()`, `beginNight` and `Win.count` all skip spectators |
| 5 | **BUG-03** The Archangel will raise a corpse as an Alpha Wolf if the phone asks | `js/roles/archangel.js:23-28` | the manual branch picks from the same village-only pool as the random one |
| 6 | **BUG-11** An Assassin in a bag with no leaders has already won at deal time | `js/engine/win.js:116-120` | `leadersAllDead` requires that a leader was actually dealt (`state.leadersDealt`) |
| 7 | **BUG-12 / BUG-07** `leadersAlive` is frozen at deal time and desynchronises | `js/engine/win.js:123-131`, `js/engine/resolver.js:651-654` | `Win.livingLeaders` derives the list from who holds the card now |
| 8 | **BUG-06** A swap completed against a corpse deletes a live role from the game | `js/roles/naughty_boy.js:23-25` | `swap()` re-checks both halves are living and seated before moving anything |
| 9 | **BUG-13** The Festival can leave a player unable to end their night at all | `js/engine/engine.js:420-424` | the redirect skips `houses:"self"`, `found-body` and free actions |
| 10 | **BUG-19** Blood Moon's second kill never happens in normal play | `js/engine/resolver.js:673` | `packVote` passes `extraKills` on the live path too |
| 11 | **BUG-01** The Seer can read their own role and burn their night on it | `data/list_of_roles.json` seer + `js/engine/resolver.js:264` | `seer.investigate` is `living-others` |
| 12 | **BUG-08** A recruitment offer can be accepted from the grave, the next afternoon | `js/engine/engine.js:473-487` | `CMD.CONSENT` requires the night phase, a living answerer and an unexpired prompt |
| 13 | **BUG-10** Everybody dead is announced as a Village win | `js/engine/win.js:68-70` shadows `:76-78` | the empty-board test runs before the wolves-are-zero one |
| 14 | **BUG-05** An abandoned half-swap survives into the next night | `js/roles/naughty_boy.js:13-22` | `beginNight` clears `_swapFirst`, matching what the phone already does |
| 15 | **BUG-04** Any Assassin created after setup has zero knives, forever | `js/engine/win.js:123-131` | `Win.armAssassins` arms anybody holding the card, on every win check |
| 16 | **BUG-02** The Doctor's "not last night" means "not ever again" | `js/engine/resolver.js:266`, `js/roles/doctor.js:15` | the Doctor records the round beside the name; the bar lasts one night |
| 17 | **BUG-20 / BUG-21** Two settings toggles are wired to nothing | `js/engine/state.js:40,46` | `kill()` honours `firstNightImmunity`; the Villager's promotion consults `villagerPromotion` |
| 18 | **BUG-14** `tieBehaviour: "runoff"` is declared and not implemented | `js/engine/engine.js:244-252` | one runoff between the tied names, a restricted ballot, and a settings control for all three values |
| 19 | **BUG-22** The Mayor's card says the pack can see them. It cannot | `js/roles/mayor.js:12` vs `js/engine/view.js:41` | the card now matches `view.js` and the data, which already agreed |
| 20 | **BUG-09** A Diwata demoted by the rope keeps her old state | `js/roles/diwata.js:46-47` | the rope's demotion applies `initialState("villager")` like the other one |
| 21 | **BUG-18** Daytime deaths write into the already-closed night | `js/engine/resolver.js:551-560` | `die()` refuses to file into a closed night |

---

## 1. Pointing an ability at your own front door

### ST-01 — Seer investigates their own house · **FIXED (BUG-01)**

- **Roles** Seer.
- **Setup** Any night. The Seer knocks on their own door.
- **Action** `ACT { houseId: <self>, actionId: "investigate" }`.
- **Expected** The door should not light up. A Seer already knows what a Seer is.
- **Actual** The offer appears and is enabled. The engine accepts the action,
  answers *"Seer is a Seer."*, and marks the Seer's night spent. One tap and the
  village's best information role has done nothing at all, with no way back.
- **Where** `data/list_of_roles.json` gives `seer.investigate` the selector
  `living-any`, whose own documentation reads *"Houses of living players, your
  own included"*, and `js/engine/resolver.js:264` implements that literally
  (`"living-any": alive`). The tap-a-house UI hands every house to the server
  (`js/ui/screens.js:384` wires `onPick` on all of them without exception, and
  `js/ui/village.js:374` makes each house a button), so the whole decision is
  the selector's.
- **Fix shape** `seer.investigate` wants `living-others`, not `living-any`. Same
  question for `detective.detect` — see SPEC-02.

- **Fixed** `seer.investigate` is `houses: "living-others"`. The Seer's own door no longer offers it, and the engine refuses it if a phone asks anyway. Reading anybody else is unchanged.

### ST-02 — Which roles can reach their own door at all · **PASS + UNSPEC (SPEC-01, SPEC-02)**

Every one of 22 targeted abilities was probed against its owner's house. The
lethal ones (Witch's poison, Pulis's gun, the Assassin's knife, the Cat's bite),
the identity ones (Doppelgänger, Trickster), the Avenger's oath, the Alpha's
bite, the Shaman's mark and the Cult Leader's offer all correctly refuse. The
ones that reach their own owner are:

| Role | Action | Selector | Verdict |
| --- | --- | --- | --- |
| Seer | `investigate` | `living-any` | **BUG-01** |
| Doctor | `protect` | `living-not-last` | **SPEC-01** |
| Witch | `save` | `living-any` | **SPEC-01** |
| Detective | `detect` | `living-any` | **SPEC-02** |
| Engineer | `trap` | `living-any` | **SPEC-02** |
| Fanatic+ | `save_cult` | `living-cult` | **SPEC-01** |

- **SPEC-01** Three protective roles, two answers. The Doctor may sit up with
  himself and the Witch may drink her own bottle; the Bodyguard may not stand in
  his own doorway. That is a defensible design (a Bodyguard's protection kills
  the Bodyguard, so self-guarding is incoherent) but nothing in
  `data/list_of_roles.json` argues it, and nothing says whether self-healing was
  meant to be free.
- **SPEC-02** A Detective reading his own footprints learns where he went last
  night, which he knows, and spends his night on it — the same trap as BUG-01,
  minus the certainty about intent. An Engineer belling his own door is at least
  arguably a real play.

### ST-03 — `living-non-cult` excludes the actor, `living-cult` does not · **PASS**

The exclusion is hand-written into one selector
(`js/engine/resolver.js:268-270`) and absent from its neighbour on line 271.
The Cult Leader cannot recruit himself; the Fanatic+ can ward himself. Both
answers are probably right, but they are right by accident.

### ST-04 — Every role can end its own night unaided · **PASS**

All 35 roles were dealt into a room and asked what they could do at their own
door. Every one of them has at least one enabled offer, because the universal
`stay_in` is added to every list at `js/engine/resolver.js:348-351`. This is
the property that keeps the night from ever deadlocking on "no legal target",
and it is worth an explicit test because it is nowhere written down.

---

## 2. Doors with nobody behind them

### DEAD-01 — A living-only action at a fresh corpse · **PASS**

Late Doctor, dead charge: the offer still appears (he cannot know), the attempt
is accepted, he is told *"Nothing left to treat. Dead before you reached the
door."*, no shield is left on the corpse, his night is still his, and he now
privately knows. This is the design working exactly as the README describes.

*Note:* the reply to `CMD.ACT` is `{ok:true}` and drops the resolver's
`discovery` object (`js/engine/engine.js:426-430` returns `done()`), so the
phone learns about the body only through the `PRIVATE` message. Not a bug —
worth knowing when reading the code.

### DEAD-02 — A dead-only action at a living player · **PASS**

Vet on a living Cat: accepted, told they are fine, charge intact, night intact.

### DEAD-03 — A dead player raises the alarm · **UNSPEC (SPEC-03)**

A Doctor finds a body, is then killed himself, and successfully reports the
body he found. At dawn the village is told *"Doc found Vic and raised the
alarm"* — by a man who is himself lying dead two houses away.

`CMD.ACT` never checks `p.alive` (`js/engine/engine.js:414`), and `offersAt`
gates on aliveness only through `action.requires`, which exactly one role in the
data declares (`naughty_ghost`). Every free action is therefore available to the
dead. Whether that is charming or broken is a decision, not a bug.

### DEAD-04 — A Shaman-hidden body, and who it actually fools · **PASS + UNSPEC (SPEC-22)**

A villager who tries to act at a marked, hidden corpse waits at a dark door and
loses their night without learning anything — the Shaman's whole contribution,
correctly implemented at `js/engine/resolver.js:397-401`.

**SPEC-22**: the `!R.isWolf(actor.role)` escape on that branch is unreachable in
ordinary play, because `die()` notes every living wolf on a pack kill
(`js/engine/resolver.js:569-573`) so a wolf never believes the victim alive in
the first place. It only matters for a wolf who was dead at the time, or one the
Alpha created afterwards. Harmless, but it is dead code that looks live.

### DEAD-05 — The Albularyo's door only opens for wolves · **PASS**

`dead-wolves` lights up at wolves the Albularyo *knows or suspects* to be dead,
which by design includes living ones. Guessing wrong costs nothing.

---

## 3. Not the same house two nights running

### REP-01 — The Doctor's no-repeat never expires · **FIXED (BUG-02)**

- **Setup** Doctor protects A on night 1. Takes night 2 off (`stay_in`).
- **Action** Night 3: knock on A.
- **Expected** `data/list_of_roles.json` documents `living-not-last` as *"Living
  players, except the one you chose last night."* A is legal again on night 3.
- **Actual** A's door is dark on night 3, and on every night after that, until
  the Doctor protects somebody else.
- **Where** `js/roles/doctor.js:15` writes `actor.lastProtected` and nothing
  ever clears it; `js/engine/resolver.js:266` compares against it. The field is
  "the last person I protected", not "the person I protected last night".
- **Fix shape** either clear `lastProtected` in `beginNight`, or store the round
  it was set and compare `=== state.round - 1`.

- **Fixed** the Doctor writes `lastProtectedRound` beside `lastProtected`, and `living-not-last` bars the house only when that round was last night. A night off clears it; two nights running is still refused.

### REP-02 — Fanatic+ enforces the same rule somewhere else · **PASS + UNSPEC (SPEC-04)**

The Fanatic+'s door lights up and *then* refuses
(`js/roles/fanatic_plus.js:11`), where the Doctor's simply goes dark. The night
survives the refusal, so nothing is lost — but one of the two is showing the
player an offer it will not honour.

### REP-03 — The Cat may bite the same house forever · **PASS**

`lastBiteTarget` is written by `js/roles/cat.js:14` and read by nothing. That is
consistent with the data (`bite` has no repeat restriction) and worth pinning so
that adding one does not silently do nothing.

---

## 4. The pack, turned on itself

### WOLF-01 — A wolf may howl for a fellow wolf · **PASS + UNSPEC (SPEC-05)**

Wolf 1 howls for Wolf 2; Wolf 2 howls for a villager; the tie is broken by a
coin toss and lands on Wolf 2, who dies. Wolf 2's own howl evaporates with it,
because `packTally` only counts living wolves — so the villager Wolf 2 voted for
survives untouched.

`wolf_vote` uses `living-others`, which does not exclude teammates. Werewolf is
a game where the pack betraying itself is a legitimate move, so this may well be
deliberate; it is also completely undocumented, and the tie-break at
`js/engine/resolver.js:701` puts no thumb on the scale.

### WOLF-02 — A wolf cannot howl for its own house · **PASS**

Not offered, and refused on the host if sent anyway.

### WOLF-03 — The Alpha cannot infect a wolf, but may infect the Cult · **PASS + UNSPEC (SPEC-06)**

`living-non-wolf` correctly excludes the pack. It does not exclude the cult, so
a Cultist bitten on night one is a Werewolf on night three, and the cult is
never told it lost a member. Cross-faction conversion between two conversion
mechanics is exactly the kind of thing a spec should have an opinion about.

### WOLF-04 — A second infection on the same target · **PASS**

Refused by the handler, no charge spent. (The door offers it anyway — the same
door/handler split as SPEC-04.)

### WOLF-05 — The Albularyo raises a wolf, who howls the same night · **PASS**

Poisoned wolf, turn marked spent by dying; the Albularyo raises it; the turn
comes back; the death is struck from the night's record; nobody was told; the
raised wolf howls and the pack gets its kill. This is the live-clock design at
its best and the test holds all five properties.

---

## 5. Everything standing in one doorway

### PROT-01 — Doctor + Bodyguard + Witch on one house · **PASS**

Shields are consumed newest-first, so the Witch — who arrived last — spends her
bottle, the victim lives, the Bodyguard is untouched, and two layers remain.
Exactly what `js/engine/resolver.js:513-532` promises.

### PROT-02 — Two Bodyguards on one house · **PASS**

They die one at a time, newest first, and the charge survives both attempts.

### PROT-03 / PROT-04 — `ignoreShields`, and releasing a guard from a corpse · **PASS**

The rope goes straight through without even consuming the shield; when a
protected player dies anyway, `die()` strips the bodyshields off the house
(`js/engine/resolver.js:559`) so a later blow does not kill a Bodyguard who has
nothing left to guard.

### PROT-05 — The Diwata's ward beats every shield to the punch · **UNSPEC (SPEC-07)**

`kill()` runs the victim's `onKilled` hook *before* touching shields
(`js/engine/resolver.js:506-532`). So a Diwata standing behind a Doctor's shield
spends her one-shot ward on an attack the shield would have turned aside for
free, and the shield is still sitting there afterwards, unused. The same is true
of the Archangel (PROT-06) and Fanatic+.

Whether a passive ward should be "outermost" or "innermost" is a real design
question and the code answers it by accident of ordering.

### PROT-06 — The Archangel absorbs a kill and wastes the shield with it · **PASS (with SPEC-07)**

Survives, is demoted to Villager, the Witch who poisoned it dies, and the
Doctor's shield never came into it.

### PROT-07 — An Archangel killed by nothing in particular · **UNSPEC (SPEC-08)**

`onKilled` prevents the death whether or not there is a killer to punish
(`js/roles/archangel.js:67-73`). Disease and the pandemic have `byId: null`, so
an undemoted Archangel simply cannot be killed by the plague, and nothing is
punished for trying. An unkillable seat until it is spent.

### PROT-08 — Two kills on the same victim in one night · **PASS**

The second arrival gets a body discovery, spends no charge and keeps their
night, and only one death is recorded.

---

## 6. Back on your feet, and the night is not over

### REV-01 — Revived and killed again the same night · **PASS**

`revive()` filters the death out of `state.night.deaths`
(`js/engine/resolver.js:628`), so a raise-and-re-kill produces exactly one
record and exactly one line in the morning report.

### REV-02 — Reviving somebody a Doctor also shielded · **PASS**

Shields live on the *house*, not the player, so a shield laid before the death
is still there after the revival and still turns the pack away. That is a
genuinely subtle interaction and it comes out right.

### REV-03 — The Archangel will raise anybody as anything · **FIXED (BUG-03)**

- **Setup** A village Archangel, one corpse.
- **Action** `ACT { actionId: "revive", payload: { assignment: "manual",
  newRole: "alpha_wolf" } }`.
- **Expected** The manual pool is village-only. The UI shows exactly that list
  (`js/ui/screens.js:568-570` filters `team === "village"` and drops archangel
  and mayor).
- **Actual** Accepted. The corpse gets up as an Alpha Wolf, on the pack's side,
  and the Archangel has handed the wolves a new player. `cult_leader`, `jester`,
  `assassin` and `manipulator` all work too.
- **Where** `js/roles/archangel.js:23-28`: the only validation on the client's
  `newRole` is `WG.roles.get(role)` — "is this a real role id". This is the one
  place in the engine that takes a phone's word for something, in direct
  contradiction of the file header of `js/engine/engine.js` ("Every command is
  re-checked here against the state, never trusted") and of the Redaction
  section of the README.
- **Fix shape** apply the same `team === "village"` filter to the manual branch
  that the random branch already uses two lines above it.

- **Fixed** the manual branch filters against the same village-only pool the random branch builds, and an ask from outside it falls back to that pool rather than failing — so the raise still happens, it just cannot be steered out of the village.

### REV-04 — A quiet revival leaves stale beliefs behind · **UNSPEC (SPEC-09)**

`revive(..., { publicly: false })` clears the public register but deliberately
leaves every witness's private `known` map saying "dead"
(`js/engine/resolver.js:616`). That is the point of a quiet revival — but the
consequence is that those witnesses' doors stay dark at that house for the rest
of the game, so the Albularyo's secret raise is also a permanent debuff on the
person raised.

### REV-05 — A revived Avenger keeps a spent oath · **UNSPEC (SPEC-10)**

`revengeTarget` still points at the person the oath already killed. It will
silently do nothing next time unless re-sworn, and the player is not told.

---

## 7. Becoming somebody else

### CONV-01 — Doppelgänger copying a Doppelgänger · **PASS**

Becomes a Doppelgänger whose one copy is already spent. `js/roles/doppelganger.js:16-18`
sets `hasCopied` twice around the `Object.assign` for exactly this reason — a
small, correct piece of defensive code.

### CONV-02 — Doppelgänger copying the Assassin · **FIXED (BUG-04)**

- **Setup** Assassin (one leader dealt, so one knife) and a Doppelgänger.
- **Action** Copy the Assassin.
- **Expected** An Assassin. Presumably with knives.
- **Actual** `killCharges: 0`, from `data/list_of_roles.json`'s declared initial
  state. `assassinate` is offered but permanently disabled, and
  `win.canStillWin` reads the same zero and decides this solo can never win, so
  it does not even block anybody else's victory. A dead seat for the rest of the
  game.
- **Where** `js/engine/win.js:123-131`. `noteLeaders()` is the only thing that
  ever hands out knives and it runs once, at deal time. The same hole affects a
  Villager promoted into a leader role, a swapped Assassin, and an
  Archangel-revived one.

- **Fixed** `Win.armAssassins()` hands one knife per leader dealt to anybody holding the card who has not been armed yet, and runs on every win check. A spent Assassin is not re-armed.

### CONV-03 — An abandoned half-swap survives the night · **FIXED (BUG-05)**

- **Setup** Naughty Boy taps house A to start a two-house swap, then does
  nothing else. The night ends.
- **Action** Next night, tap house B.
- **Expected** B is the *first* half of a new swap.
- **Actual** B is the *second* half of last night's swap. A and B exchange
  roles, and the player never saw A on their screen tonight.
- **Where** `js/roles/naughty_boy.js:13-22` parks `_swapFirst` on the player;
  `beginNight` rebuilds the night object but never touches the actor. The client
  has the same shape of state (`WG_APP.pendingSwap`, `js/ui/screens.js:376-382`)
  and *does* discard it on repaint, so the phone and the host disagree about
  whether a swap is in progress.
- **Fix shape** clear `_swapFirst` in `beginNight`, next to where turns are
  reset.

- **Fixed** `beginNight` clears `_swapFirst` on every player, which is what the phone has always done to its own copy on repaint.

### CONV-04 — A swap completed against a corpse · **FIXED (BUG-06)**

- **Setup** Crazy Naughty Boy taps house A. A is killed before the second tap.
- **Action** Tap house B.
- **Expected** Refuse — A is not a living house any more, and the selector says
  `living-others`.
- **Actual** The swap goes through. The Doctor's card ends up on a corpse and
  the corpse's card ends up on the living player. The Doctor is now gone from
  the game entirely: no living player holds the role, and nothing will ever
  bring it back.
- **Where** `js/roles/naughty_boy.js:23-25`. The only check on the parked first
  half is `if (!a || !b)` — "does this player object still exist". The selector
  was evaluated when the *first* house was picked and is never re-evaluated.

- **Fixed** `swap()` re-checks that both halves are still living, seated players before it moves anything, and clears the parked half on refusal.

### CONV-05 — A swap moves a role without moving the bookkeeping · **FIXED (BUG-07)**

The Seer's card moves from p1 to p2. `state.leadersAlive` still says `["p1"]`.
Killing the real Seer does not clear the list, because
`noteLeaderDeath` (`js/engine/resolver.js:651-654`) filters on the victim's
*current* role and p1 is no longer a leader. The Assassin's win condition is now
permanently unsatisfiable — or, in the mirror case, satisfied while a Seer is
still standing (see WIN-03).

Everything that changes a role hits this: swaps, Villager promotion, the
Doppelgänger, an Archangel's revival with a new role, and every demotion
(Pulis, Archangel, Diwata).

- **Fixed** `Win.livingLeaders()` derives the list from whoever is holding a leader's card right now, so no swap, promotion, copy or revival can desynchronise it. `noteLeaderDeath` re-derives rather than filtering by id.

### CONV-06 — The Cult can convert a solo out of its own win condition · **UNSPEC (SPEC-11)**

A recruited Jester or Manipulator becomes a Cultist and is told *"You are a
Cultist. Everything but the loyalty is unchanged."* For a solo, the loyalty was
the entire role.

### CONV-07 — Consent from the grave, in the afternoon · **FIXED (BUG-08)**

- **Setup** Cult Leader makes an offer. The target is killed by the pack before
  answering.
- **Action** `CMD.CONSENT { ok: true }`.
- **Expected** Refused; the offer died with them.
- **Actual** Accepted. The corpse's role becomes `cultist`.
- **And** the same command is accepted during `discussion`, hours later, in
  broad daylight.
- **Where** `js/engine/engine.js:473-487`. No phase check, no `p.alive` check,
  and the prompt's own `expiresAt` (written at `js/roles/cult_leader.js:21`) is
  read by nothing anywhere in the codebase. `js/engine/resolver.js:73` clears
  `prompts` in `beginNight`, so the window is exactly "until the next night
  begins".

- **Fixed** `CMD.CONSENT` requires the night phase, a living answerer, and a prompt that has not passed its `expiresAt` — which was written all along and read nowhere. The offer is discarded on every refusal.

### CONV-08 — A Trickster is what it wears, to readers only · **PASS**

The Seer reads the worn role; the true role and team are untouched; a Trickster
wearing a Trickster reads as a Trickster rather than recursing.

### CONV-09 — A demoted Pulis is a fresh Villager · **PASS + UNSPEC (SPEC-12)**

`Object.assign(initialState("villager"))` resets `hasUpgraded` and `totalScore`,
so a disgraced Pulis is on the promotion track again and can be handed a real
role — possibly Pulis. Consistent across Pulis, Archangel and (killed) Diwata,
so at least it is consistently undecided.

### CONV-10 — A Diwata demoted by the rope · **FIXED (BUG-09)**

`js/roles/diwata.js:46-47` sets `role = "villager"` and `isDemoted = true` and
stops there, where the *other* demotion path fourteen lines above it
(`js/roles/diwata.js:22-24`) correctly applies `initialState("villager")`. The
seat ends up a Villager carrying `hasUsedImmunity: true` and missing
`hasUpgraded` entirely. Cosmetic today; it is the kind of inconsistency that
becomes a bug the moment anything reads `hasUpgraded`.

---

## 8. What happens because somebody died

- **Fixed** the rope's demotion applies `initialState("villager")`, exactly as the path fourteen lines above it already did.

### TRIG-01 — Two Avengers sworn at each other · **PASS**

Both die; the recursion terminates on `already-dead` at
`js/engine/resolver.js:499`; exactly two death records.

### TRIG-02 — An oath against somebody already dead · **PASS**

Fires into nothing, silently.

### TRIG-03 / TRIG-04 — The Naughty Ghost · **PASS**

Alive: only `task`, because `requires: "alive"` is one of the two places in the
whole data file that uses the field. Dead: the turn is handed back rather than
spent (`releaseTurn` respects `actsWhileDead`, `js/engine/resolver.js:640`), the
swap opens up and the task closes, and it keeps getting turns on later nights.

### TRIG-05 — The Diseased takes the wolf that ate it · **PASS + UNSPEC (SPEC-13)**

Exactly one wolf dies: the one credited with the kill, which is
`howlers[0]` — the first wolf to have voted for that house
(`js/engine/resolver.js:711`). So which wolf eats the bad meat is decided by who
tapped first, not by anything the pack chose. Defensible on a live clock;
undocumented.

### TRIG-06 — A Diwata eaten by the pack ends the pack · **PASS**

Every wolf dies, and the village wins on the spot.

### TRIG-07 — A Cult Leader's death promotes every Fanatic · **PASS**

### TRIG-08 / TRIG-09 — The Assassin's guess · **PASS**

Wrong guess: the Assassin dies, the target is untouched, the knife is gone
anyway. Correct guess against a warded Diwata: the ward holds, the knife is
spent, and the Assassin survives (only a *wrong* guess is fatal).

---

## 9. Who won, and when the answer is wrong

### WIN-01 — Everybody dead · **FIXED (BUG-10)**

`js/engine/win.js:76-78` contains a branch for "Everybody is dead. Nobody wins a
village with nobody in it." It is unreachable: the test at line 68
(`c.werewolf === 0 && c.cult === 0`) matches an empty board first, finds no
solos to block it, and returns *"The Village wins. Every wolf is dead and
nothing else was hiding in here."* over an empty village.

- **Fixed** the everybody-dead test now runs before the wolves-are-zero one, so it is reachable. A real village win is still a village win.

### WIN-02 — An Assassin with no leaders in the bag · **FIXED (BUG-11)**

- **Setup** Roster `{ assassin: 1, werewolf: 1 }`, padded with villagers.
- **Expected** A perfectly ordinary game.
- **Actual** `minimumSeats` returns 0 and the host is told *"That mix has no
  game in it."* for every table size from 2 to 40.
- **Why** `leadersAllDead()` (`js/engine/win.js:116-120`) tests
  `state.leadersAlive != null`. `noteLeaders()` always assigns an array, so with
  no Alpha, Cult Leader, Mayor or Seer in the bag it assigns `[]` — and an empty
  list of leaders reads as "every leader is dead". The Assassin has therefore
  won before the first night, `check()` never returns null, and `minimumSeats`
  concludes the roster is unplayable.
- **Severity** This is the good outcome. The bad one is what happens if the
  guard is ever loosened: the Assassin wins the instant the game starts.
- **Fix shape** `leadersAllDead` should require that at least one leader ever
  existed — record the deal-time count, not just the survivors.

- **Fixed** `leadersAllDead()` requires `state.leadersDealt` to be non-zero — an empty bag is not a bag of corpses. `{assassin, werewolf}` is an ordinary roster again; the Assassin simply has nothing to hunt and cannot win by that route.

### WIN-03 — An Assassin wins with a Seer still standing · **FIXED (BUG-12)**

A second Seer created after the deal (promotion, revival, swap) is invisible to
`leadersAlive`. Kill the original and the Assassin is declared the winner while
a living Seer sits in the village. Same root cause as BUG-07.

- **Fixed** same derived list as BUG-07. A leader created after the deal is counted, and the Assassin wins only when nobody holds a leader's card.

### WIN-04 / WIN-05 / WIN-06 — The Jester · **PASS + UNSPEC (SPEC-14)**

The rope sets a permanent flag, checked before any count, so a Jester hanged on
the same rope that removes the last wolf takes the win. A live Manipulator
steals it and correctly reports `stolenFrom: "jester"`.

**SPEC-14**: `jesterWasLynched` is never cleared, including by revival. A Jester
hanged and then raised by an Archangel has still won, and the game ends the
instant anything checks again.

### WIN-07 — What the Manipulator cannot steal · **UNSPEC (SPEC-15)**

`pandemic`, `nobody` and `stalemate` return directly rather than through
`declare()` (`js/engine/win.js:50-52, 76-78, 83-85`), so they are the three
results the Manipulator cannot take. Probably deliberate; unwritten.

### WIN-08 / WIN-09 / WIN-10 / WIN-11 — Counts · **PASS + UNSPEC (SPEC-16)**

Converting the last wolf to the cult flips the game to a cult win; 1v1 is a
werewolf win at parity; the stalemate check catches a board where nothing can
happen. **SPEC-16**: the cult's threshold counts `village + werewolf` only, so a
living Jester is neither an obstacle nor a resource, where the team's own goal
text says *"as many living souls as every other side combined"*.

---

## 10. Nights that will not end, and commands out of turn

### FLOW-01 / FLOW-02 / FLOW-03 — Phase and double-submission guards · **PASS**

`ACT`, `KNOCK` and `VOTE` are all refused outside their phase. A second
turn-spending action is refused with a reason the player can act on. A second
report on the same body is neither offered nor accepted.

### FLOW-04 — A player on hold cannot end their night · **UNSPEC (SPEC-17)**

A quizzed player cannot even `stay_in` — every turn-spending offer is disabled
by `turn.blocked` (`js/engine/resolver.js:324`). So `allTurnsSpent` can never be
satisfied while one phone stays silent, and `endNightEarly` is dead for that
round: the whole room waits out the night timer. Not a deadlock (the clock still
fires) but it is a denial-of-service a single disconnected player performs by
accident, every time.

### FLOW-05 — A role with no legal target anywhere · **PASS**

A Vet in a village with no Cat and no Dog is offered `vet_revive` at exactly
zero doors, and still ends its night on the universal `stay_in`. The night
closes normally.

### FLOW-06 — Curfew · **PASS (BUG-01 fixed here too)**

Villagers are locked out of other houses, the pack is not, everybody can still
`stay_in`, and the night closes. Worth noting: a Seer can still read *themselves*
through a curfew, because the curfew test exempts your own house and BUG-01 puts
`investigate` there.

- **Fixed** `seer.investigate` is `houses: "living-others"`. The Seer's own door no longer offers it, and the engine refuses it if a phone asks anyway. Reading anybody else is unchanged.

### FLOW-07 — Under a Festival, ending your night is a dice roll · **FIXED (BUG-13)**

- **Setup** Festival active. A player wants to end their night.
- **Action** `ACT { houseId: <self>, actionId: "stay_in" }`.
- **Expected** Drunkenness should scramble what you *do to other people*, not
  your ability to go to bed.
- **Actual** `js/engine/engine.js:420-424` redirects the `houseId` of **every**
  action to a random living player before `Res.perform` sees it. `stay_in` only
  exists at `houses: "self"` and `report` only at `found-body`, so both are
  refused with "not-offered-here" until the dice happen to land back where the
  player aimed. With four players that is a 1-in-4 chance per tap; the test
  pins four consecutive refusals.
- **Consequence** A player can spend a whole Festival night unable to end it,
  which — combined with `endNightEarly` — holds the entire room on the clock.
- **Fix shape** exempt `spendsTurn: false` actions and `houses: "self"` from the
  redirect, or redirect only actions whose selector is not `self`.

- **Fixed** the Festival redirect skips actions declared at `houses: "self"` or `"found-body"`, and any action that does not spend a turn. Ending your night always works; a real action still lands somewhere you did not aim.

### FLOW-08 / FLOW-09 — Disconnection · **PASS**

Nothing advances on its own when every phone drops, but the phase clock is
still armed and does advance when it expires. `allReady` correctly refuses to
treat an empty room as "everyone is ready" (`js/engine/engine.js:327-330`).

### FLOW-10 — The host aborts mid-night · **PASS**

Guests cannot; the host can; `state.night` is cleared and everybody is back in
the lobby alive and roleless.

---

## 11. The rope, and who gets to pull it

### VOTE-01 — Self-votes and votes from the dead · **PASS**

### VOTE-02 — A ballot cast before dying still counts · **UNSPEC (SPEC-18)**

`state.votes` is keyed by voter and never filtered for the living at close
(`js/engine/engine.js:220-229`), so somebody killed during the day still helps
hang whoever they last voted for. The denominator (`aliveCount`) *is* recomputed
at close, so the published tally can read "2 votes to 2".

### VOTE-03 — Voting for somebody the Shaman already buried · **PASS**

The ballot must include them (leaving them off would give the secret away), the
village goes to fetch them, finds the house empty, everybody learns at once, and
nobody is hanged. This is one of the best-implemented interactions in the game.

### VOTE-04 — Voting for somebody publicly dead · **PASS**

Refused.

### VOTE-05 — Ties · **FIXED (BUG-14)**

`nobody` and `random` both work. `runoff` — the third value
`js/engine/state.js:45` declares — falls through the `if` at
`js/engine/engine.js:245` and behaves exactly like `nobody`, publishing "Tied 2
ways. Nobody hangs." There is also no control for `tieBehaviour` anywhere in
`js/ui/screens.js`, so the setting is currently reachable only by sending a
raw `CONFIG` command.

- **Fixed** `closeVoting()` runs one runoff between the tied names, the ballot is restricted to them, and a second tie falls through to "nobody" rather than looping. The settings screen now has a control for all three values (this also closes UI-4).

### VOTE-06 — Skipping needs a majority of its own · **UNSPEC (SPEC-19)**

Two skips out of five is not a majority, so `delete counts.SKIP` discards them
and a single remaining vote hangs a player. That is a defensible rule; nothing
states it, and the settings screen's description ("The village can hang nobody")
implies otherwise.

### VOTE-07 — The Mayor's vote · **PASS**

Weighs one, and the data never promised otherwise — `mayor.passives` mentions
only visibility. (Contrast `wolf_vote`, which *does* carry a `weight` field and
*is* honoured by `packTally`, `js/engine/resolver.js:682-686`.)

---

## 12. Seats that are not players, rooms that remember too much

### ROOM-01 — A spectator is a player everywhere but the deal · **FIXED (BUG-15)**

`js/engine/engine.js:67` and `:91` filter spectators out of the deal. Nothing
else does.

- `beginNight` iterates `state.players` (`js/engine/resolver.js:50-63`), so a
  spectator gets a **house** and a **turn**. Their turn can never be spent —
  they have no role, so no offers — which means `allTurnsSpent` is permanently
  false and **`endNightEarly` never fires in any room with a spectator in it**.
- `Win.count` iterates `state.players` too (`js/engine/win.js:16-21`) and
  `teamOf(null)` returns `"village"`, so **every side's win arithmetic is off by
  the number of people watching**. Three villagers and two spectators reads as
  five villagers, and the wolves need two more kills than the rules say.
- The pack can **howl for a spectator's house and kill them**: `wolf_vote`'s
  `living-others` selector only asks whether the occupant is believed alive.

- **Fixed** `living()`, `beginNight()` and `Win.count()` all skip spectators, and knock/perform/packVote refuse a house whose occupant is not seated. A watcher has no house, no turn, no place in the arithmetic and is not a door the pack can howl for.

### ROOM-02 — Kicking a player mid-night crashes the host · **FIXED (BUG-16)**

- **Setup** A game in progress, night phase.
- **Action** The host kicks somebody.
- **Actual** `js/app.js:289` splices the player out of `state.players` in *any*
  phase. Their house and their turn stay in `state.night`, keyed by an id that
  no longer resolves. Then:
  - `allTurnsSpent` is permanently false — the night cannot close early.
  - **`KNOCK` at that door throws** — `js/engine/resolver.js:197-202` reads
    `occupant.name` off `null`.
  - **`ACT` there throws** — `offersAt` reads `occupant.alive`.
  - **A pack vote there throws** — `js/engine/resolver.js:670` reads
    `P(state, houseId).name`.
- **Severity** The host *is* the server. An uncaught `TypeError` inside
  `onGuestCommand` takes the room's single source of truth with it.
- **Note** the disconnect path is handled correctly for comparison:
  `js/app.js:136-146` keeps a mid-game player's seat and only marks them
  disconnected. Only the deliberate kick is unguarded.
- **Fix shape** either refuse a kick outside the lobby, or mark the player
  `alive = false, connected = false` and leave the seat in place.

- **Fixed** `kick()` keeps the seat below the lobby — marking them kicked and disconnected and spending their turn — and `knock`, `perform`, `packVote` and `allTurnsSpent` no longer assume a house has an occupant.

### ROOM-03 — A second game leaks the first game's deaths · **FIXED (BUG-17)**

- **Setup** Play a game in a room. Somebody dies and is announced at dawn. Start
  a second game with the same players.
- **Action** The same player is killed by the pack, mid-night.
- **Expected** Nobody knows until dawn. That is the entire belief model.
- **Actual** Every player knows instantly. Their house shows `dead-tonight` on
  every phone in the village while the night is still running, with nothing
  published.
- **Why** `startGame()` (`js/engine/engine.js:103-110`) resets `round`,
  `winner`, `publicLog`, `jesterWasLynched`, `pandemic` and `currentEvent`. It
  does not clear `state.announcedDead`, nor each player's `known` map, nor
  `diedNight`, `deathHidden` or `diedCause`. `knowsDead`
  (`js/engine/resolver.js:158-163`) reads the stale register the moment the
  player is dead again.
- **Fix shape** clear `state.announcedDead` and delete `p.known`, `p.diedNight`,
  `p.diedAt`, `p.diedCause`, `p.deathHidden` in `assignRoles`.

- **Fixed** `assignRoles()` clears `state.announcedDead` and each player's `known`, `diedNight`, `diedAt`, `diedCause`, `deathHidden` and `markedByShaman`.

### ROOM-04 — Daytime deaths write into a closed night · **FIXED (BUG-18)**

`state.night` is not cleared at dawn, so the rope, an Avenger's oath and a
Diwata's curse all push death records and bodies into a night object that was
snapshotted hours earlier (`js/engine/resolver.js:551-560` writes
unconditionally; `:760-765` snapshots and leaves the object in place). Nothing
reads it before `beginNight` rebuilds it — which is the only reason this is not
worse. It is also the mechanism behind BUG-23.

- **Fixed** `endNight()` marks the night closed and `die()` refuses to file a record or a body into a closed one. Daylight deaths are announced instead, which is where they belong.

### ROOM-05 — An unannounced death crashes the host next night · **FIXED (BUG-23) — was the worst one**

- **Setup, route A (no settings changed):** an Avenger swears an oath, and is
  hanged the following day. The oath fires during the verdict.
- **Setup, route B:** the room has **"Don't believe anyone"** on — the README's
  own headline rule — and a pack kill goes unreported.
- **Either way** the victim is dead and *nobody was ever told*. `announceDeath`
  runs only for the rope (`js/engine/resolver.js:574-577`), and a death that
  happens after `endNight` never appears in `state.lastNight`, so
  `buildMorningReport` cannot mention it either.
- **Action** Next night, anybody tries a living-only action at that door — the
  Doctor protects, a wolf howls, the Bodyguard guards.
- **Expected** A body discovery, in the actor's own words, costing nothing.
- **Actual** **A `TypeError` inside the host's command handler.**
- **Why** `beginNight` rebuilds every house with `body: null`
  (`js/engine/resolver.js:51-58`). The occupant is dead but still *believed*
  alive, so the door lights up. `perform` takes the `wants === "living" &&
  !occupant.alive` branch (`:403`) and calls `bodyText` (`:229-236`), which
  passes `house.body` — `null` — to the actor's `onFindBody` hook. **23 of the
  25 hooks in `js/roles/` dereference `c.body` on their first line** (only the
  Albularyo's and the Vet's do not), and the generic fallback on
  `js/engine/resolver.js:235` reads `house.body.night` for everybody else. There
  is effectively no path through that function that survives a null body.
- **Severity** Highest in this audit. It needs no exotic roster, no kicking and
  no crafted payload: an Avenger and a rope, or one room setting the README
  advertises. It is found repeatably by the random-play sweep (FUZZ-01, roughly
  one room in eight).
- **Fix shape** guard `bodyText` on `house.body` and return a neutral "nobody
  answers" line — or, better, stop the two ways a death can go permanently
  unannounced.

---

## 13. Events

- **Fixed** three things, because there were three ways in. `endNight` marks the night closed so a daylight death stops filing into a snapshot nobody reads; `beginNight` carries a dead occupant's body forward instead of rebuilding the house with `body: null`; `bodyText` answers plainly when there is no record at all rather than handing a null to twenty-five hooks. And a death in daylight is announced, so the village stops believing a corpse answers its door. The random-play sweep crashed roughly one room in eight before this and none in four hundred after.

### EV-01 — Blood Moon's second throat · **FIXED (BUG-19)**

- **Expected** The pack kills twice. `Events.extraKills` correctly returns 1.
- **Actual** It kills twice only when the pack **fails** to finish voting.
- **Why** There are two callers of `resolvePack`. `js/engine/engine.js:152-153`
  (dawn, the fallback path) passes `{ extraKills }`. `js/engine/resolver.js:673`
  — the live path, taken the instant the last wolf howls, which is the normal
  case and the one the whole redesign is built around — calls
  `resolvePack(state, out)` with no options at all. `packKillDone` then blocks
  the dawn call from re-running.
- **Result** the event's headline effect fires only when the pack is asleep at
  the wheel. The test pins both halves: agreed → 1 death, unfinished → 2.

- **Fixed** `packVote()` passes the event's `extraKills` on the live path, the same way the dawn fallback always did.

### EV-02 — A Festival vote redirected onto yourself · **UNSPEC (SPEC-20)**

`js/engine/engine.js:442` refuses a self-vote when `allowSelfVote` is off; lines
450-453 then redirect the vote, and the candidate pool includes the voter. A
room with self-votes disabled can still record one.

### EV-03 — The pandemic · **PASS**

Patient zero, spread to seat neighbours, three nights fatal, and a real win for
the sickness if it takes everyone. The one event with a life of its own works.

---

## 14. Knobs wired to nothing

### CFG-01 — "First night is safe" · **FIXED (BUG-20)**

`rules.firstNightImmunity` is declared in `js/engine/state.js:40`, has a
labelled toggle at `js/ui/screens.js:215` ("First night is safe / Nobody dies on
night one"), and `data/game_flow.json` `firstRound.notes` says *"The first night
is a full night; immunity is a room setting, not a phase change."* No file under
`js/engine/` or `js/roles/` reads it. Turn it on and somebody dies on night one.

- **Fixed** `kill()` honours `firstNightImmunity` on round one at night, for every cause but the rope — a village that votes somebody out on day one meant to.

### CFG-02 — "Villagers can be promoted" · **FIXED (BUG-21)**

`rules.villagerPromotion` is declared and offered the same way.
`js/roles/villager.js:13-32` checks `alive`, `hasUpgraded` and `totalScore` and
never the config, so a Villager with 1000 points is promoted with the setting
off.

- **Fixed** the Villager's `onPhaseEnd` consults `rules.villagerPromotion` before promoting.

### CFG-03 — "Show the tally" hands out more than a tally · **UNSPEC (SPEC-21)**

`js/engine/view.js:241-249` gates *both* `counts` and `detail` — the full
voter→target map — on `showVoteCounts`, and the comment beside it reads *"Who
voted for whom is the loudest information in the game. It is only ever handed
out in full when the room asked for it."* The room asked for a tally.
`showPersonalVotes` is the setting that sounds like it should govern this and
governs only `onMe`.

### CFG-04 — Every rule has a reader · **PASS (as an audit)**

Scans `js/engine/*.js` and every `js/roles/*.js` for each key in
`defaultConfig().rules` and asserts that exactly two — `firstNightImmunity` and
`villagerPromotion` — are read nowhere. If a third ever joins them, this fails.

---

## 15. Who is allowed to see whom

### SEE-01 — The Mayor's card overpromises · **FIXED (BUG-22)**

`js/roles/mayor.js:12` tells the Mayor: *"Every village-team player can see that
you are the Mayor. **So can the ones who are not.**"* `js/engine/view.js:41`
reveals the Mayor to `teamOf(viewer) === "village"` and nobody else, and
`data/list_of_roles.json`'s `mayor.passives.known` agrees with the code
("Every village player sees your role"). So the role card tells the player they
are exposed to the pack when they are not — which is exactly the sort of thing a
player builds a whole day's argument on.

Which of the two is wrong is a design call. The sentence and the code cannot
both stand.

- **Fixed** the card now matches `view.js` and `list_of_roles.json`, which already agreed with each other: the village sees the Mayor, and nobody else does.

### SEE-02 / SEE-03 / SEE-04 / SEE-05 — Redaction · **PASS**

The Manipulator sees every role and leaks nothing back. A corpse's role opens
only to somebody who knows there is a corpse — the pack during the night, the
whole village at dawn. No shield, trap, visit log, quiz answer key or pack tally
reaches a phone that should not have it. A Cat's speech marker is shown only to
people who already know it is a Cat, and the words really are replaced on the
host before storage.

### SEE-06 — Footprints do not lie · **PASS**

A Trickster wearing the Seer's face is still recorded by the Detective as having
walked to the Seer's house.

---

## 16. A fuzz pass

### FUZZ-01 — Twenty rooms, random legal play · **reports, does not assert**

Twenty 12-player games, two wolves plus three random specials each, every
unspent player taking a random enabled offer each night, random consent
answers, random votes, events at 40%, and every player's redacted view rebuilt
on every phase. Runs to a winner or 120 phases.

It is a reporter rather than an assertion because a randomised sweep that fails
the build one run in eight gets muted rather than fixed. It used to crash
roughly one room in eight, and every signature it ever produced was BUG-23,
whose deterministic reproduction is ROOM-05. Since that fix it has run four
hundred rooms without a throw.

---

## Cases that could not be automated

| # | Case | Where the gap is |
| --- | --- | --- |
| UI-1 | The village screen makes **every** house a tappable button — your own included, dead ones included — and sends `KNOCK` for all of them. There is no client-side notion of "this door is not for me"; the whole decision is the server's offer list. That is the right architecture, and it is also why BUG-01 reaches the player rather than being caught on the phone. | `js/ui/screens.js:384` (`onPick: function (id) { knock(id); }`), `js/ui/village.js:366-376` (every house gets `role="button"` and `tabindex`) |
| UI-2 | ~~Nothing on the host repeats the sheet's village-only filter.~~ **Closed by the BUG-03 fix** — the host now builds the same pool and checks against it. The remaining gap is only that Verifying that the sheet and the host agree needs a DOM. | `js/ui/screens.js:568-570` vs `js/roles/archangel.js:23-28` |
| UI-3 | ~~The host's copy of a half-swap outlives the client's.~~ **Closed by the BUG-05 fix** — `beginNight` clears `_swapFirst`, so the two agree overnight. Within a single night they still differ: So a player can cancel on their phone and still be mid-swap on the host — the invisible half of BUG-05. | `js/ui/screens.js:375-380` (the Cancel button) and `:489` vs `js/roles/naughty_boy.js:13` |
| UI-4 | ~~`tieBehaviour` has no control anywhere in the settings screen.~~ **Closed by the BUG-14 fix** — the Rules tab now offers all three values, and `runoff` does something. | `js/ui/screens.js:210-226` (the whole toggle table) |
| UI-5 | A kicked player's phone is sent `BYE` and banned at the transport, but their house is still drawn on everybody else's village until the next snapshot. Tapping it used to trigger BUG-16; it is now refused rather than fatal, so what is left is cosmetic. Reproducing the race needs two real peers. | `js/app.js:277-292`; `tools/e2e.js` would be the place |
| UI-6 | Cat and Dog speech is enforced on the host *and* hinted in the view (`card.speech`). Whether the composer visibly warns the player before they type a paragraph that will become "meow meow meow" is a UI question. | `js/engine/view.js:74-76`, `js/ui/screens.js` chat panel |

---

## Cross-reference

Every bug below is fixed, and the case named beside it is what holds the fix in
place: re-break any one of them and that case fails.

| Case | Bug | Case | Bug |
| --- | --- | --- | --- |
| ST-01 | BUG-01 | CONV-10 | BUG-09 |
| REP-01 | BUG-02 | WIN-01 | BUG-10 |
| REV-03 | BUG-03 | WIN-02 | BUG-11 |
| CONV-02 | BUG-04 | WIN-03 | BUG-12 |
| CONV-03 | BUG-05 | FLOW-07 | BUG-13 |
| CONV-04 | BUG-06 | VOTE-05 | BUG-14 |
| CONV-05 | BUG-07 | ROOM-01 | BUG-15 |
| CONV-07 | BUG-08 | ROOM-02 | BUG-16 |
| ROOM-03 | BUG-17 | ROOM-04 | BUG-18 |
| EV-01 | BUG-19 | CFG-01 | BUG-20 |
| CFG-02 | BUG-21 | SEE-01 | BUG-22 |
| ROOM-05 | BUG-23 | FUZZ-01 | BUG-23 |
