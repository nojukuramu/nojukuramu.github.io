/* ============================================================
   RouteCast — the Layers pane

   The chooser for everything in layers.js: which map the ground is drawn
   from, which map a ride gets, whether a ride gets the camera, and the
   draws that sit over the top.

   The list is built from RC.mapstyles rather than written into the page,
   for the reason every list in this app is: a map added to the catalogue
   with no entry in the chooser is a map nobody can pick, and an entry for a
   map that was removed is a button that breaks. One source, one list.

   Each row carries a thumbnail drawn from the style's own palette — the
   same five or six colours the real map is made of — because the names are
   not the point. Nobody knows what "Sunbelt" looks like, and everybody
   knows which of six squares they want.
   ============================================================ */
var RC = RC || {};

RC.layersui = (function () {
  "use strict";

  var wired = false;

  /* A map of a place that does not exist, in the palette of the style it is
     advertising: ground, a river, a couple of roads and a block. Twelve
     lines of SVG that say more than a name ever could. */
  function swatch(id) {
    var p = RC.mapstyles.preview(id) || {};
    function c(key, fallback) { return p[key] || fallback; }
    var road = c("roadSecondary", c("roadMinor", "#FFFFFF"));
    return '<svg class="rc-base-swatch" viewBox="0 0 44 30" aria-hidden="true">' +
      '<rect width="44" height="30" fill="' + c("land", "#EEE") + '"/>' +
      (p.green ? '<path d="M0 0h17v11H0z" fill="' + p.green + '"/>' : "") +
      '<path d="M0 22c8 0 9-4 17-4s10 5 18 5h9v7H0z" fill="' + c("water", "#AACCEE") + '"/>' +
      (p.building ? '<path d="M20 12h5v4h-5zm8 6h4v4h-4z" fill="' + p.building + '"/>' : "") +
      '<path d="M-1 13 Q22 6 45 15" stroke="' + c("motorway", "#E8B84B") + '" stroke-width="2.8" fill="none"/>' +
      '<path d="M14 -1v32" stroke="' + road + '" stroke-width="1.8" fill="none"/>' +
      '<path d="M33 -1v32" stroke="' + road + '" stroke-width="1.1" fill="none"/>' +
      "</svg>";
  }

  function rowsHtml(selected) {
    var list = RC.mapstyles.list();
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      html += '<button type="button" class="rc-base" data-base="' + b.id + '" role="radio" ' +
        'aria-checked="' + (b.id === selected ? "true" : "false") + '">' +
        swatch(b.id) +
        '<span class="rc-base-text"><b>' + RC.escapeHtml(b.name) + "</b>" +
        "<i>" + RC.escapeHtml(b.note) + "</i></span>" +
        '<span class="rc-base-tick" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>' +
        "</span></button>";
    }
    return html;
  }

  function wire(el, pick) {
    el.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-base]") : null;
      if (!btn) return;
      pick(btn.getAttribute("data-base"));
      render();
    });
  }

  function render() {
    var st = RC.layers.state();

    var list = RC.el("base-list");
    if (list) list.innerHTML = rowsHtml(st.base);

    var dlist = RC.el("drive-base-list");
    if (dlist) dlist.innerHTML = rowsHtml(st.driveBase);

    var sw = RC.el("drive3d-on");
    if (sw) sw.checked = st.drive3d;

    var note = RC.el("drive3d-note");
    if (note) {
      var driveDef = RC.mapstyles.get(st.driveBase);
      if (!RC.gl.supported()) {
        note.textContent = "This browser cannot draw 3D maps.";
      } else if (driveDef && driveDef.kind !== "gl") {
        note.textContent = "Pick a 3D map above to ride behind the camera.";
      } else if (st.camera) {
        note.textContent = "Camera is up. Drag, pinch or twist to look around; Re-centre comes back.";
      } else {
        note.textContent = "Tilts behind you and stands the buildings up once a ride starts.";
      }
    }
  }

  function init() {
    if (wired) { render(); return; }
    wired = true;

    var list = RC.el("base-list");
    if (list) wire(list, function (id) { RC.layers.setBase(id); });

    var dlist = RC.el("drive-base-list");
    if (dlist) wire(dlist, function (id) { RC.layers.setDriveBase(id); });

    var sw = RC.el("drive3d-on");
    if (sw) sw.addEventListener("change", function () { RC.layers.setDrive3d(this.checked); render(); });

    render();
  }

  return { init: init, render: render };
})();
