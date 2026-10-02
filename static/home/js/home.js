/* ============================================================
   nojukuramu — the page itself
   Wires the wheel, the contact sheet, the film, the sound and the search
   palette to each other. Everything here is optional: if any one module
   fails to load, the page is still a readable list of projects on black.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s) { return document.querySelector(s); };

  /* Ask the browser to keep this origin's storage (the sound and film
     choices) out of eviction. A heuristic grant, not a promise, so a denial
     is logged rather than silently assumed away. */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (already) {
      return already || navigator.storage.persist();
    }).then(function (granted) {
      if (!granted) console.warn("[home] persistent storage was not granted; saved preferences may be evicted");
    }).catch(function () {});
  }

  var yr = $("#year");
  if (yr) yr.textContent = new Date().getFullYear();

  var P = NJ.projects ? NJ.projects.projects : [];

  /* ---------- sound ---------- */
  var soundBtn = $("#sound-toggle");
  if (NJ.sound && NJ.sound.available && soundBtn) {
    soundBtn.hidden = false;
    soundBtn.addEventListener("click", function () { NJ.sound.toggle(); });
    NJ.sound.onchange(function (on) {
      soundBtn.classList.toggle("on", on);
      soundBtn.classList.remove("hint");
      soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
      soundBtn.setAttribute("aria-label", on ? "Turn off the camera sounds" : "Turn on the camera sounds");
    });
    /* A remembered "on" still waits for a click — browsers will not start
       audio any other way, and a page that talks the moment it loads is
       rude even when it is allowed. */
    if (NJ.sound.remembered()) soundBtn.classList.add("hint");
  }

  /* ---------- rewinding the roll ----------
     Back to the top at a speed worth watching: on the way it passes back
     through the wheel, and the dial spins every frame past in reverse. */
  var rewind = $("#rewind");
  if (rewind) {
    rewind.addEventListener("click", function (e) {
      if (!NJ.glide) return;
      e.preventDefault();
      var ms = reduced ? 0 : 2600;
      if (NJ.sound && ms) NJ.sound.whirr(ms);
      NJ.glide(0, ms, function (arrived) {
        if (NJ.sound) NJ.sound.whirr(0);
        if (arrived && e.detail === 0) { var b = $(".brand"); if (b) b.focus({ preventScroll: true }); }
      });
    });
  }

  /* ---------- search palette ---------- */
  var palette = $("#palette");
  var pInput = $("#palette-input");
  var pList = $("#palette-list");
  var activeIdx = 0, curItems = [];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function icon(p) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  }
  var I = {
    open: icon('<path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/>'),
    dial: icon('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5v3"/>'),
    sheet: icon('<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9 4v16M15 4v16"/>'),
    film: icon('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 8.5h17M3.5 15.5h17M7 5v3.5M12 5v3.5M17 5v3.5M7 15.5V19M12 15.5V19M17 15.5V19"/>'),
    ear: icon('<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.6 7.6 0 0 1 0 11"/>'),
    code: icon('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),
    replay: icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5l3.2 6.6M20.2 9.7l-7.3 1M17.6 18.6l-4.3-6M9.2 20.1l1.9-7.1M3.6 13.6l6.5-2.8M6.6 5.4l3.9 6.2"/>'),
    rewind: icon('<circle cx="12" cy="13" r="7.5"/><circle cx="12" cy="13" r="2"/><path d="M12 5.5V3M12 3h5.5a1.5 1.5 0 0 1 0 3H16"/>'),
    dice: icon('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none"/>')
  };

  function to(y) { closePalette(); if (NJ.glide) NJ.glide(y); else global.scrollTo(0, y); }
  function toEl(id) {
    var t = document.getElementById(id);
    if (t) to(t.getBoundingClientRect().top + global.scrollY);
  }

  var COMMANDS = P.map(function (p, i) {
    return {
      icon: I.open, label: p.name, sub: "open", keywords: p.tags.join(" ") + " " + p.badge + " " + p.kind,
      run: function () { global.location.href = p.href; }
    };
  }).concat(P.map(function (p, i) {
    return {
      icon: I.dial, label: "Turn the wheel to " + p.name, sub: "wheel", keywords: "dial lens show " + p.badge, quiet: true,
      run: function () { closePalette(); if (NJ.wheel) NJ.wheel.goTo(i); }
    };
  })).concat([
    { icon: I.dice, label: "Surprise me", sub: "wheel", keywords: "random shuffle any",
      run: function () { closePalette(); if (NJ.wheel) NJ.wheel.goTo((Math.random() * P.length) | 0); } },
    { icon: I.sheet, label: "Show every project at once", sub: "contact sheet", keywords: "grid all overview list everything roll",
      run: function () { toEl("roll"); } },
    { icon: I.replay, label: "Replay the intro", sub: "shutter", keywords: "splash loading logo intro again iris shutter",
      run: function () { closePalette(); if (NJ.intro) NJ.intro.replay(); } },
    { icon: I.ear, label: "Camera sounds on or off", sub: "sound", keywords: "audio shutter click mute sound",
      run: function () { closePalette(); if (NJ.sound) NJ.sound.toggle(); } },
    { icon: I.rewind, label: "Rewind to the top", sub: "roll", keywords: "top start beginning back",
      run: function () { closePalette(); if (rewind) rewind.click(); else to(0); } }
  ]).concat((NJ.film ? NJ.film.films : []).map(function (f) {
    return {
      icon: I.film, label: "Film: " + f.name, sub: "simulation", keywords: "film simulation look colour color grade filter " + f.id,
      run: function () { closePalette(); NJ.film.set(f.id); }
    };
  })).concat([
    { icon: I.code, label: "Source on GitHub", sub: "repository", keywords: "code repo git",
      run: function () { global.open("https://github.com/nojukuramu/nojukuramu.github.io", "_blank", "noopener"); } }
  ]);

  function renderPalette(q) {
    q = (q || "").trim().toLowerCase();
    /* Turning the wheel to each project would double the list nobody has
       typed into yet; those wait for a search. */
    var items = COMMANDS.filter(function (c) {
      if (!q) return !c.quiet;
      return (c.label + " " + c.sub + " " + (c.keywords || "")).toLowerCase().indexOf(q) !== -1;
    });
    curItems = items; activeIdx = 0;
    if (!items.length) { pList.innerHTML = '<li class="palette-empty">Nothing matches that.</li>'; return; }
    pList.innerHTML = items.map(function (c, i) {
      return '<li class="' + (i === 0 ? "active" : "") + '" data-i="' + i + '"><span class="pi">' + c.icon +
             "</span><span>" + esc(c.label) + '</span><span class="ps">' + esc(c.sub) + "</span></li>";
    }).join("");
    pList.querySelectorAll("li[data-i]").forEach(function (li) {
      li.addEventListener("click", function () { var c = curItems[+li.dataset.i]; if (c) c.run(); });
    });
  }
  function move(d) {
    if (!curItems.length) return;
    activeIdx = (activeIdx + d + curItems.length) % curItems.length;
    var nodes = pList.querySelectorAll("li[data-i]");
    nodes.forEach(function (li, i) { li.classList.toggle("active", i === activeIdx); });
    if (nodes[activeIdx]) nodes[activeIdx].scrollIntoView({ block: "nearest" });
  }
  var opener = null;
  function openPalette() {
    opener = document.activeElement;
    palette.hidden = false; pInput.value = ""; renderPalette("");
    setTimeout(function () { pInput.focus(); }, 0);
  }
  function closePalette() {
    if (palette.hidden) return;
    palette.hidden = true;
    if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  }

  $("#open-palette").addEventListener("click", openPalette);
  pInput.addEventListener("input", function () { renderPalette(pInput.value); });
  pInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (curItems[activeIdx]) curItems[activeIdx].run(); }
    else if (e.key === "Escape") { closePalette(); }
  });
  palette.addEventListener("click", function (e) { if (e.target === palette) closePalette(); });
  document.addEventListener("keydown", function (e) {
    var typing = /^(input|textarea|select)$/i.test(e.target.tagName || "") || e.target.isContentEditable;
    if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      if (palette.hidden) openPalette(); else closePalette();
    } else if (e.key === "Escape" && !palette.hidden) { closePalette(); }
  });
})(window);
