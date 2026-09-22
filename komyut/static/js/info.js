/* ============================================================
   TheCommuters — the info sheet

   The same mechanism RouteCast uses (routecast/static/js/info.js), lifted
   with the namespace changed and its own topics: one sheet, one scrim, one
   registry, and clicks delegated from the document so markup that is
   rebuilt on every render costs nothing to wire and cannot go stale.

   The house rule it exists to serve: the pane says one line, and the
   paragraph lives behind a small (i) beside the thing it explains. Keeping
   the copy here rather than inline in index.html is not tidiness — it is
   the only way the same explanation can be reached from the browse pane,
   from a route's detail and from the planner without three copies of it
   drifting apart.

   Every topic body below is trusted HTML written in this file. Nothing off
   the network ever reaches this sheet.
   ============================================================ */
var KM = KM || {};

KM.info = (function () {
  "use strict";

  var TOPICS = {
    planner: {
      title: "How a trip is found",
      body:
        "<p>TheCommuters does not know any routes of its own. It chains together the ones " +
        "<b>people filed themselves</b> — so a trip is only as good as what the community " +
        "has written down for your area.</p>" +
        "<p>It looks for a route you can walk to, one you can walk from, and where necessary " +
        "the changes in between. Up to two changes, because three is a trip nobody takes.</p>" +
        "<p>Between two ways across, it prefers the one on routes people have <b>backed with " +
        "votes</b>, not merely the one that looks fastest on a map.</p>"
    },

    reliability: {
      title: "The reliability meter",
      body:
        "<p>How strongly the community has backed this route — not how many votes it has.</p>" +
        "<p>Ten up and nothing else is weaker evidence than two hundred up and three down, and " +
        "a plain ratio calls them identical. The meter asks instead: <i>given this many votes, " +
        "how low could the real approval plausibly be?</i> So a route earns confidence by being " +
        "voted on, not only by being voted on well.</p>" +
        "<p>It falls as a route ages without anybody confirming it, because routes change. " +
        "A <b>validated</b> route holds a floor — until the community votes against it, at " +
        "which point the floor gets out of the way.</p>" +
        "<p>For a trip with changes, the meter shows the <b>weakest leg</b>, not the average. " +
        "The weak one is the leg that strands you.</p>"
    },

    votes: {
      title: "What a vote means",
      body:
        "<p><b>Up</b> means this is still the route, and it still runs this way. <b>Down</b> " +
        "means it is wrong, or gone.</p>" +
        "<p>A route with more down than up sinks: it drops in searches and in every list, " +
        "rather than sitting politely in fourth place.</p>" +
        "<p>Pressing the arrow you already chose takes your vote back. One vote each, and " +
        "changing your mind is free.</p>"
    },

    building: {
      title: "Filing a route",
      body:
        "<p>List the places <b>in order</b>. The line between them draws itself along the real " +
        "roads, so you never trace anything.</p>" +
        "<p>Add a stop three ways: drop a pin on the map, search a place by name, or use where " +
        "you are standing — which is usually how a route gets filed, by somebody riding it.</p>" +
        "<p>The arrows on each stop move it up and down. The order is the route.</p>" +
        "<p>A half-finished route is kept on this phone, so closing the app does not lose it.</p>"
    },

    validated: {
      title: "The validated tag",
      body:
        "<p>Somebody trusted checked this route against the real line and said it matches.</p>" +
        "<p>It is not a score and it does not outrank the community: a validated route that " +
        "people have since voted down still falls, because the tag means <i>it was right when " +
        "it was checked</i>.</p>" +
        "<p>Only moderators can move it. The database refuses it to anybody else, so it cannot " +
        "be granted by a mistake in the app.</p>"
    },

    account: {
      title: "What an account is for",
      body:
        "<p>Reading needs no account at all. Search every route, open every one, read every " +
        "comment, plan every trip, signed out.</p>" +
        "<p>An account is for <b>writing</b>: filing a route, voting, and commenting — so " +
        "that a vote means one person and a route has somebody's name against it.</p>" +
        "<p>An email, a handle and a password is all of it. There is no profile to fill in.</p>" +
        "<p>Your <b>handle</b>, and every route and comment you post, are public. Your email " +
        "is not: nobody but you can read it.</p>" +
        "<p><b>Keep me signed in</b> remembers you on this device. Untick it on a phone that " +
        "is not yours, and closing the tab signs you out.</p>"
    },

    setup: {
      title: "The database is not set up",
      body:
        "<p>The app reached its Supabase project, but the project has no table or function " +
        "by that name. Signing in still works, because accounts live in Supabase itself; " +
        "everything else is refused.</p>" +
        "<p>The fix is on the project, not on this phone. In the Supabase dashboard:</p>" +
        "<p><b>1.</b> SQL Editor, New query: paste all of <b>supabase/schema.sql</b> and Run " +
        "it as one script. It is safe to run again.</p>" +
        "<p><b>2.</b> Run <b>supabase/verify.sql</b> the same way. Every row should say ok.</p>" +
        "<p><b>3.</b> Settings, Data API: <b>public</b> must be among the exposed schemas.</p>" +
        "<p>Then reload this page.</p>"
    },

    weather: {
      title: "Weather along the line",
      body:
        "<p>The forecast for each stretch of the route <b>at the hour you would reach it</b>, " +
        "not the forecast for right now and not the forecast for where it ends.</p>" +
        "<p>On a commute the useful question is whether the twenty minutes you spend standing " +
        "at the transfer are the twenty minutes the rain arrives.</p>" +
        "<p>It is taken as if you set off now and rode it end to end.</p>"
    },

    privacy: {
      title: "What leaves the phone",
      body:
        "<p><b>Where you are is not shared with anybody.</b> It is used to centre the map, to " +
        "start a trip from, and to place a stop when you ask. It is not sent to the community " +
        "database and it is not stored.</p>" +
        "<p>What is public is what you deliberately publish: a route you file, a vote you cast, " +
        "a comment you write, and the handle attached to them.</p>" +
        "<p>Your email address is never shown to anybody else.</p>" +
        "<p>Map tiles come from OpenStreetMap, the forecast from Open-Meteo, and place search " +
        "from Nominatim — each of which sees the coordinates it is asked about, as any map " +
        "app's would.</p>"
    },

    transfers: {
      title: "Changing rides",
      body:
        "<p>Almost nothing here is one ride. A change is found where two filed routes pass " +
        "within a short walk of each other, after you got on the first and before you get off " +
        "the second.</p>" +
        "<p>Each change costs a few minutes in the reckoning, because it is a wait and not just " +
        "a walk — which is why a single longer ride often wins over two quick ones.</p>"
    },

    update: {
      title: "Updates",
      body:
        "<p>TheCommuters installs its own copy so it opens instantly and works with no signal. " +
        "That copy is replaced when a new version is published.</p>" +
        "<p>A new version is never applied on its own — it waits, and the bar at the top " +
        "offers it. Reloading takes a second and keeps a half-finished route.</p>"
    }
  };

  var sheet = null, scrim = null, titleEl = null, bodyEl = null, lastFocus = null;

  function ensure() {
    if (sheet) return true;
    sheet = KM.el("info-sheet");
    scrim = KM.el("info-scrim");
    titleEl = KM.el("info-title");
    bodyEl = KM.el("info-body");
    return !!(sheet && titleEl && bodyEl);
  }

  function open(key) {
    if (!ensure()) return false;
    var topic = TOPICS[key];
    if (!topic) return false;
    try { lastFocus = document.activeElement; } catch (e) { lastFocus = null; }
    titleEl.textContent = topic.title;
    bodyEl.innerHTML = topic.body;
    sheet.hidden = false;
    var close = KM.el("info-close");
    if (close && close.focus) { try { close.focus(); } catch (e) {} }
    return true;
  }

  function close() {
    if (!ensure() || sheet.hidden) return false;
    sheet.hidden = true;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
    return true;
  }

  function init() {
    if (!ensure()) return;
    var closeBtn = KM.el("info-close");
    if (closeBtn) {
      KM.glyph(closeBtn, "close");
      closeBtn.addEventListener("click", close);
    }
    if (scrim) scrim.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    /* Delegated: the lists that carry these buttons are rebuilt from
       scratch on every render, and re-wiring them each time is how a
       button ends up doing nothing. */
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-info]") : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      open(btn.getAttribute("data-info"));
    });
    /* The (i) buttons carry no glyph in the markup, so one place decides
       what they look like. */
    paintButtons();
  }

  function paintButtons() {
    Array.prototype.forEach.call(document.querySelectorAll(".km-i"), function (b) {
      if (!b.innerHTML) KM.glyph(b, "info");
    });
  }

  return {
    init: init,
    open: open,
    close: close,
    paintButtons: paintButtons,
    has: function (key) { return !!TOPICS[key]; },
    /* For the harness: every data-info in the page must name a topic that
       exists, or it is a button that does nothing. */
    keys: function () { return Object.keys(TOPICS); }
  };
})();
