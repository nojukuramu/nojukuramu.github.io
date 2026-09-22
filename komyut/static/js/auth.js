/* ============================================================
   TheCommuters — the sign-in page, and every step around it

   Signing in, creating an account, "forgot my password", "check your
   inbox", choosing a new password from a reset link, choosing a handle and
   changing a password: seven steps, one full-screen page, one form. Each
   step is a MODE, and the markup says which fields a mode shows with a
   `data-modes` attribute, so adding a step is a row in MODES below and a
   word on the fields it needs — not a second form that drifts from this
   one.

   Why a page and not the corner of the You pane these used to live in:
   while somebody is doing any of this it is the only thing they are doing,
   and a form squeezed into a sheet over a map, with a map still pannable
   behind it, is a form people abandon.

   Reactive, and what that means here
   ----------------------------------
   Every field is checked as it is typed, and the verdict is painted beside
   it — but a field only turns red once somebody has left it or tried to
   submit. Nothing is louder than a form that shouts "invalid email" at the
   first keystroke. The submit button looks dimmed until the form is good,
   and still answers a press: it points at the first thing to fix rather
   than doing nothing, because a disabled button that will not say why is
   the least helpful control there is.

   Carried over from account.js, unchanged
   ---------------------------------------
   * A password is never written down: not to storage, not to a variable
     that outlives the request. Both password fields are cleared when a
     request returns, when the mode changes, and when the page closes.
   * A refused sign-in does not say which half was wrong.
   * Where an email link lands is KM.supa's to decide, not this file's.
   ============================================================ */
var KM = KM || {};

KM.auth = (function () {
  "use strict";

  var RESEND_COOLDOWN_S = 60;

  /* go:    the submit button, and `busy` while a request is out.
     pw:    how the password field presents itself in this mode — the
            autocomplete word is what tells a password manager whether to
            fill a saved password or offer to generate one.
     foot:  the line under the form: [text, button, where it goes]. */
  var MODES = {
    signin: {
      title: "Welcome back", sub: "Sign in to vote, comment and file routes.",
      go: "Sign in", busy: "Signing in…",
      pw: { label: "Password", auto: "current-password", hint: "Your password" },
      foot: ["New here?", "Create an account", "signup"]
    },
    signup: {
      title: "Create your account", sub: "Free. An email, a handle and a password is all of it.",
      go: "Create account", busy: "Creating…",
      pw: { label: "Password", auto: "new-password", hint: "At least 8 characters" },
      foot: ["Already have an account?", "Sign in", "signin"]
    },
    forgot: {
      title: "Reset your password", sub: "We will email you a link to choose a new one.",
      go: "Send reset link", busy: "Sending…",
      foot: ["Remembered it?", "Back to sign in", "signin"]
    },
    sent: {
      title: "Check your inbox", sub: ""
    },
    reset: {
      title: "Choose a new password", sub: "That link worked. Pick one you have not used here before.",
      go: "Save new password", busy: "Saving…",
      pw: { label: "New password", auto: "new-password", hint: "At least 8 characters" },
      foot: ["", "Not now", "close"]
    },
    handle: {
      title: "Choose your handle", sub: "The name next to your routes and comments.",
      go: "Save handle", busy: "Saving…",
      foot: ["", "Keep the one I have", "close"]
    },
    change: {
      title: "Change password", sub: "You stay signed in on this device.",
      go: "Save new password", busy: "Saving…",
      pw: { label: "New password", auto: "new-password", hint: "At least 8 characters" },
      foot: ["", "Cancel", "close"]
    }
  };

  var els = {};
  var mode = "signin";
  var opts = {};
  var busy = false;
  var touched = {};
  var tried = false;
  var sent = { kind: "signup", email: "", until: 0 };
  var tick = null;
  var handleWatch = null;

  function init() {
    els.page = KM.el("auth");
    els.form = KM.el("auth-form");
    els.title = KM.el("auth-title");
    els.sub = KM.el("auth-sub");
    els.switcher = KM.el("auth-switch");
    els.handle = KM.el("auth-handle");
    els.email = KM.el("auth-email");
    els.password = KM.el("auth-password");
    els.pwLabel = KM.el("auth-password-label");
    els.confirm = KM.el("auth-confirm");
    els.remember = KM.el("auth-remember");
    els.terms = KM.el("auth-terms");
    els.go = KM.el("auth-go");
    els.err = KM.el("auth-err");
    els.note = KM.el("auth-note");
    els.caps = KM.el("auth-caps");
    els.reveal = KM.el("auth-reveal");
    els.strength = KM.el("auth-strength");
    els.strengthLabel = KM.el("auth-strength-label");
    els.rules = KM.el("auth-rules");
    els.sentTo = KM.el("auth-sent-to");
    els.resend = KM.el("auth-resend");
    els.footText = KM.el("auth-foot-text");
    els.footGo = KM.el("auth-foot-go");

    KM.glyph(KM.el("auth-back"), "back");
    KM.glyph(KM.el("auth-mark"), "jeepney", "ride");
    paintReveal(false);

    /* One row per password rule, built once from the rule list itself so
       the page and KM.sanitize can never disagree about what they are. */
    KM.sanitize.passwordCheck("").rules.forEach(function (r) {
      var li = KM.mk("li", "km-rule");
      li.setAttribute("data-rule", r.id);
      var mark = KM.mk("span", "km-rule-mark");
      KM.glyph(mark, "check");
      li.appendChild(mark);
      li.appendChild(KM.mk("span", null, r.label));
      els.rules.appendChild(li);
    });

    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit();
    });

    /* Every keystroke re-checks the form; leaving a field is what allows
       it to show an error. */
    [els.handle, els.email, els.password, els.confirm].forEach(function (input) {
      input.addEventListener("input", function () {
        els.err.hidden = true;
        paint();
      });
      input.addEventListener("blur", function () {
        touched[input.id] = true;
        paint();
      });
    });
    els.terms.addEventListener("change", paint);

    els.remember.checked = KM.supa.remembers();
    els.remember.addEventListener("change", function () { KM.supa.setRemember(els.remember.checked); });

    /* Caps Lock is the most common reason a right password is refused, and
       the browser can say whether it is on while a key is pressed. */
    [els.password, els.confirm].forEach(function (input) {
      ["keydown", "keyup"].forEach(function (ev) {
        input.addEventListener(ev, function (e) {
          if (e.getModifierState) els.caps.hidden = !e.getModifierState("CapsLock");
        });
      });
      input.addEventListener("blur", function () { els.caps.hidden = true; });
    });

    els.reveal.addEventListener("click", function () {
      var show = els.password.type === "password";
      els.password.type = show ? "text" : "password";
      els.confirm.type = show ? "text" : "password";
      paintReveal(show);
    });

    els.switcher.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-to]");
      if (b) setMode(b.getAttribute("data-to"));
    });
    els.footGo.addEventListener("click", function () {
      var to = (MODES[mode].foot || [])[2];
      if (to === "close") close();
      else if (to) setMode(to);
    });
    KM.el("auth-forgot").addEventListener("click", function () { setMode("forgot"); });
    KM.el("auth-back").addEventListener("click", close);
    KM.el("auth-sent-back").addEventListener("click", function () { setMode("signin"); });
    els.resend.addEventListener("click", resend);

    document.addEventListener("keydown", function (e) {
      /* Escape closes the info sheet first when it is up over this page. */
      if (e.key === "Escape" && isOpen() && KM.el("info-sheet").hidden) close();
    });

    handleWatch = watchHandle(els.handle, KM.el("auth-handle-status"), KM.el("auth-handle-state"), paint);
  }

  function paintReveal(shown) {
    KM.glyph(els.reveal, shown ? "eyeoff" : "eye");
    els.reveal.setAttribute("aria-label", shown ? "Hide password" : "Show password");
    els.reveal.setAttribute("aria-pressed", shown ? "true" : "false");
  }

  /* ---------------------------------------------------------
     Opening, closing, and moving between steps
     --------------------------------------------------------- */

  /* open(mode, { email, handle, error, note, onClose })
     `onClose` runs however the page is left — the back arrow, Escape, a
     "Not now", or a step finishing — so the caller has one place to put
     "and then". */
  function open(next, o) {
    opts = o || {};
    els.page.hidden = false;
    document.documentElement.setAttribute("data-auth", "open");
    if (opts.email) els.email.value = opts.email;
    else if (!els.email.value) els.email.value = KM.store.get("last-email", "") || "";
    if (opts.handle != null) els.handle.value = opts.handle;
    setMode(next || "signin");
    if (opts.error) fail(opts.error);
    if (opts.note) say(opts.note);
  }

  function close() {
    if (!isOpen()) return;
    clearSecrets();
    stopTick();
    els.page.hidden = true;
    document.documentElement.removeAttribute("data-auth");
    var done = opts.onClose;
    opts = {};
    if (done) { try { done(); } catch (e) {} }
  }

  function isOpen() { return !!els.page && !els.page.hidden; }

  function setMode(next) {
    if (!MODES[next]) next = "signin";
    var m = MODES[next];
    var from = mode;
    mode = next;
    touched = {};
    tried = false;
    busy = false;

    /* The passwords do not carry from one step to another. The email does:
       typing it once is enough. */
    if (from !== next) clearSecrets();

    els.page.setAttribute("data-mode", next);
    Array.prototype.forEach.call(els.page.querySelectorAll("[data-modes]"), function (node) {
      node.hidden = node.getAttribute("data-modes").split(" ").indexOf(next) === -1;
    });
    Array.prototype.forEach.call(els.switcher.querySelectorAll("button"), function (b) {
      var on = b.getAttribute("data-to") === next;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });

    els.title.textContent = m.title;
    els.sub.textContent = m.sub;
    els.sub.hidden = !m.sub;
    els.go.textContent = m.go || "";
    els.go.disabled = false;
    if (m.pw) {
      els.pwLabel.textContent = m.pw.label;
      els.password.setAttribute("autocomplete", m.pw.auto);
      els.password.setAttribute("placeholder", m.pw.hint);
    }
    if (m.foot) {
      els.footText.textContent = m.foot[0];
      els.footText.hidden = !m.foot[0];
      els.footGo.textContent = m.foot[1];
    }
    KM.glyph(KM.el("auth-mark"), next === "sent" ? "mail"
      : (next === "reset" || next === "change" || next === "forgot") ? "lock"
      : next === "handle" ? "user" : "jeepney", next === "signin" || next === "signup" ? "ride" : undefined);

    els.err.hidden = true;
    els.note.hidden = true;
    els.caps.hidden = true;
    stopTick();
    if (next === "sent") paintSent();
    if (next === "signup" || next === "handle") handleWatch.check();
    paint();
    KM.info.paintButtons();

    /* The first empty field a person has to fill, so a keyboard comes up
       where it is needed. Not on a phone's first paint of the page, where
       a keyboard over the title is worse than a tap. */
    setTimeout(function () {
      if (!isOpen()) return;
      var order = [els.handle, els.email, els.password, els.confirm];
      for (var i = 0; i < order.length; i++) {
        if (visible(order[i]) && !order[i].value) { try { order[i].focus(); } catch (e) {} return; }
      }
    }, 60);
  }

  function visible(node) {
    for (var n = node; n && n !== els.page; n = n.parentNode) {
      if (n.hidden) return false;
    }
    return true;
  }

  function clearSecrets() {
    if (els.password) els.password.value = "";
    if (els.confirm) els.confirm.value = "";
    if (els.password && els.password.type !== "password") {
      els.password.type = "password";
      els.confirm.type = "password";
      paintReveal(false);
    }
  }

  /* ---------------------------------------------------------
     Checking, as it is typed
     --------------------------------------------------------- */

  /* Every field the current mode shows, with a verdict: null is fine, a
     string is what is wrong. `quiet` is "not wrong, just not done", which
     is dimmed rather than red. */
  /* The address the password must not contain: the one typed here, or on
     the steps that do not ask for it, the one signed in. */
  function whoEmail() {
    if (visible(els.email)) return KM.sanitize.email(els.email.value);
    var s = KM.supa.session();
    return (s && s.user && s.user.email) || "";
  }

  function verdicts() {
    var v = {};
    var shows = function (el) { return visible(el); };
    var email = whoEmail();
    var pw = els.password.value;

    if (shows(els.handle)) {
      v.handle = handleWatch.verdict();
    }
    if (shows(els.email)) {
      v.email = !email ? { msg: "Type your email address.", quiet: true }
        : !KM.sanitize.emailLooksValid(email) ? { msg: "That does not look like an email address." } : null;
    }
    if (shows(els.password)) {
      if (mode === "signin") {
        v.password = pw ? null : { msg: "Type your password.", quiet: true };
      } else {
        var chk = KM.sanitize.passwordCheck(pw, email, visible(els.handle) ? els.handle.value : "");
        v.password = chk.ok ? null : { msg: "The password needs everything on the list.", quiet: !pw };
      }
    }
    if (shows(els.confirm)) {
      var c = els.confirm.value;
      v.confirm = !c ? { msg: "Type the password again.", quiet: true }
        : c !== pw ? { msg: "The passwords do not match." } : null;
    }
    if (mode === "signup") {
      v.terms = els.terms.checked ? null : { msg: "Tick the box to say you understand.", quiet: true };
    }
    return v;
  }

  function paint() {
    if (!els.page) return;
    var v = verdicts();

    paintField("email", els.email, v.email, KM.el("auth-email-status"), KM.el("auth-email-state"), "");
    paintField("confirm", els.confirm, v.confirm, KM.el("auth-confirm-status"), KM.el("auth-confirm-state"),
      els.confirm.value ? "They match." : "");

    /* The strength meter and the rule list move with every keystroke; that
       is the one place where live feedback before blur is the point. */
    if (visible(els.strength)) {
      var chk = KM.sanitize.passwordCheck(els.password.value, whoEmail(), visible(els.handle) ? els.handle.value : "");
      els.strength.setAttribute("data-score", String(chk.score));
      els.strengthLabel.textContent = els.password.value ? chk.label : "";
      chk.rules.forEach(function (r) {
        var li = els.rules.querySelector('[data-rule="' + r.id + '"]');
        if (li) li.classList.toggle("is-ok", r.ok);
      });
      var wrapPw = els.password.parentNode;
      wrapPw.classList.toggle("is-bad", !!(v.password && !v.password.quiet && (tried || touched[els.password.id])));
    }

    var ok = Object.keys(v).every(function (k) { return !v[k]; });
    /* Dimmed, not disabled, and deliberately not aria-disabled either: the
       button still answers a press with what to fix, and a screen reader
       told "dimmed" would be told something untrue. */
    els.go.classList.toggle("is-waiting", !ok);
    els.go.setAttribute("data-ready", ok ? "true" : "false");
    return { ok: ok, v: v };
  }

  function paintField(key, input, verdict, statusEl, stateEl, goodText) {
    if (!visible(input)) return;
    var shown = tried || touched[input.id];
    var wrap = input.parentNode;
    var bad = !!verdict && (!verdict.quiet || tried) && shown;
    var good = !verdict && !!input.value;
    wrap.classList.toggle("is-bad", bad);
    wrap.classList.toggle("is-good", good);
    if (stateEl) KM.glyph(stateEl, good ? "check" : (bad ? "alert" : "close"));
    if (stateEl) stateEl.hidden = !(good || bad);
    if (statusEl) {
      statusEl.textContent = bad ? verdict.msg : (good ? goodText : "");
      statusEl.classList.toggle("is-bad", bad);
      statusEl.classList.toggle("is-good", good && !!goodText);
    }
  }

  /* ---------------------------------------------------------
     A handle field that says whether the name is free

     Shared with the You pane's "change handle" field, so both check the
     same way. Shape first (no request for a handle that could not be
     saved anyway), then availability, debounced and with stale answers
     thrown away — the reply for "jua" must not paint over "juan".
     --------------------------------------------------------- */
  function watchHandle(input, statusEl, stateEl, onChange) {
    var state = { value: "", taken: null, pending: false };
    var seq = 0;
    var defaultText = statusEl ? statusEl.textContent : "";

    var ask = KM.debounce(function () {
      var mine = ++seq;
      var h = state.value;
      KM.routes.handleTaken(h).then(function (taken) {
        if (mine !== seq) return;
        state.pending = false;
        state.taken = taken;
        render();
        if (onChange) onChange();
      });
    }, 350);

    function check() {
      var h = KM.sanitize.handle(input.value);
      /* Show what will actually be saved: capitals folded, spaces and
         accents gone. Only rewritten when it differs, or the caret jumps. */
      if (input.value && input.value !== h && document.activeElement === input) {
        var at = input.selectionStart;
        input.value = h;
        try { input.setSelectionRange(Math.min(at, h.length), Math.min(at, h.length)); } catch (e) {}
      }
      state.value = h;
      state.taken = null;
      state.pending = false;
      if (h && !KM.sanitize.handleError(h) && KM.supa.ready()) {
        state.pending = true;
        ask();
      }
      render();
    }

    function verdict() {
      var h = state.value;
      if (!h) return { msg: "Pick a handle.", quiet: true };
      var shape = KM.sanitize.handleError(h);
      if (shape) return { msg: shape };
      if (state.taken === true) return { msg: "@" + h + " is taken. Try another." };
      return null;
    }

    function render() {
      if (!statusEl) return;
      var v = verdict();
      var bad = !!v && !v.quiet;
      var good = !v && !state.pending && state.taken === false;
      statusEl.textContent = bad ? v.msg
        : state.pending ? "Checking…"
        : good ? "@" + state.value + " is available."
        : defaultText;
      statusEl.classList.toggle("is-bad", bad);
      statusEl.classList.toggle("is-good", good);
      var wrap = input.parentNode;
      wrap.classList.toggle("is-bad", bad);
      wrap.classList.toggle("is-good", good);
      if (stateEl) {
        stateEl.hidden = !(bad || good);
        KM.glyph(stateEl, good ? "check" : "alert");
      }
    }

    input.addEventListener("input", check);
    return { check: check, verdict: verdict, state: function () { return state; } };
  }

  /* ---------------------------------------------------------
     Doing the thing
     --------------------------------------------------------- */
  function submit() {
    if (busy) return;
    els.err.hidden = true;
    els.note.hidden = true;
    tried = true;
    var result = paint();

    if (!result.ok) {
      /* Point at the first thing to fix, in the order the fields sit. */
      var order = ["handle", "email", "password", "confirm", "terms"];
      for (var i = 0; i < order.length; i++) {
        var bad = result.v[order[i]];
        if (!bad) continue;
        fail(bad.msg);
        var field = { handle: els.handle, email: els.email, password: els.password,
                      confirm: els.confirm, terms: els.terms }[order[i]];
        try { field.focus(); } catch (e) {}
        return;
      }
      return;
    }
    if (!KM.supa.ready()) { fail("TheCommuters is not connected to a community database yet."); return; }

    var email = KM.sanitize.email(els.email.value);
    var pw = els.password.value;
    var m = mode;

    var op;
    if (m === "signin") op = KM.supa.signIn(email, pw);
    else if (m === "signup") op = KM.supa.signUp(email, pw, KM.sanitize.handle(els.handle.value));
    else if (m === "forgot") op = KM.supa.resetPassword(email);
    else if (m === "reset" || m === "change") op = KM.supa.updatePassword(pw);
    else if (m === "handle") op = KM.routes.setHandle(els.handle.value, null);
    else return;

    setBusy(true);
    op.then(function (res) {
      setBusy(false);
      clearSecrets();
      done(m, email, res);
    }, function (err) {
      setBusy(false);
      clearSecrets();
      paint();
      if (m === "signin" && err && err.kind === "unconfirmed") {
        /* The account exists and is waiting on its email. The useful
           thing is the button that sends that email again, which lives on
           the "check your inbox" step. */
        toSent("signup", email);
        fail("Confirm your address first. We can send the link again.");
        return;
      }
      if (m === "handle" && err && err.kind === "conflict") {
        fail("Somebody already has that handle.");
        return;
      }
      fail((err && err.message) || "Something went wrong.");
      if (m === "signin") { try { els.password.focus(); } catch (e) {} }
    });
  }

  function done(m, email, res) {
    if (m === "signin") {
      remember(email);
      close();
      KM.app.toast("Signed in.");
      if (KM.account) KM.account.afterSignIn();
      return;
    }
    if (m === "signup") {
      remember(email);
      if (res && res.confirmed === false) {
        /* Email confirmation is on for this project. That is a success and
           has to read like one, or people try again and hit "already
           registered". */
        toSent("signup", email);
        return;
      }
      close();
      KM.app.toast("Welcome aboard.");
      if (KM.account) KM.account.afterSignIn();
      return;
    }
    if (m === "forgot") {
      toSent("reset", email);
      return;
    }
    if (m === "reset") {
      close();
      KM.app.toast("Password changed. You are signed in.");
      return;
    }
    if (m === "change") {
      close();
      KM.app.toast("Password changed.");
      return;
    }
    if (m === "handle") {
      close();
      KM.app.toast("Handle saved.");
      if (KM.account) KM.account.profileChanged(res);
    }
  }

  /* Only the address, and only on a browser that was told to keep the
     session: an email prefilled on a borrowed phone is a small leak. */
  function remember(email) {
    if (KM.supa.remembers()) KM.store.set("last-email", email);
    else KM.store.remove("last-email");
  }

  function setBusy(on) {
    busy = on;
    els.go.disabled = on;
    els.go.classList.toggle("is-busy", on);
    els.go.textContent = on ? (MODES[mode].busy || "…") : (MODES[mode].go || "");
  }

  /* ---------------------------------------------------------
     "Check your inbox", and sending it again
     --------------------------------------------------------- */
  function toSent(kind, email) {
    sent.kind = kind;
    sent.email = email;
    sent.until = Date.now() + RESEND_COOLDOWN_S * 1000;
    setMode("sent");
  }

  function paintSent() {
    els.sentTo.textContent = "";
    els.sentTo.appendChild(document.createTextNode(
      sent.kind === "reset" ? "If that address has an account, a reset link is on its way to " : "We sent a link to "));
    els.sentTo.appendChild(KM.mk("b", null, sent.email));
    els.sentTo.appendChild(document.createTextNode("."));
    els.sub.textContent = sent.kind === "reset" ? "Open it on this device to choose a new password."
      : "Confirm your address and you are in.";
    els.sub.hidden = false;
    paintResend();
    stopTick();
    tick = setInterval(paintResend, 1000);
  }

  /* A countdown on the button rather than a refusal from the server:
     GoTrue rate-limits these, and "try again later" after a press reads as
     broken. */
  function paintResend() {
    var left = Math.ceil((sent.until - Date.now()) / 1000);
    if (left > 0) {
      els.resend.disabled = true;
      els.resend.textContent = "Send it again in " + left + "s";
    } else {
      els.resend.disabled = false;
      els.resend.textContent = "Send it again";
      stopTick();
    }
  }

  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  function resend() {
    if (Date.now() < sent.until) return;
    els.err.hidden = true;
    els.resend.disabled = true;
    var op = sent.kind === "reset" ? KM.supa.resetPassword(sent.email) : KM.supa.resendSignup(sent.email);
    op.then(function () {
      sent.until = Date.now() + RESEND_COOLDOWN_S * 1000;
      say("Sent again.");
      paintResend();
      stopTick();
      tick = setInterval(paintResend, 1000);
    }, function (err) {
      paintResend();
      fail(err.message);
    });
  }

  /* ---------------------------------------------------------
     One line of each kind
     --------------------------------------------------------- */
  function fail(msg) {
    els.err.textContent = msg;
    els.err.hidden = false;
    els.note.hidden = true;
  }

  function say(msg) {
    els.note.textContent = msg;
    els.note.hidden = false;
  }

  return {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    mode: function () { return mode; },
    watchHandle: watchHandle
  };
})();
