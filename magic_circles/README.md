# Magic Circles — A Certain RPG Game (static build)

A self-contained static build of the **`a_certain_rpg_game`** prototype, originally a
Flask blueprint served at `/rpg`. Everything here is plain HTML/CSS/JS — no server, no
build step. Open `index.html` (the section hub) and pick an experience.

> The standout feature is the **magic-circle creation system**: you don't pick spells
> from a menu, you *draw* them. This document explains how it works, end to end.

---

## Contents

| Page | Was | What it is |
|------|-----|------------|
| [`index.html`](index.html) | _(new)_ | Hub / launcher for this section |
| [`play.html`](play.html) | `templates/rpg.html` | **Canvas prototype** — the original build, with the in-world magic editor |
| [`phaser.html`](phaser.html) | `templates/rpg_phaser.html` | **Phaser.js edition** — sprites, chunk streaming, minimap, full-scene magic editor |
| [`editor.html`](editor.html) | `templates/editor.html` | **Chunk editor** — design 8×8 world chunks, export as JS presets |

```
magic_circles/
├── index.html         # Section hub (launcher + visual explainer)
├── play.html          # Canvas prototype
├── phaser.html        # Phaser edition (loads Phaser 3.80.1 from CDN)
├── editor.html        # Standalone chunk editor
├── README.md          # This file
└── static/
    ├── css/           # styles.css, editor.css
    ├── assets/        # 18 PNG sprites/tiles
    └── js/
        ├── core/      # Config.js (all tuning constants), Input.js
        ├── utils/     # Vec2.js
        ├── game/      # Game.js, Item.js
        ├── entities/  # Entity, Player, Enemy, Projectile, Particle, WorldObject
        ├── magic/     # Magic.js, Cast.js          ← canvas magic core
        ├── ui/        # MagicEditor.js, LayerManager.js, Inventory.js  ← canvas magic UI
        ├── editor/    # ChunkEditor.js
        ├── main.js    # Canvas entry point + game loop
        └── phaser/    # Phaser implementation (scenes/, world/, entities/, effects/, …)
            └── scenes/MagicEditorScene.js          ← Phaser magic editor
```

---

## The magic-circle creation system

The system exists in **two parallel implementations** that share the same rules:

- **Canvas:** `static/js/magic/Magic.js`, `static/js/magic/Cast.js`,
  `static/js/ui/MagicEditor.js`, `static/js/ui/LayerManager.js`
- **Phaser:** `static/js/phaser/scenes/MagicEditorScene.js`

Tuning constants for both live in **`static/js/core/Config.js`**.

### 1. The node ring

When the editor opens it lays out **12 nodes** evenly around a circle (radius ≈ 60% of the
smaller screen dimension). Node `i` sits at angle `i/12 · 2π − π/2`.
(`Magic.initNodes`, `MagicEditor` render.)

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

(`getElement(n)` in `Magic.js`; identical mapping at `MagicEditorScene.js`. Effect values in
`Config.Effects`.) Each shape consumes mana on cast — Air 15, Fire 20, Earth 25, Water 20
(`Config.ManaCost`).

### 3. Circles → containers

Drag across empty canvas to draw a **circle** (minimum radius 20 px). Circles carry the
elements and define the projectile:

- **Radius > 60 px → Blunt** (heavy, magenta outline); **≤ 60 px → Sharp** (precise, yellow).
  (`Config.SharpRadiusThreshold = 60`.)
- Radius feeds the **spectrum** calculation (below).

### 4. Runes → direction

Tap a circle's **edge** to drop a rune (tap an existing rune to remove it). A rune is just
an angle stored on the circle. The **first rune** rotates the spell's launch direction
relative to your aim (`cont.runes[0]` offset in `Cast.js`).

### 5. Layers → combos & payloads

The **Layer Manager** (canvas: top-right panel; Phaser: in-scene) stacks shapes/circles
into ordered layers. Each layer has visibility (👁) and **solo** (S) toggles, and can be
reordered or deleted.

On cast, layers are grouped by index:

- **Layer 0 = the container** that is thrown immediately.
- **Layers 1…n = the payload chain**, released one stage at a time on **Right-Click**
  (`buildPayloadChain` in `Cast.js`). Because the spectrum of each stage is recomputed at
  *activation* time, you get multi-stage transformations — e.g. a slow `CANNON` that bursts
  into a swarm of `NEEDLE` shards.

### 6. Power

When **Layer 0 is selected and contains a circle**, a **POWER** slider appears (×1–×10).
It scales only the first layer: more range and damage, at a mana premium of
`manaCostMult = 1 + (power − 1) · 0.2` (so ×10 ≈ 2.8× mana). Powered first-layer circles
get a thicker outline and an orange glow.

### 7. Undo

The editor keeps up to 20 snapshots of the layer stack; **`Ctrl+Z`** restores the previous
state (`saveUndoState` / `undoLastEdit`).

### 8. Casting pipeline

When you press **CAST** (or quick-cast with a scroll equipped), `cast()` runs:

1. **Elements (fuel).** Flatten shapes from every *visible* layer, bottom→top. For each, pay
   `ceil(baseCost · manaCostMult)` if affordable, then run **predator reduction** on a stack:
   each element *beats* the next and cancels it, otherwise it stacks.

   > **Water ▶ Fire ▶ Earth ▶ Air ▶ Water** (overlapping opposites annihilate).

2. **Circles.** Group circles by layer; layer 0 is the container, the rest form the payload chain.

3. **Fallbacks.** If there's truly nothing to cast — or shapes were drawn but you can't
   afford *any* of them — fire weak **Base Magic** instead (gray, short range). Elements with
   no circle still cast via a virtual 30 px circle.

4. **Power & damage.** `basePower = (50 + sides·25) · powerMult`; `baseDmg = sides · 25`.

5. **Spectrum.** For each container circle, `getSpellSpectrum(power, radius)` classifies the
   shot by the **power ÷ radius** ratio (plus size/power special cases):

   | Spectrum | Trigger (ratio unless noted) | Behavior |
   |----------|------------------------------|----------|
   | **NEEDLE**  | ≥ 6.0 (or tiny + very powerful) | pierces 4, fast |
   | **LANCE**   | ≥ 4.0 | pierces 3 |
   | **BEAM**    | ≥ 3.0 | pierces 2, long range |
   | **DART**    | ≥ 2.0 | standard throw |
   | **WAVE**    | ≥ 1.5 | spreading arc |
   | **BURST**   | ≥ 1.0 | delayed explosion |
   | **BOULDER** | ≥ 0.5 | slow, heavy push |
   | **CANNON**  | < 0.5 | big, explosive |
   | **NOVA**    | huge circle + very high power | short-range massive explosion |
   | **FLICKER** | tiny circle + low power | weak, fast |

   Each spectrum sets pierce / damage multiplier / knockback / visual scale
   (`Config.SpellSpectrum.effects`). `NEEDLE`/`LANCE`/`BEAM` are **piercing** → `SHARP` physics;
   everything else is `BLUNT`.

6. **Spawn.** A `Projectile` is created per container circle with the resolved element stack,
   spectrum, physics, damage, pierce, speed, direction (aim + rune offset) and the nested
   payload chain.

---

## Controls

| Action | Key / Input |
|--------|-------------|
| Move | `WASD` / Arrows |
| Dash | `Shift` |
| Shoot / cast equipped scroll | Left Click |
| Open/close magic editor | `M` (or the **MAGIC** button) · `Esc` closes |
| Quick cast / remote-trigger payloads | Right Click |
| Draw shape | Click node → node, close on the first node |
| Draw circle | Drag on empty canvas |
| Add/remove rune | Tap a circle's edge |
| Undo (in editor) | `Ctrl+Z` |

In the **canvas prototype** you must have a **scroll** selected to open the editor — each
scroll stores its own spell, saved when you close the editor.

---

## Conversion notes (Flask → static)

This build is a faithful port of the Flask blueprint. The game logic under `static/` is
**byte-for-byte identical** to the source; only the HTML entry points changed.

- **Template calls removed.** Every `{{ url_for('rpg.static', filename='X') }}` became the
  relative path `static/X`. The Phaser page's `window.STATIC_URL` is now the literal
  `"static/"` (its loader reads this and falls back to `/static/` if unset —
  `phaser/scenes/BootScene.js`).
- **Pages live at the section root.** All four HTML files sit directly in `magic_circles/`
  so that relative paths like `static/assets/…` resolve to `magic_circles/static/assets/…`.
  This mirrors how Flask served the pages at `/rpg/` (with a trailing slash). If you move a
  page into a sub-folder, fix the relative paths accordingly.
- **Pages renamed** for clarity: `rpg.html → play.html`, `rpg_phaser.html → phaser.html`,
  `editor.html` unchanged, plus the new `index.html` hub. No internal references depended on
  the old filenames.
- **Phaser is loaded from a CDN** (`phaser@3.80.1`, jsDelivr) exactly as in the original, so
  the Phaser edition needs network access on first load. The canvas prototype and the chunk
  editor have **no external dependencies**.
- **Known quirk (preserved).** The canvas `Game.loadAssets()` requests four sprite files
  (`player_sprite.png`, `enemy_sprite.png`, `ground_tile.png`, `particle_texture.png`) that
  don't exist in `static/assets/`; the canvas game therefore renders programmatically. This
  matches the original behavior and was intentionally left unchanged. (The Phaser edition uses
  the 18 real PNGs in `static/assets/`.)

### Running locally

Serve over HTTP (don't open via `file://`, or the Phaser asset loader's requests will be
blocked):

```bash
cd magic_circles
python3 -m http.server 8000
# open http://localhost:8000/
```
