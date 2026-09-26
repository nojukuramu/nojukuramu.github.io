/* ============================================================
   RouteCast — the ride, afterwards

   A ride used to end with one grey line at the top of the screen — "Ride
   recorded — 42 km in 1 h 3 min" — which went away on its own after five
   seconds, usually while the rider was still taking their helmet off. That
   is the moment a rider actually wants to look at the thing: where they
   went, how long it took, how fast, how high. So a ride now ends on a card.

   The card is the shape of the ride, drawn from the track the ride recorded
   (never the planned line — the point is where you went), with the numbers
   under it. It is one tap to dismiss, and it never appears for a ride too
   short to mean anything.

   And it can be shared as a picture. The picture is drawn here, on a
   canvas, from the same track and the same numbers — nothing is uploaded
   anywhere to make it, and the only place it goes is wherever the rider's
   own share sheet sends it. Where a browser cannot share a file, it saves
   one instead.
   ============================================================ */
var RC = RC || {};

RC.recap = (function (global) {
  "use strict";

  var current = null;

  /* ---------------------------------------------------------
     The shape of the ride
     --------------------------------------------------------- */

  /* Longitude squashed by the cosine of the latitude, which is all a map
     projection needs to be at the scale of one ride: north stays up and a
     square block stays square. Fitted into the box with its aspect ratio
     kept, and thinned to a few hundred points, because a two-hour track at
     one fix a second is more path than any picture needs. */
  function project(track, w, h, pad) {
    if (!track || track.length < 2) return null;
    var step = Math.max(1, Math.floor(track.length / 600));
    var pts = [];
    for (var i = 0; i < track.length; i += step) pts.push(track[i]);
    if (pts[pts.length - 1] !== track[track.length - 1]) pts.push(track[track.length - 1]);

    var mid = 0;
    for (var m = 0; m < pts.length; m++) mid += pts[m][0];
    var k = Math.cos((mid / pts.length) * Math.PI / 180) || 1;

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    var xy = pts.map(function (p) {
      var x = p[1] * k, y = -p[0];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      return [x, y];
    });
    var sw = Math.max(maxX - minX, 1e-6), sh = Math.max(maxY - minY, 1e-6);
    var s = Math.min((w - pad * 2) / sw, (h - pad * 2) / sh);
    var ox = (w - sw * s) / 2, oy = (h - sh * s) / 2;
    return xy.map(function (p) { return [ox + (p[0] - minX) * s, oy + (p[1] - minY) * s]; });
  }

  function pathOf(pts) {
    var d = "";
    for (var i = 0; i < pts.length; i++) d += (i ? "L" : "M") + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1);
    return d;
  }

  function sketchSvg(track) {
    var W = 320, H = 150;
    var pts = project(track, W, H, 14);
    if (!pts) return "";
    var a = pts[0], b = pts[pts.length - 1];
    return '<svg class="rc-recap-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="The shape of the ride">' +
      '<path class="rc-recap-glow" d="' + pathOf(pts) + '" pathLength="100"/>' +
      '<path class="rc-recap-line" d="' + pathOf(pts) + '" pathLength="100"/>' +
      '<circle class="rc-recap-start" cx="' + a[0].toFixed(1) + '" cy="' + a[1].toFixed(1) + '" r="4.5"/>' +
      '<circle class="rc-recap-end" cx="' + b[0].toFixed(1) + '" cy="' + b[1].toFixed(1) + '" r="5"/>' +
      "</svg>";
  }

  /* ---------------------------------------------------------
     The card
     --------------------------------------------------------- */
  function show(r) {
    var card = RC.el("recap");
    if (!card || !r) return false;
    current = r;
    RC.el("recap-kicker").textContent = r.kicker || "Ride recorded";
    RC.el("recap-title").textContent = r.title || "";
    var art = RC.el("recap-art");
    var svg = sketchSvg(r.track);
    art.innerHTML = svg;
    art.hidden = !svg;

    var html = "";
    var stats = r.stats || [];
    for (var i = 0; i < stats.length; i++) {
      html += '<div class="rc-recap-stat" style="--i:' + i + '"><b>' + RC.escapeHtml(stats[i].v) + "</b>" +
              "<i>" + RC.escapeHtml(stats[i].k) + "</i></div>";
    }
    RC.el("recap-stats").innerHTML = html;
    var note = RC.el("recap-note");
    note.textContent = r.note || "";
    note.hidden = !r.note;
    card.setAttribute("data-level", r.level || "clear");
    card.hidden = false;
    // Restart the entrance each time: a second ride's card should arrive, not
    // simply be there.
    card.classList.remove("is-in");
    void card.offsetWidth;
    card.classList.add("is-in");
    return true;
  }

  function hide() {
    var card = RC.el("recap");
    if (card) { card.hidden = true; card.classList.remove("is-in"); }
    current = null;
  }

  /* ---------------------------------------------------------
     The picture
     --------------------------------------------------------- */
  // The dark palette, written out: a picture leaves the app, and must look
  // the same wherever it lands whichever theme the rider happened to be in.
  var INK = { bg: "#12160F", card: "#1D2318", line: "#313826", ink: "#EDF2E5", muted: "#9AA48E",
              accent: "#A9CA7B", start: "#6DBB8C", end: "#DE6A6A" };

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function fitText(c, text, maxW, size, weight) {
    var s = size;
    do {
      c.font = weight + " " + s + "px Poppins, system-ui, sans-serif";
      if (c.measureText(text).width <= maxW) break;
      s -= 2;
    } while (s > 24);
    return s;
  }

  function draw(r) {
    var W = 1080, H = 1350;
    var canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    var c = canvas.getContext("2d");
    if (!c) return null;

    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1A2116");
    g.addColorStop(1, INK.bg);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    c.fillStyle = INK.muted;
    c.font = "600 28px Poppins, system-ui, sans-serif";
    c.fillText(String(r.kicker || "Ride recorded").toUpperCase(), 80, 120);

    c.fillStyle = INK.ink;
    fitText(c, r.title || "", W - 160, 64, "700");
    c.fillText(r.title || "", 80, 196);
    if (r.sub) {
      c.fillStyle = INK.muted;
      c.font = "500 32px Poppins, system-ui, sans-serif";
      c.fillText(r.sub, 80, 246);
    }

    // The ride itself.
    var bx = 80, by = 300, bw = W - 160, bh = 600;
    roundRect(c, bx, by, bw, bh, 36);
    c.fillStyle = INK.card;
    c.fill();
    c.save();
    roundRect(c, bx, by, bw, bh, 36);
    c.clip();
    c.strokeStyle = INK.line;
    c.lineWidth = 2;
    for (var gx = bx + 60; gx < bx + bw; gx += 80) { c.beginPath(); c.moveTo(gx, by); c.lineTo(gx, by + bh); c.stroke(); }
    for (var gy = by + 60; gy < by + bh; gy += 80) { c.beginPath(); c.moveTo(bx, gy); c.lineTo(bx + bw, gy); c.stroke(); }
    var pts = project(r.track, bw, bh, 70);
    if (pts) {
      c.lineJoin = "round"; c.lineCap = "round";
      c.shadowColor = INK.accent; c.shadowBlur = 28;
      c.strokeStyle = INK.accent; c.lineWidth = 12;
      c.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var px = bx + pts[i][0], py = by + pts[i][1];
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.stroke();
      c.shadowBlur = 0;
      var a = pts[0], b = pts[pts.length - 1];
      c.fillStyle = INK.start;
      c.beginPath(); c.arc(bx + a[0], by + a[1], 15, 0, Math.PI * 2); c.fill();
      c.fillStyle = INK.end;
      c.beginPath(); c.arc(bx + b[0], by + b[1], 17, 0, Math.PI * 2); c.fill();
      c.strokeStyle = INK.card; c.lineWidth = 5;
      c.stroke();
    }
    c.restore();

    // The numbers, three to a row.
    var stats = (r.stats || []).slice(0, 6);
    var colW = (W - 160) / 3;
    for (var s = 0; s < stats.length; s++) {
      var col = s % 3, row = Math.floor(s / 3);
      var x = 80 + col * colW, y = 1000 + row * 150;
      c.fillStyle = INK.ink;
      fitText(c, stats[s].v, colW - 24, 58, "700");
      c.fillText(stats[s].v, x, y);
      c.fillStyle = INK.muted;
      c.font = "600 24px Poppins, system-ui, sans-serif";
      c.fillText(String(stats[s].k).toUpperCase(), x, y + 42);
    }

    c.fillStyle = INK.accent;
    c.font = "700 34px Poppins, system-ui, sans-serif";
    c.fillText("RouteCast", 80, H - 64);
    c.fillStyle = INK.muted;
    c.font = "500 26px Poppins, system-ui, sans-serif";
    var when = r.when || "";
    c.fillText(when, W - 80 - c.measureText(when).width, H - 64);
    return canvas;
  }

  function save(blob, name) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return "saved";
    } catch (e) { return "failed"; }
  }

  /* Draw it once the web font is actually in: a canvas does not wait for
     Poppins, and the first picture would otherwise be set in whatever the
     system had. */
  function share() {
    var r = current;
    if (!r) return Promise.resolve("none");
    var fontsReady = (document.fonts && document.fonts.load)
      ? Promise.all([document.fonts.load("700 58px Poppins"), document.fonts.load("600 28px Poppins"),
                     document.fonts.load("500 32px Poppins")]).catch(function () {})
      : Promise.resolve();
    return fontsReady.then(function () {
      var canvas = draw(r);
      if (!canvas || !canvas.toBlob) return "failed";
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (!blob) { resolve("failed"); return; }
          var name = "routecast-ride.png";
          var file = null;
          try { file = new File([blob], name, { type: "image/png" }); } catch (e) { file = null; }
          var nav = global.navigator;
          if (file && nav && nav.canShare && nav.share && nav.canShare({ files: [file] })) {
            nav.share({ files: [file], title: r.title || "My ride" }).then(function () { resolve("shared"); },
              function () { resolve("dismissed"); });
          } else {
            resolve(save(blob, name));
          }
        }, "image/png");
      });
    });
  }

  return {
    show: show,
    hide: hide,
    share: share,
    isOpen: function () { var c = RC.el("recap"); return !!(c && !c.hidden); },
    // Exposed for the harness: the projection is the part worth checking.
    _project: project
  };
})(typeof window !== "undefined" ? window : globalThis);
