/* ============================================================
   KomyutApp — the Supabase client, written out rather than vendored

   Supabase publishes a JavaScript SDK. It is not used here, and that is a
   decision rather than an oversight: the house rule in this repository is
   no build step, no bundler, and dependencies vendored as files a person
   can open and read. The official SDK is a bundled ESM package that pulls
   in a realtime client, a storage client and a websocket layer this app
   never touches, and it would arrive as a minified blob nobody reviews.

   What this app actually needs from Supabase is two ordinary REST APIs:

     * **PostgREST** at /rest/v1 — every table read and write, expressed as
       query parameters. `?select=`, `?id=eq.x`, `?order=score.desc`.
     * **GoTrue** at /auth/v1 — sign up, sign in, refresh, sign out.

   Both are plain HTTP with JSON, and both are covered below in about the
   space the SDK's import statement would take. The query builder is
   deliberately small and chainable in the same shape the SDK uses, so the
   calling code in routes.js reads the way somebody who knows Supabase
   expects it to.

   Two things this file guarantees, and the reason it is the only module
   allowed to speak to the database:

     1. **Values are never interpolated into a filter unescaped.** Every
        filter value goes through encodeURIComponent, and a value that
        contains PostgREST's own syntax (a comma, a parenthesis) is quoted
        so it stays one value. Combined with sanitize.js on the way in and
        parameterised RPCs in the schema, there is no path from a text field
        to a query the server parses as structure.
     2. **The access token is attached in one place.** Nothing else in the
        app reads the session, so there is no second code path that could
        forget to send it — or, worse, send it somewhere that is not the
        Supabase origin.
   ============================================================ */
var KM = KM || {};

KM.supa = (function () {
  "use strict";

  var SESSION_KEY = "session";
  /* Refresh a minute before the token actually dies. A request that fails
     on an expired token is a bug the user sees as "it randomly logged me
     out", and it is entirely avoidable. */
  var REFRESH_MARGIN_MS = 60 * 1000;

  var session = null;      // { access_token, refresh_token, expires_at, user }
  var refreshing = null;   // in-flight refresh, so ten calls share one
  var listeners = [];

  function base() { return String(KM.config.SUPABASE_URL || "").replace(/\/+$/, ""); }
  function key() { return KM.config.SUPABASE_ANON_KEY || ""; }
  function ready() { return KM.config.ready(); }

  /* ---------------------------------------------------------
     Session storage

     The refresh token is the long-lived credential, and it lives in
     localStorage. That is the same trade every browser Supabase app makes
     — a token the page can read is a token a script injected into the page
     could read — and it is why this app's rule about innerHTML is not a
     style preference. The mitigation is upstream: no community string ever
     reaches the DOM as markup, and a Content-Security-Policy in index.html
     forbids inline and third-party script outright.
     --------------------------------------------------------- */
  function load() {
    var s = KM.store.get(SESSION_KEY, null);
    if (!s || !s.access_token || !s.refresh_token) return null;
    return s;
  }

  function save(s) {
    session = s;
    if (s) KM.store.set(SESSION_KEY, s);
    else KM.store.remove(SESSION_KEY);
    listeners.forEach(function (fn) { try { fn(session); } catch (e) {} });
  }

  function onChange(fn) {
    listeners.push(fn);
    try { fn(session); } catch (e) {}
  }

  function shapeSession(body) {
    if (!body || !body.access_token) return null;
    var ttl = Number(body.expires_in || 3600) * 1000;
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Date.now() + ttl,
      user: body.user ? { id: body.user.id, email: body.user.email } : (session && session.user) || null
    };
  }

  /* ---------------------------------------------------------
     The one request function
     --------------------------------------------------------- */
  function request(path, opts) {
    opts = opts || {};
    if (!ready()) {
      return Promise.reject(KM.error(
        "KomyutApp is not connected to a community database yet.", "unconfigured"));
    }

    var url = base() + path;
    var headers = { apikey: key(), Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.prefer) headers.Prefer = opts.prefer;

    /* Anonymous calls still send the anon key as the bearer — that is what
       PostgREST reads to decide the `anon` role, and it is what makes the
       read-only policies in the schema apply to a signed-out visitor. */
    var token = (opts.auth === false) ? key() : ((session && session.access_token) || key());
    headers.Authorization = "Bearer " + token;

    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeout || 15000);

    return fetch(url, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      var ct = res.headers.get("content-type") || "";
      var parse = ct.indexOf("json") !== -1
        ? res.json().catch(function () { return null; })
        : res.text().catch(function () { return null; });
      return parse.then(function (body) {
        if (res.ok) return { body: body, headers: res.headers, status: res.status };
        throw describe(res.status, body);
      });
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") throw KM.error("The request timed out.", "timeout");
      throw KM.error("Could not reach the community database.", "network");
    });
  }

  /* Turn a Postgres or GoTrue failure into something a person can act on.
     The raw messages are written for whoever wrote the schema, not for
     whoever is standing at a jeepney stop. */
  function describe(status, body) {
    var code = (body && (body.code || body.error_code)) || "";
    var raw = (body && (body.message || body.msg || body.error_description || body.error)) || "";

    if (code === "23505") return KM.error("That already exists.", "conflict", status, code);
    if (code === "23514") return KM.error("Some of that does not fit what the database allows.", "invalid", status, code);
    if (code === "42501" || status === 403) {
      return KM.error("You are not allowed to do that.", "forbidden", status, code);
    }
    if (status === 401) return KM.error("Please sign in again.", "auth", status, code);
    if (status === 404) return KM.error("Not found.", "missing", status, code);
    if (status === 429) return KM.error("Too many requests. Give it a moment.", "rate", status, code);
    if (status >= 500) return KM.error("The community database is having trouble.", "server", status, code);

    /* Known GoTrue words, mapped rather than shown: "Invalid login
       credentials" is fine, "AuthApiError: ..." is not. */
    if (/already registered|already been registered/i.test(raw)) {
      return KM.error("That email already has an account. Try signing in.", "conflict", status, code);
    }
    if (/invalid login credentials/i.test(raw)) {
      return KM.error("That email and password do not match.", "auth", status, code);
    }
    if (/password/i.test(raw) && /(short|least|6|characters)/i.test(raw)) {
      return KM.error("That password is too short.", "invalid", status, code);
    }
    if (/email/i.test(raw) && /confirm/i.test(raw)) {
      return KM.error("Check your email and confirm the address first.", "unconfirmed", status, code);
    }
    return KM.error(raw || ("Request failed (" + status + ")"), "http", status, code);
  }

  /* ---------------------------------------------------------
     Keeping the token alive
     --------------------------------------------------------- */
  function refresh() {
    if (!session || !session.refresh_token) return Promise.resolve(null);
    if (refreshing) return refreshing;
    refreshing = request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      auth: false,
      body: { refresh_token: session.refresh_token }
    }).then(function (r) {
      var s = shapeSession(r.body);
      save(s);
      refreshing = null;
      return s;
    }, function (err) {
      refreshing = null;
      /* A refresh token the server has forgotten is a signed-out session,
         not an error to show. Anything else (no network) leaves the session
         in place so the next attempt can still work. */
      if (err && (err.kind === "auth" || err.kind === "forbidden" || err.status === 400)) save(null);
      throw err;
    });
    return refreshing;
  }

  function fresh() {
    if (!session) return Promise.resolve(null);
    if (session.expires_at - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve(session);
    return refresh().catch(function () { return session; });
  }

  /* ---------------------------------------------------------
     PostgREST query builder

     A filter value has to survive PostgREST's own grammar: `name=eq.Cubao,
     Quezon City` would be read as two filters because of the comma. The fix
     is the one PostgREST documents — wrap the value in double quotes and
     backslash-escape any quote inside it — applied to every value here so
     no caller has to remember it.
     --------------------------------------------------------- */
  function quote(v) {
    var s = String(v);
    if (/[,.()"\\:]/.test(s) || s === "") {
      return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    return s;
  }

  function Query(table) {
    this.table = table;
    this.params = [];
    this._prefer = null;
    this._single = false;
  }

  Query.prototype._push = function (k, v) {
    this.params.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    return this;
  };

  Query.prototype.select = function (cols, opts) {
    this._push("select", cols || "*");
    if (opts && opts.count) this._prefer = "count=" + opts.count;
    return this;
  };
  Query.prototype.eq = function (col, v) { return this._push(col, "eq." + quote(v)); };
  Query.prototype.neq = function (col, v) { return this._push(col, "neq." + quote(v)); };
  Query.prototype.gt = function (col, v) { return this._push(col, "gt." + quote(v)); };
  Query.prototype.gte = function (col, v) { return this._push(col, "gte." + quote(v)); };
  Query.prototype.lt = function (col, v) { return this._push(col, "lt." + quote(v)); };
  Query.prototype.lte = function (col, v) { return this._push(col, "lte." + quote(v)); };
  Query.prototype.is = function (col, v) { return this._push(col, "is." + v); };
  Query.prototype.in = function (col, list) {
    return this._push(col, "in.(" + list.map(quote).join(",") + ")");
  };
  Query.prototype.order = function (col, desc) {
    return this._push("order", col + "." + (desc ? "desc" : "asc") + ".nullslast");
  };
  Query.prototype.limit = function (n) { return this._push("limit", String(Math.max(1, n | 0))); };
  Query.prototype.offset = function (n) { return this._push("offset", String(Math.max(0, n | 0))); };
  Query.prototype.single = function () { this._single = true; return this; };

  Query.prototype._url = function () {
    return "/rest/v1/" + this.table + (this.params.length ? "?" + this.params.join("&") : "");
  };

  Query.prototype.run = function () {
    var self = this;
    return fresh().then(function () {
      return request(self._url(), { prefer: self._prefer });
    }).then(function (r) {
      var rows = r.body || [];
      if (self._single) return rows.length ? rows[0] : null;
      return rows;
    });
  };

  /* Writes. `returning` defaults to the inserted rows, because almost every
     caller here wants the id the database chose. */
  function insert(table, row, opts) {
    opts = opts || {};
    return fresh().then(function () {
      return request("/rest/v1/" + table + (opts.select ? "?select=" + encodeURIComponent(opts.select) : ""), {
        method: "POST",
        body: row,
        prefer: "return=representation" + (opts.upsert ? ",resolution=merge-duplicates" : "")
      });
    }).then(function (r) {
      var rows = r.body || [];
      return Array.isArray(rows) ? (Array.isArray(row) ? rows : rows[0]) : rows;
    });
  }

  function update(table, match, patch) {
    var q = new Query(table);
    Object.keys(match).forEach(function (k) { q.eq(k, match[k]); });
    return fresh().then(function () {
      return request(q._url(), { method: "PATCH", body: patch, prefer: "return=representation" });
    }).then(function (r) { return (r.body || [])[0] || null; });
  }

  function remove(table, match) {
    var q = new Query(table);
    Object.keys(match).forEach(function (k) { q.eq(k, match[k]); });
    return fresh().then(function () {
      return request(q._url(), { method: "DELETE", prefer: "return=minimal" });
    }).then(function () { return true; });
  }

  /* An RPC is how anything that needs real logic is done: the search
     ranking, the vote that has to be atomic, the transfer lookup. The
     arguments are a JSON body, so they are parameters to a plpgsql function
     and never text the server parses as SQL. */
  function rpc(name, args) {
    return fresh().then(function () {
      return request("/rest/v1/rpc/" + encodeURIComponent(name), {
        method: "POST",
        body: args || {}
      });
    }).then(function (r) { return r.body; });
  }

  /* ---------------------------------------------------------
     Auth
     --------------------------------------------------------- */
  function signUp(email, password) {
    return request("/auth/v1/signup", {
      method: "POST", auth: false, body: { email: email, password: password }
    }).then(function (r) {
      var s = shapeSession(r.body);
      /* A project with email confirmation on returns a user and NO token.
         That is a success, and the caller has to say "check your email"
         rather than "signed in". */
      if (s) { save(s); return { session: s, confirmed: true }; }
      return { session: null, confirmed: false };
    });
  }

  function signIn(email, password) {
    return request("/auth/v1/token?grant_type=password", {
      method: "POST", auth: false, body: { email: email, password: password }
    }).then(function (r) {
      var s = shapeSession(r.body);
      if (!s) throw KM.error("Sign in did not return a session.", "auth");
      save(s);
      return s;
    });
  }

  function signOut() {
    var had = session;
    /* Clear locally FIRST. A logout that leaves the token in place because
       the network was down is a logout that did not happen. */
    save(null);
    if (!had) return Promise.resolve(true);
    return request("/auth/v1/logout", {
      method: "POST",
      body: {},
      timeout: 6000
    }).then(function () { return true; }, function () { return true; });
  }

  function resetPassword(email, redirectTo) {
    return request("/auth/v1/recover", {
      method: "POST", auth: false, body: { email: email, redirect_to: redirectTo }
    }).then(function () { return true; });
  }

  function updatePassword(password) {
    if (!session) return Promise.reject(KM.error("That reset link has expired. Ask for another.", "auth"));
    return request("/auth/v1/user", {
      method: "PUT", body: { password: password }
    }).then(function (r) { return r.body; });
  }

  /* ---------------------------------------------------------
     Coming back from a link in an email

     A confirmation or reset link goes to GoTrue, which verifies the token
     and then bounces the browser to the project's Site URL with the result
     in the FRAGMENT:

         .../komyut/#access_token=...&refresh_token=...&type=recovery

     or, when it went wrong:

         .../komyut/#error=access_denied&error_code=otp_expired&...

     The fragment is never sent to a server, which is why GoTrue uses it,
     and it is also why this has to be read here rather than anywhere else.

     Two things happen the moment it is read. The session is adopted, so
     somebody who just confirmed their address arrives signed in rather
     than being asked to type the password they only just chose. And the
     fragment is wiped from the address bar with replaceState, so the
     tokens are not left sitting in the URL, in the back/forward history,
     or in a screenshot of the address bar. --------------------------------------------------------- */
  function adoptFromUrl() {
    var raw = "";
    try { raw = String(location.hash || "").replace(/^#/, ""); } catch (e) { return null; }
    if (!raw || raw.indexOf("=") === -1) return null;

    var params = {};
    raw.split("&").forEach(function (pair) {
      var i = pair.indexOf("=");
      if (i === -1) return;
      try {
        params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, " "));
      } catch (e) {}
    });

    function clean() {
      try { history.replaceState(null, "", location.pathname + location.search); }
      catch (e) { try { location.hash = ""; } catch (e2) {} }
    }

    if (params.error || params.error_description) {
      clean();
      /* GoTrue's own wording is written for whoever built the project.
         The two that actually happen to people get a sentence each. */
      var code = params.error_code || "";
      var message = /expired/.test(code + " " + (params.error_description || ""))
        ? "That link has expired. Ask for a new one."
        : (/access_denied/.test(params.error || "")
            ? "That link has already been used."
            : "That link did not work. Ask for a new one.");
      return { error: message, code: code };
    }

    if (!params.access_token || !params.refresh_token) return null;

    save({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
      expires_at: Date.now() + (Number(params.expires_in || 3600) * 1000),
      user: null
    });
    clean();

    /* The user object does not come back in the fragment, only the tokens,
       so it is fetched once here. Everything downstream reads
       KM.supa.userId(), and a session with no id in it would fail every
       one of those quietly. */
    var landing = { type: params.type || "signin" };
    landing.ready = request("/auth/v1/user", { method: "GET" }).then(function (r) {
      if (r.body && r.body.id && session) {
        session.user = { id: r.body.id, email: r.body.email };
        save(session);
      }
      return landing;
    }, function () { return landing; });

    return landing;
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  var landing = null;

  function init() {
    /* The URL is read BEFORE storage: arriving on an email link should
       replace whatever session this browser was holding, not lose to it. */
    landing = adoptFromUrl();
    session = session || load();
    if (session) {
      listeners.forEach(function (fn) { try { fn(session); } catch (e) {} });
      /* Do not block the app on it; a stale token simply refreshes in the
         background and the header updates when it lands. */
      fresh().catch(function () {});
    }
  }

  return {
    init: init,
    ready: ready,
    from: function (table) { return new Query(table); },
    insert: insert,
    update: update,
    remove: remove,
    rpc: rpc,
    request: request,

    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    adoptFromUrl: adoptFromUrl,
    landing: function () { return landing; },
    refresh: refresh,
    onChange: onChange,
    session: function () { return session; },
    userId: function () { return session && session.user ? session.user.id : null; },
    signedIn: function () { return !!session; },

    /* Exposed for the validation harness, which checks that a value
       carrying PostgREST's own punctuation survives as one value. */
    _quote: quote
  };
})();
