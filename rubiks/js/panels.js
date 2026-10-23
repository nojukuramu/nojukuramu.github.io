/* Rubiks — everything drawn from the session: the side column, the stats
 * sheet, a solve's sheet, an average's sheet, the event picker and the
 * settings form.
 *
 * Nothing here owns state. It reads RK.app.state() and calls RK.app actions,
 * so there is one copy of the solves and one place that writes them. */
"use strict";

var RK = RK || {};

RK.panels = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var LIST_PAGE = 200;
  var listLimit = LIST_PAGE, trendRange = 100;

  function st() { return RK.app.state(); }
  function fmt(ms) { return RK.stats.formatTime(ms, st().settings.decimals); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function solveTime(s) {
    if (s.penalty === "DNF") return "DNF";
    return fmt(RK.stats.effectiveTime(s)) + (s.penalty === "+2" ? "+" : "");
  }

  function when(ts) {
    var d = new Date(ts);
    try { return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return d.toISOString().slice(0, 16).replace("T", " "); }
  }

  function day(ts) {
    var d = new Date(ts);
    try { return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }

  function underTarget(solves, target) {
    if (!target || !solves.length) return null;
    var n = 0;
    solves.forEach(function (s) { if (RK.stats.effectiveTime(s) < target) n++; });
    return Math.round(n / solves.length * 100);
  }

  /* ---------------------------------------------------------------
     The side column
     --------------------------------------------------------------- */
  function renderSide() {
    var s = st(), sum = s.sum, ev = RK.scramble.event(s.event);
    $("side-event").textContent = ev.name;

    var rows = [["Single", sum.single, sum.bestSingle, "1"], ["Ao5", sum.cur[5], sum.best[5], "5"], ["Ao12", sum.cur[12], sum.best[12], "12"]];
    if (sum.count >= 50) rows.push(["Ao50", sum.cur[50], sum.best[50], "50"]);
    if (sum.count >= 100) rows.push(["Ao100", sum.cur[100], sum.best[100], "100"]);
    $("stat-body").innerHTML = rows.map(function (r) {
      return "<tr><th>" + r[0] + "</th>" +
        '<td><button data-avg="' + r[3] + '" data-which="cur"' + (r[1] == null ? " disabled" : "") + ">" + fmt(r[1]) + "</button></td>" +
        '<td><button class="best" data-avg="' + r[3] + '" data-which="best"' + (r[2] == null ? " disabled" : "") + ">" + fmt(r[2]) + "</button></td></tr>";
    }).join("");

    var facts = [];
    if (sum.count) facts.push("Mean <strong>" + fmt(sum.mean) + "</strong>");
    if (sum.sd != null) facts.push("&sigma; <strong>" + fmt(sum.sd) + "</strong>");
    var pct = underTarget(s.solves, s.settings.target);
    if (pct != null) facts.push("Sub-" + RK.stats.formatTime(s.settings.target).replace(/\.0+$/, "") + " <strong>" + pct + "%</strong>");
    facts.push("<strong>" + sum.count + "</strong> solve" + (sum.count === 1 ? "" : "s"));
    $("side-facts").innerHTML = facts.map(function (f) { return "<span>" + f + "</span>"; }).join('<span class="dot"></span>');

    var from = Math.max(0, s.solves.length - 50);
    if (s.solves.length >= 3) {
      RK.chart.trend($("mini-chart"), s.solves.slice(from), { height: 96, first: from + 1, ao5: sum.roll[5].slice(from), ao12: sum.roll[12].slice(from), target: s.settings.target });
      $("mini-chart").hidden = false;
    } else $("mini-chart").hidden = true;

    renderList();

    $("peek-ao5").textContent = fmt(sum.cur[5]);
    $("peek-ao12").textContent = fmt(sum.cur[12]);
    $("peek-count").textContent = sum.count;
  }

  function renderList() {
    var s = st(), sum = s.sum, list = $("solve-list");
    if (!s.solves.length) { list.innerHTML = '<div class="empty">No solves yet</div>'; return; }
    var h = "", stop = Math.max(0, s.solves.length - listLimit);
    for (var i = s.solves.length - 1; i >= stop; i--) {
      var x = s.solves[i];
      var cls = "solve-row" + (x.penalty === "DNF" ? " is-dnf" : x.penalty === "+2" ? " is-plus2" : "") + (i === sum.bestSingleIdx ? " is-best" : "");
      h += '<button class="' + cls + '" data-idx="' + i + '">' +
        '<span class="n">' + (i + 1) + "</span>" +
        '<span class="t">' + solveTime(x) + (x.comment ? '<i class="has-note" title="Has a note"></i>' : "") + "</span>" +
        '<span class="a">' + fmt(sum.roll[5][i]) + "</span>" +
        '<span class="a">' + fmt(sum.roll[12][i]) + "</span></button>";
    }
    if (stop > 0) h += '<button class="list-more" data-more>Show ' + Math.min(LIST_PAGE, stop) + " older</button>";
    list.innerHTML = h;
  }

  /* ---------------------------------------------------------------
     One solve
     --------------------------------------------------------------- */
  function openSolve(idx) {
    var s = st(), x = s.solves[idx];
    if (!x) return;
    var ev = RK.scramble.event(s.event), sum = s.sum;
    $("sheet-solve-title").textContent = "Solve " + (idx + 1);
    var h = '<div class="solve-hero' + (x.penalty === "DNF" ? " is-dnf" : x.penalty === "+2" ? " is-plus2" : "") + '">' + solveTime(x) + "</div>" +
      '<div class="solve-meta">' + esc(when(x.date)) + " &middot; " + esc(ev.name) +
      (x.penalty === "+2" ? " &middot; raw " + fmt(x.time) : x.penalty === "DNF" ? " &middot; stopped at " + fmt(x.time) : "") + "</div>" +
      '<div class="seg seg-wide" data-pen="' + idx + '">' +
      ['ok', '+2', 'DNF'].map(function (p) {
        var on = (p === "ok" && !x.penalty) || x.penalty === p;
        return '<button value="' + p + '"' + (on ? ' class="on"' : "") + ">" + (p === "ok" ? "No penalty" : p) + "</button>";
      }).join("") + "</div>" +
      '<div class="kv"><span>Ao5 here</span><strong>' + fmt(sum.roll[5][idx]) + '</strong><span>Ao12 here</span><strong>' + fmt(sum.roll[12][idx]) + "</strong></div>" +
      '<div class="block-head">Scramble <button class="link-btn" data-copy="' + esc(x.scramble) + '">Copy</button></div>' +
      '<div class="scramble-mini">' + esc(x.scramble) + "</div>" +
      (ev.n && x.scramble ? '<div class="preview-inline">' + RK.cube.svg(ev.n, x.scramble) + "</div>" : "") +
      '<div class="block-head">Note</div>' +
      '<textarea class="note" data-note="' + idx + '" rows="2" maxlength="500" placeholder="Lockup on PLL, skipped OLL...">' + esc(x.comment || "") + "</textarea>" +
      '<div class="sheet-actions"><button class="btn btn-danger" data-del="' + idx + '">Delete solve</button></div>';
    $("solve-body").innerHTML = h;
    RK.sheets.open("solve");
  }

  /* ---------------------------------------------------------------
     One average: the times in it, trimmed ones in parentheses, the way
     csTimer and every cubing forum write them, ready to paste.
     --------------------------------------------------------------- */
  function openAverage(n, which) {
    var s = st(), sum = s.sum;
    if (n === 1) {
      var i = which === "best" ? sum.bestSingleIdx : s.solves.length - 1;
      if (i >= 0) openSolve(i);
      return;
    }
    var end = which === "best" ? sum.bestEnd[n] : s.solves.length;
    if (end < n) return;
    var list = s.solves.slice(end - n, end), drop = RK.stats.trimmed(list), avg = RK.stats.average(list);
    var label = (n === 3 ? "Mo3" : "Ao" + n);
    var text = label + ": " + fmt(avg) + "\n" + list.map(function (x, k) {
      var t = solveTime(x);
      return (k + 1) + ". " + (drop[k] ? "(" + t + ")" : t) + "   " + x.scramble.replace(/\n/g, " ");
    }).join("\n");
    $("sheet-solve-title").textContent = (which === "best" ? "Best " : "Current ") + label;
    var h = '<div class="solve-hero">' + fmt(avg) + "</div>" +
      '<div class="solve-meta">Solves ' + (end - n + 1) + " to " + end + " &middot; " + esc(day(list[0].date)) + "</div>" +
      '<div class="avg-list">' + list.map(function (x, k) {
        return '<button class="avg-row' + (drop[k] ? " dropped" : "") + '" data-idx="' + (end - n + k) + '"><span class="n">' + (end - n + k + 1) + '</span><span class="t">' + (drop[k] ? "(" + solveTime(x) + ")" : solveTime(x)) + '</span><span class="sc">' + esc(x.scramble.replace(/\n/g, " ")) + "</span></button>";
      }).join("") + "</div>" +
      '<div class="sheet-actions"><button class="btn" data-copy="' + esc(text) + '">Copy as text</button></div>';
    $("solve-body").innerHTML = h;
    RK.sheets.open("solve");
  }

  /* ---------------------------------------------------------------
     The stats sheet
     --------------------------------------------------------------- */
  function openStats() {
    RK.sheets.open("stats");
    renderStats();
  }

  function renderStats() {
    var s = st(), sum = s.sum, body = $("stats-body");
    if (!sum.count) { body.innerHTML = '<p class="empty">Statistics appear after your first solve.</p>'; return; }
    var tiles = [["Best single", sum.bestSingle, "1"], ["Best Ao5", sum.best[5], "5"], ["Best Ao12", sum.best[12], "12"], ["Mean", sum.mean, null]];
    var h = '<div class="tiles">' + tiles.map(function (t) {
      return '<button class="tile"' + (t[2] && t[1] != null ? ' data-avg="' + t[2] + '" data-which="best"' : " disabled") + '><small>' + t[0] + "</small><strong>" + fmt(t[1]) + "</strong>" +
        (t[0] === "Mean" && sum.sd != null ? "<em>&sigma; " + fmt(sum.sd) + "</em>" : "") + "</button>";
    }).join("") + "</div>";

    var ranges = [50, 100, 500, 0];
    h += '<div class="block-head">Trend <div class="chips">' + ranges.map(function (r) {
      return '<button data-range="' + r + '"' + (r === trendRange ? ' class="on"' : "") + ">" + (r ? "Last " + r : "All") + "</button>";
    }).join("") + "</div></div>" +
      '<div class="legend"><span><i class="sw single"></i>Single</span><span><i class="sw ao5"></i>Ao5</span><span><i class="sw ao12"></i>Ao12</span>' +
      (s.settings.target ? '<span><i class="sw target"></i>Target</span>' : "") + "</div>" +
      '<div class="chart stats-trend"></div>' +
      '<div class="block-head">Spread</div><div class="chart stats-hist"></div>';

    h += '<div class="block-head">Averages</div><table class="stat-table wide"><thead><tr><th></th><th>Current</th><th>Best</th></tr></thead><tbody>' +
      [1, 3, 5, 12, 50, 100].map(function (n) {
        var cur = n === 1 ? sum.single : sum.cur[n], best = n === 1 ? sum.bestSingle : sum.best[n];
        return "<tr><th>" + (n === 1 ? "Single" : n === 3 ? "Mo3" : "Ao" + n) + "</th>" +
          '<td><button data-avg="' + n + '" data-which="cur"' + (cur == null ? " disabled" : "") + ">" + fmt(cur) + "</button></td>" +
          '<td><button class="best" data-avg="' + n + '" data-which="best"' + (best == null ? " disabled" : "") + ">" + fmt(best) + "</button></td></tr>";
      }).join("") + "</tbody></table>";

    var pct = underTarget(s.solves, s.settings.target);
    var facts = [["Solves", sum.count], ["DNF", sum.dnf + (sum.count ? " (" + Math.round(sum.dnf / sum.count * 100) + "%)" : "")], ["+2", sum.plus2], ["Worst", fmt(sum.worst)],
      ["Time solving", duration(sum.total)]];
    if (pct != null) facts.splice(1, 0, ["Under target", pct + "%"]);
    h += '<div class="block-head">Session</div><div class="facts">' + facts.map(function (f) { return "<div><small>" + f[0] + "</small><strong>" + f[1] + "</strong></div>"; }).join("") + "</div>";

    var days = RK.stats.byDay(s.solves).slice(0, 14);
    if (days.length > 1) {
      h += '<div class="block-head">By day</div><table class="day-table"><thead><tr><th>Day</th><th>Solves</th><th>Mean</th><th>Best</th></tr></thead><tbody>' +
        days.map(function (d) { return "<tr><td>" + esc(day(d.date)) + "</td><td>" + d.count + "</td><td>" + fmt(d.mean) + "</td><td>" + fmt(d.best) + "</td></tr>"; }).join("") + "</tbody></table>";
    }
    body.innerHTML = h;
    drawStatsCharts();
  }

  function drawStatsCharts() {
    var s = st(), sum = s.sum, el = $("stats-body").querySelector(".stats-trend");
    if (!el) return;
    var from = trendRange ? Math.max(0, s.solves.length - trendRange) : 0;
    RK.chart.trend(el, s.solves.slice(from), { height: 220, first: from + 1, ao5: sum.roll[5].slice(from), ao12: sum.roll[12].slice(from), target: s.settings.target });
    RK.chart.histogram($("stats-body").querySelector(".stats-hist"), s.solves);
  }

  function duration(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return Math.round(ms / 1000) + "s";
    if (m < 60) return m + " min";
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  }

  /* ---------------------------------------------------------------
     Event picker
     --------------------------------------------------------------- */
  function openEvents() {
    var cur = st().event;
    $("event-grid").innerHTML = RK.scramble.EVENTS.map(function (e) {
      var n = RK.store.solves(e.id).length;
      return '<button class="event-card' + (e.id === cur ? " on" : "") + '" data-event="' + e.id + '"><strong>' + e.short + "</strong><small>" + e.name + "</small><em>" + (n ? n + " solve" + (n === 1 ? "" : "s") : "&nbsp;") + "</em></button>";
    }).join("");
    RK.sheets.open("event");
  }

  /* ---------------------------------------------------------------
     Settings
     --------------------------------------------------------------- */
  function openSettings() {
    var set = st().settings;
    document.querySelectorAll("#sheet-settings [data-set]").forEach(function (el) {
      var k = el.getAttribute("data-set");
      if (el.type === "checkbox") el.checked = !!set[k];
      else el.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", String(set[k]) === b.value); });
    });
    $("set-target").value = set.target ? (set.target / 1000).toString() : "";
    RK.sheets.open("settings");
  }

  function bindSettings() {
    var sheet = $("sheet-settings");
    sheet.addEventListener("change", function (e) {
      var el = e.target;
      if (el.matches("input[type=checkbox][data-set]")) RK.app.saveSettings(prop(el.getAttribute("data-set"), el.checked));
    });
    sheet.addEventListener("click", function (e) {
      var b = e.target.closest(".seg[data-set] button");
      if (!b) return;
      var seg = b.parentNode, k = seg.getAttribute("data-set");
      seg.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
      var v = b.value;
      RK.app.saveSettings(prop(k, (k === "holdMs" || k === "decimals") ? +v : v));
    });
    $("set-target").addEventListener("change", function () {
      var v = parseFloat(this.value.replace(",", "."));
      RK.app.saveSettings({ target: v > 0 && v < 3600 ? Math.round(v * 1000) : null });
      this.value = v > 0 && v < 3600 ? String(v) : "";
    });
  }

  function prop(k, v) { var o = {}; o[k] = v; return o; }

  /* ---------------------------------------------------------------
     Wiring: one delegated listener per surface
     --------------------------------------------------------------- */
  function init() {
    bindSettings();

    $("side").addEventListener("click", function (e) {
      var row = e.target.closest(".solve-row");
      if (row) { openSolve(+row.getAttribute("data-idx")); return; }
      if (e.target.closest("[data-more]")) { listLimit += LIST_PAGE; renderList(); return; }
      var a = e.target.closest("[data-avg]");
      if (a) openAverage(+a.getAttribute("data-avg"), a.getAttribute("data-which"));
    });

    $("stats-body").addEventListener("click", function (e) {
      var r = e.target.closest("[data-range]");
      if (r) {
        trendRange = +r.getAttribute("data-range");
        r.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === r); });
        drawStatsCharts();
        return;
      }
      var a = e.target.closest("[data-avg]");
      if (a) openAverage(+a.getAttribute("data-avg"), a.getAttribute("data-which"));
    });

    $("solve-body").addEventListener("click", function (e) {
      var pen = e.target.closest("[data-pen] button");
      if (pen) {
        var idx = +pen.parentNode.getAttribute("data-pen");
        RK.app.setPenalty(idx, pen.value === "ok" ? null : pen.value);
        openSolve(idx);
        return;
      }
      var del = e.target.closest("[data-del]");
      if (del) { RK.sheets.close(); RK.app.deleteSolve(+del.getAttribute("data-del")); return; }
      var row = e.target.closest(".avg-row");
      if (row) openSolve(+row.getAttribute("data-idx"));
    });
    $("solve-body").addEventListener("change", function (e) {
      if (e.target.matches("[data-note]")) RK.app.setComment(+e.target.getAttribute("data-note"), e.target.value.trim());
    });

    $("event-grid").addEventListener("click", function (e) {
      var b = e.target.closest("[data-event]");
      if (!b) return;
      RK.sheets.close();
      RK.app.setEvent(b.getAttribute("data-event"));
    });

    /* Copy buttons anywhere carry their text in data-copy. */
    document.addEventListener("click", function (e) {
      var c = e.target.closest("[data-copy]");
      if (c) copy(c.getAttribute("data-copy"));
    });

    var resizeT = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        if (!RK.timer.busy()) renderSide();
        if (RK.sheets.current() === $("sheet-stats")) drawStatsCharts();
      }, 150);
    });
  }

  function copy(text) {
    function done() { RK.sheets.toast("Copied"); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; }
    } catch (e) {}
    fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  return {
    init: init,
    renderSide: renderSide,
    resetList: function () { listLimit = LIST_PAGE; },
    openSolve: openSolve,
    openStats: openStats,
    refreshStats: function () { if (RK.sheets.current() === $("sheet-stats")) renderStats(); },
    openEvents: openEvents,
    openSettings: openSettings,
    copy: copy
  };
})();
