/* ============================================================
   TheCommuters — searching what the community has filed

   A search box, a row of ride-type chips, three orderings and a switch for
   the validated tag. The ranking itself is not here — it is in the
   `search_routes` function in supabase/schema.sql — deliberately, because
   ranking in the client breaks the moment there is a second page: a client
   that re-sorted page two by itself would put route thirty-one above route
   three and nobody could tell why.

   What the client does own is the debounce, the paging, and the rule that
   a search with nothing typed is still a useful screen: it shows the
   best-backed routes near where the map is looking rather than an empty
   box with an explanation in it.
   ============================================================ */
var KM = KM || {};

KM.browse = (function () {
  "use strict";

  var PAGE = 20;

  var qEl, listEl, emptyEl, moreEl, clearEl, typesEl, sortEl, validatedEl;
  var state = { q: "", types: [], sort: "best", validatedOnly: false, offset: 0 };
  var loading = false;
  var token = 0;

  function init() {
    qEl = KM.el("browse-q");
    listEl = KM.el("browse-results");
    emptyEl = KM.el("browse-empty");
    moreEl = KM.el("browse-more");
    clearEl = KM.el("browse-clear");
    typesEl = KM.el("browse-types");
    sortEl = KM.el("browse-sort");
    validatedEl = KM.el("browse-validated");

    KM.glyph(KM.el("browse-search-icon"), "search");
    KM.glyph(clearEl, "close");

    buildTypeChips();

    qEl.addEventListener("input", KM.debounce(function () {
      clearEl.hidden = !qEl.value;
      restart();
    }, 400));
    qEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); restart(); }
    });
    clearEl.addEventListener("click", function () {
      qEl.value = "";
      clearEl.hidden = true;
      restart();
      try { qEl.focus(); } catch (e) {}
    });

    sortEl.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-sort]");
      if (!btn) return;
      Array.prototype.forEach.call(sortEl.querySelectorAll("button"), function (b) {
        b.classList.toggle("is-on", b === btn);
      });
      state.sort = btn.getAttribute("data-sort");
      restart();
    });

    validatedEl.addEventListener("change", function () {
      state.validatedOnly = validatedEl.checked;
      restart();
    });

    moreEl.addEventListener("click", function () { load(false); });
  }

  /* The chips are built from KM.transit.TYPES rather than written into the
     markup, so adding a route type is one line in one file and every place
     that offers a choice of them gains it at once. */
  function buildTypeChips() {
    typesEl.textContent = "";
    KM.transit.TYPES.forEach(function (t) {
      if (t.id === "walk") return;    // nobody searches for a walk
      var chip = KM.mk("button", "km-chip");
      chip.type = "button";
      chip.setAttribute("data-type", t.id);
      chip.setAttribute("aria-pressed", "false");
      var ic = KM.mk("span", "km-chip-icon");
      KM.glyph(ic, t.icon, "ride");
      ic.setAttribute("aria-hidden", "true");
      chip.appendChild(ic);
      chip.appendChild(KM.mk("span", null, t.label));
      chip.addEventListener("click", function () {
        var on = chip.classList.toggle("is-on");
        chip.setAttribute("aria-pressed", on ? "true" : "false");
        state.types = Array.prototype.map.call(
          typesEl.querySelectorAll(".km-chip.is-on"),
          function (c) { return c.getAttribute("data-type"); });
        restart();
      });
      typesEl.appendChild(chip);
    });
  }

  function restart() {
    state.q = qEl.value;
    state.offset = 0;
    listEl.textContent = "";
    load(true);
  }

  function load(first) {
    if (loading) return;
    if (!KM.supa.ready()) {
      emptyEl.hidden = false;
      emptyEl.textContent = "Not connected to a community database yet.";
      moreEl.hidden = true;
      return;
    }
    loading = true;
    var mine = ++token;

    emptyEl.hidden = true;
    moreEl.hidden = true;
    if (first) KM.ui.spinner(listEl, "Looking…");

    KM.routes.search({
      q: state.q,
      types: state.types,
      sort: state.sort,
      validatedOnly: state.validatedOnly,
      limit: PAGE,
      offset: state.offset
    }).then(function (rows) {
      if (mine !== token) return;
      loading = false;
      if (first) listEl.textContent = "";

      if (!rows.length && first) {
        emptyEl.hidden = false;
        emptyEl.textContent = state.q
          ? "Nothing matches that yet. Filing it yourself takes a minute."
          : "No routes here yet. Be the first to file one.";
        return;
      }

      state.offset += rows.length;
      moreEl.hidden = rows.length < PAGE;
      paint(rows);
    }, function (err) {
      if (mine !== token) return;
      loading = false;
      if (first) KM.ui.failure(listEl, err, restart);
      else KM.app.toast(err.message);
    });
  }

  function paint(rows) {
    /* One request for every vote of mine in this page, rather than one per
       card. Twenty cards is twenty requests otherwise, on a phone, on
       mobile data, for a row of arrows. */
    KM.routes.myVotes(rows.map(function (r) { return r.id; })).then(function (mine) {
      rows.forEach(function (route) {
        listEl.appendChild(KM.ui.routeCard(route, {
          myVote: mine[route.id] || 0,
          onOpen: openRoute
        }));
      });
    });
  }

  function openRoute(route) {
    KM.detail.open(route, {
      onClose: function () {
        /* Back to the list, with the map where the list left it. */
        KM.app.openTab("browse");
      }
    });
  }

  function refresh() {
    if (!listEl) return;
    restart();
  }

  /* Called when the pane is shown. The first visit loads; later visits keep
     whatever was on screen, because re-running a search somebody scrolled
     through is the fastest way to lose their place. */
  var everLoaded = false;
  function activate() {
    if (everLoaded) return;
    everLoaded = true;
    load(true);
  }

  return { init: init, activate: activate, refresh: refresh, open: openRoute };
})();
