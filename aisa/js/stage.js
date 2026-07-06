/* ============================================================
   stage.js — dimension switch. Wraps the three rigs behind one
   window.AisaRig facade so app.js/brain.js never care which
   body Aisa is wearing. Cycle: 2D → 3D → ART → 2D.
     · 2D  — the violet SVG vtuber (avatar.js)
     · 3D  — toon chibi figurine, lazy three.js (avatar3d.js)
     · ART — Noju's canon Aisa, Live2D-style rig (avatar-art.js)
   Load order: avatar.js → avatar3d.js → avatar-art.js → stage.js.
   ============================================================ */
(function () {
  "use strict";

  var rig2d = window.AisaRig; // avatar.js exported the 2D rig here
  if (!rig2d) return;

  var K_MODE = "aisa:mode";
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var holders = {
    "2d": document.getElementById("avatar-holder"),
    "3d": document.getElementById("holder-3d"),
    "art": document.getElementById("holder-art")
  };
  var btn = document.getElementById("mode-btn");

  var ORDER = ["2d", "3d", "art"];
  var LABEL = { "2d": "2D", "3d": "3D", "art": "ART" };
  var TITLE = {
    "2d": "back to 2D",
    "3d": "switch to 3D (drag to orbit)",
    "art": "switch to ART — Noju's canon Aisa"
  };

  var rig3d = null;
  var loading = false;
  var webglDead = false;
  var mode = "2d";
  var last = { expression: "neutral", speaking: false };

  /* ---------- facade (this is what app.js binds to) ---------- */
  var facade = {
    onPat: null,
    expressions: rig2d.expressions,
    setExpression: function (n) { last.expression = n; active().setExpression(n); },
    setSpeaking: function (on) { last.speaking = on; active().setSpeaking(on); },
    /* the emote bubble is a DOM overlay on the stage — works over every rig */
    emote: function (g, ms) { rig2d.emote(g, ms); }
  };
  window.AisaRig = facade;

  function rigFor(m) {
    if (m === "3d") return rig3d;
    if (m === "art") return window.AisaRigArt || null;
    return rig2d;
  }
  function active() { return rigFor(mode) || rig2d; }

  function nextMode(from) {
    var n = ORDER[(ORDER.indexOf(from) + 1) % ORDER.length];
    if (n === "3d" && webglDead) n = "art"; /* skip a dead 3D on the cycle */
    if (n === "art" && !window.AisaRigArt) n = "2d";
    return n;
  }

  function sysLine(text) {
    var log = document.getElementById("chat-log");
    if (!log) return;
    var div = document.createElement("div");
    div.className = "msg sys";
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function apply() {
    lsSet(K_MODE, mode);
    var nxt = nextMode(mode);
    btn.textContent = LABEL[nxt];
    btn.title = TITLE[nxt];
    for (var m in holders) holders[m].hidden = (m !== mode);
    if (rig3d) rig3d.setVisible(mode === "3d");
    if (window.AisaRigArt) window.AisaRigArt.setVisible(mode === "art");
    var a = active();
    a.setExpression(last.expression);
    a.setSpeaking(last.speaking);
  }

  function switchTo(target, silent) {
    if (target === "3d" && !rig3d) { load3d(silent); return; }
    mode = target;
    apply();
    if (!silent && target === "art") {
      sysLine("ART mode · canon Aisa, from Noju's own drawing · she blinks now");
    }
  }

  function load3d(silent) {
    if (loading) return;
    if (!window.AisaRig3DInit) { fail3d(silent); return; }
    loading = true;
    btn.textContent = "…";
    btn.disabled = true;
    window.AisaRig3DInit(holders["3d"]).then(function (r) {
      rig3d = r;
      loading = false;
      btn.disabled = false;
      mode = "3d";
      apply();
      if (!silent) sysLine("3D rig online · drag to orbit · tap her head at your own risk");
    }).catch(function (err) {
      loading = false;
      btn.disabled = false;
      webglDead = true;
      try { console.warn("Aisa 3D init failed:", err); } catch (e) {}
      fail3d(silent);
    });
  }

  function fail3d(silent) {
    webglDead = true;
    if (!silent) sysLine("3D failed to load (WebGL o network issue) — skipping it sa cycle.");
    /* keep the cycle moving: land on the next viable mode */
    switchTo(nextMode("3d"), silent);
  }

  btn.addEventListener("click", function () {
    switchTo(nextMode(mode), false);
  });

  /* read the saved preference BEFORE apply() persists the default */
  var saved = lsGet(K_MODE);
  apply();
  /* honor a saved preference: 3D warms up quietly, ART is instant */
  if (saved === "3d") load3d(true);
  else if (saved === "art" && window.AisaRigArt) switchTo("art", true);
})();
