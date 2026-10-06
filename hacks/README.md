# Hacks — the movement shooter you are allowed to cheat in

A first-person shooter built around movement, where writing cheats is the point. Plain
JavaScript and three.js: no build step, no accounts, playable offline once installed, on a
computer or a phone held either way up, alone against bots or in rooms with friends.

Press **H** in a match and you are in an editor. A hack is a few lines of JavaScript that can
read everything in the game — every player's position, velocity and seventeen bones, the map,
the camera — and change only you: your buttons, your aim, your view, your own body, your own
screen. ESP boxes, bone drawing, radars, aimbots, triggerbots, bunny hop and strafe scripts,
recoil control and fly hacks are all *written*, not switched on. Fourteen lessons go from
"print something" to "predict where a sniper round will be", and each one is the real maths
behind the cheat.

## Moving

The core is a port of Source's player movement (`gamemovement.cpp`): friction, acceleration,
air acceleration with its 30-unit cap, clip-and-slide against the level, step-up, stay on
ground. None of the techniques are coded; they are what that code does when played well.

| Technique | How |
|-----------|-----|
| Bunny hop | Friction only runs on a tick that starts on the ground. Jump the tick you land (a fresh press — holding jump never hops) and you keep all your speed. One tick of grace either side. |
| Air strafe | In the air, hold A or D (not W) and turn the same way. Acceleration is capped along the direction you ask for, so asking almost at right angles to your velocity gains speed every tick. |
| Surf | The purple ridges are steeper than 45°, so they are not ground: you slide along them with no friction, all the way to the foot. |
| Sprint, slide | Crouch at a sprint to slide, with a boost on a cooldown; a slide while it recharges, or out of a landing, still gets a smaller push (never past 12 m/s, and tapping crouch builds nothing). The view widens with the slide's speed. Downhill, gravity along the slope speeds a slide up — and on a ramp steeper than about 12°, crouching slides you down it from a standstill. Jump out of it to keep the speed. |
| Wall climb | Jump into a wall and hold jump and forward. Over the top, you mantle. |
| Wall jump | Tap jump beside a wall. Your speed along the wall is kept; the same wall twice in a row does not count. The red shafts are made for it. |
| Lunge | With the blade out, hold Aim (right click; the Aim button on a phone) on any surface — floor, wall, ceiling — and you stick to it and charge. Release to launch where you look; the more squarely you face away from the surface, the harder. A tap is a quick swing. |
| Grapple | A gun, in slot 4: its key (E or 4) draws it and puts it away. Hold Fire and the hook flies where you look; where it bites, the rope reels you in, and lets go by itself when you arrive. The rope never lengthens, so moving away from the hook becomes going round it: steer with the move keys to swing. Hook a player and you are each pulled towards the other. Let go to stop; a wall between you and the hook cuts it. |

Steep slopes used to stop a body dead halfway down: against a slanted face a rounding error made the
same plane count twice, and the crease between a plane and itself has no direction. The slide-move now
nudges off a plane it meets again, as Quake III's `PM_SlideMove` does.

The simulation runs in fixed 64 Hz ticks paid out of real elapsed time (`js/clock.js`) and the
screen is drawn between them, so 30, 60, 144 and 240 fps give the same result — the validator
runs the same movement at all four and compares.

## Weapons

| | | |
|---|---|---|
| Handguns | **Wasp P9** — fast, accurate semi-auto | **Brick .50** — six heavy rounds |
| Full auto | **Hornet SMG** — close, 900 rpm | **Kestrel AR** — the all-rounder |
| Shotgun | **Mauler** — ten pellets, pump | |
| Snipers | **Talon .338** — a bolt action whose round flies: it has travel time and drops | **Condor .50** — heavy: slow to aim and carry, a long bolt, and a hit anywhere kills |
| Melee | **Katana** — charges fast, lunges short, cuts wide | **Lancer** — charges slowly, lunges far and hard, hits only at its tip |

Recoil lifts your view and stays lifted. Moving spreads your shots, jumping more; aiming down
sights tightens them. Health comes back after a few seconds out of the fight.

A sniper's first stretch (40 m for the Talon, 50 for the Condor) is covered the instant it fires, so a
close shot lands where the reticle was; past that it flies, at 330 and 380 m/s. Both scopes have a
second, doubled zoom (Z, or middle mouse). After every shot the bolt is worked: the scope shakes, the
gun rolls over in your hands, and a ring by the crosshair fills until you can fire again (a reload
shows there too).

Every round goes on through a body into the next, keeping a share of its damage each time — snipers
through two or three, the Brick through two, most guns through one, a pellet barely. One round, two
kills, is a **collateral**. Between the legs, from the front, is the **nut** box: more than the body,
less than the head, and announced.

Blades hit harder the faster you are going when they land (speed in all three axes, so a dive counts):
nothing extra at a run, twice as hard at 18 m/s, two and a half times past 24. The multiplier shows
by the crosshair, and carried at speed the blade is held low and forward with lines streaming past.

Aiming puts the gun's own sights in the middle of the screen, exactly where the shot goes, on any
screen shape: every model's sight line is level, and the aimed pose puts it on the gun camera's
axis (`js/viewmodel.js`). The Talon looks through a scope instead.

## The arena

Relay, one quarter drawn by hand and turned four ways, so no corner is a worse place to spawn: a surf
ridge, a wall-jump shaft to a sniper's nest, a slide hill, a canopy to lunge up to, a perch, a jump pad,
and the Core in the middle. Above that is a second map, for fighting in the air:

- **the Skyway**: a ring of bridges twelve metres up, all the way round, with an on-ramp and a pad in
  every quarter, cover to fight from, and a break halfway along each side with a stepping stone in it;
- **the Halo**: a square ring of slabs sixteen metres over the Core, thrown up to by four pads;
- **kites**: small platforms hanging in the air, reachable only by grapple (or a very good lunge).

Bots reach the Skyway and the Halo by the ramps and pads (`js/nav.js` finds them); spots no link leads
to are marked so a bot never wanders under them.

## Sound and the announcer

Every gun's shot is a real recording, with a distant take for somebody far away; so are the reloads,
the bolt, the pump, the blades, footsteps and metal. All are free (CC0, except the announcer's
WARLORD lines, CC BY-SA 4.0), listed with their sources in
[`assets/sounds/CREDITS.md`](assets/sounds/CREDITS.md). Until a file has loaded its synthesised
version plays, so the game is never silent and never waits.

`js/medals.js` decides what each of your kills was worth — first blood, double, triple and multi
kills, streaks, headshots, nut shots, collaterals, revenge, combo breakers, long shots, mid-air kills,
speed kills, players reeled in on your grapple — shows them under the crosshair (the loudest across
the middle) and hands the announcer at most two lines. Kills that come quickly ring a little higher
each time. The two lines no recording has, "Nut shot" and "Collateral", are spoken by the device's own
voice, and only by one that runs on the device. The announcer has its own slider.

## Models

The guns, the blades and the players are public-domain (CC0) models by Quaternius, from
OpenGameArt, converted to GLB for this game — see [`assets/models/CREDITS.md`](assets/models/CREDITS.md).
Every player is the same body, posed each frame from the seventeen bones the hitboxes use
(`js/rig.js`), so a head you can see is a head you can hit; their shirt and the band of light
across their eyes are their colour. Until the models have loaded, or if they never do, the old
box-built mannequins and guns stand in.

## Hacks

Hacks run in a Web Worker (`js/hackworker.js`), so a hack has no access to the page, the game's
objects or the network — everything it sees arrives as a frozen copy once a frame, and
everything it does leaves as a request that `js/hackapi.js` checks before it touches anything.
The requests that exist are *press your own buttons, turn your own view, change your own body,
draw on your own screen*. There is no request that names another player, or anyone's health,
ammo or score. Writing `enemy.hp = 0` is a TypeError, and the console says why.

A room chooses how much hacks may do:

| Rules | Allows |
|-------|--------|
| Visual only | reading everything, drawing on your screen, highlighting players through walls |
| Assist | and pressing your buttons and aiming for you |
| Full self | and your own velocity, gravity, speed, jump height and a teleport |

A hack that loops forever freezes only the worker; the page notices within a second, turns
that hack off and restarts the others. Syntax errors are marked on their line; runtime errors
come with a line and, for the common ones, a sentence about what went wrong.

The **Learn** tab has the lessons; the **API** tab lists everything a hack can use.

## Playing

| | |
|---|---|
| Play vs bots | free for all or teams, 1–11 bots, four difficulties that differ only in human things: reaction time, first-aim error, turn speed, whether they strafe and bunny hop, and how often they grapple you in |
| Practice | four dummies that wander and never shoot back — something for an ESP or an aimbot to find |
| Multiplayer | servers with rooms in them, Quick join, room codes; free for all or team deathmatch, a kill count, a time limit, bots to fill the room, and the room's hack rules |

Bots move by the same physics and have to see you before they shoot. They find their way on a
graph generated from the map's brushes (`js/nav.js`) — walk, jump, climb, drop and jump-pad
links, each checked with the same box sweeps movement uses.

## Controls

Every keyboard and mouse action is rebindable (Settings, Keys), two keys per action, including
the mouse wheel — bind jump to the wheel and each notch is a fresh press, the way Source players
hop by hand. Escape always opens the menu.

Aim, crouch, sprint and the scoreboard can each **hold**, **toggle** or be **mixed** — a
quick tap toggles, a longer press holds — and sprint can be always on. Keys and touch are set
separately (Settings, Controls and Touch), so a phone can toggle what a keyboard holds.

Buttons mean what the thing in your hands needs: Fire is the trigger of whatever is out, the
grapple included, and Aim is the lunge while the blade is out (always a hold, whatever Aim is set
to). The courtesies every shooter has are here too: asking to run — a fresh sprint, the stick
pushed out, auto-run, or a slide ending while you still run — stands you up out of a crouch;
aiming or firing ends a toggled sprint; a new weapon comes up unaimed; and **auto-run** (`=`)
keeps you running forward until a move key takes over.

**Force landscape** (Settings, Touch) plays sideways however the phone is held. Where the browser
allows it — Android, or the game installed to the home screen — the screen is locked sideways
(going fullscreen if it must; the lock is lifted from ARCO's `shell.js`). Where it does not, as on
iPhone Safari or with the phone's own rotation lock on, the game itself is drawn turned a quarter
turn and the touch controls follow (`js/orient.js`); the hacks panel stays upright for typing.

On a phone every button is always on screen. **Move buttons** (Settings, Touch) lets you drag
each one anywhere, size it and fade it, with a separate layout for sideways and upright. No
button can be dropped on another, under the editor's bar or on the readouts that cannot move
(score, health, ammo — shown faintly while you edit): it slides to the nearest free place, so
none is ever lost where it cannot be picked up again. Fire and Aim can be dragged while
held to aim as you shoot; a touch anywhere else looks around — except low on the left, where the
**floating stick** comes to your thumb. Push your thumb out past the stick's ring to run; carry on
up to the lock above it and let go, and you keep running hands-free until you touch the stick. Fire
and Aim change their pictures to say what they do (the hook, the blade, the lunge).

## Files

| File | What it is |
|------|------------|
| [`js/brush.js`](js/brush.js) | the world as convex brushes, and a box swept through them (Quake III's trace) |
| [`js/movement.js`](js/movement.js) | Source's movement, plus sprint, slide, climb, wall jump and the lunge |
| [`js/clock.js`](js/clock.js) | real time in, fixed ticks out |
| [`js/map.js`](js/map.js) | the arena, Relay: one quarter drawn by hand and turned four ways, with the Skyway, the Halo and kites above |
| [`js/nav.js`](js/nav.js) | the bots' graph, read off the brushes, and A* |
| [`js/skeleton.js`](js/skeleton.js) | seventeen bones posed from movement state; hitboxes on them |
| [`js/weapons.js`](js/weapons.js) | the guns, the blades, and what a trigger pull does |
| [`js/game.js`](js/game.js) | a match: actors, ticks, shots, damage, deaths, scoring |
| [`js/bots.js`](js/bots.js) | bot brains, producing the same commands a player does |
| [`js/render.js`](js/render.js) | the arena, the sky and the light, tracers and bullet holes, the camera; the canvas measured, never assumed |
| [`js/models.js`](js/models.js), [`js/rig.js`](js/rig.js) | the CC0 models, loaded in the background; the body posed on the game's bones |
| [`js/figures.js`](js/figures.js), [`js/viewmodel.js`](js/viewmodel.js) | everybody else's body and gun; your own arms and gun, sights on the screen's centre |
| [`js/input.js`](js/input.js), [`js/touch.js`](js/touch.js), [`js/controls.js`](js/controls.js) | keys and mouse, the touch controls and their editor, the table of actions and layouts |
| [`js/hud.js`](js/hud.js), [`js/menus.js`](js/menus.js), [`js/audio.js`](js/audio.js) | what is drawn over the game, every screen, recorded and synthesised sound and the announcer |
| [`js/medals.js`](js/medals.js) | what each of your kills was worth, and which of it the announcer says |
| [`js/hackworker.js`](js/hackworker.js), [`js/hackapi.js`](js/hackapi.js) | where hacks run; what they are shown and what they may do |
| [`js/hackui.js`](js/hackui.js), [`js/editor.js`](js/editor.js), [`js/hackdocs.js`](js/hackdocs.js) | the hacks panel, the code editor, the lessons and the API reference |
| [`js/modes.js`](js/modes.js), [`js/net.js`](js/net.js), [`js/mpui.js`](js/mpui.js) | match rules and hack rules; a match kept in step across a room; the multiplayer screens |
| [`js/peer.js`](js/peer.js), [`js/lobby.js`](js/lobby.js) | the WebRTC transport (KaraokeNatin's) and the server list and rooms (Magic Sandbox's) |
| [`js/info.js`](js/info.js), [`js/update.js`](js/update.js) | the (i) sheet and the update prompt, lifted from Magic Sandbox |
| [`js/orient.js`](js/orient.js) | Force landscape: the real lock (ARCO's) where there is one, the game turned where there is not |
| [`js/save.js`](js/save.js) | the one localStorage record, re-checked on the way in |

## Checks

```
node tools/validate.js    # static and behaviour checks, no dependencies — the sandbox in a stand-in worker, and a match played headless
node tools/e2e.js         # the game in Chromium: settings, a match, medals, the grapple, the lunge, run-to-stand, auto-run, the scope, the hacks panel, practice, a phone both ways
node tools/mp-e2e.js      # two browsers over real WebRTC: rooms, a grapple across machines, a hack-fought free for all, bots, hack rules
```

`window.HK_VERSION` in `index.html` and `CACHE` in `sw.js` carry one number; bumping it
publishes an update, and `validate.js` refuses to let the two drift apart.

## What leaves the device

Nothing, alone. In a room: your name, and during a match where you are, where you aim, what
you shoot and where your grapple is. Your hacks' code never leaves your browser — other people see what your hacks *do*,
not what they are. A public signalling service introduces browsers to each other and then steps
aside; there is no game server.
