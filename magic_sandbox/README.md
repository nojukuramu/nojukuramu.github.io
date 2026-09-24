# Magic Sandbox — The Loom Tower

Draw your own spells and climb a tower of floating islands — alone, with friends, or against
them. A 3D spell-drawing roguelite in plain JavaScript and three.js: no build step, no
accounts, playable offline once installed (multiplayer needs a connection), on a phone held
either way up, a computer, or a gamepad.

## The game

**The climb.** Ten floors, two per land — Verdant Reach, Ember Wastes, Frostreach, The
Hollow, Stormspire. Odd floors end when you sever three **Anchors**; even floors end at a
**Warden**; floor ten is the **Loom Heart**. Past it, Endless keeps going.

**Surviving it.** Every enemy attack is shown on the ground before it lands — a lane
before a Knot lunges, a filling circle before a Golem slams — and a dash passes straight
through. Floors 1, 3, 5, 7 and 9 are **landings**: a fall offers your last landing back
with the level, boons and circle rank you arrived with. Portals heal a third of your
health; shrines heal half and hand back a potion; nothing respawns behind you.

**Growing.** Levels offer three **boons** to choose from. Wardens drop a thread that raises
your **circle rank**, and rank is what lets a page hold more.

**The spellbook.** A spell is a drawing on a page:

| Mark | How | Means |
|------|-----|-------|
| Glyph | trace a closed shape through the ring's twelve dots | its side count is the element: 3 Air, 4 Fire, 5 Earth, 6 Water |
| Seal | drag out a circle anywhere | one muzzle; its size is its form (Needle, Bolt, Orb, Nova), its position is where the shot leaves |
| Rune | tap a seal's rim | one shot in that direction; the top of the page is where you aim |
| Layer | add a second page | bursts out of every shot of the first when it lands, or on the trigger |

Two different elements in one layer react — Steam, Magma, Wildfire, Mire, Storm,
Shrapnel. Pages that mirror left-to-right are **balanced** and fly true. The book has
stamps for perfect shapes, tap-to-connect, a Mirror switch, undo, examples, and a small
arena that keeps firing the page you are drawing.

**The Sandbox.** An island with straw dummies that report damage per second, a panel that
summons any enemy or a Warden, everything unlocked, endless mana. Your spellbook is
shared, so a page drawn there is ready in the tower — locked until your rank catches up.

## Multiplayer

The single-player climb is unchanged. **Multiplayer** on the title opens a server list;
**Quick join** takes the busiest open room anywhere, or opens one if nobody is waiting.

**Servers and rooms.** Five servers, one per land. Each lists its rooms; make one, or walk
into one, or type a private room's six-letter code. A room's host sets it up:

| Setting | |
|---|---|
| Mode | **Co-op climb**, **Wipe Out**, **Team deathmatch**, **Free for all** |
| Map | PVP only: any of the tower's lands, always built from the same seed |
| Players | 2 to 8 |
| Target | Wipe Out: rounds to win (4 by default). Deathmatches: kills to win |
| Circle rank | PVP only: how much a page may hold. Everyone starts at level one with no boons |
| Start floor | Co-op only: 1, 3, 5, 7 or 9, with the rank and boons those floors would have given |
| Fog of war | You see as far as a lantern reaches, and not through trees, rocks or pillars |
| Private | Left off the list; join by code |

Guests say they are ready, the host starts, and the results screen leads back to the room.

- **Co-op climb** — the tower together. Enemies are tougher for each mage in the room; loot
  is each mage's own. A fallen mage watches a friend until the next floor, or until someone
  stands beside them for a moment. The floor changes when everyone is in the portal, or six
  seconds after anyone is.
- **Wipe Out** — two teams, one life per round, last team standing takes it.
- **Team deathmatch** — two teams, respawning, first team to the kill count.
- **Free for all** — everyone against everyone, first to the kill count.

**How it connects.** There is no game server — the rooms are KaraokeNatin's and RouteCast's:
the room code is the host's peer id on a public PeerJS broker, and everything after the
handshake is a direct WebRTC data channel ([`js/peer.js`](js/peer.js) is KaraokeNatin's
transport, lifted). A *server* is the one new thing: a directory that whichever browser
arrives first holds, that room hosts announce themselves to, and that the next browser takes
over when its holder leaves ([`js/lobby.js`](js/lobby.js)).

**Who decides what.** Your own mage is yours: your machine moves it and decides what hurt
it — an enemy's bolt, another mage's spell — and says who did it. Everything else is the
host's: the enemies' brains and the blows they land on an area, the score, the rounds, the
floors. Clients draw the host's enemies as puppets of a 10 Hz snapshot, and see and hear
every warning they make because the host copies its effects. Spells travel as "slot, where,
which way, and a seed", so every screen flies the same page the same way
([`js/net.js`](js/net.js)).

**What is shared.** Browsing sends nothing but the asking. Joining a room sends your name and
your four pages; a match, where your mage is and what it casts. Leave is on every multiplayer
screen and in every match's pause sheet.

## Controls

| | Move | Aim | Cast | Dash | Trigger | Other |
|---|---|---|---|---|---|---|
| Keyboard & mouse | W A S D | mouse | hold left click | Space | F / right click | 1–4 spells, E interact, Q potion, B book, Esc pause |
| Touch | left thumb, anywhere | right thumb drag | right thumb (hold still = auto-aim, tap = one shot) | DASH | glowing button | tap a spell; book and pause top right |
| Gamepad | left stick | right stick | RT | A | LT | LB/RB spells, X interact, Y potion, Back book, Start pause |

## Files

| File | What it is |
|------|------------|
| [`js/spellcore.js`](js/spellcore.js) | what a drawing means — the whole grammar, pure, tested in Node |
| [`js/forge.js`](js/forge.js) | the spellbook |
| [`js/glyphart.js`](js/glyphart.js) | draws a page on any canvas (book, spell bar, the circle at your feet) |
| [`js/spells.js`](js/spells.js) | shots, novas, reactions, payloads |
| [`js/enemies.js`](js/enemies.js) | the Unravelled, Anchors, Wardens, the Loom Heart |
| [`js/player.js`](js/player.js) | the mage |
| [`js/game.js`](js/game.js) | floors, pickups, chests, shrines, portals, landings, the sandbox |
| [`js/world.js`](js/world.js), [`js/themes.js`](js/themes.js) | island generation, props, weather; the five lands |
| [`js/models.js`](js/models.js) | loaded props and every built character |
| [`js/gfx.js`](js/gfx.js), [`js/fx.js`](js/fx.js) | renderer, camera, quality tiers; pooled particles, rings, ground warnings |
| [`js/hud.js`](js/hud.js), [`js/menus.js`](js/menus.js), [`js/input.js`](js/input.js) | what is on screen, every screen, every device |
| [`js/audio.js`](js/audio.js) | synthesised sound and music |
| [`js/info.js`](js/info.js), [`js/update.js`](js/update.js) | the (i) sheet and the update prompt, both lifted from RouteCast |
| [`js/save.js`](js/save.js) | the one localStorage record |
| [`js/peer.js`](js/peer.js) | WebRTC data channels over a PeerJS broker — KaraokeNatin's transport |
| [`js/lobby.js`](js/lobby.js) | servers (directories somebody holds), rooms, the roster |
| [`js/modes.js`](js/modes.js) | the four modes, maps, settings, teams and scoring — pure, tested in Node |
| [`js/net.js`](js/net.js) | a match kept in step: other mages, casts, the host's enemies, rounds |
| [`js/fog.js`](js/fog.js) | fog of war |
| [`js/mpui.js`](js/mpui.js) | the server list, rooms, room setup, the room, the results |

## Checks

```
node tools/validate.js      # static and behaviour checks, no dependencies
node tools/e2e.js           # the game in Chromium: a climb, the sandbox, a phone both ways
node tools/balance.js 6 3   # a bot climbs; per-floor time, damage taken, potions
node tools/mp-e2e.js        # several browsers over real WebRTC and a local broker: servers,
                            # rooms, quick join, a PVP match, co-op with fog, Wipe Out rounds
```

`window.MS_VERSION` in `index.html` and `CACHE` in `sw.js` carry one number; bumping it
publishes an update, and `validate.js` refuses to let the two drift apart.

Asset sources and licences: [`assets/CREDITS.md`](assets/CREDITS.md).
