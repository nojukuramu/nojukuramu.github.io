# Ballzooka — the cannon game from the ads, for real

You have seen the ad: a cannon at the bottom, a stream of balls, a green gate that says ×3, and the
stream turning into a flood. The game behind the ad is usually something else. This one is the ad,
made into a game you can actually play — and then given everything else a fun arcade game needs.

In 3D with Three.js: the camera sits low behind the cannon and looks down the lane the way the ads
film it, the gates stand across the lane like glass doorways, and the horde hops toward you out of
the distance. Synthesised sound, plain ES modules, no build step, no models or audio files, no ads.
Plays offline once installed.

## Running it

Serve the folder (`npx http-server ballzooka` or any static server) and open it.

| Check | Command |
|-------|---------|
| Static and behaviour checks (70) | `node tools/validate.js` |
| The game in a real browser, WebGL included (26) | `node tools/e2e.js [--shots dir]` |

`validate.js` ends by letting a simple autopilot play the campaign and printing how far it gets
with an empty shop, a little spent, and a lot spent: about levels 1–3, 1–10 and 1–28.

## What makes it fun — the research, and what came of it

The design write-ups on hypercasual games (Kwalee's, GameDev.net's "Admiring the game design in
hyper-casuals", the various "juice" talks) agree on a short list. Each item became something here:

| What a fun game has | In Ballzooka |
|---------------------|--------------|
| A core loop that reads in a second | Drag left and right. The cannon fires by itself. Pick the better gate. |
| A choice in every moment | Gates side by side — ×3 or ÷2, sure ×2 or a **?** that might be ×10. Panels in pairs. Where the horde is versus where the best gate is. |
| A goal you can always see | A progress bar with a skull at the end on boss levels; a dashed line the horde must not cross. |
| Rewards that arrive steadily | Coins fly off every pop, a combo counter, a perk draft every few kills, a Fever meter, stars, the bonus wheel, trophies. |
| Layered progression over the loop | In a level: perks and panels. Between levels: the shop and skins. Over everything: trophies, Endless, the Daily. |
| Difficulty that never blocks you | Early levels are clearable with nothing bought; when a level walls you, the shop is the answer and coins are kept even from a loss. A free revive, once a level. |
| Short sessions | A level is two or three minutes. |
| Juice | Hit flashes, squash and wobble, rings and bursts on every pop, floating damage numbers that add up, coins that fly to the counter, screen shake, hit-stop and slow motion on a boss, a rainbow rim and a faster soundtrack during Fever, vibration. |
| Variety | Eight enemies that each want a different answer, eight gate kinds, sliding gates, four bosses, six worlds, six Daily twists. |

## What is in it

**Gates.** ×N; **charge gates** that start at ×1 and climb to ×6 as you shoot through them; ÷N;
**mystery** gates that open on the first ball (×2 to ×10, or a dud); FIRE (more damage and
splash), GOLD (double coins), BIG (heavier balls) and ICE (slows what it hits). Rows slide from
level 4. Each ball passes each gate once — until it ricochets off the top and comes back down
through them again.

**Panels.** The runner half of the ad: a pair of panels — balls, fire rate or damage, plus or
minus — slides down toward the cannon, and you take the one you are under. Every ball that hits a
panel raises its number, so a red −20% can be shot into a blue +15% before it arrives.

**The horde.** Blobs; Zoomers (fast); Chonks (huge, two hearts); Knights, whose shield stops one
ball per point however heavy it is, so they want a stream rather than a cannonball; Jellies that
split; Boomers that explode into their neighbours; Medics that heal everything around them; and
Goldies that run off with the money. Every fifth level is a boss — King Blob calls his court,
the Brick Golem builds walls of Knights, the Hydra splits in two, and the Gate Magus curses your
best gate.

**Perks.** Nineteen, drafted three at a time as the XP bar fills: fire rate, extra balls, damage,
pierce, ricochet, splash, crits, homing, shrapnel, frost, Gate Crasher (+1 on every ×), magnet,
a mirror cannon, big balls, static arcs, hearts, faster Fever, volatile enemies, rubber balls.
One reroll a level.

**Fever.** Kills in quick succession build a combo; the combo fills the Fever meter; a full meter
is seven seconds of double fire rate and extra crits, with the music doubling its tempo.

**Power-ups.** Rapid fire, Mega balls, Triple barrel, Freeze, Bomb and Heart, dropped by the horde
and caught with the cannon.

**Around the runs.** A shop of eight permanent upgrades; seven cannon skins and seven ball skins,
two of each earned with trophies; nineteen trophies; Endless (a boss every tenth wave, half the
coins); and a **Daily** — the same seed for everybody on the same day, with one of six twists
(Glass Cannon, Swarm, Gate Storm, Giants, Turbo, Payday).

**The ad's own tropes, played straight.** "ONLY 1% CAN BEAT LEVEL N" on the title. A bonus wheel
after every level whose needle you stop for ×2, ×3 or ×5. A revive button — with no video in front
of it.

## How it is built

| File | What it is |
|------|------------|
| [`js/sim.js`](js/sim.js) | the game: cannon, balls, gates, panels, the horde, bosses, perks, Fever. Pure — no DOM — so the validator imports it into Node and plays whole levels |
| [`js/data.js`](js/data.js) | every table: enemies, bosses, gates, panels, drops, perks, the shop, skins, worlds, Daily twists, trophies |
| [`js/render.js`](js/render.js) | the field in 3D (Three.js), a 2D overlay for numbers and banners, and all the juice |
| [`js/audio.js`](js/audio.js) | every sound and the music, synthesised |
| [`js/ui.js`](js/ui.js) | the HUD and every screen between runs |
| [`js/main.js`](js/main.js) | input, the frame loop, starting and ending runs, trophies, the service worker |
| [`js/topics.js`](js/topics.js) | the long explanations behind each (i) |
| [`js/save.js`](js/save.js) | progress in this browser's localStorage |
| `js/update.js`, `js/info.js`, `js/rng.js`, `js/icons.js`, `sw.js`, `vendor/` | lifted from Bloomworks — see below |

**3D over a flat game.** `sim.js` is a flat 400 × 720 field and knows nothing of the camera;
`render.js` maps it onto the ground (sim x is world X, sim y is world Z, squeezed a little so the far
end of the lane is not lost to perspective on an upright phone). The camera backs off until the
whole lane fits and slides the picture down so the cannon sits at the foot of the screen, so a tall
phone and a wide monitor both see every inch of the lane. Balls and sparks are InstancedMeshes, one
draw call each however many there are; balls stretch along their flight. Gate and panel numbers are
canvas textures on the glass; health, damage numbers and banners are drawn on a 2D canvas over the
3D one, projected from the world, so they stay crisp. A drag is read by casting the finger onto the
ground. Settings has a "Glow and shadows" switch that drops the bloom pass and shadow maps on a slow
phone.

**The ball cap.** A phone cannot draw a hundred thousand balls, and the ad's whole joke is that the
number gets absurd. So there are never more than 600 ball objects; past that, a gate makes the
existing balls *heavier* instead of making new ones. Every ball carries a weight, damage scales
with it, the counter is the sum of the weights, and a heavy ball is drawn a little larger. ×3
always means ×3 — `validate.js` checks that weight is conserved exactly past the cap.

**Seeded.** Every random choice in a run comes from its own seeded generator, so a seed replays the
same run (checked), and the Daily is the same level for everybody.

**Reused, not rewritten** (CLAUDE.md). `update.js`, `info.js` and `sw.js` are Bloomworks' — which
are Aeons', Hacks' and RouteCast's — with the version name and the reload question changed.
`rng.js` is Bloomworks' mulberry32 without the noise functions. `vendor/` is Bloomworks' vendored
three r160 and the bloom post-processing passes, and `render.js` keeps its renderer setup (ACES
tone mapping, one shadowing sun, UnrealBloomPass, a quality switch). `icons.js` keeps Bloomworks' shape
and its general glyphs, and adds the game's own. `audio.js` keeps Bloomworks' structure (one
context on the first tap, rate-limited tones, a look-ahead music scheduler) with this game's sounds.

**Auto-update.** The house pattern: the worker never calls `skipWaiting()` on install, answers
`"skip-waiting"` when the page asks, and the page checks on load, every 30 minutes, on return
from hidden and when the network comes back. A bar offers the reload; Settings shows the version
and a "Check for updates" button; a level in progress is confirmed before reloading.
`window.BZ_VERSION` in `index.html` and the worker's `ballzooka-v<N>` cache name are one number,
and the validator refuses to let them drift — bumping it is what publishes an update.

**Privacy.** Progress is in localStorage and nowhere else. No network requests beyond the game's
own files.
