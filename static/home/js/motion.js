/* ============================================================
   nojukuramu — the page's own movement

   Everything on the page that moves and is not the sky or a card: the
   headings that rise a word at a time, the paragraphs that follow them in,
   the two ribbons of names crossing under the hero, the counters, the
   buttons that lean towards a pointer, the hairline along the top that is
   the evening's progress, and the mark at the very bottom writing itself
   the way the splash wrote it at the top.

   None of it is load-bearing. The root only gets `.motion` — the class
   every "start hidden" rule in the stylesheet hangs off — once this file
   is running and able to reveal things again, so a page where it never
   loads is simply all there. Under prefers-reduced-motion the same
   classes are set and the stylesheet collapses every transition to
   nothing, so things arrive in place rather than moving into it.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var doc = document.documentElement;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  var P = NJ.projects ? NJ.projects.projects : null;
  var canWatch = "IntersectionObserver" in global;
  if (canWatch) doc.classList.add("motion");

  /* ---------- the count, in words ----------
     The heading says how many projects there are. It is written into the
     HTML for anyone without scripts, and corrected from the list here, so
     adding a project can never leave it saying twelve again. */
  var word = $("[data-projects-word]");
  if (word && P && NJ.projects.inWords) word.textContent = NJ.projects.inWords(P.length);

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
  var projectsCount = $('[data-count-to="projects"]');
  if (projectsCount && P) projectsCount.textContent = P.length;

  function count(el) {
    var to = el.getAttribute("data-count-to");
    var end = to === "projects" ? (P ? P.length : +el.textContent) : +(to || 0);
    var from = +(el.getAttribute("data-count-from") || 0);
    if (reduced || from === end) { el.textContent = end; return; }
    var t0 = 0, dur = 1300 + Math.abs(end - from) * 25;
    el.textContent = from;
    requestAnimationFrame(function step(now) {
      if (!t0) t0 = now;
      var p = clamp((now - t0) / dur, 0, 1);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (end - from) * e);
      if (p < 1) requestAnimationFrame(step);
    });
  }

  /* ---------- the mark at the bottom ----------
     The same four outlines the header uses, copied in rather than written
     out a fifth time, and stroked on exactly as splash.js strokes them. */
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
    /* The splash's cue, once more — but only for someone who turned the
       evening's sound on. Nobody is surprised by a bell at the bottom of a
       page they have been reading in silence. */
    if (!reduced && NJ.ambience && NJ.ambience.on && NJ.ambience.logo) {
      NJ.ambience.logo({
        plate: 0,
        letters: finalePaths.map(function (_, i) { return LEAD + i * STAGGER; }),
        draw: DRAW,
        flood: LEAD + (finalePaths.length - 1) * STAGGER + DRAW * 0.55
      });
    }
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
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    $$(".reveal, .split").forEach(function (el) { io.observe(el); });
    if (finale) io.observe(finale);
  }

  /* ---------- the ribbons ----------
     Two copies of each list end to end, moved left by exactly one copy's
     width and wrapped, which is a loop with no seam. The speed leans on
     the scroll: the faster the page moves the faster they run, and they
     turn round when the page does. */
  var ribbonsEl = $(".ribbons");
  var tracks = [];
  (function () {
    if (!ribbonsEl || !P) return;
    var star = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.2 7.3 7.3 2.2-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2z"/></svg>';
    var dot = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="5"/></svg>';
    var names = P.map(function (p, i) {
      return '<a class="rb-item' + (i % 2 ? " ghost" : "") + '" href="' + esc(p.href) + '" tabindex="-1">' + esc(p.name) + star + "</a>";
    }).join("");
    var seen = {}, tags = [];
    P.forEach(function (p) {
      p.tags.forEach(function (t) {
        var k = t.toLowerCase();
        if (!seen[k]) { seen[k] = 1; tags.push(t); }
      });
    });
    var tagHtml = tags.map(function (t) { return '<span class="rb-item">' + esc(t) + dot + "</span>"; }).join("");

    var a = ribbonsEl.querySelector('[data-ribbon="names"]');
    var b = ribbonsEl.querySelector('[data-ribbon="tags"]');
    if (a) { a.innerHTML = names + (reduced ? "" : names); tracks.push({ el: a, dir: -1, speed: 52, x: 0, half: 0, slow: 1, want: 1 }); }
    if (b) { b.innerHTML = tagHtml + (reduced ? "" : tagHtml); tracks.push({ el: b, dir: 1, speed: 34, x: 0, half: 0, slow: 1, want: 1 }); }
    tracks.forEach(function (t) {
      /* a name you are reaching for should not run away from the pointer */
      t.el.parentNode.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") t.want = 0.12; });
      t.el.parentNode.addEventListener("pointerleave", function () { t.want = 1; });
    });
  })();

  function measureRibbons() {
    tracks.forEach(function (t) { t.half = t.el.scrollWidth / 2; });
  }

  var ribbonsOn = false, ribbonRaf = 0, ribbonLast = 0, lastY = global.scrollY, boost = 0, heading = 1;
  function ribbonFrame(now) {
    ribbonRaf = 0;
    var dt = ribbonLast ? Math.min(0.1, (now - ribbonLast) / 1000) : 1 / 60;
    ribbonLast = now;
    var y = global.scrollY, dy = y - lastY;
    lastY = y;
    if (dy) heading = dy > 0 ? 1 : -1;
    boost += (Math.min(Math.abs(dy) / Math.max(dt, 0.001), 2600) * 0.32 - boost) * clamp(dt * 7, 0, 1);
    tracks.forEach(function (t) {
      if (!t.half) return;
      t.slow += (t.want - t.slow) * clamp(dt * 6, 0, 1);
      t.x += (t.speed + boost) * t.dir * heading * t.slow * dt;
      if (t.x <= -t.half) t.x += t.half;
      else if (t.x > 0) t.x -= t.half;
      t.el.style.transform = "translate3d(" + t.x.toFixed(1) + "px,0,0)";
    });
    if (ribbonsOn) ribbonRaf = requestAnimationFrame(ribbonFrame);
    else ribbonLast = 0;
  }

  if (tracks.length && !reduced) {
    measureRibbons();
    if (canWatch) {
      new IntersectionObserver(function (en) {
        ribbonsOn = en[0].isIntersecting;
        if (ribbonsOn && !ribbonRaf) { lastY = global.scrollY; ribbonRaf = requestAnimationFrame(ribbonFrame); }
      }).observe(ribbonsEl);
    } else {
      ribbonsOn = true;
      ribbonRaf = requestAnimationFrame(ribbonFrame);
    }
    global.addEventListener("resize", measureRibbons);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureRibbons);
  }

  /* ---------- scroll: the hairline, the hero, the nav ---------- */
  var fill = $("#progress-fill");
  var heroEl = $(".hero");
  var spyLinks = $$("[data-spy]");
  var spyTargets = spyLinks.map(function (a) { return document.getElementById(a.getAttribute("data-spy")); });
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = global.scrollY, vh = global.innerHeight;
      var max = Math.max(1, doc.scrollHeight - vh);
      if (fill) fill.style.transform = "scaleX(" + clamp(y / max, 0, 1).toFixed(4) + ")";
      if (heroEl && !reduced) heroEl.style.setProperty("--hp", clamp(y / (vh * 0.9), 0, 1).toFixed(3));
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

  /* ---------- things that lean towards the pointer ---------- */
  if (!reduced) {
    $$("[data-magnetic]").forEach(function (b) {
      b.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse") return;
        var r = b.getBoundingClientRect();
        var x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
        b.style.setProperty("--tx", (x * 0.2).toFixed(1) + "px");
        b.style.setProperty("--ty", (y * 0.28).toFixed(1) + "px");
      });
      b.addEventListener("pointerleave", function () {
        b.style.removeProperty("--tx");
        b.style.removeProperty("--ty");
      });
    });

    $$("[data-spot]").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty("--mx", (e.clientX - r.left).toFixed(0) + "px");
        el.style.setProperty("--my", (e.clientY - r.top).toFixed(0) + "px");
      });
    });
  }

  NJ.motion = { split: split, count: count };
})(window);
