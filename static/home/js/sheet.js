/* ============================================================
   nojukuramu — the contact sheet

   The wheel shows the projects one frame at a time; this is the whole
   roll laid out at once, the way a contact sheet lays out every frame of
   a film, for the visitor who would rather scan than turn. Each frame is
   the same drawing the lens shows, held still, with the film's rebate
   round it and its number printed in the edge.

   The frames arrive as negatives and develop as they come into view: a
   white layer in `difference` blend over the picture is its negative, an
   orange one in `multiply` is the film base, and fading the two out is
   the print coming up in the tray. Two opacities, so it costs nothing.

   Only one frame is ever animated: the one under the pointer, or on a
   screen with no pointer to hover, the one nearest the middle.

   The filter chips and the pill that slides between them are the old
   ring's, moved here with the list they filter.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var noHover = global.matchMedia && global.matchMedia("(hover: none)").matches;
  var PR = NJ.projects;
  var P = PR && PR.projects;
  var sheet = document.getElementById("sheet");
  var filterEl = document.getElementById("filters");
  if (!sheet || !P) return;

  var esc = PR.esc, pad = PR.pad;
  var TRI = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1.5l6.5 3.5L2 8.5z" fill="currentColor"/></svg>';
  var OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/></svg>';

  sheet.innerHTML = P.map(function (p, i) {
    return '<li class="frame" data-i="' + i + '" style="--accent:' + p.accent + ";--accent-rgb:" + PR.rgbOf(p.accent) + '">' +
             '<a class="frame-link" href="' + esc(p.href) + '">' +
               '<span class="film">' +
                 '<span class="frame-photo"><canvas class="photo" aria-hidden="true"></canvas>' +
                   '<i class="frame-neg" aria-hidden="true"></i><i class="frame-base" aria-hidden="true"></i></span>' +
                 '<span class="edge" aria-hidden="true"><b>NOJU 400</b>' + TRI + pad(i + 1) + TRI + pad(i + 1) + "A</span>" +
               "</span>" +
               '<span class="frame-cap"><span class="frame-no">' + pad(i + 1) + "</span>" +
                 '<span class="frame-name">' + esc(p.name) + "</span>" +
                 '<span class="frame-badge">' + esc(p.badge) + "</span></span>" +
               '<span class="frame-desc">' + esc(p.desc) + "</span>" +
               '<span class="frame-open">Open' + OPEN + "</span>" +
             "</a>" +
           "</li>";
  }).join("");

  var F = Array.prototype.map.call(sheet.children, function (li, i) {
    var cv = li.querySelector("canvas");
    return { i: i, li: li, cv: cv, ctx: cv.getContext ? cv.getContext("2d") : null, w: 0, h: 0 };
  });

  /* ---------- drawing ---------- */
  var dpr = 1;
  function size() {
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    F.forEach(function (f) {
      var w = f.cv.offsetWidth, h = f.cv.offsetHeight;
      if (!w || !h || (w === f.w && h === f.h)) return;
      f.w = w; f.h = h;
      f.cv.width = Math.round(w * dpr);
      f.cv.height = Math.round(h * dpr);
      paint(f, 1.4);
    });
  }
  function paint(f, p) {
    var c = f.ctx;
    if (!c || !f.w) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!f.bg) {
      var rgb = PR.rgbOf(P[f.i].accent);
      f.bg = c.createRadialGradient(f.w / 2, f.h / 2, 0, f.w / 2, f.h / 2, f.w * 0.62);
      f.bg.addColorStop(0, "rgba(" + rgb + ",.20)");
      f.bg.addColorStop(1, "rgba(" + rgb + ",0)");
    }
    c.fillStyle = "#08080a";
    c.fillRect(0, 0, f.w, f.h);
    c.fillStyle = f.bg;
    c.fillRect(0, 0, f.w, f.h);
    var mw = f.w * 0.86, mh = f.h * 0.8;
    c.save();
    c.translate((f.w - mw) / 2, (f.h - mh) / 2);
    PR.draw(c, mw, mh, p, f.i);
    c.restore();
  }

  /* ---------- the one live frame ---------- */
  var hot = null, since = 0, raf = 0;
  function loop(now) {
    raf = 0;
    if (!hot) return;
    paint(hot, 1.4 + (now - since) / 1000);
    raf = requestAnimationFrame(loop);
  }
  function setHot(f) {
    if (f === hot || reduced) return;
    if (hot) { hot.li.classList.remove("live"); paint(hot, 1.4); }
    hot = f;
    since = performance.now();
    if (hot) {
      hot.li.classList.add("live");
      if (!raf) raf = requestAnimationFrame(loop);
    }
  }

  F.forEach(function (f) {
    f.li.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") setHot(f); });
    f.li.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && hot === f) setHot(null); });
    f.li.addEventListener("focusin", function () { setHot(f); });
    f.li.addEventListener("focusout", function () { if (hot === f) setHot(null); });
  });

  /* With nothing to hover, the frame nearest the middle of the screen is
     the one that plays — so scrolling down the sheet on a phone plays
     each one in turn. */
  var inView = false;
  function nearest() {
    if (!noHover || !inView) return;
    var mid = global.innerHeight / 2, best = null, bd = Infinity;
    F.forEach(function (f) {
      if (f.li.hidden) return;
      var r = f.li.getBoundingClientRect();
      var d = Math.abs(r.top + r.height * 0.35 - mid);
      if (d < bd && r.bottom > 0 && r.top < global.innerHeight) { bd = d; best = f; }
    });
    setHot(best);
  }

  /* ---------- developing ---------- */
  if ("IntersectionObserver" in global && !reduced) {
    var cols = function () {
      var t = global.getComputedStyle(sheet).gridTemplateColumns;
      return t ? t.split(" ").length : 1;
    };
    var dev = new IntersectionObserver(function (entries) {
      var n = cols(), k = 0;
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var li = en.target;
        dev.unobserve(li);
        li.style.setProperty("--dev", ((k++ % n) * 140) + "ms");
        li.classList.add("developed");
      });
    }, { threshold: 0.2 });
    sheet.classList.add("undeveloped");
    F.forEach(function (f) { dev.observe(f.li); });

    new IntersectionObserver(function (en) {
      inView = en[0].isIntersecting;
      if (!inView && noHover) setHot(null);
      else nearest();
    }).observe(sheet);
  } else {
    inView = true;
  }
  if (noHover) global.addEventListener("scroll", nearest, { passive: true });

  /* ---------- filters, and the pill that slides between them ---------- */
  var chips = [], pill = null;
  if (filterEl) {
    filterEl.innerHTML = '<span class="chip-pill" aria-hidden="true"></span>' + PR.filters.map(function (f, i) {
      var n = f.id === "all" ? P.length : P.filter(function (p) { return p.kind === f.id; }).length;
      return '<button class="chip' + (i === 0 ? " on" : "") + '" type="button" data-filter="' + f.id + '" aria-pressed="' + (i === 0) + '">' +
             esc(f.label) + "<i>" + n + "</i></button>";
    }).join("");
    pill = filterEl.querySelector(".chip-pill");
    chips = Array.prototype.slice.call(filterEl.querySelectorAll(".chip"));
    chips.forEach(function (c) {
      c.addEventListener("click", function () { applyFilter(c.getAttribute("data-filter")); });
    });
  }

  function movePill() {
    var b = filterEl && filterEl.querySelector(".chip.on");
    if (!b || !b.offsetWidth) return;
    pill.style.width = b.offsetWidth + "px";
    pill.style.height = b.offsetHeight + "px";
    pill.style.transform = "translate(" + b.offsetLeft + "px," + b.offsetTop + "px)";
    filterEl.classList.add("has-pill");
  }

  function applyFilter(id) {
    chips.forEach(function (c) {
      var on = c.getAttribute("data-filter") === id;
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    movePill();
    var k = 0;
    F.forEach(function (f) {
      var on = id === "all" || P[f.i].kind === id;
      var was = !f.li.hidden;
      f.li.hidden = !on;
      if (on && !reduced) {
        f.li.style.setProperty("--k", k++);
        if (!was || id !== "all") {
          f.li.classList.remove("dealt");
          void f.li.offsetWidth;
          f.li.classList.add("dealt");
        }
      }
    });
    size();
    nearest();
  }

  /* ---------- first paint ---------- */
  function relayout() { size(); movePill(); }
  if ("ResizeObserver" in global) new global.ResizeObserver(relayout).observe(sheet);
  else global.addEventListener("resize", relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  requestAnimationFrame(relayout);

  NJ.sheet = { filter: applyFilter };
})(window);
