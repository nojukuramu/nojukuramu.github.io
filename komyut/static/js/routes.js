/* ============================================================
   TheCommuters — the community's routes, as data

   Everything that reads or writes a route, a vote, a comment or a profile
   goes through here. Nothing in this file touches the DOM, and nothing
   outside it talks to KM.supa about these tables — so there is exactly one
   place to look for "what does the app actually send", and exactly one
   place where the sanitiser is applied on the way out.

   The sanitiser being applied here rather than in the forms is deliberate.
   A form that forgets to clean a field is a bug you find in production; a
   data layer that cleans everything it is handed cannot forget. The
   database repeats the same limits as CHECK constraints, so this is the
   second of three lines rather than the only one.
   ============================================================ */
var KM = KM || {};

KM.routes = (function () {
  "use strict";

  var S = function () { return KM.sanitize; };

  /* The columns a list needs. `path` is deliberately not among them: a list
     of thirty routes carrying thirty polylines is a megabyte of JSON to
     draw a list of names. */
  var LIST_COLS = "id,name,route_type,description,origin_name,destination_name," +
    "city,country_code,fare_min,fare_max,currency,distance_m,duration_s," +
    "upvotes,downvotes,score,comment_count,validated,last_confirmed_at,created_at," +
    "author:profiles!routes_author_id_fkey(handle,display_name)";

  var FULL_COLS = LIST_COLS + ",path,stops,updated_at,validated_note,status,author_id";

  /* ---------------------------------------------------------
     Reading
     --------------------------------------------------------- */

  /* search({q, types, country, city, validatedOnly, sort, limit, offset})

     Ranking happens in the database (see search_routes in
     supabase/schema.sql) so that paging is consistent: a client that
     re-sorted page two by itself would show route #31 above route #3.
     KM.transit.rank exists for the cases where a list was NOT produced by
     the search function — the planner's candidates, mostly. */
  function search(opts) {
    opts = opts || {};
    var q = S().search(opts.q || "");
    var types = (opts.types || []).map(function (t) {
      return S().oneOf(t, KM.transit.ids());
    }).filter(Boolean);

    return KM.supa.rpc("search_routes", {
      q: q,
      types: types.length ? types : null,
      country: opts.country ? S().countryCode(opts.country) : null,
      city_q: opts.city ? S().line(opts.city, S().LIMITS.city) : null,
      only_validated: !!opts.validatedOnly,
      sort: S().oneOf(opts.sort || "best", ["best", "new", "top"]) || "best",
      max_rows: KM.clamp(opts.limit || 30, 1, 100),
      skip: Math.max(0, opts.offset || 0)
    }).then(function (rows) {
      return (rows || []).map(function (r) {
        /* The RPC returns the handle flat; the table query returns it
           nested. Normalise here so every consumer sees one shape. */
        r.author = { handle: r.author_handle, display_name: null };
        return r;
      });
    });
  }

  function get(id) {
    return KM.supa.from("routes").select(FULL_COLS).eq("id", id).single().run();
  }

  function byAuthor(userId, limit) {
    return KM.supa.from("routes").select(LIST_COLS)
      .eq("author_id", userId).order("created_at", true).limit(limit || 50).run();
  }

  /* Every route whose bounding box overlaps the area, with its path. This
     is what the journey planner plans from, and it is the one call in the
     app that can return a lot of data — hence the server-side cap and the
     deliberately tight box the planner asks for. */
  function inBbox(south, west, north, east, types) {
    return KM.supa.rpc("routes_in_bbox", {
      south: south, west: west, north: north, east: east,
      types: (types && types.length) ? types : null,
      max_rows: 300
    });
  }

  /* ---------------------------------------------------------
     Writing

     `draft` is what the builder holds: stops, a path, names, a type, a
     fare. Everything is cleaned here and anything that cannot be made
     valid is reported as a field error rather than sent and refused — a
     server-side CHECK violation reads as "invalid input syntax", which
     tells nobody which field to fix.
     --------------------------------------------------------- */
  function validate(draft) {
    var s = S();
    var errors = {};
    var out = {};

    out.name = s.line(draft.name, s.LIMITS.routeName);
    if (out.name.length < 3) errors.name = "Give the route a name people would search for.";

    out.route_type = s.oneOf(draft.route_type, KM.transit.ids());
    if (!out.route_type) errors.route_type = "Pick what kind of ride this is.";

    out.description = s.block(draft.description || "", s.LIMITS.routeDescription) || null;

    out.origin_name = s.line(draft.origin_name, s.LIMITS.placeName);
    out.destination_name = s.line(draft.destination_name, s.LIMITS.placeName);
    if (!out.origin_name) errors.origin_name = "Where does it start?";
    if (!out.destination_name) errors.destination_name = "Where does it end?";

    out.city = s.line(draft.city || "", s.LIMITS.city) || null;
    out.country_code = s.countryCode(draft.country_code || KM.config.DEFAULT_COUNTRY) || "PH";
    out.currency = s.oneOf((draft.currency || KM.config.DEFAULT_CURRENCY).toUpperCase(),
      ["PHP", "USD", "EUR", "JPY", "SGD", "MYR", "THB", "IDR", "VND", "AUD", "GBP"]) || "PHP";

    out.fare_min = s.fare(draft.fare_min);
    out.fare_max = s.fare(draft.fare_max);
    if (out.fare_min != null && out.fare_max != null && out.fare_max < out.fare_min) {
      var swap = out.fare_min; out.fare_min = out.fare_max; out.fare_max = swap;
    }

    /* Stops and path: every coordinate re-validated, because these came
       from a map the user dragged and from a router's reply. */
    var stops = (draft.stops || []).map(function (st) {
      var c = s.coord(st.lat, st.lon);
      if (!c) return null;
      return { lat: c.lat, lon: c.lon, name: s.line(st.name || "", s.LIMITS.placeName) };
    }).filter(Boolean);
    if (stops.length < s.LIMITS.stopsMin) errors.stops = "A route needs at least two stops.";
    if (stops.length > s.LIMITS.stopsMax) stops = stops.slice(0, s.LIMITS.stopsMax);
    out.stops = stops;

    var path = (draft.path || []).map(function (p) {
      var c = s.coord(p[0], p[1]);
      return c ? [c.lat, c.lon] : null;
    }).filter(Boolean);
    /* The database caps a path at 4000 points. A long route sampled at the
       router's own resolution can exceed that, so thin it rather than let
       the insert fail: dropping every other point on a 30 km line moves
       nothing a person can see at map zoom. */
    while (path.length > 4000) {
      path = path.filter(function (_, i) { return i % 2 === 0 || i === path.length - 1; });
    }
    if (path.length < 2) errors.path = "Draw the route on the map first.";
    out.path = path;

    out.distance_m = KM.clamp(Math.round(draft.distance_m || 0), 0, 2000000);
    out.duration_s = KM.clamp(Math.round(draft.duration_s || 0), 0, 604800);

    return { value: out, errors: errors, ok: Object.keys(errors).length === 0 };
  }

  function create(draft) {
    var checked = validate(draft);
    if (!checked.ok) return Promise.reject(fieldError(checked.errors));
    var me = KM.supa.userId();
    if (!me) return Promise.reject(KM.error("Sign in to file a route.", "auth"));

    var row = checked.value;
    row.author_id = me;
    return KM.supa.insert("routes", row, { select: FULL_COLS });
  }

  function save(id, draft) {
    var checked = validate(draft);
    if (!checked.ok) return Promise.reject(fieldError(checked.errors));
    return KM.supa.update("routes", { id: id }, checked.value);
  }

  function remove(id) {
    return KM.supa.remove("routes", { id: id });
  }

  function setStatus(id, status) {
    var st = S().oneOf(status, ["published", "hidden"]);
    if (!st) return Promise.reject(KM.error("Unknown status.", "invalid"));
    return KM.supa.update("routes", { id: id }, { status: st });
  }

  /* Moderator only; the database refuses it for anybody else, loudly, so
     there is no need to hide the button — only to explain the refusal. */
  function setValidated(id, on, note) {
    return KM.supa.update("routes", { id: id }, {
      validated: !!on,
      validated_note: note ? S().line(note, 200) : null
    });
  }

  function fieldError(errors) {
    var first = Object.keys(errors)[0];
    var e = KM.error(errors[first], "fields");
    e.fields = errors;
    return e;
  }

  /* ---------------------------------------------------------
     Votes
     --------------------------------------------------------- */

  /* v is 1, -1, or 0 to take it back. Returns the fresh counts so the UI
     shows what the database now holds rather than what it guessed. */
  function vote(routeId, v) {
    return KM.supa.rpc("cast_route_vote", { target: routeId, v: v })
      .then(function (rows) { return (rows || [])[0] || null; });
  }

  /* My vote on each of a list of routes, in one request, so a list of
     thirty does not make thirty calls. */
  function myVotes(routeIds) {
    var me = KM.supa.userId();
    if (!me || !routeIds.length) return Promise.resolve({});
    return KM.supa.from("route_votes").select("route_id,value")
      .eq("user_id", me).in("route_id", routeIds).run()
      .then(function (rows) {
        var map = {};
        (rows || []).forEach(function (r) { map[r.route_id] = r.value; });
        return map;
      })
      .catch(function () { return {}; });
  }

  /* ---------------------------------------------------------
     Comments
     --------------------------------------------------------- */
  var COMMENT_COLS = "id,route_id,body,upvotes,downvotes,score,deleted,created_at,updated_at,user_id," +
    "author:profiles!route_comments_user_id_fkey(handle,display_name)";

  function comments(routeId, opts) {
    opts = opts || {};
    var q = KM.supa.from("route_comments").select(COMMENT_COLS).eq("route_id", routeId);
    if (opts.sort === "top") q.order("score", true);
    q.order("created_at", opts.sort !== "old");
    return q.limit(opts.limit || 100).run();
  }

  function comment(routeId, body) {
    var me = KM.supa.userId();
    if (!me) return Promise.reject(KM.error("Sign in to comment.", "auth"));
    var text = S().block(body, S().LIMITS.comment);
    if (!text) return Promise.reject(KM.error("Write something first.", "invalid"));
    return KM.supa.insert("route_comments",
      { route_id: routeId, user_id: me, body: text }, { select: COMMENT_COLS });
  }

  function editComment(id, body) {
    var text = S().block(body, S().LIMITS.comment);
    if (!text) return Promise.reject(KM.error("Write something first.", "invalid"));
    return KM.supa.update("route_comments", { id: id }, { body: text });
  }

  /* A tombstone, not a delete: the thread above and below still reads in
     order, and the counters stay honest. */
  function deleteComment(id) {
    return KM.supa.update("route_comments", { id: id }, { deleted: true });
  }

  function voteComment(commentId, v) {
    return KM.supa.rpc("cast_comment_vote", { target: commentId, v: v })
      .then(function (rows) { return (rows || [])[0] || null; });
  }

  function myCommentVotes(ids) {
    var me = KM.supa.userId();
    if (!me || !ids.length) return Promise.resolve({});
    return KM.supa.from("comment_votes").select("comment_id,value")
      .eq("user_id", me).in("comment_id", ids).run()
      .then(function (rows) {
        var map = {};
        (rows || []).forEach(function (r) { map[r.comment_id] = r.value; });
        return map;
      })
      .catch(function () { return {}; });
  }

  /* ---------------------------------------------------------
     Reporting
     --------------------------------------------------------- */
  function report(routeId, reason, detail) {
    var me = KM.supa.userId();
    if (!me) return Promise.reject(KM.error("Sign in to report a route.", "auth"));
    var r = S().oneOf(reason, ["not-real", "wrong-path", "duplicate", "offensive", "outdated", "other"]);
    if (!r) return Promise.reject(KM.error("Pick a reason.", "invalid"));
    return KM.supa.insert("route_reports", {
      route_id: routeId, user_id: me, reason: r,
      detail: detail ? S().block(detail, 500) : null
    });
  }

  /* ---------------------------------------------------------
     Profiles
     --------------------------------------------------------- */
  function profile(userId) {
    return KM.supa.from("profiles")
      .select("id,handle,display_name,is_moderator,created_at")
      .eq("id", userId).single().run();
  }

  /* The signed-in member's own profile, made if it is missing. An account
     created before schema.sql was run has none, and without this it could
     sign in, "save" a handle that matched no row, and then be refused
     everywhere else with nothing on screen to say why. */
  function ensureProfile() {
    if (!KM.supa.userId()) return Promise.resolve(null);
    return KM.supa.rpc("ensure_profile", {}).then(function (rows) {
      return (rows || [])[0] || null;
    });
  }

  /* Whether somebody else already has this handle. Case-insensitive, as the
     column is citext. `null` means "could not tell", which the sign-up page
     treats as a shrug rather than a refusal: the database has the last word
     on uniqueness either way. */
  function handleTaken(handle) {
    var h = S().handle(handle);
    if (S().handleError(h)) return Promise.resolve(null);
    var me = KM.supa.userId();
    return KM.supa.from("profiles").select("id").eq("handle", h).limit(1).run()
      .then(function (rows) {
        return !!(rows && rows.length && rows[0].id !== me);
      }, function () { return null; });
  }

  function setHandle(handle, displayName) {
    var me = KM.supa.userId();
    if (!me) return Promise.reject(KM.error("Sign in first.", "auth"));
    var h = S().handle(handle);
    var err = S().handleError(h);
    if (err) return Promise.reject(KM.error(err, "invalid"));
    var patch = {
      handle: h,
      display_name: displayName ? S().line(displayName, S().LIMITS.displayName) : null
    };
    /* A PATCH that matches no row is a 200 with nothing in it, not an
       error — which is exactly how a missing profile used to pass for a
       saved handle. So an empty answer makes the profile and tries once
       more, and a second empty answer is reported as the failure it is. */
    return KM.supa.update("profiles", { id: me }, patch).then(function (row) {
      if (row) return row;
      return ensureProfile().then(function () {
        return KM.supa.update("profiles", { id: me }, patch);
      }).then(function (row2) {
        if (!row2) throw KM.error("Your profile could not be saved. Sign out and in again.", "missing");
        return row2;
      });
    });
  }

  return {
    LIST_COLS: LIST_COLS,
    search: search,
    get: get,
    byAuthor: byAuthor,
    inBbox: inBbox,
    validate: validate,
    create: create,
    save: save,
    remove: remove,
    setStatus: setStatus,
    setValidated: setValidated,
    vote: vote,
    myVotes: myVotes,
    comments: comments,
    comment: comment,
    editComment: editComment,
    deleteComment: deleteComment,
    voteComment: voteComment,
    myCommentVotes: myCommentVotes,
    report: report,
    profile: profile,
    ensureProfile: ensureProfile,
    handleTaken: handleTaken,
    setHandle: setHandle
  };
})();
