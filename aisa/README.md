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
2. **Cut.** `tools/cut.py` slices the upscale into 25 parts (back hair, ponytail,
   face, each eyeball, lash, brow strokes, side locks, bangs, ahoge, arms, legs,
   shoes, dress, collar, neck, ear). The part outlines are hand-drawn polygons in
   `tools/parts_def.py`, and colour decides which part owns each pixel. Output:
   `art/atlas.png` and `art/parts.json`.

   What is hidden under another part is painted in, so a move uncovers more of
   her rather than a hole:
   - Long hair is carried down its own strands.
   - Skin is a smooth continuation of the skin around it.
   - The neck is a column that shows a throat when she looks up.
   - The thighs continue up under the skirt in smooth skin, and the socks on
     down into the shoes.
   - The bodice continues under the sleeves.
   - The back hair is one mass from crown to tips, behind the neck and the
     dress as well, in the drawing's flat shadow colour: a turned head or a
     lifted arm uncovers hair, never a join or a hole. It has an outline
     wherever it becomes a silhouette, including under the ponytail.

   Lines are kept whole:
   - A line between two parts, and its anti-aliased edge, belongs to the part
     in front, so it moves as one piece instead of splitting down the middle.
   - For the limbs, the dress and the neck, fill is only a pixel that is one
     of the drawing's flat colours; ink and every blend of ink with a colour
     belongs to the part it touches, the one in front where it touches two.
     A stub of hair outline beside a hand, or a blend of dress and ink that
     passed for skin, is therefore never left on an arm to spike when it moves.
   - A sleeve is a closed cap, shoulder line to cuff to crease: nothing of
     the chest goes up with the arm. What the drawing hides under the bodice
     is a part of its own (`sleeveR`, `sleeveL`): on her right a small gusset
     of armpit fabric, whose edge by the crease follows the arm and whose edge
     under the bodice stays with the torso, so the mesh stretches as the arm
     rises; on her left, whose sleeve is drawn three-quarter on as a thin
     crescent, the body of the tube as well. Both are a shade darker than the
     outside and hidden at rest. The dress's side seam under each sleeve
     is redrawn as one clean line (`DRESS_SIL`, `SEAM_L` in `parts_def.py`).
   - The soft shadow the bangs and locks cast on the skin goes with them.
   - Outlines are redrawn after the cut (`smooth_lines`, `smooth_edge`):
     each part's ink and its own edge are traced as curves with potrace
     (`apt install potrace` is not needed; `pip install potracer`), so a
     long edge is a straight line or a smooth curve rather than pixel steps,
     and debris smaller than a line is dropped.
   - The upscaler's pale halos are removed wherever a moving part would drag
     them out into view.
3. **Rig.** Each part is a mesh over its piece of the atlas (`js/rig.js`, WebGL).
   Every frame, every vertex goes through the deformers in `js/model.js`:
   - **Body.** Bends at the hips. The head, arms and hair ride on it.
   - **Head.** Rolls at the neck and turns with parallax: bangs move more than
     eyes, eyes more than cheeks, and the back hair moves the other way.
   - **Eyes.** The lash comes down along a curve, and the eyeball is clipped
     under it rather than squashed. A smile closes the eye from below, with a
     fine lower lid drawn along the cheek.
   - **Arms and legs.** Shoulder, elbow and wrist each rotate everything below
     them, blended across the joint so the sleeve bends rather than tearing.
   - **Hair and skirt.** Sway from pendulums. A swinging leg carries the hem.

   Everything a deformer needs that depends only on where a vertex was drawn
   (its depth in the head, how far down a lock it is, how much of a joint it
   is) is worked out once, the first time the mesh moves. Only what changes is
   computed per frame. On a desktop, about 8,000 vertices take a millisecond.
4. **Drawn parts.** The mouth, the smiling lower lids, blush, tears, sweat drop,
   anger mark and gloom are painted by code (`js/model.js`). They are redrawn
   only when their parameters change. The mouth's neutral shape is the drawn
   one, and it opens through a closed smile or frown into an "o", a wide "D",
   or an upside-down one.

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
Aisa.pause(); Aisa.step(1 / 30);          // run your own clock: tests, recording
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

A few things happen without being asked, because an animator would do them:
- When she looks somewhere, her eyes get there first, her head follows and
  her body comes last.
- A change of expression that changes her eyes is covered by a blink.
- A big glance away is sometimes a blink too.
- While idle, her arms hang slightly out of step with her body, and her
  breathing lifts her shoulders.

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
surprised, scared, shy, sleepy, smug, pout, confused, thinking, determined,
wink.

**Motions:** nod, shake, tilt, wave, bow, hop, cheer, shrug, lookAround, sigh,
laugh, jolt, sway (loops).

Both are plain data in `js/expressions.js`, along with the hair pendulums.
Adding one means adding an entry there. The panel builds itself from those
lists, and the validator checks that this list keeps up.

A motion's keys are points the curve passes through, not stops. The curve is
a monotone cubic, so it is smooth through every key, never overshoots one, and
holds still only where two keys hold the same value. A key before the big
move is the anticipation, and one after it is the follow-through.

## Painting her by hand

Every part lives in one layered file, `art/aisa.ora`. You can paint the
hidden areas yourself, or extend a part past its edge, and the atlas the page
loads is packed from that file.

It's an OpenRaster file, which Krita opens directly (so do GIMP 2.10+ and
MyPaint). The canvas is the drawing at 4× (896×2048). Each part the rig moves
is a group named for it, with the frontmost part at the top:

```
ahoge
  guide: hidden at rest   off by default; turn it on to see pink wherever
                          nothing shows until she moves
  paint                   yours: paint here
  base (generated)        cut from the drawing; locked
frontHair
  ...
hairBack
background                the page colour, to judge against; not packed
```

1. Open `aisa/art/aisa.ora` and find the part's group.
2. Paint on its `paint` layer. You can also add layers and groups of your own
   inside the part's group. What you paint moves with that part, so hair
   painted in the `face` group turns with the face.
3. To extend a part, paint past its edge inside its group. The part grows,
   and the rig gives it a mesh to match: a longer ahoge sways as the ahoge,
   and a longer lock swings as the lock.
4. Save, keeping the `.ora` format and the canvas size.
5. Pack the file into the atlas, then reload the page:
   ```
   python3 aisa/tools/layers.py pack
   ```
   It needs only Pillow (`pip install pillow`). It says how much of each part
   you painted, and warns when a stroke lands somewhere that shows at rest,
   where she no longer matches the drawing. Extending a part usually does
   that, on purpose.
6. `node aisa/tools/validate.js` fails if the atlas wasn't packed from the
   file as it is now, so commit the `.ora`, `atlas.png` and `parts.json`
   together.

What the packer does with each group:
- It uses every visible layer except the guides. A hidden layer is left out;
  hiding the base doesn't remove it.
- Layer opacity is honoured.
- These blending modes are honoured: Normal, Multiply, Screen, Overlay,
  Darken, Lighten, Addition, Hard Light, Soft Light and Erase. Any other mode
  is packed as Normal, and the packer says so.
- A shading layer set to Multiply darkens only where the part already is.

Things to know:
- **Don't paint on `base (generated)`.** It's locked because `cut.py`
  replaces it when the parts are cut again. Everything else in each group is
  kept when that happens.
- **Redraw the guides after you extend a part.** The pink guides are worked
  out from the parts as they were. Close the file in your editor first, then
  run `python3 aisa/tools/layers.py guides`, which rewrites the file.
- **Some parts aren't in the file.** The mouth, the smiling lower lids, blush,
  tears, sweat, the anger mark and gloom are drawn by code in `js/model.js`.
- **In GIMP,** layers have a fixed size. The `paint` layers are as big as the
  canvas, but give any layer you add the canvas size too
  (Layer → Layer to Image Size).

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
| `art/aisa.ora` | every part as a layered file: the generated bases and anything painted over them |
| `art/atlas.png`, `art/parts.json` | the parts packed for the page, from `aisa.ora` (generated) |
| `tools/layers.py` | `pack` turns `aisa.ora` into the atlas; `guides` redraws the hidden-area guides |
| `tools/upscale.py`, `tools/cut.py`, `tools/parts_def.py` | how the base layers were cut from the drawing |
| `tools/validate.js` | `node tools/validate.js`, the checks to run before committing |

To cut the parts again after changing `parts_def.py`, run this from `tools/`:

```
python3 upscale.py ../art/source.png RealESRGAN_x4plus_anime_6B.pth /tmp/up4.png
python3 cut.py /tmp/up4.png ../art
```

`cut.py` replaces the base layers in `aisa.ora`, keeps everything painted over
them, and packs the atlas. It needs numpy, opencv-python, Pillow and potracer.
`upscale.py` also needs torch and the model weights (the link is in its
header). All of this is build-time only: the page needs nothing but a browser
with WebGL.
