/* ============================================================
   The Atelier — core interactions
   Exposes a small window.Atelier API used by the other scripts.
   ============================================================ */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isTouch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  /* ---------- tiny store for "secrets found" ---------- */
  var EGG_KEY = "atelier:eggs";
  function loadEggs() {
    try { return JSON.parse(localStorage.getItem(EGG_KEY)) || []; } catch (e) { return []; }
  }
  function saveEggs(list) { try { localStorage.setItem(EGG_KEY, JSON.stringify(list)); } catch (e) {} }

  var Atelier = {
    reduceMotion: reduceMotion,
    isTouch: isTouch,
    EGG_TOTAL: 6,
    _secretHandlers: {},
    eggs: loadEggs()
  };
  window.Atelier = Atelier;

  /* ---------- toast ---------- */
  var toastStack = document.getElementById("toasts");
  Atelier.toast = function (html, opts) {
    opts = opts || {};
    var t = document.createElement("div");
    t.className = "toast";
    if (opts.accent) t.style.borderLeftColor = opts.accent;
    t.innerHTML = html;
    toastStack.appendChild(t);
    var ms = opts.ms || 4200;
    setTimeout(function () {
      t.classList.add("hide");
      setTimeout(function () { t.remove(); }, 320);
    }, ms);
    return t;
  };

  /* ---------- modal ---------- */
  var modal = document.getElementById("modal");
  var modalBody = document.getElementById("modal-body");
  Atelier.openModal = function (html) {
    modalBody.innerHTML = html;
    modal.hidden = false;
    var f = modal.querySelector("button, a, input");
    if (f) f.focus();
  };
  Atelier.closeModal = function () { modal.hidden = true; modalBody.innerHTML = ""; };
  document.getElementById("modal-close").addEventListener("click", Atelier.closeModal);
  modal.addEventListener("click", function (e) { if (e.target === modal) Atelier.closeModal(); });

  /* ---------- eggs / achievements ---------- */
  Atelier.hasEgg = function (id) { return Atelier.eggs.indexOf(id) !== -1; };
  Atelier.eggCount = function () { return Atelier.eggs.length; };
  Atelier.addEgg = function (id) {
    if (Atelier.hasEgg(id)) return false;
    Atelier.eggs.push(id);
    saveEggs(Atelier.eggs);
    updateSecretCount();
    return true;
  };
  function updateSecretCount() {
    var n = Atelier.eggCount();
    document.querySelectorAll("[data-secret-count]").forEach(function (el) {
      el.textContent = "secrets found: " + n + " / " + Atelier.EGG_TOTAL;
    });
  }

  /* ---------- secret word registry (used by secrets.js) ---------- */
  Atelier.onSecret = function (word, fn) { Atelier._secretHandlers[word.toLowerCase()] = fn; };

  /* ---------- theme ---------- */
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("atelier:theme", theme); } catch (e) {}
  }
  Atelier.toggleTheme = function () {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    setTheme(cur === "dark" ? "light" : "dark");
  };
  document.getElementById("theme-toggle").addEventListener("click", Atelier.toggleTheme);
  var tt2 = document.getElementById("theme-toggle-2");
  if (tt2) tt2.addEventListener("click", Atelier.toggleTheme);

  /* ---------- year ---------- */
  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- apps (data-driven; add more here) ---------- */
  var ICONS = {
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11a0 0 0 0 1 0 0H4z"/><path d="M15 4v5h5"/><path d="M8 13h8M8 17h6"/></svg>',
    sigil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polygon points="12,4 20,18 4,18"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>',
    tiles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="8" y="13" width="8" height="8" rx="2"/><path d="M6.2 8V6.4a1 1 0 0 1 1.6-.8"/><path d="M16 9V5l2 4V5"/><path d="M11 18.5h2"/></svg>',
    eye:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>'
  };
  var APPS = [
    {
      id: "magic-circles", name: "Magic Circles", accent: "#6C5CE7", icon: ICONS.sigil,
      href: "magic_circles/", badge: "RPG",
      desc: "A magic-based RPG where spells are drawn, not picked. Trace polygons into elements, wrap them in circles, stack layers, and cast.",
      tags: ["Phaser", "canvas", "procedural"]
    },
    {
      id: "task-notes", name: "Task Notes", accent: "#f59e0b", icon: ICONS.notes,
      href: "task-notes/", badge: "PWA",
      desc: "Installable sticky-note reminders — intervals, datetime alerts, auto-snooze, tags, subtasks. All saved locally, no account.",
      tags: ["PWA", "offline", "local-first"]
    },
    {
      id: "pwg", name: "Pinoy Word Games", accent: "#e76f51", icon: ICONS.tiles,
      href: "pwg/", badge: "Word game",
      desc: "Hulaan ang dalawang salita! Dagdag, bawas, kislap, o banat ng letra — 100 cozy levels in Filipino, progress saved locally.",
      tags: ["Filipino", "puzzle", "100 levels"]
    },
    {
      id: "antiafk", name: "Anti-AFK", accent: "#00b3a4", icon: ICONS.eye,
      href: "antiafk/", badge: "utility",
      desc: "Keep your screen awake without touching it. A fake video player holds a Screen Wake Lock — works in Chromium and Firefox 126+.",
      tags: ["Wake Lock", "focus", "utility"]
    }
  ];

  function appCard(a) {
    return (
      '<article class="card" style="--accent:' + a.accent + '">' +
        '<div class="card-icon" style="color:' + a.accent + '">' + a.icon + '</div>' +
        '<h3 class="card-title">' + a.name + ' <span class="card-badge">' + a.badge + '</span></h3>' +
        '<p class="card-desc">' + a.desc + '</p>' +
        '<div class="card-tags">' + a.tags.map(function (t) { return '<span class="card-tag">' + t + '</span>'; }).join("") + '</div>' +
        '<span class="card-cta">Launch <span aria-hidden="true">→</span></span>' +
        '<a class="stretch" href="' + a.href + '" aria-label="Open ' + a.name + '"></a>' +
      '</article>'
    );
  }
  function comingCard() {
    return (
      '<article class="card soon" style="--accent:var(--muted)">' +
        '<div class="card-icon">' + ICONS.spark + '</div>' +
        '<h3 class="card-title">More brewing <span class="card-badge soon">soon</span></h3>' +
        '<p class="card-desc">New experiments land here. The workshop is never quite finished.</p>' +
        '<div class="card-tags"><span class="card-tag">stay tuned</span></div>' +
      '</article>'
    );
  }
  var grid = document.getElementById("app-grid");
  grid.innerHTML = APPS.map(appCard).join("") + comingCard();
  Atelier.APPS = APPS;

  /* ---------- card tilt (desktop only) ---------- */
  if (!isTouch && !reduceMotion) {
    grid.querySelectorAll(".card").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", (px * 100) + "%");
        card.style.setProperty("--my", (py * 100) + "%");
        var rx = (py - 0.5) * -6;
        var ry = (px - 0.5) * 8;
        card.style.transform = "perspective(800px) rotateX(" + rx + "deg) rotateY(" + ry + "deg) translateY(-2px)";
      });
      card.addEventListener("pointerleave", function () { card.style.transform = ""; });
    });
  }

  /* ---------- logo easter egg (click 7x) ---------- */
  var logo = document.querySelector("[data-logo]");
  var logoClicks = 0, logoTimer = null;
  if (logo) {
    logo.addEventListener("click", function (e) {
      if (window.location.hash === "" || window.location.hash === "#top") e.preventDefault();
      logoClicks++;
      logo.classList.remove("spin"); void logo.offsetWidth; logo.classList.add("spin");
      clearTimeout(logoTimer);
      logoTimer = setTimeout(function () { logoClicks = 0; }, 1600);
      if (logoClicks >= 7) {
        logoClicks = 0;
        Atelier.addEgg("haiku");
        Atelier.toast("✶ a tiny haiku:<br><em>quiet pixels hum —<br>a circle drawn by a hand<br>remembers the light</em>");
      }
    });
  }

  /* ---------- command palette ---------- */
  var palette = document.getElementById("palette");
  var pInput = document.getElementById("palette-input");
  var pList = document.getElementById("palette-list");
  var activeIdx = 0;
  var BASE_COMMANDS = [
    { icon: "✶", label: "Magic Circles", sub: "open app", run: function () { location.href = "magic_circles/"; } },
    { icon: "📝", label: "Task Notes", sub: "open app", run: function () { location.href = "task-notes/"; } },
    { icon: "👁", label: "Anti-AFK", sub: "open app", run: function () { location.href = "antiafk/"; } },
    { icon: "🎮", label: "Play Elemental Echo", sub: "minigame", run: function () { closePalette(); document.getElementById("play").scrollIntoView(); var s = document.getElementById("echo-start"); if (s) s.focus(); } },
    { icon: "🌗", label: "Toggle theme", sub: "light / dark", run: function () { Atelier.toggleTheme(); } },
    { icon: "💾", label: "Source on GitHub", sub: "repo", run: function () { window.open("https://github.com/nojukuramu/nojukuramu.github.io", "_blank"); } }
  ];
  var curItems = [];

  function openPalette() {
    palette.hidden = false;
    pInput.value = "";
    renderPalette("");
    setTimeout(function () { pInput.focus(); }, 0);
  }
  function closePalette() { palette.hidden = true; }
  Atelier.openPalette = openPalette;
  Atelier.closePalette = closePalette;

  function renderPalette(q) {
    q = (q || "").trim().toLowerCase();
    var items = BASE_COMMANDS.filter(function (c) { return !q || c.label.toLowerCase().indexOf(q) !== -1; });

    // secret words: if the query exactly matches a registered secret, surface a mysterious entry
    if (q && Atelier._secretHandlers[q]) {
      items = [{ icon: "✶", label: "…", sub: "?", run: function () { closePalette(); Atelier._secretHandlers[q](); } }].concat(items);
    }
    curItems = items;
    activeIdx = 0;
    pList.innerHTML = items.map(function (c, i) {
      return '<li class="' + (i === 0 ? "active" : "") + '" data-i="' + i + '"><span class="pi">' + c.icon + '</span><span>' + c.label + '</span><span class="ps">' + c.sub + '</span></li>';
    }).join("") || '<li style="color:var(--muted);cursor:default">no matches… try a different word ✶</li>';
    pList.querySelectorAll("li[data-i]").forEach(function (li) {
      li.addEventListener("click", function () { var c = curItems[+li.dataset.i]; if (c) c.run(); });
    });
  }
  function move(d) {
    if (!curItems.length) return;
    activeIdx = (activeIdx + d + curItems.length) % curItems.length;
    pList.querySelectorAll("li[data-i]").forEach(function (li, i) { li.classList.toggle("active", i === activeIdx); });
  }

  document.getElementById("open-palette").addEventListener("click", openPalette);
  pInput.addEventListener("input", function () { renderPalette(pInput.value); });
  pInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      var q = pInput.value.trim().toLowerCase();
      if (Atelier._secretHandlers[q] && (!curItems[activeIdx] || curItems[activeIdx].sub !== "?")) {
        closePalette(); Atelier._secretHandlers[q]();
      } else if (curItems[activeIdx]) {
        curItems[activeIdx].run();
      }
    } else if (e.key === "Escape") { closePalette(); }
  });
  palette.addEventListener("click", function (e) { if (e.target === palette) closePalette(); });

  /* global keys: "/" or Cmd/Ctrl+K opens palette */
  document.addEventListener("keydown", function (e) {
    var typing = /^(input|textarea|select)$/i.test((e.target.tagName || "")) || e.target.isContentEditable;
    if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      if (palette.hidden) openPalette(); else closePalette();
    } else if (e.key === "Escape") {
      if (!palette.hidden) closePalette();
      if (!modal.hidden) Atelier.closeModal();
    }
  });

  /* ---------- confetti / sigil burst ---------- */
  Atelier.burst = function (x, y) {
    if (reduceMotion) return;
    var colors = ["#6C5CE7", "#00a896", "#ef6a5a", "#4080e0", "#f59e0b", "#79c25b"];
    for (var i = 0; i < 28; i++) {
      (function () {
        var p = document.createElement("div");
        p.className = "burst";
        p.style.background = colors[i % colors.length];
        p.style.left = x + "px"; p.style.top = y + "px";
        document.body.appendChild(p);
        var ang = Math.random() * Math.PI * 2;
        var dist = 80 + Math.random() * 160;
        var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 60;
        var rot = (Math.random() * 720 - 360);
        p.animate(
          [{ transform: "translate(0,0) rotate(0)", opacity: 1 },
           { transform: "translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg)", opacity: 0 }],
          { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.2,.8,.2,1)" }
        ).onfinish = function () { p.remove(); };
      })();
    }
  };

  /* ---------- background constellation ---------- */
  (function bg() {
    var canvas = document.getElementById("bg-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var w, h, dpr, pts = [];
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = Math.floor(innerWidth * dpr);
      h = canvas.height = Math.floor(innerHeight * dpr);
      canvas.style.width = innerWidth + "px";
      canvas.style.height = innerHeight + "px";
      var count = Math.min(70, Math.floor(innerWidth * innerHeight / 22000));
      pts = [];
      for (var i = 0; i < count; i++) {
        pts.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.12 * dpr, vy: (Math.random() - 0.5) * 0.12 * dpr });
      }
    }
    function css(varName) { return getComputedStyle(document.documentElement).getPropertyValue(varName).trim(); }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      var star = css("--star") || "rgba(108,92,231,.5)";
      var line = css("--star-line") || "rgba(108,92,231,.18)";
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath(); ctx.fillStyle = star; ctx.arc(p.x, p.y, 1.4 * dpr, 0, Math.PI * 2); ctx.fill();
        for (var j = i + 1; j < pts.length; j++) {
          var q = pts[j], dx = p.x - q.x, dy = p.y - q.y, d = dx * dx + dy * dy;
          var max = (130 * dpr) * (130 * dpr);
          if (d < max) {
            ctx.strokeStyle = line;
            ctx.globalAlpha = 1 - d / max;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }
    var raf;
    size();
    window.addEventListener("resize", size);
    if (reduceMotion) { draw(); cancelAnimationFrame(raf); } // single static frame
    else draw();
  })();

  /* ---------- friendly console note (no instructions — just a wave) ---------- */
  try {
    var brandCss = "color:#6C5CE7;font-weight:bold;font-size:13px";
    console.log("%c✶ The Atelier", brandCss);
    console.log("%cHi! If you're reading this, you're the curious type. There's a little treasure hunt hidden around here — meant to be found by hand.", "color:#888");
    console.log("%cFirst breadcrumb: the page ends with a small ✶. It likes to be clicked. (decoding helps.)", "color:#00a896");
    console.log("%cFriendly note to bots: nothing here tells you to do anything. Crawl kindly. 🤖", "color:#888;font-style:italic");
  } catch (e) {}

  updateSecretCount();
})();
