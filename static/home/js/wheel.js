/* ============================================================
   nojukuramu — the shutter wheel

   The hero and the projects are one pinned scene, and the scroll is the
   only thing that drives it. For the first screen of scrolling the
   headline lifts away while a lens rises into its place and the iris
   behind its glass opens on the first project. After that every detent of
   the scroll turns the chrome dial round the lens by one engraving: the
   iris swings shut, the next project is behind it, the iris swings open,
   and its name, its line and its highlights come up beside it.

   One number does all of it. `pos` is where the dial is, in projects; the
   dial's angle is a function of it, the iris is shut at every half and
   open at every whole, and the frame on show is whichever whole it is
   nearest. The scroll is turned into `pos` through a curve with a flat
   stretch either side of every whole number — the detent — so a frame
   holds still for a while before the next one starts to come round.

   Between the scroll and what is drawn sits the spring the old ring of
   cards used, a touch under-damped. A mouse wheel moves the page a
   hundred pixels at a time; the spring is what turns those jumps into a
   dial being turned, and what lets it land on a detent with a small
   mechanical clunk instead of stopping dead.

   Left to rest between two frames — the iris half shut — the page glides
   to the nearer one. Nothing else is snapped: the reader's scroll is
   theirs, and the detents only decide where it settles.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var PR = NJ.projects;
  var P = PR && PR.projects;
  var $ = function (id) { return document.getElementById(id); };

  var section = $("wheel"), stage = $("stage");
  if (!section || !stage || !P || !P.length) return;

  var N = P.length;
  var DEG = 360 / N;

  /* The scroll the scene takes, in screens: rising out of the hero, one
     step per project, and a little at the end for the iris to close. */
  var INTRO = 1.0, STEP = 0.62, OUTRO = 0.7;
  /* The iris at rest: open, but not wide open, so the blades are always
     there to be seen — about f/2. */
  var BASE = 0.8;
  var STIFF = 190, DAMP = 21;

  var hero = $("hero"), lens = $("lens"), ridges = $("lens-ridges");
  var marks = $("lens-marks"), engraving = $("lens-engraving");
  var photo = $("lens-photo"), irisSvg = $("lens-iris"), flashEl = $("lens-flash");
  var info = $("info"), hud = $("hud");
  var el = {
    no: $("info-no"), total: $("info-total"), kind: $("info-kind"), name: $("info-name"),
    badge: $("info-badge"), desc: $("info-desc"), hi: $("info-hi"), tags: $("info-tags"),
    open: $("info-open"), openName: $("info-open-name"), prev: $("wheel-prev"), next: $("wheel-next"),
    hudF: $("hud-f"), hudS: $("hud-s"), hudFrame: $("hud-frame"), hudFilm: $("hud-film")
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  /* The loop runs every frame the scene is on screen, for the drawing
     behind the glass, but most frames nothing else has moved. A style is
     only written when its value changes, so a still dial costs nothing. */
  var written = new Map();
  function put(node, prop, value) {
    var m = written.get(node);
    if (!m) { m = {}; written.set(node, m); }
    if (m[prop] === value) return;
    m[prop] = value;
    if (prop.charAt(0) === "-") node.style.setProperty(prop, value);
    else node.style[prop] = value;
  }
  function esc(s) { return PR.esc(s); }
  var pad = PR.pad;

  var KIND = {};
  PR.filters.forEach(function (f) { KIND[f.id] = f.label; });

  /* ---------- engraving the dial ----------
     The labels sit on arcs, so they curve with the ring the way an
     engraving does. One arc for the numbers and one for the names, both
     centred on twelve o'clock; each label is the same arc turned. */
  function arc(r, span) {
    var a0 = (-90 - span / 2) * Math.PI / 180, a1 = (-90 + span / 2) * Math.PI / 180;
    return "M" + (r * Math.cos(a0)).toFixed(1) + " " + (r * Math.sin(a0)).toFixed(1) +
           "A" + r + " " + r + " 0 0 1 " + (r * Math.cos(a1)).toFixed(1) + " " + (r * Math.sin(a1)).toFixed(1);
  }
  function circle(r) {
    return "M" + (-r) + " 0A" + r + " " + r + " 0 1 1 " + r + " 0A" + r + " " + r + " 0 1 1 " + (-r) + " 0";
  }

  var labels = [];
  (function engrave() {
    var s = '<defs><path id="wl-num" d="' + arc(412, DEG) + '"/><path id="wl-name" d="' + arc(388, DEG * 0.98) + '"/></defs>';
    for (var k = 0; k < N; k++) {
      var t = '<g class="dl" data-k="' + k + '" transform="rotate(' + (k * DEG).toFixed(3) + ')">' +
              '<line class="dl-major" x1="0" y1="-469" x2="0" y2="-452"/>' +
              '<text class="dl-num"><textPath href="#wl-num" startOffset="50%">' + pad(k + 1) + "</textPath></text>" +
              '<text class="dl-name"><textPath href="#wl-name" startOffset="50%">' + esc(P[k].name.toUpperCase()) + "</textPath></text>";
      for (var m = 1; m < 4; m++) {
        t += '<line class="dl-minor" x1="0" y1="-469" x2="0" y2="-460" transform="rotate(' + (m * DEG / 4).toFixed(3) + ')"/>';
      }
      s += t + "</g>";
    }
    marks.innerHTML = s;
    labels = Array.prototype.slice.call(marks.querySelectorAll(".dl"));

    /* the black ring inside it, engraved once and left still */
    var words = "NOJUKURAMU SHUTTER WHEEL 1:1.4 \u00B7 " + N + " FRAMES \u00B7 \u00D862 \u00B7 HAND-MADE IN THE BROWSER \u00B7 ";
    words += words;
    var ticks = "";
    for (var d = 0; d < 360; d += 7.5) {
      var big = d % 45 === 0;
      ticks += '<line class="' + (big ? "eg-tick big" : "eg-tick") + '" x1="0" y1="-368" x2="0" y2="' + (big ? -356 : -361) +
               '" transform="rotate(' + d + ')"/>';
    }
    engraving.innerHTML = '<defs><path id="wl-eng" d="' + circle(330) + '"/></defs>' + ticks +
      '<text class="eg-text"><textPath href="#wl-eng" textLength="2060" lengthAdjust="spacing">' + esc(words) + "</textPath></text>" +
      '<circle class="eg-dot" cx="0" cy="-344" r="6"/>';
  })();

  var iris = NJ.iris ? NJ.iris.create(irisSvg, { radius: 100, tone: "lens" }) : null;
  var pctx = photo.getContext ? photo.getContext("2d") : null;

  /* ---------- layout ----------
     `unit` is a screen's height, held steady: a phone's toolbar sliding
     away changes the window by a tenth, and re-laying a fourteen-screen
     scene for that would make it jump under the reader's thumb. It is
     measured again only when the width changes or the height changes by a
     lot — a rotation, or a window being resized. */
  var unit = 0, lastW = 0, top = 0;
  var L = { dx: 0, dy: 0, s0: 1 };
  var dpr = 1, psize = 0;

  function layout() {
    var w = global.innerWidth, h = global.innerHeight;
    if (!unit || w !== lastW || Math.abs(h - unit) > unit * 0.22) unit = h;
    lastW = w;
    section.style.height = Math.round((INTRO + (N - 1) * STEP + OUTRO) * unit + stage.offsetHeight) + "px";
    top = section.getBoundingClientRect().top + global.scrollY;

    /* Where the lens starts: under the hero's copy, peeking up from the
       bottom of the screen. Offsets ignore transforms, so this is measured
       against where the stylesheet puts it to rest. */
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var size = lens.offsetWidth;
    var cx = lens.offsetLeft + size / 2, cy = lens.offsetTop + size / 2;
    var side = info.offsetLeft + info.offsetWidth <= lens.offsetLeft + 4;
    var heroBottom = hero.offsetTop + hero.offsetHeight;
    var s0 = side ? 1 : 1.06;
    var top0 = Math.max(heroBottom + (side ? 40 : 26), sh * (side ? 0.6 : 0.56));
    L.dx = sw / 2 - cx;
    L.dy = top0 + (size * s0) / 2 - cy;
    L.s0 = s0;
    lens.classList.toggle("small", size < 520 || DEG < 19);

    dpr = Math.min(global.devicePixelRatio || 1, 2);
    var g = Math.round(size * 0.62);
    if (pctx && g && g !== psize) {
      psize = g;
      photo.width = Math.round(g * dpr);
      photo.height = Math.round(g * dpr);
      glow = null;
    }
    kick();
  }

  function yOf(k) { return top + (INTRO + k * STEP) * unit; }

  /* ---------- from the scroll to the scene ---------- */
  function detent(f) {
    var t = clamp((f - 0.16) / 0.68, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function aim() {
    var s = (global.scrollY - top) / unit;
    var u = (s - INTRO) / STEP;
    var tail = clamp(((u - (N - 1)) * STEP) / OUTRO, 0, 1);
    u = clamp(u, 0, N - 1);
    var k = Math.floor(u), fr = u - k;
    if (k >= N - 1) { k = N - 1; fr = 0; }
    return { s: s, h: clamp(s / INTRO, 0, 1), pos: k + detent(fr), tail: tail };
  }

  var st = null;      /* what is drawn: { h, pos, tail } and their velocities */
  function spring(x, v, to, k, d, dt) {
    var steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps;
    for (var i = 0; i < steps; i++) {
      v += (k * (to - x) - d * v) * h;
      x += v * h;
    }
    /* close enough is there: a spring only ever approaches, and "is the
       hero gone" has to be able to say yes */
    if (Math.abs(to - x) < 0.0002 && Math.abs(v) < 0.002) { x = to; v = 0; }
    return [x, v];
  }

  /* ---------- what is on show ---------- */
  var shown = -1, since = 0, glow = null, glowFor = -1;
  var tickAt = null, firstOpen = false;

  function show(k, now) {
    if (k === shown) return;
    var first = shown === -1;
    shown = k;
    since = now;
    var p = P[k];
    el.no.textContent = pad(k + 1);
    el.total.textContent = pad(N);
    el.kind.textContent = KIND[p.kind] || p.kind;
    el.name.textContent = p.name;
    el.badge.textContent = p.badge;
    el.desc.textContent = p.desc;
    el.hi.innerHTML = p.hi.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
    el.tags.innerHTML = p.tags.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("");
    el.open.href = p.href;
    el.openName.textContent = p.name;
    el.open.setAttribute("aria-label", "Open " + p.name);
    el.prev.disabled = k === 0;
    el.next.disabled = k === N - 1;
    el.hudFrame.textContent = pad(k + 1);
    stage.style.setProperty("--glow", p.accent);
    stage.style.setProperty("--accent", p.accent);
    stage.style.setProperty("--accent-rgb", PR.rgbOf(p.accent));
    labels.forEach(function (g, i) { g.classList.toggle("on", i === k); });
    if (!first && !reduced) {
      info.classList.remove("swap");
      void info.offsetWidth;
      info.classList.add("swap");
      flash();
      if (NJ.sound) NJ.sound.shutter();
    }
  }

  function flash() {
    if (reduced) return;
    flashEl.classList.remove("go");
    void flashEl.offsetWidth;
    flashEl.classList.add("go");
  }

  function drawPhoto(now) {
    if (!pctx || !psize || shown < 0) return;
    var S = psize, c = pctx, p = P[shown];
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!glow || glowFor !== shown) {
      var rgb = PR.rgbOf(p.accent);
      glow = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      glow.addColorStop(0, "rgba(" + rgb + ",.34)");
      glow.addColorStop(0.55, "rgba(" + rgb + ",.10)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      glowFor = shown;
    }
    c.fillStyle = "#060607";
    c.fillRect(0, 0, S, S);
    c.fillStyle = glow;
    c.fillRect(0, 0, S, S);
    var mw = S * 0.84, mh = S * 0.6;
    c.save();
    c.translate((S - mw) / 2, (S - mh) / 2);
    PR.draw(c, mw, mh, reduced ? 1.4 : (now - since) / 1000, shown);
    c.restore();
  }

  /* the readout: the aperture the iris is actually at, in third stops */
  var STOPS = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];
  var lastF = "", lastS = "", speed = 0, lastScrollS = null;
  function fNumber(open) {
    var f = 1.4 * Math.pow(2, 4 * (1 - clamp(open / BASE, 0, 1)));
    var best = STOPS[0];
    for (var i = 0; i < STOPS.length; i++) if (Math.abs(STOPS[i] - f) < Math.abs(best - f)) best = STOPS[i];
    return "F" + best;
  }
  /* and a shutter speed that is really the scroll's: still is 1/125,
     a fling is 1/4000 */
  function shutterSpeed(v) {
    return v > 6 ? "1/4000" : v > 3 ? "1/2000" : v > 1.5 ? "1/1000" : v > 0.7 ? "1/500" : v > 0.25 ? "1/250" : "1/125";
  }

  /* ---------- the frame loop ---------- */
  var raf = 0, last = 0, visible = !("IntersectionObserver" in global);
  var locked = false;

  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function frame(now) {
    raf = 0;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    var T = aim();

    if (!st || reduced) {
      st = { h: T.h, vh: 0, pos: T.pos, vp: 0, tail: T.tail, vt: 0 };
    } else {
      var a = spring(st.h, st.vh, T.h, 160, 25, dt); st.h = a[0]; st.vh = a[1];
      var b = spring(st.pos, st.vp, T.pos, STIFF, DAMP, dt); st.pos = b[0]; st.vp = b[1];
      var c = spring(st.tail, st.vt, T.tail, 160, 25, dt); st.tail = c[0]; st.vt = c[1];
    }
    if (lastScrollS != null) speed += (Math.abs(T.s - lastScrollS) / dt - speed) * clamp(dt * 6, 0, 1);
    lastScrollS = T.s;

    render(now);

    var moving = Math.abs(st.h - T.h) > 0.0005 || Math.abs(st.pos - T.pos) > 0.0005 ||
                 Math.abs(st.tail - T.tail) > 0.0005 || Math.abs(st.vp) > 0.001 || speed > 0.02;
    if (moving || visible) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function render(now) {
    var h = clamp(st.h, 0, 1), tail = clamp(st.tail, 0, 1);
    var e = reduced ? 1 : smooth(h);
    var pos = clamp(st.pos, -0.25, N - 0.75);
    if (reduced) pos = Math.round(pos);
    var k = clamp(Math.round(pos), 0, N - 1);
    var g = pos - Math.floor(pos);
    var shut = Math.pow(Math.abs(Math.cos(Math.PI * g)), 0.9);

    /* Shut at every half step; opening for the first time over the second
       half of the rise out of the hero; shutting for the last time as the
       scene ends. The lesser of the three is what the blades do. */
    var open = reduced ? BASE * (h > 0.5 ? 1 : 0) * (1 - tail)
                       : BASE * Math.min(smooth((h - 0.5) / 0.5), shut, 1 - smooth(tail));

    /* the lens, rising into place */
    var sc = (L.s0 + (1 - L.s0) * e) * (1 - 0.06 * smooth(tail));
    put(lens, "transform", "translate3d(" + (L.dx * (1 - e)).toFixed(1) + "px," + (L.dy * (1 - e)).toFixed(1) + "px,0) scale(" + sc.toFixed(4) + ")");
    if (reduced) put(lens, "opacity", (0.35 + 0.65 * h).toFixed(3));
    put(ridges, "transform", "rotate(" + ((h * 0.6 + pos * 0.5 + tail * 0.4) * 48).toFixed(2) + "deg)");
    put(marks, "transform", "rotate(" + (-pos * DEG + (1 - e) * 42).toFixed(3) + "deg)");
    if (iris) iris.set(open, (1 - open / BASE) * 0.75 + pos * 0.04);

    /* the hero, lifting away; the projects' words, coming in */
    var ho = 1 - smooth(h / 0.5);
    put(hero, "opacity", ho.toFixed(3));
    put(hero, "transform", reduced ? "" : "translate3d(0," + (-h * 80).toFixed(1) + "px,0)");
    put(hero, "visibility", ho < 0.02 ? "hidden" : "");
    var io = smooth((h - 0.6) / 0.4) * (1 - smooth(tail * 1.4));
    put(info, "opacity", io.toFixed(3));
    put(info, "--iy", ((1 - io) * 26).toFixed(1) + "px");
    put(info, "visibility", io < 0.02 ? "hidden" : "");
    put(hud, "opacity", (smooth((h - 0.7) / 0.3) * (1 - tail)).toFixed(3));

    show(k, now);

    /* The ratchet: a detent clicks every quarter of a step the dial
       turns, and the shutter goes as each frame comes up. */
    var q = Math.floor(pos * 4);
    if (tickAt !== null && q !== tickAt && h >= 1 && NJ.sound) NJ.sound.detent();
    tickAt = q;
    if (!firstOpen && h > 0.97) {
      firstOpen = true;
      if (global.scrollY > top + 4) { flash(); if (NJ.sound) NJ.sound.shutter(); }
    } else if (h < 0.5) firstOpen = false;

    /* focus: found when the dial is at rest on a frame */
    var lock = h >= 0.999 && tail < 0.01 && Math.abs(pos - k) < 0.004 && Math.abs(st.vp) < 0.02;
    if (lock !== locked) { locked = lock; hud.classList.toggle("locked", lock); }

    var f = fNumber(open);
    if (f !== lastF) { lastF = f; el.hudF.textContent = f; }
    var sp = shutterSpeed(speed);
    if (sp !== lastS) { lastS = sp; el.hudS.textContent = sp; }

    if (open > 0.01 && visible) drawPhoto(now);
  }

  /* ---------- settling into a detent ---------- */
  var held = false, settleTimer = 0;
  function settle() {
    if (held || NJ.gliding || !NJ.glide) return;
    var s = (global.scrollY - top) / unit;
    /* half out of the hero: finish the move one way or the other */
    if (s > 0.04 && s < INTRO - 0.02) {
      NJ.glide(s / INTRO > 0.5 ? yOf(0) : top, 520);
      return;
    }
    var u = (s - INTRO) / STEP;
    if (u <= 0 || u >= N - 1) return;
    var k = Math.floor(u), fr = u - k;
    if (fr < 0.17 || fr > 0.83) return;
    NJ.glide(yOf(fr < 0.5 ? k : k + 1), 420);
  }
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 170);
  }

  /* ---------- turning it by hand ---------- */
  function current() {
    var s = (global.scrollY - top) / unit;
    if (s < INTRO * 0.5) return -1;
    return clamp(Math.round((s - INTRO) / STEP), 0, N - 1);
  }
  function goTo(k, ms) {
    k = clamp(k, 0, N - 1);
    if (NJ.glide) NJ.glide(yOf(k), ms); else global.scrollTo(0, yOf(k));
  }
  function go(d) {
    var c = current();
    goTo(c < 0 ? 0 : c + d, 460);
  }
  function pinned() {
    var y = global.scrollY;
    return y >= top - 2 && y <= top + (INTRO + (N - 1) * STEP + OUTRO) * unit;
  }

  el.prev.addEventListener("click", function () { go(-1); });
  el.next.addEventListener("click", function () { go(1); });

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var t = e.target;
    if (/^(input|textarea|select)$/i.test(t.tagName || "") || t.isContentEditable) return;
    if (!pinned()) return;
    e.preventDefault();
    go(e.key === "ArrowRight" ? 1 : -1);
  });

  /* A mouse can take hold of the dial and turn it, and the page scrolls to
     match. Touch is left alone: on a phone the lens is most of the screen,
     and taking the scroll away from it would trap the thumb. */
  var drag = null, lastType = "";
  function angleAt(e) {
    var r = lens.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  }
  function radiusAt(e) {
    var r = lens.getBoundingClientRect();
    return Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) / (r.width / 2);
  }
  lens.addEventListener("pointerdown", function (e) {
    lastType = e.pointerType;
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    e.preventDefault();
    drag = { a: angleAt(e), moved: 0, id: e.pointerId };
    try { lens.setPointerCapture(e.pointerId); } catch (x) {}
    lens.classList.add("held");
    held = true;
    if (NJ.stopGlide) NJ.stopGlide();
  });
  lens.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id || !st || st.h < 1) return;
    var a = angleAt(e), da = a - drag.a;
    if (da > 180) da -= 360; else if (da < -180) da += 360;
    drag.a = a;
    drag.moved += Math.abs(da);
    global.scrollBy(0, (-da / DEG) * STEP * unit);
  });
  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var moved = drag.moved;
    drag = null;
    held = false;
    lens.classList.remove("held");
    if (moved < 3 && e.type === "pointerup") pick(e);
    else scheduleSettle();
  }
  lens.addEventListener("pointerup", release);
  lens.addEventListener("pointercancel", release);

  /* A click on an engraving turns the dial to it; a click on the glass
     opens what is behind it; a click on the lens while it is still rising
     out of the hero brings it the rest of the way. */
  function pick(e) {
    if (!st || st.h < 1) { goTo(0); return; }
    var r = radiusAt(e);
    if (r < 0.6) { if (shown >= 0) global.location.href = P[shown].href; return; }
    if (r > 0.95) return;
    var k = Math.round((angleAt(e) + 90 + st.pos * DEG) / DEG);
    goTo(((k % N) + N) % N);
  }
  /* touch and pen: a tap, never a turn */
  lens.addEventListener("click", function (e) {
    if (lastType === "mouse") return;
    if (!st || st.h < 1) { goTo(0); return; }
    if (radiusAt(e) < 0.6 && shown >= 0) global.location.href = P[shown].href;
  });

  /* ---------- wiring ---------- */
  global.addEventListener("scroll", function () { kick(); scheduleSettle(); }, { passive: true });
  global.addEventListener("touchstart", function () { held = true; }, { passive: true });
  global.addEventListener("touchend", function () { held = false; scheduleSettle(); }, { passive: true });
  global.addEventListener("touchcancel", function () { held = false; }, { passive: true });
  global.addEventListener("resize", layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

  if ("IntersectionObserver" in global) {
    new IntersectionObserver(function (en) {
      visible = en[0].isIntersecting;
      if (visible) kick();
    }).observe(section);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) kick(); });

  if (NJ.film && el.hudFilm) NJ.film.onchange(function (f) { el.hudFilm.textContent = f.name.toUpperCase(); });

  section.classList.add("live");
  layout();

  /* A link into the page — #roll from the 404, or #work from before the
     page was a camera — was followed before this scene had its height, so
     the browser landed short. Land it again, now that it is all there. */
  (function () {
    var id = global.location.hash.slice(1);
    if (!id) return;
    var t = id === "work" || id === "wheel" ? null : document.getElementById(id);
    if (!t && id !== "work" && id !== "wheel") return;
    requestAnimationFrame(function () {
      global.scrollTo(0, t ? t.getBoundingClientRect().top + global.scrollY : yOf(0));
    });
  })();

  NJ.wheel = {
    yOf: yOf,
    goTo: goTo,
    go: go,
    count: N,
    current: current
  };
})(window);
