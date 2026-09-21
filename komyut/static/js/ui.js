/* ============================================================
   KomyutApp — the pieces every list is built from

   A route appears in four places: the browse list, the search results, the
   planner's itineraries and your own filed routes. They are the same
   object and they are shown the same way, so the card, the reliability
   meter, the vote control and the type chip are built here once.

   The rule that governs this whole file
   -------------------------------------
   **Nothing here ever assigns a community string to innerHTML.** Route
   names, descriptions, place names, handles and comments all reach the
   page through `textContent` (usually via KM.mk). innerHTML is used only
   for icons, which are constants defined in static/js/icons.js and never
   contain anything off the network. tools/validate.js checks this by
   reading the source, because "we were careful" is not a mechanism.
   ============================================================ */
var KM = KM || {};

KM.ui = (function () {
  "use strict";

  /* ---------------------------------------------------------
     Small parts
     --------------------------------------------------------- */
  function icon(name, cls) {
    var s = KM.mk("span", "km-ico" + (cls ? " " + cls : ""));
    KM.glyph(s, name);
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  function rideIcon(typeId, cls) {
    var s = KM.mk("span", "km-ico" + (cls ? " " + cls : ""));
    KM.glyph(s, KM.transit.type(typeId).icon, "ride");
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  function typeChip(typeId) {
    var t = KM.transit.type(typeId);
    var chip = KM.mk("span", "km-type");
    chip.appendChild(rideIcon(typeId));
    chip.appendChild(KM.mk("span", null, t.label));
    return chip;
  }

  /* The validated tag. Small, and it says what it means on hover and to a
     screen reader, because a badge nobody can interrogate is decoration. */
  function validatedTag() {
    var tag = KM.mk("span", "km-tag km-tag-validated");
    tag.appendChild(icon("shield"));
    tag.appendChild(KM.mk("span", null, "Validated"));
    tag.title = "Checked by a moderator against the real line.";
    return tag;
  }

  /* ---------------------------------------------------------
     The reliability meter

     Five segments, filled to the band the score falls in, plus the band's
     name in words. Deliberately not a percentage: the number underneath is
     a lower confidence bound on a vote ratio, and printing "62%" beside it
     would invite an argument about the 2.
     --------------------------------------------------------- */
  function meter(route, opts) {
    opts = opts || {};
    var score = KM.transit.reliability(route);
    var band = KM.transit.band(score);

    var wrap = KM.mk("div", "km-meter");
    wrap.setAttribute("data-band", band.id);

    var bar = KM.mk("div", "km-meter-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", "Reliability: " + band.label);
    for (var i = 0; i < 5; i++) {
      var seg = KM.mk("span", "km-meter-seg");
      if (score >= KM.transit.BANDS[Math.min(i, 4)].at && score > i * 0.2) seg.classList.add("is-on");
      bar.appendChild(seg);
    }
    wrap.appendChild(bar);

    var label = KM.mk("span", "km-meter-label", band.label);
    wrap.appendChild(label);

    if (opts.detail) {
      var n = (route.upvotes || 0) + (route.downvotes || 0);
      var why = n === 0
        ? "Nobody has voted on this yet."
        : KM.fmtCount(route.upvotes || 0) + " up, " + KM.fmtCount(route.downvotes || 0) + " down"
          + (route.last_confirmed_at ? ", last backed " + KM.fmtAgo(route.last_confirmed_at) : "");
      wrap.appendChild(KM.mk("p", "km-meter-why", why));
    }
    return wrap;
  }

  /* ---------------------------------------------------------
     The vote control

     Optimistic, but only in the direction the database will agree with:
     the arrow lights up immediately and the counts are replaced by
     whatever the server returns a moment later. A vote that fails puts the
     old state back and says why, rather than leaving an arrow lit for
     something that did not happen.
     --------------------------------------------------------- */
  function voter(opts) {
    var state = { my: opts.myVote || 0, up: opts.upvotes || 0, down: opts.downvotes || 0 };

    var wrap = KM.mk("div", "km-vote");
    var up = KM.mk("button", "km-vote-btn km-vote-up");
    up.type = "button";
    up.setAttribute("aria-label", "This route is right");
    up.appendChild(icon("up"));

    var count = KM.mk("span", "km-vote-count");
    var down = KM.mk("button", "km-vote-btn km-vote-down");
    down.type = "button";
    down.setAttribute("aria-label", "This route is wrong or gone");
    down.appendChild(icon("down"));

    wrap.appendChild(up);
    wrap.appendChild(count);
    wrap.appendChild(down);

    function paint() {
      count.textContent = KM.fmtCount(state.up - state.down);
      up.classList.toggle("is-on", state.my === 1);
      down.classList.toggle("is-on", state.my === -1);
      wrap.classList.toggle("is-negative", (state.up - state.down) < 0);
      count.title = KM.fmtCount(state.up) + " up, " + KM.fmtCount(state.down) + " down";
    }

    function cast(v) {
      if (!KM.supa.signedIn()) {
        KM.app.toast("Sign in to vote.");
        KM.app.openTab("you");
        return;
      }
      var before = { my: state.my, up: state.up, down: state.down };
      /* Pressing the arrow you already chose takes the vote back, which is
         the behaviour everybody expects from this control and which the
         database supports as v = 0. */
      var next = state.my === v ? 0 : v;

      state.my = next;
      state.up = before.up + (next === 1 ? 1 : 0) - (before.my === 1 ? 1 : 0);
      state.down = before.down + (next === -1 ? 1 : 0) - (before.my === -1 ? 1 : 0);
      paint();

      opts.onVote(next).then(function (fresh) {
        if (fresh) {
          state.up = fresh.upvotes; state.down = fresh.downvotes; state.my = fresh.my_vote;
          paint();
        }
      }, function (err) {
        state.my = before.my; state.up = before.up; state.down = before.down;
        paint();
        KM.app.toast(err.message);
      });
    }

    up.addEventListener("click", function (e) { e.stopPropagation(); cast(1); });
    down.addEventListener("click", function (e) { e.stopPropagation(); cast(-1); });

    paint();
    return { node: wrap, set: function (s) { state = s; paint(); } };
  }

  /* ---------------------------------------------------------
     A route, as a row in a list
     --------------------------------------------------------- */
  function routeCard(route, opts) {
    opts = opts || {};
    var card = KM.mk("article", "km-card");
    if (route.validated) card.classList.add("is-validated");
    if ((route.score || 0) < 0) card.classList.add("is-down");

    var main = KM.mk("button", "km-card-main");
    main.type = "button";

    var head = KM.mk("div", "km-card-head");
    head.appendChild(rideIcon(route.route_type, "km-card-ride"));
    head.appendChild(KM.mk("h3", "km-card-name", route.name));
    if (route.validated) head.appendChild(validatedTag());
    main.appendChild(head);

    var od = KM.mk("p", "km-card-od");
    od.appendChild(KM.mk("span", "km-card-from", route.origin_name));
    od.appendChild(icon("chevron", "km-card-arrow"));
    od.appendChild(KM.mk("span", "km-card-to", route.destination_name));
    main.appendChild(od);

    var facts = KM.mk("p", "km-card-facts");
    var bits = [];
    if (route.distance_m) bits.push(KM.fmtDist(route.distance_m));
    var fare = KM.fmtFare(route.fare_min, route.fare_max, route.currency);
    if (fare) bits.push(fare);
    if (route.city) bits.push(route.city);
    bits.forEach(function (b, i) {
      if (i) facts.appendChild(KM.mk("span", "km-dot-sep"));
      facts.appendChild(KM.mk("span", null, b));
    });
    main.appendChild(facts);

    main.appendChild(meter(route));

    var by = KM.mk("p", "km-card-by");
    var handle = (route.author && route.author.handle) || route.author_handle || "someone";
    by.appendChild(KM.mk("span", null, "@" + handle));
    by.appendChild(KM.mk("span", "km-dot-sep"));
    by.appendChild(KM.mk("span", null, KM.fmtAgo(route.created_at)));
    if (route.comment_count) {
      by.appendChild(KM.mk("span", "km-dot-sep"));
      by.appendChild(icon("chat", "km-tiny"));
      by.appendChild(KM.mk("span", null, KM.fmtCount(route.comment_count)));
    }
    main.appendChild(by);

    main.addEventListener("click", function () {
      if (opts.onOpen) opts.onOpen(route);
    });
    card.appendChild(main);

    if (opts.vote !== false) {
      var v = voter({
        myVote: opts.myVote || 0,
        upvotes: route.upvotes, downvotes: route.downvotes,
        onVote: function (val) { return KM.routes.vote(route.id, val); }
      });
      card.appendChild(v.node);
    }

    return card;
  }

  /* One short line where a list has nothing in it. The house rule: an
     empty state is one line, not a paragraph explaining itself. */
  function empty(node, text) {
    node.textContent = "";
    node.appendChild(KM.mk("p", "km-empty", text));
  }

  function spinner(node, text) {
    node.textContent = "";
    var p = KM.mk("p", "km-empty km-loading", text || "Loading…");
    node.appendChild(p);
  }

  /* An error, said plainly, with the one thing worth doing about it. */
  function failure(node, err, retry) {
    node.textContent = "";
    var box = KM.mk("div", "km-failure");
    box.appendChild(icon("alert"));
    box.appendChild(KM.mk("p", null, (err && err.message) || "Something went wrong."));
    if (retry) {
      var btn = KM.mk("button", "km-btn km-btn-ghost", "Try again");
      btn.type = "button";
      btn.addEventListener("click", retry);
      box.appendChild(btn);
    }
    node.appendChild(box);
  }

  return {
    icon: icon,
    rideIcon: rideIcon,
    typeChip: typeChip,
    validatedTag: validatedTag,
    meter: meter,
    voter: voter,
    routeCard: routeCard,
    empty: empty,
    spinner: spinner,
    failure: failure
  };
})();
