/* ============================================================
   nojukuramu — the page's own movement

   Everything that moves and is not the lens or a frame on the contact
   sheet: the headings that rise a word at a time, the paragraphs that
   follow them in, the statement that lights a word at a time as it is
   scrolled through, the two strips of film crossing between the wheel and
   the sheet, the small dials that turn their numbers down to nothing, the
   hairline along the top that is how much of the roll has gone past, and
   the mark at the very bottom writing itself.

   It also owns `glide`, the one way the page scrolls itself. The browser's
   smooth scrolling has no say over how long a trip takes, and the trips
   here are long — rewinding the roll goes back through every frame on the
   wheel, and that is only worth watching at a speed someone chose.

   None of it is load-bearing. The root only gets `.motion` — the class
   every "start hidden" rule in the stylesheet hangs off — once this file
   is running and able to reveal things again, so a page where it never
   loads is simply all there. Under prefers-reduced-motion the same classes
   are set and the stylesheet collapses every transition to nothing.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var doc = document.documentElement;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  var esc = NJ.projects ? NJ.projects.esc : function (s) { return String(s); };

  var P = NJ.projects ? NJ.projects.projects : null;
  var canWatch = "IntersectionObserver" in global;
  if (canWatch) doc.classList.add("motion");

  /* ---------- the count, in words ----------
     Written into the HTML for anyone without scripts and corrected from
     the list here, so adding a project can never leave it saying twelve. */
  if (P) {
    $$("[data-projects-word]").forEach(function (el) { el.textContent = NJ.projects.inWords(P.length); });
    $$("[data-projects-num]").forEach(function (el) { el.textContent = P.length; });
  }

  /* ---------- glide: the page scrolling itself ---------- */
  var glideRaf = 0, glideDone = null;
  function maxScroll() { return Math.max(0, doc.scrollHeight - global.innerHeight); }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  function stopGlide() {
    if (!glideRaf) return;
    cancelAnimationFrame(glideRaf);
    glideRaf = 0;
    NJ.gliding = false;
    var d = glideDone; glideDone = null;
    if (d) d(false);
  }

  /* Scroll to `y` over `ms` (or a duration that grows with the distance,
     gently). `done(true)` when it arrives, `done(false)` if a hand on the
     wheel or the screen took over first. */
  function glide(y, ms, done) {
    stopGlide();
    var from = global.scrollY, to = clamp(Math.round(y), 0, maxScroll()), d = to - from;
    if (reduced || Math.abs(d) < 2) {
      global.scrollTo(0, to);
      if (done) done(true);
      return;
    }
    if (ms == null) ms = clamp(320 + Math.sqrt(Math.abs(d) / global.innerHeight) * 360, 380, 1800);
    var t0 = 0;
    glideDone = done || null;
    NJ.gliding = true;
    glideRaf = requestAnimationFrame(function step(now) {
      if (!t0) t0 = now;
      var p = clamp((now - t0) / ms, 0, 1);
      global.scrollTo(0, from + d * easeInOut(p));
      if (p < 1) { glideRaf = requestAnimationFrame(step); return; }
      glideRaf = 0;
      NJ.gliding = false;
      var cb = glideDone; glideDone = null;
      if (cb) cb(true);
    });
  }
  ["wheel", "touchstart", "pointerdown"].forEach(function (t) {
    global.addEventListener(t, stopGlide, { passive: true });
  });
  /* A key that scrolls takes over from a glide — unless something on the
     page already took that key, like the wheel turning on an arrow, in
     which case the glide is its answer to it. */
  global.addEventListener("keydown", function (e) {
    if (!e.defaultPrevented && /^(Arrow|Page|Home|End| )/.test(e.key)) stopGlide();
  });

  /* In-page links glide rather than jump. The skip link is left to the
     browser — it is for someone on a keyboard who wants to be there now. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.classList.contains("skip-link") || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    var id = a.getAttribute("href").slice(1);
    var y = null;
    if (a.getAttribute("data-glide") === "first" && NJ.wheel) y = NJ.wheel.yOf(0);
    else if (!id || id === "top") y = 0;
    else {
      var t = document.getElementById(id);
      if (t) y = t.getBoundingClientRect().top + global.scrollY;
    }
    if (y == null) return;
    e.preventDefault();
    var byKey = e.detail === 0;
    glide(y, null, function (arrived) {
      if (!arrived || !byKey || !id) return;
      var t = document.getElementById(id);
      if (!t) return;
      if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
      t.focus({ preventScroll: true });
    });
  });

  /* ---------- headings, a word at a time ----------
     Each word is wrapped twice: an outer window that clips, and an inner
     span that rises into it. An element inside the heading (the number
     word) becomes a word of its own, so it rises with the rest. */
  function split(el) {
    var i = 0;
    function word(inner) {
      var w = document.createElement("span");
      w.className = "w";
      w.style.setProperty("--i", i++);
      var s = document.createElement("span");
      s.appendChild(inner);
      w.appendChild(s);
      return w;
    }
    Array.prototype.slice.call(el.childNodes).forEach(function (ch) {
      if (ch.nodeType === 3) {
        var frag = document.createDocumentFragment();
        ch.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          frag.appendChild(/^\s+$/.test(part) ? document.createTextNode(part) : word(document.createTextNode(part)));
        });
        el.replaceChild(frag, ch);
      } else if (ch.nodeType === 1) {
        var placeholder = document.createComment("");
        el.replaceChild(placeholder, ch);
        el.replaceChild(word(ch), placeholder);
      }
    });
  }
  if (canWatch) $$(".split").forEach(split);

  /* ---------- counters ----------
     The first counts up to how many projects there are. The others count
     *down* to nothing — build steps, trackers, accounts — because the
     point of those numbers is what got taken away. */
  function countTarget(el) {
    var to = el.getAttribute("data-count-to");
    return to === "projects" ? (P ? P.length : +el.textContent) : +(to || 0);
  }
  function countDuration(from, end) { return 1300 + Math.abs(end - from) * 25; }

  function count(el) {
    var end = countTarget(el);
    var from = +(el.getAttribute("data-count-from") || 0);
    if (reduced || from === end) { el.textContent = end; return; }
    var t0 = 0, dur = countDuration(from, end);
    el.textContent = from;
    requestAnimationFrame(function step(now) {
      if (!t0) t0 = now;
      var p = clamp((now - t0) / dur, 0, 1);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (end - from) * e);
      if (p < 1) requestAnimationFrame(step);
    });
  }
  /* a counter that will count starts at its first number, not its last */
  if (canWatch && !reduced) {
    $$("[data-count-from]").forEach(function (el) { el.textContent = el.getAttribute("data-count-from"); });
    $$('[data-count-to="projects"]').forEach(function (el) { el.textContent = "0"; });
  }

  /* ---------- the small dials ----------
     Each counter sits under a dial engraved with its numbers, and the dial
     turns with the count — the same duration, the same curve — so the
     number under the red mark is always the number printed below it. */
  var SVGNS = "http://www.w3.org/2000/svg";
  function miniDial(el) {
    var from = +el.getAttribute("data-dial-from");
    var toAttr = el.getAttribute("data-dial-to");
    var to = toAttr === "projects" ? (P ? P.length : 0) : +toAttr;
    var top = Math.max(from, to);
    var sp = Math.min(30, 340 / (top + 1));
    var marks = "";
    for (var k = 0; k <= top; k++) {
      var a = k * sp;
      marks += '<g transform="rotate(' + a.toFixed(2) + ')">' +
               '<line x1="0" y1="-95" x2="0" y2="-86" class="md-tick"/>' +
               '<text x="0" y="-66" class="md-num' + (k === to ? " md-to" : "") + '">' + k + "</text></g>";
      if (k < top) {
        marks += '<line x1="0" y1="-95" x2="0" y2="-90" class="md-minor" transform="rotate(' + (a + sp / 2).toFixed(2) + ')"/>';
      }
    }
    el.innerHTML = '<svg viewBox="-100 -100 200 200" aria-hidden="true"><g class="md-face">' + marks + "</g></svg>";
    var face = el.querySelector(".md-face");
    face.style.transform = "rotate(" + (-from * sp) + "deg)";
    return {
      turn: function () {
        var dur = countDuration(from, to);
        face.style.transition = reduced ? "none" : "transform " + dur + "ms cubic-bezier(.33,1,.68,1)";
        face.style.transform = "rotate(" + (-to * sp) + "deg)";
        el.classList.add("turned");
      }
    };
  }
  var dials = new Map();
  $$(".mini-dial[data-dial-from]").forEach(function (el) { dials.set(el.closest(".dial-stat") || el, miniDial(el)); });

  /* ---------- the statement, lit a word at a time ----------
     Not a reveal that fires once: the words light as the paragraph is
     scrolled up through the screen and go dark again on the way back, so
     the reader's own pace is what reads it out. */
  var statement = $("#statement");
  var sWords = [];
  if (statement && canWatch) {
    (function wrap(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) {
          var frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var s = document.createElement("span");
            s.className = "sw";
            s.textContent = part;
            sWords.push(s);
            frag.appendChild(s);
          });
          node.replaceChild(frag, ch);
        } else if (ch.nodeType === 1) {
          wrap(ch);
        }
      });
    })(statement);
    statement.classList.add("lightable");
  }
  var litCount = -1;
  function lightStatement(vh) {
    if (!sWords.length) return;
    var r = statement.getBoundingClientRect();
    if (r.bottom < -vh || r.top > vh * 2) return;
    var p = reduced ? 1 : clamp((vh * 0.86 - r.top) / (r.height + vh * 0.32), 0, 1);
    var n = Math.round(p * sWords.length);
    if (n === litCount) return;
    for (var i = 0; i < sWords.length; i++) sWords[i].classList.toggle("lit", i < n);
    litCount = n;
  }

  /* ---------- the mark at the bottom ----------
     The same four outlines the header uses, copied in rather than written
     out a fourth time, and stroked on a letter at a time. */
  var finale = $(".finale");
  var finaleInk = $(".finale-ink");
  var finalePaths = [];
  (function () {
    var src = $(".site-header .mark-word");
    if (!finaleInk || !src || !canWatch) return;
    finaleInk.innerHTML = src.innerHTML;
    finalePaths = Array.prototype.slice.call(finaleInk.querySelectorAll("path"));
    finalePaths.forEach(function (p) {
      var len;
      try { len = p.getTotalLength(); } catch (e) { len = 900; }
      len = Math.ceil(len) + 4;
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = reduced ? 0 : len;
    });
  })();

  var DRAW = 900, STAGGER = 160, LEAD = 200;
  function writeFinale() {
    finalePaths.forEach(function (p, i) {
      p.style.transition = "stroke-dashoffset " + DRAW + "ms cubic-bezier(.62,.03,.32,1) " + (LEAD + i * STAGGER) + "ms";
      p.style.strokeDashoffset = "0";
    });
    finale.classList.add("drawn");
  }

  /* ---------- reveal ---------- */
  if (canWatch) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        io.unobserve(el);
        el.classList.add("in");
        if (el === finale) writeFinale();
        var n = el.querySelector && el.querySelector("[data-count-to], [data-count-from]");
        if (n) count(n);
        var d = dials.get(el);
        if (d) d.turn();
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    $$(".reveal, .split").forEach(function (el) { io.observe(el); });
    if (finale) io.observe(finale);
  }

  /* ---------- the leader: two strips of film crossing ----------
     Driven by the scroll, not by a clock: they slide as far as the page
     moves and stop when it stops, the way the old ribbons of names under
     the hero leaned on it, only without running on their own. */
  var leader = $("#leader");
  var strips = [];
  (function () {
    if (!leader || !P) return;
    var tri = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1.5l6.5 3.5L2 8.5z" fill="currentColor"/></svg>';
    var names = P.map(function (p, i) {
      return '<span class="strip-item"><i class="strip-no">' + NJ.projects.pad(i + 1) + tri + "</i>" + esc(p.name) + "</span>";
    }).join("");
    var seen = {}, tags = [];
    P.forEach(function (p) {
      p.tags.forEach(function (t) {
        var k = t.toLowerCase();
        if (!seen[k]) { seen[k] = 1; tags.push(t); }
      });
    });
    var tagHtml = tags.map(function (t) { return '<span class="strip-item ghost">' + esc(t) + "</span>"; }).join("");
    var a = leader.querySelector('[data-strip="names"]');
    var b = leader.querySelector('[data-strip="tags"]');
    if (a) { a.innerHTML = names + names + names; strips.push({ el: a, dir: -1, x: 0, want: 0, half: 0 }); }
    if (b) { b.innerHTML = tagHtml + tagHtml + tagHtml; strips.push({ el: b, dir: 1, x: 0, want: 0, half: 0 }); }
  })();
  function measureStrips() { strips.forEach(function (s) { s.half = s.el.scrollWidth / 3; }); }
  var stripRaf = 0;
  function stripFrame() {
    stripRaf = 0;
    var moving = false;
    strips.forEach(function (s) {
      s.x += (s.want - s.x) * (reduced ? 1 : 0.16);
      if (Math.abs(s.want - s.x) > 0.3) moving = true; else s.x = s.want;
      s.el.style.transform = "translate3d(" + s.x.toFixed(1) + "px,0,0)";
    });
    if (moving) stripRaf = requestAnimationFrame(stripFrame);
  }
  function aimStrips(vh) {
    if (!strips.length) return;
    var r = leader.getBoundingClientRect();
    if (r.bottom < -200 || r.top > vh + 200) return;
    var p = clamp((vh - r.top) / (vh + r.height), 0, 1);
    strips.forEach(function (s) {
      var travel = s.half * 0.9;
      s.want = s.dir < 0 ? -s.half * 0.5 - p * travel : -s.half * 1.4 + p * travel;
    });
    if (!stripRaf) stripRaf = requestAnimationFrame(stripFrame);
  }
  if (strips.length) {
    measureStrips();
    global.addEventListener("resize", measureStrips);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measureStrips(); onScroll(); });
  }

  /* ---------- scroll: the hairline, the header, the nav ---------- */
  var fill = $("#progress-fill");
  var header = $(".site-header");
  var spyLinks = $$("[data-spy]");
  var spyTargets = spyLinks.map(function (a) { return document.getElementById(a.getAttribute("data-spy")); });
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = global.scrollY, vh = global.innerHeight;
      if (fill) fill.style.transform = "scaleX(" + clamp(y / Math.max(1, maxScroll()), 0, 1).toFixed(4) + ")";
      if (header) header.classList.toggle("stuck", y > 8);
      lightStatement(vh);
      aimStrips(vh);
      /* the section under the middle of the screen is the one you are in */
      var mid = vh * 0.45, here = -1;
      spyTargets.forEach(function (t, i) {
        if (!t) return;
        var r = t.getBoundingClientRect();
        if (r.top <= mid && r.bottom > mid) here = i;
      });
      spyLinks.forEach(function (a, i) {
        a.classList.toggle("here", i === here);
        if (i === here) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
      });
    });
  }
  global.addEventListener("scroll", onScroll, { passive: true });
  global.addEventListener("resize", onScroll);
  onScroll();

  NJ.motion = { split: split, count: count };
  NJ.glide = glide;
  NJ.stopGlide = stopGlide;
})(window);
