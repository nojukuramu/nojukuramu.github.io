/* ============================================================
   nojukuramu — homepage interactions
   Renders the project grid, the theme toggle and the search palette.
   ============================================================ */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Ask the browser to keep this origin's storage (theme, high score) out
   * of eviction — Chrome under disk pressure, Safari's ~7-day ITP wipe of
   * sites with no recent visit. Best-effort; a denial changes nothing. */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (already) {
      if (!already) navigator.storage.persist();
    }).catch(function () {});
  }

  /* ---------- theme ---------- */
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) {}
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    setTheme(cur === "dark" ? "light" : "dark");
  }
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  var tt2 = document.getElementById("theme-toggle-2");
  if (tt2) tt2.addEventListener("click", toggleTheme);

  /* ---------- header hairline on scroll ---------- */
  var header = document.querySelector(".site-header");
  function onScroll() { header.classList.toggle("stuck", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- year ---------- */
  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- icons ---------- */
  function svg(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var ICONS = {
    notes:  svg('<path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><path d="M9 13h6M9 17h4"/>'),
    sigil:  svg('<circle cx="12" cy="12" r="9"/><polygon points="12,5 19,17.5 5,17.5"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>'),
    spark:  svg('<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l3 3M14.7 14.7l3 3M17.7 6.3l-3 3M9.3 14.7l-3 3"/>'),
    tiles:  svg('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="8" y="13" width="8" height="8" rx="2"/>'),
    eye:    svg('<path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.8"/>'),
    tower:  svg('<path d="M12 2.5l3 3-3 3-3-3z"/><path d="M7.5 8.5h9l1 4.5H6.5z"/><path d="M6.5 13h11l1.4 8H5.1z"/><path d="M10.5 21v-4M13.5 21v-4"/>'),
    camera: svg('<path d="M3 8h3.2L7.7 6h8.6L17.8 8H21v11H3z"/><circle cx="12" cy="13" r="3.2"/>'),
    city:   svg('<path d="M3 21h18"/><path d="M5.5 21V9.5l4-2.5V21"/><path d="M13.5 21V5.5l4-2V21"/><path d="M9.5 12h.01M9.5 15h.01M17.5 9h.01M17.5 12h.01"/>'),
    spore:  svg('<path d="M4 10.5c0-3.6 3.6-6 8-6s8 2.4 8 6z"/><path d="M10 10.5V17a2 2 0 0 0 4 0v-6.5"/><path d="M2.5 21h19"/>'),
    arc:    svg('<path d="M3 21A18 18 0 0 1 21 3"/><path d="M3 21A12 12 0 0 1 15 9"/><path d="M3 21a6 6 0 0 1 6-6"/><circle cx="3.4" cy="20.6" r="1.4" fill="currentColor" stroke="none"/>'),
    mic:    svg('<rect x="9" y="2.5" width="6" height="10.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M9 21h6"/>'),
    route:  svg('<path d="M6.5 20.5c-2 0-3.5-1.4-3.5-3.2S4.5 14 6.5 14h11c2 0 3.5-1.4 3.5-3.2S19.5 7.5 17.5 7.5H9"/><path d="M6 3.5c1.7 0 3 1.3 3 2.9C9 8 6 11 6 11S3 8 3 6.4c0-1.6 1.3-2.9 3-2.9z"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
    arrow:  svg('<path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/>'),
    sun:    svg('<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>'),
    code:   svg('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),
    play:   svg('<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>')
  };

  /* ---------- projects (add new ones here) ---------- */
  var PROJECTS = [
    {
      name: "Magic Circles", href: "magic_circles/", icon: ICONS.sigil, badge: "RPG",
      desc: "A magic-based RPG where spells are drawn, not picked from a menu. Trace polygons into elements, wrap them in circles, stack the layers, and cast.",
      tags: ["Phaser", "canvas", "procedural"]
    },
    {
      name: "Magic Sandbox", href: "magic_sandbox/", icon: ICONS.tower, badge: "3D roguelite",
      desc: "The Loom Tower — a top-down spell-crafting roguelite. Weave runes into elemental circles in the Spellforge, then ascend the tower floor by floor.",
      tags: ["Three.js", "WebGL", "roguelite"]
    },
    {
      name: "Task Notes", href: "task-notes/", icon: ICONS.notes, badge: "PWA",
      desc: "A notebook with a real alarm clock inside it. Markdown notes, repeating alarms that ring until you answer them, notebooks, tags and five views — all offline.",
      tags: ["PWA", "offline", "IndexedDB"]
    },
    {
      name: "Pinoy Word Games", href: "pwg/", icon: ICONS.tiles, badge: "Word game",
      desc: "Hulaan ang dalawang salita. Dagdag, bawas, kislap, o banat ng letra — 100 cozy levels in Filipino, with progress saved on your device.",
      tags: ["Filipino", "puzzle", "100 levels"]
    },
    {
      name: "Anti-AFK", href: "antiafk/", icon: ICONS.eye, badge: "Utility",
      desc: "Keep a screen awake without touching it. A decoy video player holds a Screen Wake Lock open — works in Chromium and Firefox 126 and up.",
      tags: ["Wake Lock", "utility"]
    },
    {
      name: "Burst//Dump", href: "burst_dump/", icon: ICONS.camera, badge: "Video",
      desc: "Drop in a folder of photos and it cuts them into a fast, seeded photo-dump reel — rhythms, styles, effects, music — then records straight to MP4 or WebM.",
      tags: ["canvas", "MediaRecorder", "reels"]
    },
    {
      name: "SkyLine", href: "citybuilder/", icon: ICONS.city, badge: "City builder",
      desc: "A pocket-sized city sim. Terraform the ground, lay roads, zone a skyline that grows itself, and watch day turn to night as the rain rolls in.",
      tags: ["Three.js", "procedural", "mobile"]
    },
    {
      name: "VELL", href: "3dtd/", icon: ICONS.spore, badge: "Tower defense",
      desc: "A drowned moor, procedurally grown. Root the Bloom around a Heartspore, shape the route with towers, walls and walkable traps, and hold the line against the Rust.",
      tags: ["Three.js", "procedural", "endless"]
    },
    {
      name: "KaraokeNatin", href: "karaokenatin/", icon: ICONS.mic, badge: "Party",
      desc: "Turn any screen into a karaoke machine. Guests scan a code and their phone becomes the remote — search, queue, skip. Peer-to-peer over WebRTC, so no server of mine is involved.",
      tags: ["WebRTC", "P2P", "PWA"]
    },
    {
      name: "RouteCast", href: "routecast/", icon: ICONS.route, badge: "Navigation",
      desc: "Plan a drive or a ride, then see the weather waiting for you at every stretch of it — each checkpoint forecast for the hour you will actually arrive there, with gear advice for a bike and a nudge if leaving an hour later dodges the rain.",
      tags: ["Leaflet", "OpenStreetMap", "forecast"]
    },
    {
      name: "ARCO", href: "arco/", icon: ICONS.arc, badge: "Instrument",
      desc: "A two-thumb instrument for a phone held sideways. One thumb sweeps the scale, the other plucks or bows four modelled strings, and tilt shapes the tone. Learn a melody once and it plays in all twelve keys.",
      tags: ["AudioWorklet", "waveguide", "offline"]
    }
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function card(p) {
    return (
      '<article class="card">' +
        '<div class="card-top">' +
          '<div class="card-icon">' + p.icon + '</div>' +
          '<span class="card-badge">' + esc(p.badge) + '</span>' +
        '</div>' +
        '<h3 class="card-title">' + esc(p.name) + '</h3>' +
        '<p class="card-desc">' + esc(p.desc) + '</p>' +
        '<div class="card-tags">' +
          p.tags.map(function (t) { return '<span class="card-tag">' + esc(t) + '</span>'; }).join("") +
        '</div>' +
        '<span class="card-cta">Open' + ICONS.arrow + '</span>' +
        '<a class="stretch" href="' + esc(p.href) + '" aria-label="Open ' + esc(p.name) + '"></a>' +
      '</article>'
    );
  }

  function soonCard() {
    return (
      '<article class="card soon">' +
        '<div class="card-top"><div class="card-icon">' + ICONS.spark + '</div></div>' +
        '<h3 class="card-title">Something next</h3>' +
        '<p class="card-desc">New experiments land here when they are finished enough to be useful. The workshop is never quite empty.</p>' +
      '</article>'
    );
  }

  var grid = document.getElementById("app-grid");
  if (grid) grid.innerHTML = PROJECTS.map(card).join("") + soonCard();

  /* ---------- search palette ---------- */
  var palette = document.getElementById("palette");
  var pInput = document.getElementById("palette-input");
  var pList = document.getElementById("palette-list");
  var activeIdx = 0;
  var curItems = [];

  var COMMANDS = PROJECTS.map(function (p) {
    return {
      icon: p.icon, label: p.name, sub: "project", keywords: p.tags.join(" ") + " " + p.badge,
      run: function () { location.href = p.href; }
    };
  }).concat([
    {
      icon: ICONS.play, label: "Play Elemental Echo", sub: "game", keywords: "minigame memory simon",
      run: function () {
        closePalette();
        document.getElementById("play").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
        var s = document.getElementById("echo-start");
        if (s) setTimeout(function () { s.focus(); }, reduceMotion ? 0 : 500);
      }
    },
    { icon: ICONS.sun, label: "Toggle theme", sub: "light / dark", keywords: "dark light mode appearance", run: toggleTheme },
    {
      icon: ICONS.code, label: "Source on GitHub", sub: "repository", keywords: "code repo git",
      run: function () { window.open("https://github.com/nojukuramu/nojukuramu.github.io", "_blank", "noopener"); }
    }
  ]);

  function renderPalette(q) {
    q = (q || "").trim().toLowerCase();
    var items = COMMANDS.filter(function (c) {
      if (!q) return true;
      return (c.label + " " + c.sub + " " + (c.keywords || "")).toLowerCase().indexOf(q) !== -1;
    });
    curItems = items;
    activeIdx = 0;

    if (!items.length) {
      pList.innerHTML = '<li class="palette-empty">Nothing matches that.</li>';
      return;
    }
    pList.innerHTML = items.map(function (c, i) {
      return '<li class="' + (i === 0 ? "active" : "") + '" data-i="' + i + '">' +
             '<span class="pi">' + c.icon + '</span>' +
             '<span>' + esc(c.label) + '</span>' +
             '<span class="ps">' + esc(c.sub) + '</span></li>';
    }).join("");
    pList.querySelectorAll("li[data-i]").forEach(function (li) {
      li.addEventListener("click", function () {
        var c = curItems[+li.dataset.i];
        if (c) c.run();
      });
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
    palette.hidden = false;
    pInput.value = "";
    renderPalette("");
    setTimeout(function () { pInput.focus(); }, 0);
  }
  function closePalette() { palette.hidden = true; }

  document.getElementById("open-palette").addEventListener("click", openPalette);
  pInput.addEventListener("input", function () { renderPalette(pInput.value); });
  pInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (curItems[activeIdx]) curItems[activeIdx].run();
    } else if (e.key === "Escape") { closePalette(); }
  });
  palette.addEventListener("click", function (e) { if (e.target === palette) closePalette(); });

  document.addEventListener("keydown", function (e) {
    var typing = /^(input|textarea|select)$/i.test(e.target.tagName || "") || e.target.isContentEditable;
    if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      if (palette.hidden) openPalette(); else closePalette();
    } else if (e.key === "Escape" && !palette.hidden) {
      closePalette();
    }
  });
})();
