/* hackdocs.js — the lessons, the API reference, and the hack every player
 * starts with. All the teaching copy is here, in one file, so the Learn tab,
 * the API tab and the starter hack cannot drift apart (the house rule for
 * long copy: one place, reachable from wherever it is needed).
 *
 * Each lesson is a working hack plus the idea it teaches. They run in order
 * from "print something" to "predict where a bullet will be", and every one
 * is the real technique behind a real kind of cheat — which is the point:
 * the maths that finds an enemy's head on your screen is the maths every
 * 3D program uses. tools/e2e.js loads every lesson's code into the hack
 * runner and fails if any of them does not start.
 *
 * Pure data and strings. Bodies are trusted HTML written here. */

const c = (s) => "<code>" + s + "</code>";

export const STARTER = `// Hello, hacker. This is a hack: JavaScript that runs inside the game.
// Change something, then press Run (or Ctrl+S) to try it.

log("Hello from " + hack.name + "!");

// on("draw", ...) runs once every frame. Draw on your screen in here.
on("draw", () => {
  const speed = me.speed.toFixed(1);
  draw.text("speed " + speed + " m/s", 20, screen.height / 2, "#39c6e8", 16);
});

// Ideas: change the colour or the size, or show me.position.y (your height).
// The Learn tab goes from here to an aimbot, one idea at a time.
`;

export function starterHacks() {
  return [{ id: "hello000", name: "Hello", code: STARTER, on: true }];
}

/* ---------------------------------------------------------------
   Lessons
   --------------------------------------------------------------- */
export const LESSONS = [
  {
    id: "hello", title: "1 · Hello, game", learn: "functions, strings, events",
    body:
      "<p>A hack is a JavaScript program. The top of it runs once, when you press <b>Run</b>. " +
      "Anything inside " + c("on(\"tick\", …)") + " or " + c("on(\"draw\", …)") + " runs again every frame — about sixty times a second.</p>" +
      "<p>" + c("log(…)") + " prints to the console under the editor. " + c("me") + " is you: try " + c("log(me.position)") + ".</p>" +
      "<p>Events are the game telling you something happened: " + c("on(\"kill\", e => …)") + " runs whenever anybody dies. This hack announces them.</p>",
    code: `// Runs once, when you press Run:
log("I am " + me.name + ", on team " + me.team);

// Runs whenever somebody dies. e.killer and e.victim are player ids.
on("kill", (e) => {
  const who = (id) => id === me.id ? "you" : (players.find((p) => p.id === id) || { name: "?" }).name;
  log(who(e.killer) + " got " + who(e.victim) + (e.head ? " (headshot)" : ""));
});

// Runs every time you land. e.speed is how fast you were going.
on("land", (e) => log("landed at " + e.speed.toFixed(1) + " m/s"));`
  },
  {
    id: "speedo", title: "2 · A speedometer", learn: "variables, arrays, loops",
    body:
      "<p>Keep a list of your speed over the last few seconds and draw it as a graph. " +
      "An array (" + c("[]") + ") holds the history; " + c("push") + " adds to the end, " + c("shift") + " drops the oldest.</p>" +
      "<p>Then a " + c("for") + " loop walks the list and draws one line per sample. Bunny hop and watch the graph climb.</p>" +
      "<p>One thing to notice: a sample is taken every 1/60 of a second of <i>time</i>, not every frame. " + c("dt") + " is how long the last frame took; " +
      "add it up and take a sample each time the total passes a step. On a 144 Hz screen and a 30 fps phone the graph then covers the same four seconds. " +
      "Anything that happens \"over time\" in a hack should be measured in " + c("dt") + ", never in frames.</p>",
    code: `const history = [];
const W = 240, H = 80, STEP = 1 / 60;   // a sample every 1/60 s, whatever the frame rate
let banked = 0;

on("tick", (dt) => {
  banked += dt;
  while (banked >= STEP) {
    banked -= STEP;
    history.push(me.speed);
    if (history.length > W) history.shift();
  }
});

on("draw", () => {
  const x0 = 20, y0 = screen.height - 180;
  draw.fillRect(x0, y0, W, H, "rgba(0,0,0,0.45)");
  const top = Math.max(10, ...history);
  for (let i = 1; i < history.length; i++) {
    const ya = y0 + H - history[i - 1] / top * H;
    const yb = y0 + H - history[i] / top * H;
    draw.line(x0 + i - 1, ya, x0 + i, yb, "#6fdc7a", 2);
  }
  draw.text(me.speed.toFixed(1) + " m/s  (best " + top.toFixed(1) + ")", x0, y0 - 18, "#ffffff", 13);
});`
  },
  {
    id: "boxes", title: "3 · Boxes through walls", learn: "objects, 3D to 2D projection",
    body:
      "<p>This is the classic <b>ESP</b>. Every enemy is an object with a " + c("position") + " (their feet) and " + c("bones") + " (their skeleton). " +
      c("screen.toScreen(point)") + " turns a point in the world into a point on your screen — the same projection the renderer uses.</p>" +
      "<p>Project the head and the feet; the distance between them on screen is how tall to draw the box, so far enemies get small boxes on their own.</p>" +
      "<p>" + c("e.visible") + " says whether their chest is in a straight line from your eye: green if you could shoot them, red if a wall is in the way.</p>",
    code: `on("draw", () => {
  for (const e of enemies) {
    const head = screen.toScreen(e.bones.head);
    const feet = screen.toScreen(e.position);
    if (head.behind || feet.behind) continue;      // behind you: nothing to draw

    const h = feet.y - head.y + 12;                // box height on screen
    const w = h * 0.45;
    const color = e.visible ? "#6fdc7a" : "#ff5f7e";
    draw.rect(head.x - w / 2, head.y - 8, w, h, color, 2);

    // a health bar down the left side
    draw.fillRect(head.x - w / 2 - 6, head.y - 8, 3, h, "rgba(0,0,0,0.6)");
    draw.fillRect(head.x - w / 2 - 6, head.y - 8 + h * (1 - e.hp / e.maxHp), 3, h * e.hp / e.maxHp, "#6fdc7a");
    draw.text(e.name + "  " + e.distance.toFixed(0) + " m", head.x, head.y - 24, color, 12, "center");
  }
});`
  },
  {
    id: "bones", title: "4 · Drawing bones", learn: "nested data, pairs, 3D drawing",
    body:
      "<p>" + c("LINKS") + " is a list of pairs of bone names — " + c("[\"neck\", \"head\"]") + ", " + c("[\"l_hip\", \"l_knee\"]") + " … Draw a line for every pair and you have a stick figure.</p>" +
      "<p>" + c("draw.line3d(a, b)") + " takes points in the world, not on the screen: the game projects them for you, and trims lines that pass behind the camera.</p>" +
      "<p>The skeleton is the same one the game uses for hitboxes. If the bones cover them, a bullet there hits.</p>",
    code: `const color = ui.color("Colour", "#39c6e8");

on("draw", () => {
  for (const e of enemies) {
    for (const [a, b] of LINKS) {
      draw.line3d(e.bones[a], e.bones[b], color.value, 2);
    }
    draw.circle3d(e.bones.head, 0.15, color.value, 2);   // the head hitbox, to scale
  }
});`
  },
  {
    id: "radar", title: "5 · A radar", learn: "rotation with sin and cos",
    body:
      "<p>A radar is a map that turns with you. Take each player's offset from you (" + c("dx") + ", " + c("dz") + ") and rotate it by your yaw, so that the way you face is always up.</p>" +
      "<p>Rotating a point by an angle is two lines of trigonometry: " + c("x' = x·cos − z·sin") + " and " + c("y' = x·sin + z·cos") + ". " +
      "You will meet those two lines in every graphics program you ever read.</p>" +
      "<p>" + c("draw.highlight(e, colour)") + " shows a player through walls — the chams at the end are one line.</p>",
    code: `const size = ui.slider("Size", 90, 280, 170, 10);
const range = ui.slider("Range (m)", 10, 120, 50, 5);
const chams = ui.toggle("Show enemies through walls", true);

on("draw", () => {
  const R = size.value / 2;
  const cx = screen.width - R - 16, cy = R + 70;
  draw.fillCircle(cx, cy, R, "rgba(8,12,18,0.6)");
  draw.circle(cx, cy, R, "#39c6e8", 1.5);
  draw.line(cx, cy - R, cx, cy + R, "rgba(57,198,232,0.25)", 1);
  draw.line(cx - R, cy, cx + R, cy, "rgba(57,198,232,0.25)", 1);

  const yaw = input.yaw, cos = Math.cos(yaw), sin = Math.sin(yaw);
  for (const p of players) {
    if (!p.alive) continue;
    const dx = p.position.x - me.position.x;
    const dz = p.position.z - me.position.z;
    let x = (dx * cos - dz * sin) / range.value * R;
    let y = (dx * sin + dz * cos) / range.value * R;
    const d = Math.hypot(x, y);
    if (d > R - 4) { x = x / d * (R - 4); y = y / d * (R - 4); }   // pin far ones to the edge
    draw.fillCircle(cx + x, cy + y, 4, p.enemy ? "#ff5f7e" : "#6fdc7a");
    if (chams.value && p.enemy) draw.highlight(p, "#ff3b6b");
  }
  draw.fillCircle(cx, cy, 3, "#ffffff");
});`
  },
  {
    id: "aimbot", title: "6 · An aimbot", learn: "atan2, angles, smoothing",
    body:
      "<p>To look at a point you need two angles: <b>yaw</b> (left–right) and <b>pitch</b> (up–down). " + c("vec.angles(from, to)") + " works them out with " + c("Math.atan2") + ", which turns a direction into an angle.</p>" +
      "<p>Pick the enemy whose head is closest to where you already aim (the smallest angle away), and only within a small circle, so it feels like help rather than a jerk. " +
      c("wrap(a)") + " keeps an angle difference between −π and π, so turning from 350° to 10° goes 20° right, not 340° left.</p>" +
      "<p>Then move only part of the way each frame. " + c("1 − e^(−k·dt)") + " is the same fraction of the way every second, whatever your frame rate.</p>" +
      "<p>Hold <b>E</b> to use it (you can change the key below the editor).</p>",
    code: `const enabled = ui.toggle("Enabled", true);
const hold = ui.key("Hold to aim", "KeyE");
const reach = ui.slider("Search angle (degrees)", 1, 45, 10, 1);
const speed = ui.slider("Speed", 1, 40, 12, 1);

// How far, in radians, a point is from where you are looking now
function offAim(point) {
  const a = vec.angles(me.eye, point);
  return { a, off: Math.hypot(wrap(a.yaw - input.yaw), a.pitch - input.pitch) };
}

on("tick", (dt) => {
  if (!enabled.value || !hold.down || !me.alive) return;
  let best = null, bestOff = rad(reach.value);
  for (const e of enemies) {
    if (!e.visible) continue;
    const t = offAim(e.bones.head);
    if (t.off < bestOff) { bestOff = t.off; best = t.a; }
  }
  if (!best) return;
  const k = 1 - Math.exp(-speed.value * dt);
  input.yaw = input.yaw + wrap(best.yaw - input.yaw) * k;
  input.pitch = lerp(input.pitch, best.pitch, k);
});

on("draw", () => {
  if (!enabled.value) return;
  // the search circle, so you can see what it will consider
  const r = Math.tan(rad(reach.value)) / Math.tan(rad(view.fov / 2)) * screen.width / 2;
  draw.circle(screen.center.x, screen.center.y, r, hold.down ? "#ffd24a" : "rgba(255,255,255,0.25)", 1);
});`
  },
  {
    id: "trigger", title: "7 · A triggerbot", learn: "the dot product, distance to a line",
    body:
      "<p>A triggerbot fires the moment your crosshair is on someone. Your crosshair is a ray: it starts at your eye and runs along " + c("vec.fromAngles(yaw, pitch)") + ".</p>" +
      "<p>How far down that ray is a bone? The <b>dot product</b> of the ray's direction with (bone − eye). Step that far along the ray and measure the gap to the bone: " +
      "smaller than the hitbox, and a shot would hit.</p>" +
      "<p>Semi-automatic guns need a fresh press for every shot, so the hack presses and releases on alternate frames.</p>",
    code: `const enabled = ui.toggle("Enabled", true);
const delay = ui.slider("Reaction (ms)", 0, 300, 40, 10);
let since = -1, pulse = false;

function onCrosshair(e) {
  const dir = vec.fromAngles(input.yaw, input.pitch);
  const parts = { head: 0.15, chest: 0.2, spine: 0.2, pelvis: 0.2 };
  for (const name in parts) {
    const bone = e.bones[name];
    const along = vec.dot(vec.sub(bone, me.eye), dir);   // how far down the ray
    if (along <= 0) continue;                            // behind you
    const nearest = vec.add(me.eye, vec.scale(dir, along));
    if (vec.dist(nearest, bone) < parts[name]) return true;
  }
  return false;
}

on("tick", () => {
  if (!enabled.value || !me.alive || me.weapon.melee) return;
  const target = enemies.find((e) => e.visible && onCrosshair(e));
  if (!target) { since = -1; return; }
  if (since < 0) since = time;
  if ((time - since) * 1000 < delay.value) return;
  pulse = !pulse;
  input.fire = me.weapon.auto ? true : pulse;
});`
  },
  {
    id: "bhop", title: "8 · Bunny hop", learn: "booleans, timing, reading the rules",
    body:
      "<p>Friction only happens on a tick that starts on the ground. Jump on the tick you land and friction never gets a turn: you keep every bit of speed. " +
      "But the game only jumps on a <i>fresh</i> press — holding jump does nothing — so by hand it takes timing, or a scroll wheel.</p>" +
      "<p>The hack is one line: jump is pressed exactly when you are on the ground, released when you are not. " +
      "Every landing becomes a new press. Hold Space to hop; add air strafing (next lesson) to get faster.</p>",
    code: `const enabled = ui.toggle("Enabled", true);
const hold = ui.key("Hold to hop", "Space");

on("tick", () => {
  if (!enabled.value || !hold.down) return;
  input.jump = me.onGround;
});

on("draw", () => {
  if (enabled.value && hold.down) draw.text("bhop " + me.speed.toFixed(1), screen.center.x, screen.center.y + 40, "#6fdc7a", 13, "center");
});`
  },
  {
    id: "strafe", title: "9 · Air strafing", learn: "vectors, the maths of acceleration",
    body:
      "<p>In the air, the game adds speed only along the direction you ask for, and only until your speed <i>in that direction</i> reaches a small cap (" + c("world.physics.aircap") + ", 0.76 m/s). " +
      "Ask for a direction almost at right angles to where you are going and your speed along it is nearly zero — so the game adds speed every tick, and you go faster.</p>" +
      "<p>By hand: hold A while turning left, D while turning right, never W. This hack watches which way you turn the mouse and presses the matching key for you.</p>" +
      "<p>The <b>Perfect angle</b> switch goes further: it turns your view itself to the best angle, " + c("acos((cap − a) / speed)") + " off your velocity, so every tick gains the most it can. " +
      "You will not be able to aim, but you will be very fast.</p>",
    code: `const enabled = ui.toggle("Enabled", true);
const perfect = ui.toggle("Perfect angle (takes your view)", false);
let lastYaw = null, side = 1, flip = 0;

on("tick", (dt) => {
  if (lastYaw === null) lastYaw = input.yaw;
  const turn = dt > 0 ? wrap(input.yaw - lastYaw) / dt : 0;   // radians a second; + is turning left
  lastYaw = input.yaw;
  if (!enabled.value || me.onGround || !keys.isDown("Space")) return;
  input.forward = 0;                            // W in the air only slows you

  if (!perfect.value) {
    if (turn > 0.05) input.side = -1;           // turning left: A
    else if (turn < -0.05) input.side = 1;      // turning right: D
    return;
  }
  // the best angle between where you ask to go and where you are going
  const v = me.velocity, speed = vec.len2d(v);
  if (speed < 1) return;
  const P = world.physics;
  const a = P.airaccelerate * P.run * dt;
  const theta = Math.acos(clamp((P.aircap - a) / speed, -1, 1));
  const velYaw = Math.atan2(-v.x, -v.z);
  flip += dt;
  if (flip > 0.45) { flip = 0; side = -side; }  // weave, so you go roughly straight
  input.yaw = velYaw + side * (Math.PI / 2 - theta);
  input.side = -side;
  lastYaw = input.yaw;
});`
  },
  {
    id: "recoil", title: "10 · Recoil control", learn: "state across frames",
    body:
      "<p>Every shot lifts your view by " + c("me.weapon.lastKick") + " (radians of pitch and yaw), and it does not come back by itself.</p>" +
      "<p>" + c("me.weapon.shots") + " counts shots fired. Remember the count from the last frame; if it went up, pull the view back down by the kick, once per new shot.</p>",
    code: `const strength = ui.slider("Strength (%)", 0, 100, 85, 5);
let last = 0;

on("tick", () => {
  const w = me.weapon;
  const fired = w.shots - last;
  last = w.shots;
  if (w.melee || fired <= 0 || fired > 10) return;   // (the count starts again when you respawn)
  const k = strength.value / 100 * fired;
  input.pitch = input.pitch - w.lastKick.pitch * k;
  input.yaw = input.yaw - w.lastKick.yaw * k;
});`
  },
  {
    id: "lead", title: "11 · Leading a sniper shot", learn: "projectile motion",
    body:
      "<p>The Talon's round is not instant: it flies at " + c("me.weapon.projectile.speed") + " and falls under " + c("…gravity") + ". " +
      "To hit a moving target you aim where they <i>will</i> be.</p>" +
      "<p>Time of flight is distance ÷ speed. Where they will be is where they are + velocity × time. " +
      "And in that time the round drops ½·g·t², so aim that much higher. That is the whole of it — the physics you learn at school, doing a job.</p>" +
      "<p>This draws the point to aim at. Turn on <b>Aim for me</b> to snap to it while you aim down sights.</p>",
    code: `const assist = ui.toggle("Aim for me (while aiming)", false);

function leadPoint(e) {
  const w = me.weapon;
  const target = e.bones.chest;
  const t = vec.dist(me.eye, target) / w.projectile.speed;       // seconds in flight
  const future = vec.add(target, vec.scale(e.velocity, t));       // where they will be
  future.y += 0.5 * w.projectile.gravity * t * t;                  // the drop
  return { point: future, t };
}

on("tick", () => {
  if (!assist.value || !me.weapon.projectile || !input.aim) return;
  const e = enemies.filter((x) => x.visible).sort((a, b) => a.distance - b.distance)[0];
  if (e) input.lookAt(leadPoint(e).point);
});

on("draw", () => {
  if (!me.weapon.projectile) return;
  for (const e of enemies) {
    if (!e.visible) continue;
    const { point, t } = leadPoint(e);
    const s = screen.toScreen(point);
    if (!s.visible) continue;
    draw.circle(s.x, s.y, 7, "#ffd24a", 2);
    draw.text(Math.round(t * 1000) + " ms", s.x + 10, s.y - 7, "#ffd24a", 12);
  }
});`
  },
  {
    id: "landing", title: "12 · Where will I land?", learn: "simulation",
    body:
      "<p>" + c("physics.simulate(player, keys, ticks)") + " runs the game's own movement code on a copy of a player — nothing real moves — and tells you where they end up, with the path on the way.</p>" +
      "<p>Simulate yourself pressing what you are pressing now, for three seconds, and draw the path and the landing spot. Try it off a jump pad, or mid-surf.</p>",
    code: `on("draw", () => {
  if (me.onGround || !me.alive) return;
  const keysNow = { forward: input.forward, side: input.side, yaw: input.yaw, pitch: input.pitch };
  const r = physics.simulate(me, keysNow, 192);        // 192 ticks = 3 seconds
  let prev = me.position;
  for (const p of r.path) { draw.line3d(prev, p, "rgba(255,210,74,0.8)", 2); prev = p; }
  if (r.landedAt > 0) {
    draw.circle3d(r.position, 0.5, "#ffd24a", 2);
    draw.text3d((r.landedAt / world.tickRate).toFixed(2) + " s", r.position, "#ffd24a", 12);
  }
});`
  },
  {
    id: "lunge", title: "13 · Reading the lunge", learn: "dot product as 'how much'",
    body:
      "<p>A lunge is strongest when you face straight away from the surface you are stuck to. \"How much am I facing away\" is exactly the dot product of your look direction with the surface's normal " +
      "(the direction pointing out of it): 1 facing straight out, 0 along it, negative into it.</p>" +
      "<p>This shows the power you would launch with right now, the same sum the game does: " + c("(0.3 + 0.7·dot) × (0.35 + 0.65·charge)") + ".</p>",
    code: `on("draw", () => {
  if (me.lunge !== "charging") return;
  const look = vec.fromAngles(input.yaw, input.pitch);
  let facing = 0, power;
  if (me.lungeStuck) {
    const dot = vec.dot(look, me.lungeNormal);
    power = dot <= 0 ? 0.3 : 0.3 + 0.7 * dot;
    facing = dot;
  } else power = 0.45;
  power *= 0.35 + 0.65 * me.lungeCharge;

  const x = screen.center.x - 100, y = screen.center.y + 70;
  draw.fillRect(x, y, 200, 10, "rgba(0,0,0,0.5)");
  draw.fillRect(x, y, 200 * power, 10, power > 0.8 ? "#6fdc7a" : "#ffd24a");
  draw.text("power " + Math.round(power * 100) + "%   facing " + facing.toFixed(2), screen.center.x, y + 16, "#ffffff", 12, "center");
});`
  },
  {
    id: "fly", title: "14 · Changing yourself", learn: "velocity, and the rules",
    body:
      "<p>Hacks may change your own body — never anybody else's. " + c("me.gravityScale") + ", " + c("me.speedScale") + " and " + c("me.jumpScale") + " stay set until you change them; " +
      c("me.setVelocity(v)") + " and " + c("me.teleport(p)") + " happen once.</p>" +
      "<p>This one flies: hold G, gravity goes to zero, and your velocity points where you look, scaled by your move keys.</p>" +
      "<p>A room can forbid this (its hack rules). Try it in a room set to Assist: the console says why nothing happens.</p>",
    code: `const hold = ui.key("Hold to fly", "KeyG");
const speed = ui.slider("Speed", 2, 40, 14, 1);

on("tick", () => {
  if (!hold.down) { me.gravityScale = 1; return; }
  me.gravityScale = 0;
  const ahead = vec.fromAngles(input.yaw, input.pitch);
  const right = vec.fromAngles(input.yaw - Math.PI / 2, 0);
  const v = vec.add(vec.scale(ahead, input.forward * speed.value), vec.scale(right, input.side * speed.value));
  me.setVelocity(v);
});`
  }
];

/* ---------------------------------------------------------------
   The API reference
   --------------------------------------------------------------- */
export const API = [
  { name: "The shape of a hack", items: [
    ["top level", "Runs once when you press Run. Set things up here."],
    ["on(\"tick\", dt => …)", "Every frame, before your inputs are used. Change input.* here. dt is seconds since the last frame: scale anything that happens over time by it, so the hack behaves the same at any frame rate."],
    ["on(\"draw\", dt => …)", "Every frame, after tick. Draw here."],
    ["on(\"key\", code => …)", "A key or mouse button was pressed (KeyboardEvent.code, e.g. \"KeyG\", \"Mouse0\")."],
    ["on(event, e => …)", "shot (anyone fired: by, mine, weapon, from, to, hit, part) · hit (you hit: target, damage, part) · hurt (you were hit: by, damage) · kill (killer, victim, weapon, head) · death · spawn · jump · land (speed) · walljump · climb · mantle · slide · stick · lunge · swing · pad"],
    ["log(…) / print(…)", "Write to the console under the editor."],
    ["hack", "{ id, name } of this hack."],
    ["ui.toggle(label, on)", "A switch in the panel. .value is true or false."],
    ["ui.slider(label, min, max, value, step)", "A slider. .value is the number."],
    ["ui.key(label, code)", "A key you can rebind. .value is the code, .down is whether it is held."],
    ["ui.color(label, \"#rrggbb\")", "A colour picker. .value is the colour."]
  ] },
  { name: "me — you (read; a few writes)", items: [
    ["position, velocity, eye", "{x, y, z} in metres and metres per second. y is up; the floor is y = 0. eye is where your camera is."],
    ["yaw, pitch", "Where your body faces, in radians. Yaw 0 faces −z; turning left increases it. Pitch up is positive."],
    ["speed", "Horizontal speed, m/s."],
    ["alive, hp, maxHp, team, id, name, kills, deaths, respawnIn", ""],
    ["onGround, crouched, sliding, climbing, sprinting, groundKind, groundNormal", "What your body is doing, and what it stands on."],
    ["lunge, lungeCharge, lungeStuck, lungeNormal", "\"idle\" / \"charging\" / \"dashing\"; 0–1; stuck to a surface; that surface's outward normal."],
    ["slideCooldown, wallJumpReady, climbLeft, jumpHeld", "Movement timers and state."],
    ["weapon", "{ slot, id, name, cls, melee, ammo, mag, reloading, ads, auto, rpm, spread (degrees), projectile {speed, gravity} or null, lastKick {pitch, yaw}, shots, damage, pellets }"],
    ["bones", "{ head: {x,y,z}, neck, chest, … } — see BONES."],
    ["me.gravityScale, me.speedScale, me.jumpScale", "Write: change your body until changed back (rules: Full self)."],
    ["me.setVelocity(v) · me.addVelocity(v) · me.teleport(p)", "Once, this frame (rules: Full self). v and p are {x,y,z}. A steady push is me.addVelocity(vec.scale(push, dt)) every frame."]
  ] },
  { name: "players, enemies, allies — everyone else (read only)", items: [
    ["players", "Everyone but you, alive or not. enemies: the ones you can hurt, alive. allies: your team."],
    ["p.id, name, team, bot, enemy, alive, hp, maxHp, kills, deaths", ""],
    ["p.position, velocity, eye, speed, yaw, pitch, distance", "As for me. distance is from you, in metres."],
    ["p.onGround, crouched, sliding, climbing, lunge", ""],
    ["p.weapon", "{ slot, id, name, cls, melee }"],
    ["p.bones", "Their skeleton — the same points the hitboxes are built on."],
    ["p.visible", "Is their chest in a straight line from your eye (no wall in between)?"],
    ["Writing any of it", "A TypeError. You can read the game; you can only change yourself."]
  ] },
  { name: "input — your buttons for this frame (rules: Assist)", items: [
    ["input.forward, input.side", "−1 to 1 (W/S, D/A). Reading gives what the player is pressing."],
    ["input.yaw, input.pitch", "Where you look, radians. Setting it turns your view."],
    ["input.jump, crouch, sprint, fire, aim, reload, lunge, melee", "true or false."],
    ["input.slot", "1, 2, 3 or −1 (last weapon): switch once."],
    ["input.lookAt(point)", "Set yaw and pitch to look from your eye at a point."]
  ] },
  { name: "draw — on your screen (rules: any)", items: [
    ["draw.line(x1, y1, x2, y2, color, width)", "Screen pixels; (0, 0) is the top left."],
    ["draw.rect / draw.fillRect(x, y, w, h, color)", ""],
    ["draw.circle / draw.fillCircle(x, y, r, color)", ""],
    ["draw.text(text, x, y, color, size, align)", "align: \"left\", \"center\" or \"right\"."],
    ["draw.poly(points, color, fill)", "points: [{x, y}, …]"],
    ["draw.line3d(a, b, color, width)", "Points in the world; projected and clipped for you."],
    ["draw.box3d(min, max, color) · circle3d(center, r, color) · dot3d(p, r, color) · text3d(text, p, color, size)", ""],
    ["draw.highlight(player, color)", "Show a player through walls this frame."]
  ] },
  { name: "screen, view, keys", items: [
    ["screen.width, screen.height, screen.center", "In CSS pixels."],
    ["screen.toScreen(point)", "{ x, y, visible, behind } for a point in the world."],
    ["view.fov", "Your horizontal field of view in degrees. Set it to zoom."],
    ["view.thirdPerson", "true for a camera behind you."],
    ["keys.isDown(code), keys.down", "What is held right now."]
  ] },
  { name: "world, physics — the map and its rules", items: [
    ["world.raycast(from, to)", "{ hit, fraction, distance, point, normal, kind } — the map only; players do not block it."],
    ["world.visible(from, to)", "true if nothing in the map is in between."],
    ["world.traceBox(from, to, half)", "Sweep a box (half-size {x,y,z}) — what movement does."],
    ["world.gravity, world.tickRate, world.physics", "The constants the movement code uses (aircap, airaccelerate, friction, run, sprint, jump …)."],
    ["world.spawns, world.time, world.tick", ""],
    ["physics.simulate(player, {forward, side, yaw, pitch, jump, crouch, sprint}, ticks)", "Run the game's own movement on a copy. Returns { position, velocity, onGround, landedAt, events, path }."],
    ["physics.predict(player, seconds)", "Where a player would be if they pressed nothing."],
    ["projectiles", "Rounds in flight: { owner, position, velocity, gravity }."],
    ["match", "{ mode, time, timeLeft, target, rules, over, score: { kills, deaths, teams } }"]
  ] },
  { name: "Maths", items: [
    ["vec.v(x, y, z), add, sub, scale, dot, cross, len, len2d, dist, norm, lerp", "Vectors are plain {x, y, z} objects."],
    ["vec.angles(from, to)", "{ yaw, pitch } that look from one point to another."],
    ["vec.fromAngles(yaw, pitch)", "The direction a yaw and pitch look along."],
    ["deg(r), rad(d), wrap(a), clamp(v, lo, hi), lerp(a, b, t)", "wrap keeps an angle between −π and π."],
    ["BONES, LINKS", "The bone names, and the pairs that make a stick figure."],
    ["time, dt", "Match time, and seconds since the last frame."]
  ] }
];

export const ABOUT_API =
  "<p>Your hack runs in its own sandbox. It is shown everything and can change only you: your buttons (" + c("input") + "), your view (" + c("view") + "), " +
  "your own body (" + c("me.setVelocity") + " and friends) and your own screen (" + c("draw") + "). There is no way to change another player, or anyone's health, ammo or score. " +
  "A room's <b>hack rules</b> can narrow that further — the console tells you when something was ignored.</p>" +
  "<p>The language is plain modern JavaScript. The network, the page and storage are not available to hacks; " + c("Math") + ", arrays, objects, classes and closures all are.</p>";
