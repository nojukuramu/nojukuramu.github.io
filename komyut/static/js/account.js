/* ============================================================
   KomyutApp — the account, and what it is for

   The login here is deliberately the smallest thing that answers the one
   question the app has to answer: is this person allowed to write. Email
   and a password, no social sign-in, no profile to fill in, no onboarding.
   Reading the whole database needs no account at all, and the pane says so
   before it asks for anything.

   What this module is careful about
   ---------------------------------
   * **The password field is never written down.** Not to storage, not to a
     variable that outlives the request, and it is cleared the moment the
     call returns either way.
   * **A failed sign-in does not say which half was wrong.** Supabase does
     not tell us, and the wording here does not invent a distinction: "that
     email and password do not match" is the whole truth and it does not
     confirm to a stranger that an address has an account.
   * **Signing out clears the session first and tells the server second.** A
     sign-out that leaves the token in place because the network was down
     is a sign-out that did not happen.
   ============================================================ */
var KM = KM || {};

KM.account = (function () {
  "use strict";

  var mode = "in";
  var profileCache = null;
  var els = {};

  function init() {
    els.out = KM.el("you-out");
    els.in = KM.el("you-in");
    els.email = KM.el("auth-email");
    els.password = KM.el("auth-password");
    els.go = KM.el("auth-go");
    els.err = KM.el("auth-err");
    els.note = KM.el("auth-note");
    els.modeEl = KM.el("auth-mode");
    els.handleInput = KM.el("you-handle-input");
    els.youErr = KM.el("you-err");
    els.routes = KM.el("you-routes");
    els.routesEmpty = KM.el("you-routes-empty");

    KM.glyph(KM.el("you-avatar"), "user");

    els.modeEl.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-mode]");
      if (!btn) return;
      setMode(btn.getAttribute("data-mode"));
    });

    els.go.addEventListener("click", submit);
    els.password.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });

    KM.el("auth-forgot").addEventListener("click", forgot);
    KM.el("auth-signout").addEventListener("click", signOut);
    KM.el("you-handle-save").addEventListener("click", saveHandle);

    KM.supa.onChange(function () {
      profileCache = null;
      paint();
    });
  }

  function setMode(next) {
    mode = next === "up" ? "up" : "in";
    Array.prototype.forEach.call(els.modeEl.querySelectorAll("button"), function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-mode") === mode);
    });
    els.go.textContent = mode === "up" ? "Create the account" : "Sign in";
    els.password.setAttribute("autocomplete", mode === "up" ? "new-password" : "current-password");
    els.err.hidden = true;
    els.note.hidden = true;
  }

  function submit() {
    var email = KM.sanitize.email(els.email.value);
    var password = els.password.value;

    els.err.hidden = true;
    els.note.hidden = true;

    if (!KM.sanitize.emailLooksValid(email)) { fail("That does not look like an email address."); return; }
    if (password.length < 8) {
      fail(mode === "up" ? "Use at least eight characters." : "That email and password do not match.");
      return;
    }
    if (!KM.supa.ready()) { fail("This app is not connected to a community database yet."); return; }

    els.go.disabled = true;
    els.go.textContent = mode === "up" ? "Creating…" : "Signing in…";

    var op = mode === "up" ? KM.supa.signUp(email, password) : KM.supa.signIn(email, password);

    op.then(function (result) {
      els.password.value = "";
      els.go.disabled = false;
      setMode(mode);

      if (mode === "up" && result && result.confirmed === false) {
        /* Email confirmation is on for this project. That is a success and
           has to read like one, or people try again and hit "already
           registered". */
        els.note.textContent = "Account made. Check your email to confirm the address, then sign in.";
        els.note.hidden = false;
        setMode("in");
        return;
      }
      KM.app.toast("Signed in.");
      paint();
      KM.browse.refresh();
    }, function (err) {
      els.password.value = "";
      els.go.disabled = false;
      setMode(mode);
      fail(err.message);
    });
  }

  function fail(msg) {
    els.err.textContent = msg;
    els.err.hidden = false;
  }

  function forgot() {
    var email = KM.sanitize.email(els.email.value);
    if (!KM.sanitize.emailLooksValid(email)) { fail("Type your email address first."); return; }
    KM.supa.resetPassword(email, location.href).then(function () {
      els.note.textContent = "If that address has an account, a reset link is on its way.";
      els.note.hidden = false;
      els.err.hidden = true;
    }, function (err) { fail(err.message); });
  }

  function signOut() {
    KM.supa.signOut().then(function () {
      profileCache = null;
      KM.app.toast("Signed out.");
      paint();
      KM.browse.refresh();
    });
  }

  /* ---------------------------------------------------------
     The signed-in half
     --------------------------------------------------------- */
  function paint() {
    if (!els.out) return;
    var signedIn = KM.supa.signedIn();
    els.out.hidden = signedIn;
    els.in.hidden = !signedIn;

    var btn = KM.el("account-btn");
    if (btn) {
      KM.glyph(btn, "user");
      btn.classList.toggle("is-on", signedIn);
      btn.setAttribute("aria-label", signedIn ? "Your account" : "Sign in");
    }

    var buildLocked = KM.el("build-locked");
    var buildForm = KM.el("build-form");
    if (buildLocked && buildForm) {
      buildLocked.hidden = signedIn;
      buildForm.hidden = !signedIn;
    }

    if (!signedIn) return;

    profile().then(function (p) {
      if (!p) return;
      KM.el("you-handle").textContent = "@" + p.handle;
      KM.el("you-sub").textContent = (p.is_moderator ? "Moderator · " : "") +
        "Joined " + KM.fmtAgo(p.created_at);
      els.handleInput.value = p.handle;
    }, function () {});

    loadMine();
  }

  function profile() {
    if (profileCache) return Promise.resolve(profileCache);
    var me = KM.supa.userId();
    if (!me) return Promise.resolve(null);
    return KM.routes.profile(me).then(function (p) {
      profileCache = p;
      return p;
    });
  }

  function isModerator() {
    return profile().then(function (p) { return !!(p && p.is_moderator); }, function () { return false; });
  }

  function saveHandle() {
    els.youErr.hidden = true;
    KM.routes.setHandle(els.handleInput.value, null).then(function (p) {
      profileCache = p;
      KM.app.toast("Handle saved.");
      paint();
    }, function (err) {
      els.youErr.textContent = err.kind === "conflict" ? "Somebody already has that handle." : err.message;
      els.youErr.hidden = false;
    });
  }

  function loadMine() {
    var me = KM.supa.userId();
    if (!me) return;
    els.routesEmpty.hidden = true;
    KM.ui.spinner(els.routes, "Loading…");
    KM.routes.byAuthor(me, 50).then(function (rows) {
      els.routes.textContent = "";
      if (!rows || !rows.length) {
        els.routesEmpty.hidden = false;
        els.routesEmpty.textContent = "Nothing yet. The Build tab is where routes start.";
        return;
      }
      rows.forEach(function (r) {
        els.routes.appendChild(KM.ui.routeCard(r, {
          vote: false,
          onOpen: function (route) {
            KM.detail.open(route, { onClose: function () { KM.app.openTab("you"); } });
          }
        }));
      });
    }, function (err) {
      KM.ui.failure(els.routes, err, loadMine);
    });
  }

  function activate() { paint(); }

  return {
    init: init,
    activate: activate,
    paint: paint,
    profile: profile,
    isModerator: isModerator
  };
})();
