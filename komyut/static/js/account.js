/* ============================================================
   TheCommuters — the account, and what it is for

   The account is the smallest thing that answers the one question the app
   has to answer: is this person allowed to write. Reading the whole
   database needs no account at all, and the pane says so before it asks
   for anything.

   The forms themselves — sign in, create an account, reset, the rest —
   live on their own page in static/js/auth.js. This module is the You
   pane on either side of them, the landing from an email link, and the
   profile behind the handle.

   What this module is careful about
   ---------------------------------
   * **Every signed-in member has a profile.** An account made before
     schema.sql was run has none, and used to be able to sign in, "save" a
     handle that matched no row, and then meet a bare "Not found." under
     its own routes. A sign-in now asks the database to make the profile if
     it is missing, and offers the handle step when it had to.
   * **Signing out clears the session first and tells the server second.** A
     sign-out that leaves the token in place because the network was down
     is a sign-out that did not happen.
   ============================================================ */
var KM = KM || {};

KM.account = (function () {
  "use strict";

  var profileCache = null;
  var recovering = false;
  var els = {};
  var handleWatch = null;

  function init() {
    els.out = KM.el("you-out");
    els.in = KM.el("you-in");
    els.handleInput = KM.el("you-handle-input");
    els.youErr = KM.el("you-err");
    els.routes = KM.el("you-routes");
    els.routesEmpty = KM.el("you-routes-empty");

    KM.glyph(KM.el("you-avatar"), "user");
    KM.glyph(KM.el("you-out-mark"), "user");

    KM.el("you-signin").addEventListener("click", function () { signIn("signin"); });
    KM.el("you-signup").addEventListener("click", function () { signIn("signup"); });
    KM.el("you-password").addEventListener("click", function () { KM.auth.open("change"); });
    KM.el("auth-signout").addEventListener("click", function () { signOut(false); });
    KM.el("auth-signout-all").addEventListener("click", function () {
      if (window.confirm("Sign out on every device, including this one?")) signOut(true);
    });
    KM.el("you-handle-save").addEventListener("click", saveHandle);
    els.handleInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") saveHandle();
    });
    handleWatch = KM.auth.watchHandle(els.handleInput, KM.el("you-handle-status"), null, null);

    KM.supa.onChange(function () {
      profileCache = null;
      paint();
    });
  }

  /* The one door into the sign-in page from anywhere in the app: the You
     pane, a vote arrow, the comment box, the locked builder. */
  function signIn(mode) {
    KM.auth.open(mode || "signin");
  }

  function signOut(everywhere) {
    KM.supa.signOut(everywhere).then(function () {
      profileCache = null;
      KM.app.toast(everywhere ? "Signed out everywhere." : "Signed out.");
      paint();
      KM.browse.refresh();
    });
  }

  /* After any sign-in, however it happened: the form, a sign-up that
     needed no confirmation, or an email link. Makes sure there is a
     profile behind the session, and offers the handle step when the
     database had to invent one. */
  function afterSignIn() {
    profileCache = null;
    paint();
    KM.browse.refresh();
    if (!KM.supa.userId()) return;
    KM.routes.ensureProfile().then(function (p) {
      if (!p) return;
      profileCache = p;
      paint();
      if (p.created && !KM.auth.isOpen()) {
        KM.auth.open("handle", { handle: p.handle });
      }
    }, function (err) {
      /* Older databases have no ensure_profile; the plain read in paint()
         still works there, so only a missing-schema answer is worth
         saying out loud. */
      if (err && err.kind === "setup") showYouError(err);
    });
  }

  /* ---------------------------------------------------------
     Arriving on a link from an email

     Called once at boot with whatever KM.supa read out of the URL. Three
     outcomes, and each says what happened rather than leaving somebody on
     a page that looks the same as before they clicked.
     --------------------------------------------------------- */
  /* Which pane this landing wants open. Answered synchronously and in one
     place, because the shell has to choose the opening tab before the
     rest of `landed` has finished its round trip — and when both decided
     it, whichever ran last won. */
  function landingTab(landing) {
    if (!landing) return "find";
    /* An expired link and a reset both leave something to do in You. A
       confirmed address leaves nothing to do there, so it stays on Find
       and says so in one line instead. */
    if (landing.error || landing.type === "recovery") return "you";
    return "find";
  }

  function landed(landing) {
    if (!landing) return;

    if (landing.error) {
      recovering = false;
      paint();
      KM.auth.open("signin", { error: landing.error });
      return;
    }

    /* The session's user id is fetched a moment after the tokens are read,
       so everything that depends on knowing who this is waits for it. */
    var after = landing.ready || Promise.resolve(landing);
    after.then(function () {
      profileCache = null;
      if (landing.type === "recovery") {
        recovering = true;
        paint();
        KM.auth.open("reset", {
          onClose: function () { recovering = false; paint(); }
        });
        return;
      }
      KM.app.toast(landing.type === "signup" || landing.type === "email_change"
        ? "Email confirmed. You are signed in."
        : "Signed in.");
      afterSignIn();
    });
  }

  /* ---------------------------------------------------------
     The signed-in half
     --------------------------------------------------------- */
  function paint() {
    if (!els.out) return;
    var signedIn = KM.supa.signedIn();
    /* While a reset link is being acted on, the session is real but the
       person has not chosen a password yet; the account waits for that. */
    els.out.hidden = signedIn;
    els.in.hidden = !signedIn || recovering;

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

    if (!signedIn || recovering) return;

    var sess = KM.supa.session();
    KM.el("you-email").textContent = (sess && sess.user && sess.user.email) || "";

    profile().then(function (p) {
      if (!p) return;
      KM.el("you-handle").textContent = "@" + p.handle;
      KM.el("you-sub").textContent = (p.is_moderator ? "Moderator \u00b7 " : "") +
        "Joined " + KM.fmtAgo(p.created_at);
      if (document.activeElement !== els.handleInput) els.handleInput.value = p.handle;
    }, function (err) {
      if (err && err.kind === "setup") showYouError(err);
    });

    loadMine();
  }

  function profile() {
    if (profileCache) return Promise.resolve(profileCache);
    var me = KM.supa.userId();
    if (!me) return Promise.resolve(null);
    return KM.routes.profile(me).then(function (p) {
      if (p) { profileCache = p; return p; }
      /* Signed in with no profile row: make it rather than show a blank
         header and a handle field that saves into nothing. */
      return KM.routes.ensureProfile().then(function (made) {
        profileCache = made;
        return made;
      }, function () { return null; });
    });
  }

  /* The handle step on the sign-in page saves through KM.routes directly;
     this is how the pane behind it hears about the new name. */
  function profileChanged(p) {
    profileCache = p || null;
    paint();
  }

  function showYouError(err) {
    els.youErr.textContent = err.message;
    els.youErr.hidden = false;
  }

  function isModerator() {
    return profile().then(function (p) { return !!(p && p.is_moderator); }, function () { return false; });
  }

  function saveHandle() {
    els.youErr.hidden = true;
    var v = handleWatch.verdict();
    if (v && !v.quiet) { showYouError({ message: v.msg }); return; }
    var btn = KM.el("you-handle-save");
    btn.disabled = true;
    KM.routes.setHandle(els.handleInput.value, null).then(function (p) {
      btn.disabled = false;
      profileCache = p;
      KM.app.toast("Handle saved.");
      paint();
    }, function (err) {
      btn.disabled = false;
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
    signIn: signIn,
    afterSignIn: afterSignIn,
    profileChanged: profileChanged,
    landed: landed,
    landingTab: landingTab,
    profile: profile,
    isModerator: isModerator
  };
})();
