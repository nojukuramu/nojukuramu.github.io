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
| Surf | The purple ridges are steeper than 45°, so they are not ground: you slide along them with no friction. |
| Sprint, slide | Crouch at a sprint to slide, with a boost on a cooldown. Downhill, gravity along the slope speeds a slide up. Jump out of it to keep the speed. |
| Wall climb | Jump into a wall and hold jump and forward. Over the top, you mantle. |
| Wall jump | Tap jump beside a wall. Your speed along the wall is kept; the same wall twice in a row does not count. The red shafts are made for it. |
| Lunge | Hold the lunge key on any surface — floor, wall, ceiling — and you stick to it and charge. Release to launch where you look; the more squarely you face away from the surface, the harder. A tap is a quick swing. |

The simulation runs in fixed 64 Hz ticks paid out of real elapsed time (`js/clock.js`) and the
screen is drawn between them, so 30, 60, 144 and 240 fps give the same result — the validator
runs the same movement at all four and compares.

## Weapons

| | | |
|---|---|---|
| Handguns | **Wasp P9** — fast, accurate semi-auto | **Brick .50** — six heavy rounds |
| Full auto | **Hornet SMG** — close, 900 rpm | **Kestrel AR** — the all-rounder |
| Shotgun | **Mauler** — ten pellets, pump | |
| Sniper | **Talon .338** — the only gun whose round flies: it has travel time and drops | |
| Melee | **Katana** — charges fast, lunges short, cuts wide | **Lancer** — charges slowly, lunges far and hard, hits only at its tip |

Recoil lifts your view and stays lifted. Moving spreads your shots, jumping more; aiming down
sights tightens them. Health comes back after a few seconds out of the fight.

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
| Play vs bots | free for all or teams, 1–11 bots, four difficulties that differ only in human things: reaction time, first-aim error, turn speed, whether they strafe and bunny hop |
| Practice | four dummies that wander and never shoot back — something for an ESP or an aimbot to find |
| Multiplayer | servers with rooms in them, Quick join, room codes; free for all or team deathmatch, a kill count, a time limit, bots to fill the room, and the room's hack rules |

Bots move by the same physics and have to see you before they shoot. They find their way on a
graph generated from the map's brushes (`js/nav.js`) — walk, jump, climb, drop and jump-pad
links, each checked with the same box sweeps movement uses.

## Controls

Every keyboard and mouse action is rebindable (Settings, Keys), two keys per action, including
the mouse wheel — bind jump to the wheel and each notch is a fresh press, the way Source players
hop by hand. Escape always opens the menu.

On a phone every button is always on screen. **Move buttons** (Settings, Touch) lets you drag
each one anywhere, size it and fade it, with a separate layout for sideways and upright. Fire
and Lunge can be dragged while held to aim as you shoot; a touch anywhere else looks around.

## Files

| File | What it is |
|------|------------|
| [`js/brush.js`](js/brush.js) | the world as convex brushes, and a box swept through them (Quake III's trace) |
| [`js/movement.js`](js/movement.js) | Source's movement, plus sprint, slide, climb, wall jump and the lunge |
| [`js/clock.js`](js/clock.js) | real time in, fixed ticks out |
| [`js/map.js`](js/map.js) | the arena, Relay: one quarter drawn by hand and turned four ways |
| [`js/nav.js`](js/nav.js) | the bots' graph, read off the brushes, and A* |
| [`js/skeleton.js`](js/skeleton.js) | seventeen bones posed from movement state; hitboxes on them |
| [`js/weapons.js`](js/weapons.js) | the guns, the blades, and what a trigger pull does |
| [`js/game.js`](js/game.js) | a match: actors, ticks, shots, damage, deaths, scoring |
| [`js/bots.js`](js/bots.js) | bot brains, producing the same commands a player does |
| [`js/render.js`](js/render.js) | the arena, mannequins on the bones, your gun, tracers, the camera |
| [`js/input.js`](js/input.js), [`js/touch.js`](js/touch.js), [`js/controls.js`](js/controls.js) | keys and mouse, the touch controls and their editor, the table of actions and layouts |
| [`js/hud.js`](js/hud.js), [`js/menus.js`](js/menus.js), [`js/audio.js`](js/audio.js) | what is drawn over the game, every screen, synthesised sound |
| [`js/hackworker.js`](js/hackworker.js), [`js/hackapi.js`](js/hackapi.js) | where hacks run; what they are shown and what they may do |
| [`js/hackui.js`](js/hackui.js), [`js/editor.js`](js/editor.js), [`js/hackdocs.js`](js/hackdocs.js) | the hacks panel, the code editor, the lessons and the API reference |
| [`js/modes.js`](js/modes.js), [`js/net.js`](js/net.js), [`js/mpui.js`](js/mpui.js) | match rules and hack rules; a match kept in step across a room; the multiplayer screens |
| [`js/peer.js`](js/peer.js), [`js/lobby.js`](js/lobby.js) | the WebRTC transport (KaraokeNatin's) and the server list and rooms (Magic Sandbox's) |
| [`js/info.js`](js/info.js), [`js/update.js`](js/update.js) | the (i) sheet and the update prompt, lifted from Magic Sandbox |
| [`js/save.js`](js/save.js) | the one localStorage record, re-checked on the way in |

## Checks

```
node tools/validate.js    # static and behaviour checks, no dependencies — including the sandbox, in a stand-in worker
node tools/e2e.js         # the game in Chromium: settings, a match, the hacks panel, practice, a phone both ways
node tools/mp-e2e.js      # two browsers over real WebRTC: rooms, a hack-fought free for all, bots, hack rules
```

`window.HK_VERSION` in `index.html` and `CACHE` in `sw.js` carry one number; bumping it
publishes an update, and `validate.js` refuses to let the two drift apart.

## What leaves the device

Nothing, alone. In a room: your name, and during a match where you are, where you aim and what
you shoot. Your hacks' code never leaves your browser — other people see what your hacks *do*,
not what they are. A public signalling service introduces browsers to each other and then steps
aside; there is no game server.
