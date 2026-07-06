/* ============================================================
   stage.js — dimension switch. Wraps the 2D SVG rig and the
   lazy-loaded 3D rig behind one window.AisaRig facade so
   app.js/brain.js never care which body Aisa is wearing.
   Load order: avatar.js → avatar3d.js → stage.js → brain → app.
   ============================================================ */
(function () {
  "use strict";

  var rig2d = window.AisaRig; // avatar.js exported the 2D rig here
  if (!rig2d) return;

  var K_MODE = "aisa:mode";
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var holder2d = document.getElementById("avatar-holder");
  var holder3d = document.getElementById("holder-3d");
  var btn = document.getElementById("mode-btn");

  var rig3d = null;
  var loading = false;
  var mode = "2d";
  var last = { expression: "neutral", speaking: false };

  /* ---------- facade (this is what app.js binds to) ---------- */
  var facade = {
    onPat: null,
    expressions: rig2d.expressions,
    setExpression: function (n) { last.expression = n; active().setExpression(n); },
    setSpeaking: function (on) { last.speaking = on; active().setSpeaking(on); },
    /* the emote bubble is a DOM overlay on the stage — works over both rigs */
    emote: function (g, ms) { rig2d.emote(g, ms); }
  };
  window.AisaRig = facade;

  function active() { return (mode === "3d" && rig3d) ? rig3d : rig2d; }

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
    btn.textContent = mode === "2d" ? "3D" : "2D";
    btn.title = mode === "2d" ? "switch to 3D (drag to orbit)" : "back to 2D";
    holder2d.hidden = mode === "3d";
    holder3d.hidden = mode !== "3d";
    if (rig3d) rig3d.setVisible(mode === "3d");
    var a = active();
    a.setExpression(last.expression);
    a.setSpeaking(last.speaking);
  }

  function to3d(silent) {
    if (rig3d) { mode = "3d"; apply(); return; }
    if (loading) return;
    if (!window.AisaRig3DInit) { fail(silent); return; }
    loading = true;
    btn.textContent = "…";
    btn.disabled = true;
    window.AisaRig3DInit(holder3d).then(function (r) {
      rig3d = r;
      loading = false;
      btn.disabled = false;
      mode = "3d";
      apply();
      if (!silent) sysLine("3D rig online · drag to orbit · tap her head at your own risk");
    }).catch(function (err) {
      loading = false;
      btn.disabled = false;
      mode = "2d";
      apply();
      try { console.warn("Aisa 3D init failed:", err); } catch (e) {}
      fail(silent);
    });
  }

  function fail(silent) {
    if (!silent) sysLine("3D failed to load (WebGL o network issue) — staying in 2D. Classic never dies naman.");
  }

  btn.addEventListener("click", function () {
    if (mode === "2d") to3d(false);
    else { mode = "2d"; apply(); }
  });

  /* read the saved preference BEFORE apply() persists the default */
  var saved = lsGet(K_MODE);
  apply();
  /* honor a saved 3D preference: warm up quietly, swap when ready */
  if (saved === "3d") to3d(true);
})();
