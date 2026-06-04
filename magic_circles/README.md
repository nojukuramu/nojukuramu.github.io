# Magic Circles — A Certain RPG Game (static build)

A self-contained static build of the **`a_certain_rpg_game`** prototype, originally a Flask
blueprint served at `/rpg`. Everything here is plain HTML/CSS/JS — no server, no build step.
Open `index.html` (the section hub) and hit **Play**.

> The standout feature is the **magic-circle creation system**: you don't pick spells
> from a menu, you *draw* them. This document explains how it works, end to end.

The game is built with **Phaser 3** (loaded from a CDN): sprites, Matter physics, a
chunk-streamed procedural world, a minimap, and a full-scene magic editor.

---

## Contents

| Page | What it is |
|------|-----------|
| [`index.html`](index.html) | Hub / launcher for this section + visual explainer |
| [`phaser.html`](phaser.html) | **The game** — Phaser.js edition (loads Phaser 3.80.1 from a CDN) |

```
magic_circles/
├── index.html         # Section hub (launcher + visual explainer)
├── phaser.html        # The game (loads Phaser 3.80.1 from CDN)
├── README.md          # This file
└── static/
    ├── assets/        # 18 PNG sprites/tiles
    └── js/
        ├── core/      # Config.js — all tuning constants (shared)
        └── phaser/    # Phaser implementation
            ├── scenes/      # BootScene, MenuScene, GameScene, MagicEditorScene
            ├── world/       # ChunkManager, BiomeRenderer, PathwayRenderer
            ├── entities/    # PlayerSprite, EnemySprite, ProjectileSprite
            ├── effects/     # MinimapSystem, ElementalEffects
            ├── game/        # InventorySystem, Item
            ├── config/      # ChunkPresets
            ├── utils/       # SeededRandom
            └── game.js      # Phaser bootstrap + GameState
```

---

## The magic-circle creation system

All tuning constants live in **`static/js/core/Config.js`**. The editor UI lives in
**`static/js/phaser/scenes/MagicEditorScene.js`**; casting and the runtime spell behaviour
live in **`static/js/phaser/scenes/GameScene.js`** and
**`static/js/phaser/entities/ProjectileSprite.js`**.

### 1. The node ring

When the editor opens it lays out **12 nodes** evenly around a circle (radius ≈ 60% of the
smaller screen dimension). Node `i` sits at angle `i/12 · 2π − π/2`.
(`MagicEditorScene.initNodes`.)

### 2. Shapes → elements (the spell's *fuel*)

Click a node, then drag/click from node to node to trace a path. Close the loop by
returning to the **first** node with at least 3 nodes in the path. The **side count picks
the element**:

| Sides | Element | Color | Role in combat |
|------:|---------|-------|----------------|
| 3 | **Air**   | `#A0E0E0` | Speed & knockback — propels targets (`propelForce` 2500) |
| 4 | **Fire**  | `#E06060` | Damage & **burn** (DoT: 5/tick for 3 s) |
| 5 | **Earth** | `#80C060` | Impact & force — blunt-only push/bulldoze |
| 6 | **Water** | `#4080E0` | Slow & control (×0.3 speed for 3 s) |

(`getElement(n)` in `GameScene.js` / `MagicEditorScene.js`. Effect values in
`Config.Effects`.) Each shape consumes mana on cast — Air 15, Fire 20, Earth 25, Water 20
(`Config.ManaCost`).

### 3. Circles → containers

Drag across empty space to draw a **circle** (minimum radius 20 px). Circles carry the
elements and define the projectile:

- **Radius > 60 px → Blunt** (heavy); **≤ 60 px → Sharp** (precise).
  (`Config.SharpRadiusThreshold = 60`.)
- Radius feeds the **spectrum** calculation (below).

### 4. Runes → direction

Tap a circle's **edge** to drop a rune (tap an existing rune to remove it). A rune is just
an angle stored on the circle. The **first rune** rotates the spell's launch direction
relative to your aim (`runes[0]` offset in `GameScene.castSpell` / `ProjectileSprite.activate`).

### 5. Layers → combos & payloads

The **Layer Manager** (an in-scene panel) stacks shapes/circles into ordered layers. Each
layer has visibility (👁) and **solo** (S) toggles, and can be reordered or deleted.

On cast, layers are grouped by index:

- **Layer 0 = the container** that is thrown immediately.
- **Layers 1…n = the payload chain**, released one stage at a time on **Right-Click**
  (`buildPayloadChain` in `GameScene.js`, `activate()` in `ProjectileSprite.js`). Because the
  spectrum of each stage is recomputed at *activation* time, you get multi-stage
  transformations — e.g. a slow `CANNON` that bursts into a swarm of `NEEDLE` shards.

### 6. Power

When **Layer 0 is selected and contains a circle**, a **POWER** slider appears (×1–×10).
It scales only the first layer: more range and damage, at a mana premium of
`manaCostMult = 1 + (power − 1) · 0.2` (so ×10 ≈ 2.8× mana).

### 7. Undo

The editor keeps up to 20 snapshots of the layer stack; **`Ctrl+Z`** restores the previous
state (`saveUndoState` / `undoLastEdit` in `MagicEditorScene`).

### 8. Casting pipeline

When you press **CAST** (or quick-cast with a scroll equipped), `GameScene.castSpell()` runs:

1. **Elements (fuel).** Flatten shapes from every *visible* layer, bottom→top. For each, pay
   `ceil(baseCost · manaCostMult)` if affordable, then run **predator reduction** on a stack:
   each element *beats* the next and cancels it, otherwise it stacks.

   > **Water ▶ Fire ▶ Earth ▶ Air ▶ Water** (overlapping opposites annihilate).

2. **Circles.** Group circles by layer; layer 0 is the container, the rest form the payload chain.

3. **Fallbacks.** If there's truly nothing to cast — or shapes were drawn but you can't
   afford *any* of them — fire weak **Base Magic** instead (`castBaseMagic`). Elements with
   no circle still cast via a virtual 30 px circle.

4. **Power & damage.** `basePower = (50 + sides·25) · powerMult`; `baseDmg = sides · 25`.

5. **Spectrum.** For each container circle, the **power ÷ radius** ratio classifies the shot
   (plus size/power special cases):

   | Spectrum | Behavior |
   |----------|----------|
   | **NEEDLE**  | pierces 4, fast |
   | **LANCE**   | pierces 3 |
   | **BEAM**    | pierces 2, long range |
   | **DART**    | standard throw |
   | **WAVE**    | spreading arc |
   | **BURST**   | delayed explosion |
   | **BOULDER** | slow, heavy push |
   | **CANNON**  | big, explosive |
   | **NOVA**    | huge circle + very high power → short-range massive explosion |
   | **FLICKER** | tiny circle + low power → weak, fast |

   Each spectrum sets pierce / damage multiplier / knockback / visual scale
   (`Config.SpellSpectrum.effects`). `NEEDLE`/`LANCE`/`BEAM` are **piercing** → `SHARP` physics;
   everything else is `BLUNT`.

6. **Spawn.** A `ProjectileSprite` is created per container circle with the resolved element
   stack, spectrum, physics, damage, pierce, speed, direction (aim + rune offset) and the
   nested payload chain.

---

## Controls

| Action | Key / Input |
|--------|-------------|
| Move | `WASD` / Arrows |
| Dash | `Shift` |
| Shoot / cast equipped scroll | Left Click |
| Open/close magic editor | `M` (or the **MAGIC** button) · `Esc` closes |
| Remote-trigger payloads | Right Click |
| Draw shape | Click node → node, close on the first node |
| Draw circle | Drag on empty space |
| Add/remove rune | Tap a circle's edge |
| Undo (in editor) | `Ctrl+Z` |

Equip a **scroll** to open the magic editor — each scroll stores its own spell, saved when
you close the editor.

---

## Stability / safety notes

The projectile lifecycle was hardened to eliminate an intermittent freeze that could happen
when right-clicking to release a payload layer. The game loop runs inside Phaser's
`requestAnimationFrame` step, so **any uncaught error there stops the loop and freezes the
screen**. The fixes:

- `ProjectileSprite` now has an explicit lifecycle flag (`isDead`) and an `isAlive()` guard.
  Every per-frame / collision method (`update`, `activate`, `onHitEnemy`, `onHitObject`,
  `pushEntitiesOnPath`, `applyElementalEffects`, `checkProjectileCollisions`) bails out once
  the projectile's physics body has been destroyed — preventing use-after-destroy crashes.
- `die()` is **idempotent** and wraps every teardown step, so a projectile can be killed by
  several systems in the same step without throwing.
- Payload shards spawn spread apart (not all at the exact same point) and with sanitized,
  finite velocities, so the Matter physics solver can't be wedged by coincident bodies or NaN.
- The scene `update()`, the input handlers, the `collisionstart` callback, and
  `remoteTrigger()` are wrapped in `try/catch`. A single bad object now drops one frame and
  logs a warning instead of freezing the whole game.

---

## Conversion notes (Flask → static)

This build is a faithful port of the Flask blueprint. The Phaser game logic under `static/`
is copied from the source; the HTML entry points are the only structural change.

- **Template calls removed.** Every `{{ url_for('rpg.static', filename='X') }}` became the
  relative path `static/X`. The page's `window.STATIC_URL` is now the literal `"static/"`
  (the loader reads this and falls back to `/static/` if unset — `phaser/scenes/BootScene.js`).
- **Pages live at the section root.** The HTML files sit directly in `magic_circles/` so that
  relative paths like `static/assets/…` resolve correctly. This mirrors how Flask served the
  pages at `/rpg/` (with a trailing slash).
- **Phaser is loaded from a CDN** (`phaser@3.80.1`, jsDelivr), so the page needs network
  access on first load.

### Running locally

Serve over HTTP (don't open via `file://`, or the asset loader's requests will be blocked):

```bash
cd magic_circles
python3 -m http.server 8000
# open http://localhost:8000/
```
