/* ============================================================
   KomyutApp — one route, in full

   Opened from anywhere a route appears. It draws the line on the map,
   shows what the community has said about it, reads the weather along it,
   and carries the comments.

   The order of the page is the order somebody asks the questions in:
   where does it go, what does it cost, can I trust it, what is the sky
   doing, what do people say. The comments are last because they are the
   longest and because everything above them is the answer most people
   came for.
   ============================================================ */
var KM = KM || {};

KM.detail = (function () {
  "use strict";

  var sheet, body, titleEl;
  var current = null;          // the route being shown
  var talkEl = null;           // the comments block of the page now rendered
  var onClose = null;

  function init() {
    sheet = KM.el("detail");
    body = KM.el("detail-body");
    titleEl = KM.el("detail-title");

    KM.glyph(KM.el("detail-back"), "back");
    KM.glyph(KM.el("detail-report"), "flag");

    KM.el("detail-back").addEventListener("click", close);
    KM.el("detail-report").addEventListener("click", function () {
      if (current) report(current);
    });
  }

  /* ---------------------------------------------------------
     Opening
     --------------------------------------------------------- */
  function open(route, opts) {
    opts = opts || {};
    onClose = opts.onClose || null;
    sheet.hidden = false;
    titleEl.textContent = route.name || "Route";
    KM.ui.spinner(body, "Opening the route…");

    /* The list version of a route has no path, so a detail view always
       re-reads the full row. It is one request and it is the difference
       between a line on the map and an apology. */
    KM.routes.get(route.id).then(function (full) {
      if (!full) { KM.ui.empty(body, "That route is gone."); return; }
      current = full;
      draw(full);
      render(full);
    }, function (err) {
      KM.ui.failure(body, err, function () { open(route, opts); });
    });
  }

  function close() {
    sheet.hidden = true;
    current = null;
    talkEl = null;
    KM.map.clear("route");
    if (onClose) { var f = onClose; onClose = null; f(); }
  }

  function isOpen() { return sheet && !sheet.hidden; }

  /* ---------------------------------------------------------
     On the map
     --------------------------------------------------------- */
  function draw(route) {
    KM.map.clear("route");
    KM.map.clear("plan");
    KM.map.clear("build");

    KM.map.line("route", route.path, { style: "route", weight: 7 });

    (route.stops || []).forEach(function (st, i) {
      var first = i === 0, last = i === route.stops.length - 1;
      KM.map.dot("route", st, {
        text: first ? "A" : (last ? "B" : String(i)),
        colour: first ? "#2E7D4F" : (last ? "#B4562B" : "#2F6FBF"),
        size: first || last ? 28 : 20,
        title: st.name || "",
        z: first || last ? 500 : 0
      });
    });

    KM.map.fit(route.path, { bottom: 120 });
  }

  /* ---------------------------------------------------------
     The page
     --------------------------------------------------------- */
  function render(route) {
    body.textContent = "";

    /* --- what it is --- */
    var head = KM.mk("section", "km-d-head");
    var line1 = KM.mk("div", "km-d-line");
    line1.appendChild(KM.ui.typeChip(route.route_type));
    if (route.validated) {
      line1.appendChild(KM.ui.validatedTag());
      var vI = KM.mk("button", "km-i");
      vI.type = "button";
      vI.setAttribute("data-info", "validated");
      vI.setAttribute("aria-label", "What the validated tag means");
      line1.appendChild(vI);
    }
    head.appendChild(line1);

    head.appendChild(KM.mk("h2", "km-d-name", route.name));

    var od = KM.mk("p", "km-d-od");
    od.appendChild(KM.mk("span", "km-d-from", route.origin_name));
    od.appendChild(KM.ui.icon("chevron", "km-card-arrow"));
    od.appendChild(KM.mk("span", "km-d-to", route.destination_name));
    head.appendChild(od);

    var facts = KM.mk("div", "km-d-facts");
    fact(facts, "route", KM.fmtDist(route.distance_m));
    fact(facts, "clock", KM.fmtDur(route.duration_s) + " by car");
    var fare = KM.fmtFare(route.fare_min, route.fare_max, route.currency);
    if (fare) fact(facts, "money", fare);
    if (route.city) fact(facts, "pin", route.city);
    head.appendChild(facts);
    body.appendChild(head);

    /* --- what the community says --- */
    var verdict = KM.mk("section", "km-d-block");
    var vrow = KM.mk("div", "km-d-verdict");
    vrow.appendChild(KM.ui.meter(route, { detail: true }));

    var voteHolder = KM.mk("div", "km-d-vote");
    vrow.appendChild(voteHolder);
    verdict.appendChild(vrow);

    if (route.validated && route.validated_note) {
      verdict.appendChild(KM.mk("p", "km-d-note", route.validated_note));
    }

    var why = KM.mk("p", "km-hint");
    why.appendChild(document.createTextNode("Up means it still runs this way. Down means it does not. "));
    var iBtn = KM.mk("button", "km-i");
    iBtn.type = "button";
    iBtn.setAttribute("data-info", "reliability");
    iBtn.setAttribute("aria-label", "What the meter means");
    why.appendChild(iBtn);
    verdict.appendChild(why);
    body.appendChild(verdict);

    KM.routes.myVotes([route.id]).then(function (mine) {
      var v = KM.ui.voter({
        myVote: mine[route.id] || 0,
        upvotes: route.upvotes, downvotes: route.downvotes,
        onVote: function (val) { return KM.routes.vote(route.id, val); }
      });
      voteHolder.textContent = "";
      voteHolder.appendChild(v.node);
    });

    /* --- what the author said --- */
    if (route.description) {
      var desc = KM.mk("section", "km-d-block");
      desc.appendChild(KM.mk("h3", "km-h3", "Notes"));
      /* Paragraph by paragraph, as text. The body was cleaned on the way
         in and it is still only ever text on the way out. */
      route.description.split(/\n{2,}/).forEach(function (para) {
        desc.appendChild(KM.mk("p", "km-d-para", para));
      });
      body.appendChild(desc);
    }

    /* --- the stops --- */
    var stopsBlock = KM.mk("section", "km-d-block");
    stopsBlock.appendChild(KM.mk("h3", "km-h3", "Stops, in order"));
    var ol = KM.mk("ol", "km-d-stops");
    (route.stops || []).forEach(function (st, i) {
      var li = KM.mk("li", "km-d-stop");
      li.appendChild(KM.mk("span", "km-d-stop-n", String(i + 1)));
      var btn = KM.mk("button", "km-d-stop-name", st.name || ("Stop " + (i + 1)));
      btn.type = "button";
      btn.addEventListener("click", function () { KM.map.centreOn(st, 16); });
      li.appendChild(btn);
      ol.appendChild(li);
    });
    stopsBlock.appendChild(ol);
    body.appendChild(stopsBlock);

    /* --- the sky along it --- */
    var wxBlock = KM.mk("section", "km-d-block");
    wxBlock.appendChild(KM.mk("h3", "km-h3", "Weather along the line"));
    var wxHint = KM.mk("p", "km-hint");
    wxHint.appendChild(document.createTextNode("Forecast for each stretch at the hour you would reach it. "));
    var wxI = KM.mk("button", "km-i");
    wxI.type = "button";
    wxI.setAttribute("data-info", "weather");
    wxI.setAttribute("aria-label", "How the forecast is worked out");
    wxHint.appendChild(wxI);
    wxBlock.appendChild(wxHint);
    var wxRow = KM.mk("div", "km-wx-row");
    wxBlock.appendChild(wxRow);
    body.appendChild(wxBlock);
    loadWeather(route, wxRow);

    /* --- yours to edit --- */
    var me = KM.supa.userId();
    if (me && route.author_id === me) {
      var own = KM.mk("section", "km-d-block km-d-own");
      own.appendChild(KM.mk("h3", "km-h3", "This one is yours"));
      var row = KM.mk("div", "km-row km-row-wrap");

      var edit = KM.mk("button", "km-btn km-btn-ghost", "Edit in the builder");
      edit.type = "button";
      edit.addEventListener("click", function () {
        close();
        KM.builder.load(route);
        KM.app.openTab("build");
      });
      row.appendChild(edit);

      var del = KM.mk("button", "km-btn km-btn-danger", "Delete");
      del.type = "button";
      del.addEventListener("click", function () {
        if (!window.confirm("Delete this route? Its comments and votes go with it.")) return;
        KM.routes.remove(route.id).then(function () {
          KM.app.toast("Route deleted.");
          close();
          KM.browse.refresh();
        }, function (err) { KM.app.toast(err.message); });
      });
      row.appendChild(del);
      own.appendChild(row);
      body.appendChild(own);
    }

    /* --- moderators only ---
       The block is put in place BEFORE the comments are, and filled in
       when the answer arrives, so a slow reply cannot land the moderator
       controls underneath a thread. */
    var modHolder = KM.mk("section", "km-d-block km-d-mod");
    modHolder.hidden = true;
    body.appendChild(modHolder);

    KM.account.isModerator().then(function (isMod) {
      if (!isMod || !isOpen() || current !== route) return;
      modHolder.hidden = false;
      modHolder.appendChild(KM.mk("h3", "km-h3", "Moderator"));
      var btn = KM.mk("button", "km-btn km-btn-ghost",
        route.validated ? "Remove the validated tag" : "Mark as validated");
      btn.type = "button";
      btn.addEventListener("click", function () {
        btn.disabled = true;
        var note = route.validated ? null : window.prompt("A line about what you checked (optional):", "");
        KM.routes.setValidated(route.id, !route.validated, note).then(function (updated) {
          btn.disabled = false;
          if (updated) { current = updated; render(updated); KM.app.toast("Saved."); }
        }, function (err) { btn.disabled = false; KM.app.toast(err.message); });
      });
      modHolder.appendChild(btn);
    }, function () {});

    /* --- the conversation --- */
    /* Held as a reference rather than found by id: the whole detail body
       is rebuilt on every open, so an id lookup would be a race between
       the comments arriving and the page they belong to still existing. */
    talkEl = KM.mk("section", "km-d-block km-d-talk");
    talkEl.appendChild(KM.mk("h3", "km-h3", "Comments"));
    body.appendChild(talkEl);
    loadComments(route);
  }

  function fact(into, iconName, text) {
    if (!text) return;
    var f = KM.mk("span", "km-d-fact");
    f.appendChild(KM.ui.icon(iconName));
    f.appendChild(KM.mk("span", null, text));
    into.appendChild(f);
  }

  /* ---------------------------------------------------------
     Weather
     --------------------------------------------------------- */
  function loadWeather(route, into) {
    KM.ui.spinner(into, "Reading the sky…");

    /* Six points along the line, each stamped with when you would reach it
       leaving now and riding it end to end. Six rather than twenty: this is
       a strip somebody glances at, not a meteorological record. */
    var total = route.distance_m || 1;
    var pts = KM.router.sample(route.path, Math.max(1500, total / 5));
    if (pts.length > 6) {
      var keep = [], step = (pts.length - 1) / 5;
      for (var i = 0; i < 6; i++) keep.push(pts[Math.round(i * step)]);
      pts = keep;
    }
    var start = Date.now();
    var checkpoints = pts.map(function (p) {
      return {
        lat: p.lat, lon: p.lon,
        eta: new Date(start + (p.along / total) * (route.duration_s || 0) * 1000)
      };
    });

    KM.weather.forecast(checkpoints).then(function (done) {
      if (!isOpen() || current !== route) return;
      into.textContent = "";
      done.forEach(function (c) {
        into.appendChild(wxChip(c));
        /* And on the map, so the strip and the line agree. */
        var sev = KM.weather.severity(c.wx);
        KM.map.dot("route", c, {
          className: "km-mark-wx km-sev-" + sev.id,
          icon: null,
          text: c.wx && !c.wx.outOfRange && c.wx.tempC != null ? Math.round(c.wx.tempC) + "°" : "?",
          colour: "#FFFFFF",
          size: 30
        });
      });
    }, function () {
      if (!isOpen() || current !== route) return;
      KM.ui.empty(into, "No forecast just now.");
    });
  }

  function wxChip(c) {
    var wx = c.wx || { outOfRange: true };
    var sev = KM.weather.severity(wx);
    var chip = KM.mk("div", "km-wx km-sev-" + sev.id);

    var ic = KM.mk("span", "km-wx-icon");
    var d = KM.weather.describe(wx.code, wx.isDay);
    KM.glyph(ic, wx.outOfRange ? "cloud" : d.icon, "weather");
    ic.setAttribute("aria-hidden", "true");
    chip.appendChild(ic);

    chip.appendChild(KM.mk("span", "km-wx-temp",
      wx.outOfRange || wx.tempC == null ? "—" : Math.round(wx.tempC) + "°"));
    chip.appendChild(KM.mk("span", "km-wx-text", wx.outOfRange ? "No data" : d.text));
    chip.appendChild(KM.mk("span", "km-wx-time", KM.fmtTime(c.eta)));
    return chip;
  }

  /* ---------------------------------------------------------
     Comments
     --------------------------------------------------------- */
  function loadComments(route) {
    var talk = talkEl;
    if (!talk) return;

    /* Rebuild the whole block each time rather than patching it: a thread
       that is patched in six places is a thread with six ways to go out of
       step with the database. */
    talk.textContent = "";
    talk.appendChild(KM.mk("h3", "km-h3", "Comments"));

    if (KM.supa.signedIn()) {
      talk.appendChild(composer(route));
    } else {
      var prompt = KM.mk("p", "km-hint", "Sign in to join in. Reading needs no account.");
      talk.appendChild(prompt);
    }

    var list = KM.mk("div", "km-comments");
    talk.appendChild(list);
    KM.ui.spinner(list, "Loading comments…");

    KM.routes.comments(route.id, { sort: "top" }).then(function (rows) {
      if (!isOpen() || current !== route) return;
      if (!rows || !rows.length) { KM.ui.empty(list, "Nothing said yet."); return; }
      var ids = rows.map(function (r) { return r.id; });
      KM.routes.myCommentVotes(ids).then(function (mine) {
        list.textContent = "";
        rows.forEach(function (row) {
          list.appendChild(commentRow(route, row, mine[row.id] || 0));
        });
      });
    }, function (err) {
      if (!isOpen() || current !== route) return;
      KM.ui.failure(list, err, function () { loadComments(route); });
    });
  }

  function composer(route) {
    var box = KM.mk("div", "km-composer");
    var ta = document.createElement("textarea");
    ta.className = "km-input km-textarea";
    ta.rows = 2;
    ta.maxLength = KM.sanitize.LIMITS.comment;
    ta.placeholder = "Is this still the route? Where does it wait?";
    box.appendChild(ta);

    var row = KM.mk("div", "km-row km-row-split");
    var count = KM.mk("span", "km-counter", "0 / " + KM.sanitize.LIMITS.comment);
    row.appendChild(count);

    var send = KM.mk("button", "km-btn km-btn-primary", "Post");
    send.type = "button";
    row.appendChild(send);
    box.appendChild(row);

    ta.addEventListener("input", function () {
      count.textContent = ta.value.length + " / " + KM.sanitize.LIMITS.comment;
    });

    send.addEventListener("click", function () {
      var text = ta.value;
      if (!KM.sanitize.block(text, KM.sanitize.LIMITS.comment)) {
        KM.app.toast("Write something first.");
        return;
      }
      send.disabled = true;
      KM.routes.comment(route.id, text).then(function () {
        send.disabled = false;
        ta.value = "";
        loadComments(route);
      }, function (err) {
        send.disabled = false;
        KM.app.toast(err.message);
      });
    });

    return box;
  }

  function commentRow(route, row, myVote) {
    var el = KM.mk("article", "km-comment");
    if (row.deleted) el.classList.add("is-gone");

    var head = KM.mk("p", "km-comment-head");
    var handle = (row.author && row.author.handle) || "someone";
    head.appendChild(KM.mk("span", "km-comment-who", "@" + handle));
    head.appendChild(KM.mk("span", "km-dot-sep"));
    head.appendChild(KM.mk("span", "km-comment-when", KM.fmtAgo(row.created_at)));
    if (row.updated_at && row.updated_at !== row.created_at && !row.deleted) {
      head.appendChild(KM.mk("span", "km-dot-sep"));
      head.appendChild(KM.mk("span", "km-comment-when", "edited"));
    }
    el.appendChild(head);

    el.appendChild(KM.mk("p", "km-comment-body", row.deleted ? "This comment was removed." : row.body));

    var foot = KM.mk("div", "km-comment-foot");
    if (!row.deleted) {
      var v = KM.ui.voter({
        myVote: myVote,
        upvotes: row.upvotes, downvotes: row.downvotes,
        onVote: function (val) { return KM.routes.voteComment(row.id, val); }
      });
      v.node.classList.add("km-vote-inline");
      foot.appendChild(v.node);
    }

    var me = KM.supa.userId();
    if (me && row.user_id === me && !row.deleted) {
      var del = KM.mk("button", "km-linkish", "Delete");
      del.type = "button";
      del.addEventListener("click", function () {
        if (!window.confirm("Delete this comment?")) return;
        KM.routes.deleteComment(row.id).then(function () {
          loadComments(route);
        }, function (err) { KM.app.toast(err.message); });
      });
      foot.appendChild(del);
    }
    el.appendChild(foot);
    return el;
  }

  /* ---------------------------------------------------------
     Reporting

     A report is not a comment: it goes to the moderators, only they and
     you can read it, and it does not start an argument in public.
     --------------------------------------------------------- */
  var REASONS = [
    ["not-real", "This route does not exist"],
    ["wrong-path", "The line is wrong"],
    ["outdated", "It does not run any more"],
    ["duplicate", "Somebody already filed this"],
    ["offensive", "The text is abusive"],
    ["other", "Something else"]
  ];

  function report(route) {
    if (!KM.supa.signedIn()) {
      KM.app.toast("Sign in to report a route.");
      KM.app.openTab("you");
      return;
    }
    var labels = REASONS.map(function (r, i) { return (i + 1) + ") " + r[1]; }).join("\n");
    var pick = window.prompt("Why are you reporting this route?\n\n" + labels + "\n\nType a number:", "1");
    if (!pick) return;
    var idx = parseInt(pick, 10) - 1;
    if (!(idx >= 0 && idx < REASONS.length)) { KM.app.toast("Not one of those."); return; }
    var detail = window.prompt("Anything to add? (optional)", "") || "";

    KM.routes.report(route.id, REASONS[idx][0], detail).then(function () {
      KM.app.toast("Reported. Thank you.");
    }, function (err) {
      KM.app.toast(err.kind === "conflict" ? "You already reported this one." : err.message);
    });
  }

  return { init: init, open: open, close: close, isOpen: isOpen };
})();
