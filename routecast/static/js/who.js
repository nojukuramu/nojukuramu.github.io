/* ============================================================
   RouteCast — somebody on the map, tapped

   Three different things can be tapped on the map now: a rider in your own
   ride, a stranger on the public road, and a pin somebody dropped about the
   road. Each has its own actions — ride to a mate, beep a stranger, say a
   crash has cleared — but they are all answered the same way: one small card
   along the bottom of the screen, a face, a name, one line of facts, and a
   row of buttons.

   One card, not three, for the reason the info sheet is one sheet: three
   cards is three sets of positions, three Escape handlers and three ways of
   covering the dashboard, and the day one of them is changed the other two
   are not. The modules that own the things on the map (groupui.js, pubsui.js)
   describe what was tapped and what can be done about it; this draws it and
   gets out of the way.

   The card is pinned to the bottom, like the ways back, so it never sits on
   top of the marker it is describing. Tapping the map, Escape or the X all
   close it. An optional `ttl` closes it on its own — a "still there?" prompt
   that nobody answered is not left covering the road.
   ============================================================ */
var RC = RC || {};

RC.who = (function () {
  "use strict";

  var spec = null;
  var timer = null;
  var drawnActs = null;     // the buttons' markup as last written

  function el(id) { return RC.el(id); }

  function render() {
    var card = el("who-card");
    if (!card) return;
    if (!spec) { card.hidden = true; drawnActs = null; return; }

    var face = el("who-face");
    if (face) {
      face.innerHTML = spec.face || "";
      face.style.setProperty("--who", spec.color || "var(--matcha)");
    }
    var name = el("who-name");
    if (name) name.textContent = spec.name || "";
    var sub = el("who-sub");
    if (sub) sub.textContent = spec.sub || "";
    card.setAttribute("data-kind", spec.kind || "");

    // Built from the spec's own text through escapeHtml; the icons are ours.
    var html = "";
    var acts = spec.actions || [];
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      if (!a) continue;
      html += '<button type="button" class="rc-act' +
        (a.kind === "primary" ? " rc-act-primary" : a.kind === "danger" ? " rc-act-danger" : "") +
        '" data-who-act="' + i + '"' + (a.disabled ? " disabled" : "") + ">" +
        (a.icon ? RC.icons.ui(a.icon) : "") + RC.escapeHtml(a.label) + "</button>";
    }
    /* The card is refreshed on every fix while the rider it describes moves.
       Rewriting the buttons each time would replace the one under a thumb
       between press and release, and the tap would go nowhere — so they are
       only rewritten when they actually change. */
    var box = el("who-acts");
    if (box && html !== drawnActs) { box.innerHTML = html; box.hidden = !html; drawnActs = html; }
    card.hidden = false;
  }

  function open(s) {
    var fresh = !spec || spec.key !== s.key;
    spec = s;
    clearTimeout(timer);
    if (s.ttl) timer = setTimeout(function () { close(s.key); }, s.ttl);
    render();
    if (fresh) {
      var card = el("who-card");
      if (card) {
        // Restart the entrance so a second rider tapped reads as a new card.
        card.classList.remove("is-in");
        void card.offsetWidth;
        card.classList.add("is-in");
      }
    }
  }

  /** Change what an open card says without re-opening it — the rider it
      describes has moved, or the pin has been confirmed. A card showing
      something else is left alone. */
  function update(key, s) {
    if (!spec || spec.key !== key) return false;
    var ttl = spec.ttl;
    spec = s;
    spec.ttl = ttl;
    render();
    return true;
  }

  function close(key) {
    if (!spec) return;
    if (key && spec.key !== key) return;
    var was = spec;
    spec = null;
    clearTimeout(timer);
    render();
    if (typeof was.onClose === "function") { try { was.onClose(); } catch (e) {} }
  }

  function init(map) {
    var box = el("who-acts");
    if (box) box.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-who-act]") : null;
      if (!b || !spec) return;
      var a = (spec.actions || [])[+b.getAttribute("data-who-act")];
      if (!a || a.disabled) return;
      var key = spec.key;
      if (!a.keep) close(key);
      try { a.run(); } catch (err) {}
    });
    var x = el("who-close");
    if (x) x.addEventListener("click", function () { close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && spec) close();
    });
    // A tap on empty map is "never mind". Markers swallow their own clicks,
    // so tapping a second rider replaces the card rather than closing it.
    if (map) map.on("click", function () { close(); });
  }

  return {
    init: init,
    open: open,
    update: update,
    close: close,
    isOpen: function (key) { return !!spec && (!key || spec.key === key); },
    current: function () { return spec ? spec.key : null; }
  };
})();
