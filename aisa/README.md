# Aisa

A Live2D-style rig of one drawing, in the browser. Reached by its address
only: nothing on the site links to it, it is not in the sitemap, and the page
asks search engines to leave it alone.

At rest the rig is the drawing, exactly: every part sits where it was drawn
until a parameter moves it, and `tools/validate.js` checks that this stays
true. From there she turns her head, blinks, looks around, changes expression,
moves her arms and legs, and her hair and skirt swing.

Nothing drives her yet. There's no face tracker, voice, or chat behind her.
`window.Aisa` is the socket those plug into. The drawer in the corner of the
page is a test bench for that socket, not an app.

## How she is built

It isn't a Cubism `.moc3`. Only the Cubism Editor produces one, and the
Cubism runtime is proprietary, so it isn't ours to vendor. Instead this folder
does what Cubism does, by hand:

1. **Upscale.** The drawing is 224×512. `tools/upscale.py` redraws it 4× with
   Real-ESRGAN's anime model, so the lines stay clean when stretched.
2. **Cut.** `tools/cut.py` slices the upscale into 23 parts (back hair, ponytail,
   face, each eyeball, lash and crease, side locks, bangs, ahoge, arms, legs,
   shoes, dress, collar, neck, ear). Where a part is hidden under another,
   it's painted in, so moving a lock of hair uncovers more face rather than a
   hole. The part outlines are hand-drawn polygons in `tools/parts_def.py`, and
   colour decides which part owns each pixel. Output: `art/atlas.png` and
   `art/parts.json`.
3. **Rig.** Each part is a mesh over its piece of the atlas (`js/rig.js`, WebGL).
   Every frame, every vertex goes through the deformers in `js/model.js`:
   - **Body.** Bends at the hips. The head, arms and hair ride on it.
   - **Head.** Rolls at the neck and turns with parallax: bangs move more than
     eyes, eyes more than cheeks, and the back hair moves the other way.
   - **Eyes.** The lash comes down along a curve, and the eyeball is clipped
     under it rather than squashed.
   - **Arms and legs.** Shoulder, elbow and wrist each rotate everything below
     them, blended across the joint so the sleeve bends rather than tearing.
   - **Hair and skirt.** Sway from pendulums.
4. **Drawn parts.** The mouth, blush, tears, sweat drop, anger mark and gloom
   lines are painted by code (`js/model.js`). The mouth is redrawn whenever its
   parameters change, and its neutral shape is the drawn one.

## Driving her

```js
await Aisa.ready;

Aisa.expression("happy");                 // fade to it; { mix: true, weight, fade }
Aisa.expression("neutral");
Aisa.play("wave").then(...);              // a motion; resolves when it ends
Aisa.play("sway", { loop: true });        // { speed, weight, layer: true to stack }
Aisa.stop();                              // or stop("sway")

Aisa.lookAt(0.4, 0.2);                    // -1..1: +x screen right, +y up; null = ahead
Aisa.lookAtPoint(e.clientX, e.clientY);   // at a point on the page
Aisa.blink();

Aisa.eyes({ open: 1, smile: 0, slant: 0, x: 0, y: 0 });
Aisa.eye("left", { open: 0, smile: 1 });  // a wink
Aisa.brows({ y: 0.5, slant: -0.5 });
Aisa.mouth({ open: 0.6, form: 1 });       // form -1 frown .. 1 smile
Aisa.speak(level);                        // lip-sync input, 0..1, as often as you have one

Aisa.head({ x: 15, y: -5, z: 8 });        // degrees: turn, nod, tilt
Aisa.body({ x: 5, y: 0, z: -3, lift: 10 });
Aisa.arm("right", { shoulder: 105, elbow: 45, wrist: 10 });
Aisa.leg("left", 12);

Aisa.set("ParamCheek", 1);                // any parameter by id
Aisa.set({ ParamAngleX: 20, ParamEyeLOpen: 0.5 });
Aisa.get("ParamAngleX");                  // what she is showing this frame
Aisa.base("ParamAngleX");                 // what set() last said
Aisa.reset();

Aisa.auto({ blink: true, breath: true, idle: true, physics: true });
Aisa.view({ zoom: 2, x: 0, y: 60 });      // framing, in source pixels
Aisa.background(null);                    // transparent, or "#rrggbb"
Aisa.on("frame", function (values, dt) {});
Aisa.on("expression", function (name, weight) {});
Aisa.on("motion", function (name, "start" | "end") {});
Aisa.params(); Aisa.expressions(); Aisa.motions(); Aisa.snapshot();
```

**Left and right are hers**, as in Live2D. Her right arm and right eye are the
ones on the left of the screen.

Each frame, the parameters are built up in layers, in this order:

1. what `set()` says
2. look-at
3. idle drift
4. expressions
5. motions (added on top)
6. `speak()`
7. blink
8. physics

So an arm held up with `set()` stays up while she smiles, nods and blinks over
it.

## Parameters

The ids are Cubism's standard set, so a tracker that already outputs Live2D
parameters can feed `Aisa.set()` unchanged.

| Group | Ids |
|-------|-----|
| Head | `ParamAngleX` `ParamAngleY` `ParamAngleZ` (±30) |
| Eyes | `ParamEyeLOpen` `ParamEyeROpen` (0..1.2), `ParamEyeLSmile` `ParamEyeRSmile` (0..1), `ParamEyeLAngle` `ParamEyeRAngle` (lid slant ±1), `ParamEyeBallX` `ParamEyeBallY` (±1) |
| Brows | `ParamBrowLY` `ParamBrowRY` `ParamBrowLAngle` `ParamBrowRAngle` (±1) |
| Mouth | `ParamMouthForm` (±1), `ParamMouthOpenY` (0..1) |
| Face | `ParamCheek` `ParamTear` `ParamSweat` `ParamAnger` `ParamGloom` (0..1) |
| Body | `ParamBodyAngleX` `ParamBodyAngleY` `ParamBodyAngleZ` (±10), `ParamBreath` (0..1), `ParamBodyY` (±30, + is up) |
| Arms | `ParamArmLA` `ParamArmRA` shoulder (-30..180), `ParamArmLB` `ParamArmRB` elbow (-120..150), `ParamHandL` `ParamHandR` wrist (±60) |
| Legs | `ParamLegL` `ParamLegR` (±30, + is outward) |
| Hair | `ParamHairFront` `ParamHairSide` `ParamHairBack` `ParamHairTail` `ParamAhoge` `ParamSkirt` (±1, written by physics, added to what you set) |

A positive slant puts the inner corner down, for an angry look. A negative
slant raises it, for a sad one. A positive shoulder, elbow or wrist value
moves outward and up; a negative one folds inward.

**Expressions:** neutral (the drawing), happy, joy, sad, crying, angry, annoyed,
surprised, scared, shy, sleepy, smug, pout, confused, wink.

**Motions:** nod, shake, tilt, wave, bow, hop, cheer, shrug, lookAround, sigh,
sway (loops).

Both are plain data in `js/expressions.js`, along with the hair pendulums.
Adding one means adding an entry there. The panel builds itself from those
lists.

## Files

| File | What it is |
|------|------------|
| `index.html`, `css/aisa.css` | the page: one canvas, one drawer, one info sheet |
| `js/rig.js` | the engine: meshes, the eye clip, WebGL. Knows nothing about Aisa |
| `js/model.js` | Aisa herself: parameters, landmarks, deformers, drawn parts |
| `js/expressions.js` | expressions, motions, hair physics |
| `js/aisa.js` | the controller and `window.Aisa` |
| `js/info.js` | the (i) sheet, in the shape of `routecast/static/js/info.js` |
| `js/panel.js` | boots her and builds the drawer |
| `art/source.png` | the original drawing |
| `art/atlas.png`, `art/parts.json` | the cut parts (generated) |
| `tools/upscale.py`, `tools/cut.py`, `tools/parts_def.py` | how the atlas was made |
| `tools/validate.js` | `node tools/validate.js`, the checks to run before committing |

To remake the atlas after changing `parts_def.py`, run this from `tools/`:

```
python3 upscale.py ../art/source.png RealESRGAN_x4plus_anime_6B.pth /tmp/up4.png
python3 cut.py /tmp/up4.png ../art
```

`cut.py` needs numpy, opencv-python and Pillow. `upscale.py` also needs torch
and the model weights (the link is in its header). Both are build-time only.
The page needs nothing but a browser with WebGL.
