/* ============================================================
   Aisa — the page

   Boots the rig onto the canvas, publishes it as window.Aisa, and builds
   the drawer of controls from the rig's own lists - the parameters, the
   expressions, the motions - so a new entry in model.js or expressions.js
   shows up here without touching this file.
   ============================================================ */
(function () {
  "use strict";

  var status = document.getElementById("status");
  var canvas = document.getElementById("aisa");
  var Aisa;
  try {
    Aisa = window.Aisa = AISA.create(canvas, { base: "art/", background: "#1b1b1b" });
  } catch (e) {
    status.textContent = "This browser cannot draw her (WebGL is off or missing).";
    return;
  }
  status.textContent = "Loading";
  AISA.info.init();

  var panel = document.getElementById("rig"), openBtn = document.getElementById("rig-open");
  function show(on) {
    panel.hidden = !on;
    openBtn.setAttribute("aria-expanded", on ? "true" : "false");
    // on a phone the drawer is a bottom sheet: the stage shrinks to the
    // space above it, so she stays whole instead of half under the controls
    document.body.classList.toggle("rig-open", on);
  }
  openBtn.addEventListener("click", function () { show(true); });
  document.getElementById("rig-close").addEventListener("click", function () { show(false); });

  function chip(label, pressed) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = label;
    if (pressed != null) b.setAttribute("aria-pressed", pressed ? "true" : "false");
    return b;
  }
  function words(id) { return id.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(); }

  Aisa.ready.then(function () {
    status.textContent = "";

    // ---- expressions
    var exprBox = document.getElementById("expr"), exprBtns = {};
    Aisa.expressions().forEach(function (name) {
      var b = chip(name, name === "neutral");
      b.addEventListener("click", function () { Aisa.expression(name); });
      exprBox.appendChild(b); exprBtns[name] = b;
    });
    Aisa.on("expression", function (name) {
      for (var k in exprBtns) exprBtns[k].setAttribute("aria-pressed", k === name ? "true" : "false");
    });

    // ---- motions
    var motionBox = document.getElementById("motion"), motionBtns = {};
    Aisa.motions().forEach(function (name) {
      var b = chip(words(name), false);
      b.addEventListener("click", function () {
        if (Aisa.playing().indexOf(name) >= 0) Aisa.stop(name); else Aisa.play(name);
      });
      motionBox.appendChild(b); motionBtns[name] = b;
    });
    Aisa.on("motion", function () {
      var on = Aisa.playing();
      for (var k in motionBtns) motionBtns[k].setAttribute("aria-pressed", on.indexOf(k) >= 0 ? "true" : "false");
    });

    // ---- live behaviours
    var autoBox = document.getElementById("auto"), state = Aisa.auto();
    function toggle(label, on, fn) {
      var l = document.createElement("label"), i = document.createElement("input");
      i.type = "checkbox"; i.checked = on;
      i.addEventListener("change", function () { fn(i.checked); });
      l.appendChild(i); l.appendChild(document.createTextNode(label));
      autoBox.appendChild(l);
    }
    ["blink", "breath", "idle", "physics"].forEach(function (k) {
      toggle(k.charAt(0).toUpperCase() + k.slice(1), state[k], function (on) { var o = {}; o[k] = on; Aisa.auto(o); });
    });
    function follow(e) { Aisa.lookAtPoint(e.clientX, e.clientY); }
    toggle("Follow pointer", false, function (on) {
      if (on) window.addEventListener("pointermove", follow);
      else { window.removeEventListener("pointermove", follow); Aisa.lookAt(null); }
    });

    // ---- parameter sliders, grouped as the model groups them
    var box = document.getElementById("params"), groups = {}, rows = [];
    Aisa.params().forEach(function (p) {
      var g = groups[p.group];
      if (!g) {
        g = groups[p.group] = document.createElement("details");
        g.className = "group";
        var s = document.createElement("summary"); s.textContent = p.group;
        g.appendChild(s); box.appendChild(g);
      }
      var row = document.createElement("div"); row.className = "param";
      var id = "p-" + p.id;
      var lab = document.createElement("label"); lab.htmlFor = id;
      lab.innerHTML = p.label + " <code>" + p.id + "</code>";
      var out = document.createElement("output");
      var inp = document.createElement("input");
      inp.type = "range"; inp.id = id; inp.min = p.min; inp.max = p.max;
      inp.step = (p.max - p.min) > 20 ? 1 : 0.01; inp.value = p.value;
      inp.addEventListener("input", function () { Aisa.set(p.id, +inp.value); });
      row.appendChild(lab); row.appendChild(out); row.appendChild(inp);
      g.appendChild(row);
      rows.push({ id: p.id, out: out, inp: inp, group: g, big: (p.max - p.min) > 20 });
    });
    document.getElementById("reset").addEventListener("click", function () {
      Aisa.reset(); Aisa.expression("neutral"); Aisa.stop();
      rows.forEach(function (r) { r.inp.value = Aisa.base(r.id); });
    });

    // the live readout: only for groups that are open, and only while the
    // drawer is - forty outputs rewritten every frame for nobody is waste
    Aisa.on("frame", function (v) {
      if (panel.hidden) return;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r.group.open) continue;
        var t = r.big ? Math.round(v[r.id]) + "" : v[r.id].toFixed(2);
        if (r.out.textContent !== t) r.out.textContent = t;
      }
    });
  }).catch(function (e) {
    status.textContent = "She did not load: " + e.message;
  });
})();
