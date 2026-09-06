/* ============================================================
   nojukuramu — the page itself
   Wires the sky, the projects, the sound and the search palette to each
   other. Everything here is optional: if any one module fails to load the
   page is still a readable list of projects on a dark background.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s) { return document.querySelector(s); };

  /* Ask the browser to keep this origin's storage (the sound and location
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

  /* ---------- the sky ---------- */
  var sky = NJ.sky;
  if (sky) sky.mount($("#sky"));

  function scrollProgress() {
    var max = Math.max(1, document.body.scrollHeight - global.innerHeight);
    return Math.min(1, Math.max(0, global.scrollY / max));
  }

  var header = $(".site-header");
  function onScroll() {
    if (sky) sky.setScroll(scrollProgress());
    header.classList.toggle("stuck", global.scrollY > 8);
    if (sky && !sky.dialled()) dialRange.value = Math.round(sky.auto() * 1000);
  }
  global.addEventListener("scroll", onScroll, { passive: true });
  global.addEventListener("resize", onScroll);

  if (sky && !reduced) {
    global.addEventListener("pointermove", function (e) {
      sky.pointer((e.clientX / global.innerWidth - 0.5) * 2, (e.clientY / global.innerHeight - 0.5) * 2);
    }, { passive: true });
  }

  /* Click the sky itself and something happens. */
  document.addEventListener("click", function (e) {
    if (!sky) return;
    if (e.target.closest("a,button,input,label,.slide,.palette,.sky-bar")) return;
    sky.poke(e.clientX, e.clientY);
  });

  /* ---------- the dial ---------- */
  var dialRange = $("#dial-range");
  var dialTime = $("#dial-time");
  var dialPhase = $("#dial-phase");
  var bar = $("#sky-bar");
  var lastLabel = -1;

  var PHASES = [[0.20, "golden hour"], [0.40, "sunset"], [0.60, "dusk"], [0.80, "twilight"], [1.01, "night"]];

  function label() {
    if (!sky) return;
    var v = sky.t();
    var mins = Math.round((17 * 60 + 40) + v * 245);       /* 17:40 → 21:45 */
    var q = Math.round(mins / 5) * 5;
    if (q !== lastLabel) {
      lastLabel = q;
      dialTime.textContent = String((q / 60) | 0).padStart(2, "0") + ":" + String(q % 60).padStart(2, "0");
      for (var i = 0; i < PHASES.length; i++) {
        if (v < PHASES[i][0]) { dialPhase.textContent = PHASES[i][1]; break; }
      }
    }
    if (NJ.ambience && NJ.ambience.on) {
      var w = sky.weather();
      NJ.ambience.setScene({ t: v, wind: w.wind, rain: w.rain, storm: w.storm });
    }
    requestAnimationFrame(label);
  }
  requestAnimationFrame(label);

  dialRange.addEventListener("input", function () {
    if (sky) sky.setDial(+dialRange.value / 1000);
    bar.classList.remove("auto");
  });
  $("#dial-reset").addEventListener("click", function () {
    if (!sky) return;
    sky.setDial(null);
    bar.classList.add("auto");
    dialRange.value = Math.round(sky.auto() * 1000);
  });

  /* ---------- sound ---------- */
  var soundBtn = $("#sound-toggle");
  if (NJ.ambience && NJ.ambience.available) {
    soundBtn.hidden = false;
    soundBtn.addEventListener("click", function () { NJ.ambience.toggle(); });
    NJ.ambience.onchange(function (on) {
      soundBtn.classList.toggle("on", on);
      soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
      soundBtn.title = on ? "Silence the evening" : "Listen to the evening";
    });
    if (sky) sky.onlightning(function () { NJ.ambience.thunder(); });
    /* A remembered "on" still waits for a click — browsers will not start
       audio any other way, and a page that talks the moment it loads is
       rude even when it is allowed. */
    if (NJ.ambience.remembered()) soundBtn.classList.add("hint");
  }

  /* ---------- the real sky ---------- */
  var wxChip = $("#wx-chip");
  var wxText = $("#wx-text");
  var locBtn = $("#locate");

  function showWeather(s) {
    if (!s) {
      wxChip.hidden = true;
      locBtn.hidden = false;
      return;
    }
    if (sky) {
      sky.setWeather(s);
      if (s.dayT != null && !sky.dialled()) {
        sky.setBase(s.dayT);
        dialRange.value = Math.round(sky.auto() * 1000);
      }
      if (s.moon) sky.setMoonPhase(s.moon.phase);
    }
    var bits = [s.text];
    if (s.temp != null) bits.push(Math.round(s.temp) + "°");
    if (s.moon && sky && sky.t() > 0.5) bits.push(s.moon.name.toLowerCase());
    wxText.textContent = bits.join(" · ");
    wxChip.hidden = false;
    wxChip.title = "Your sky, from Open-Meteo — " + s.place + ", read at " +
                   s.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    locBtn.hidden = true;
  }

  if (NJ.weather) {
    NJ.weather.onchange(showWeather);
    NJ.weather.load().catch(function () {});

    locBtn.addEventListener("click", function () {
      locBtn.classList.add("busy");
      locBtn.disabled = true;
      NJ.weather.request()
        .catch(function (err) {
          locBtn.classList.remove("busy");
          locBtn.disabled = false;
          locBtn.title = (err && err.code === 1)
            ? "Location was declined — the sky will keep running off the scroll"
            : "Could not reach the forecast just now";
          locBtn.classList.add("failed");
          setTimeout(function () { locBtn.classList.remove("failed"); }, 4000);
        });
    });

    wxChip.addEventListener("click", function () {
      NJ.weather.forget();
      if (sky) { sky.setWeather(null); sky.setBase(0); }
    });
  } else {
    locBtn.hidden = true;
  }

  /* ---------- projects ---------- */
  if (NJ.projects) NJ.projects.mount($("#carousel"));

  /* ---------- reveal ---------- */
  if ("IntersectionObserver" in global) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "-8% 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
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
    sun: icon('<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>'),
    moon: icon('<path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z"/>'),
    rain: icon('<path d="M6 14.5A4.5 4.5 0 0 1 7 5.6a5.2 5.2 0 0 1 9.8.9A3.8 3.8 0 0 1 18 14"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>'),
    bolt: icon('<path d="M6 14.5A4.5 4.5 0 0 1 7 5.6a5.2 5.2 0 0 1 9.8.9A3.8 3.8 0 0 1 18 14"/><path d="M13 12l-3 5h3l-1 4"/>'),
    pin: icon('<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
    ear: icon('<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.6 7.6 0 0 1 0 11"/>'),
    code: icon('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),
    dice: icon('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none"/>')
  };

  function skyTo(v) {
    if (sky) sky.setDial(v);
    bar.classList.remove("auto");
    dialRange.value = Math.round(v * 1000);
    closePalette();
  }
  function pretend(code, cloud, wind) {
    if (!NJ.weather) return;
    NJ.weather.pretend({ code: code, cloud: cloud, wind: wind, precip: code >= 60 ? 3 : 0 });
    closePalette();
  }

  var COMMANDS = (NJ.projects ? NJ.projects.projects : []).map(function (p, i) {
    return {
      icon: I.open, label: p.name, sub: "project", keywords: p.tags.join(" ") + " " + p.badge + " " + p.kind,
      run: function () { global.location.href = p.href; }
    };
  }).concat([
    { icon: I.dice, label: "Surprise me", sub: "project", keywords: "random shuffle any",
      run: function () { closePalette(); var n = NJ.projects.projects.length; document.getElementById("work").scrollIntoView({ behavior: reduced ? "auto" : "smooth" }); NJ.projects.goToIndex((Math.random() * n) | 0, true); } },
    { icon: I.pin, label: "Use my real sky", sub: "weather", keywords: "location gps weather forecast now",
      run: function () { closePalette(); locBtn.click(); } },
    { icon: I.ear, label: "Listen to the evening", sub: "sound", keywords: "audio ambient crickets birds wind mute",
      run: function () { closePalette(); if (NJ.ambience) NJ.ambience.toggle(); } },
    { icon: I.sun, label: "Bring back the sun", sub: "sky", keywords: "day golden hour light morning", run: function () { skyTo(0); } },
    { icon: I.moon, label: "Make it night", sub: "sky", keywords: "dark stars night moon", run: function () { skyTo(1); } },
    { icon: I.rain, label: "Pretend it is raining", sub: "sky", keywords: "rain wet shower weather demo", run: function () { pretend(63, 0.9, 22); } },
    { icon: I.bolt, label: "Pretend there is a storm", sub: "sky", keywords: "thunder lightning storm demo", run: function () { pretend(95, 1, 42); } },
    { icon: I.sun, label: "Pretend the sky is clear", sub: "sky", keywords: "clear clean fine demo", run: function () { pretend(0, 0.08, 7); } },
    { icon: I.code, label: "Source on GitHub", sub: "repository", keywords: "code repo git",
      run: function () { global.open("https://github.com/nojukuramu/nojukuramu.github.io", "_blank", "noopener"); } }
  ]);

  function renderPalette(q) {
    q = (q || "").trim().toLowerCase();
    var items = COMMANDS.filter(function (c) {
      if (!q) return true;
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
  function openPalette() {
    palette.hidden = false; pInput.value = ""; renderPalette("");
    setTimeout(function () { pInput.focus(); }, 0);
  }
  function closePalette() { palette.hidden = true; }

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

  onScroll();
})(window);
