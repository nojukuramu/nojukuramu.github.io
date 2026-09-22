/* ============================================================
   TheCommuters — what a stranger is allowed to write down

   This app is the first thing in this repository where one person's typing
   is shown to another person. Everything else here is either local to the
   phone or peer-to-peer between people who already agreed to be in a room
   together. A community route list is neither: the name on a route is
   written by somebody you have never met and read by everybody.

   So there are two jobs, and they are deliberately separate functions:

     clean(...)   runs on the way IN, before anything is sent to the
                  database. It normalises and strips. It is not a security
                  boundary — a determined client can skip it entirely by
                  talking to the API directly, which is why the same limits
                  are repeated as CHECK constraints in supabase/schema.sql.
                  What it buys is that honest input arrives in one shape.

     Rendering    runs on the way OUT, and is not in this file at all,
                  because the rule is that there is nothing to decide: every
                  string that came off the network reaches the DOM through
                  `textContent` or `KM.mk`, never through innerHTML. See the
                  check in tools/validate.js that refuses to let a renderer
                  drift back to string concatenation.

   What gets stripped, and why it is not paranoia
   ---------------------------------------------
   * **Control characters.** A NUL or a backspace in a route name is never
     what somebody meant and is a classic way to confuse a log reader.
   * **Bidirectional overrides** (U+202A-U+202E, U+2066-U+2069). These
     reorder the *visible* text without changing the stored text, which is
     how "Cubao to Makati" can be made to display as something else
     entirely. There is no legitimate use of them in a route name.
   * **Zero-width characters** (U+200B-U+200D, U+FEFF). Invisible, so they
     are used to slip a duplicate past a uniqueness check or to pad a name
     past a moderation filter while looking identical.
   * **Confusable whitespace** — every Unicode space collapses to a normal
     one, so a name cannot be padded into a column of its own in a list.
   * **NFC normalisation**, so two names that look identical compare
     identical.

   What is deliberately NOT stripped: ordinary punctuation, accents, and
   non-Latin scripts. This app is aimed at the Philippines and meant to
   travel; a filter that rejects a Baybayin or a Japanese place name is a
   bug, not a protection.
   ============================================================ */
var KM = KM || {};

KM.sanitize = (function () {
  "use strict";

  /* Kept in one object so the validation harness can compare them against
     the CHECK constraints in the schema and fail if the two ever drift. */
  var LIMITS = {
    handle: 24,
    handleMin: 3,
    displayName: 40,
    routeName: 90,
    routeDescription: 600,
    placeName: 80,
    comment: 1000,
    search: 120,
    city: 60,
    fareMax: 100000,
    stopsMax: 25,
    stopsMin: 2
  };

  var CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  var BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
  var ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
  /* Every Unicode space separator plus the ones that are not formally
     separators but behave like one on screen. */
  var ODD_SPACE = /[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g;

  function normalise(s) {
    var v = String(s == null ? "" : s);
    try { v = v.normalize("NFC"); } catch (e) { /* ancient engine; not fatal */ }
    return v.replace(CONTROL, "")
            .replace(BIDI, "")
            .replace(ZERO_WIDTH, "")
            .replace(ODD_SPACE, " ");
  }

  /* One line of text: newlines become spaces, runs of space collapse. */
  function line(s, max) {
    var v = normalise(s).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
    if (max && v.length > max) v = v.slice(0, max).trim();
    return v;
  }

  /* A block of text: paragraphs survive, but not a wall of blank lines used
     to push the rest of a thread off the screen. */
  function block(s, max) {
    var v = normalise(s)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/ {3,}/g, "  ")
      .trim();
    if (max && v.length > max) v = v.slice(0, max).trim();
    return v;
  }

  /* A handle is the one field with a narrow alphabet, because it is an
     identity: two accounts whose names differ only by an accent or a
     capital is exactly the confusion an impersonator wants. Lowercase
     ASCII, digits, underscore. */
  function handle(s) {
    var v = normalise(s).toLowerCase().replace(/[^a-z0-9_]/g, "");
    return v.slice(0, LIMITS.handle);
  }

  function handleError(v) {
    if (v.length < LIMITS.handleMin) return "At least " + LIMITS.handleMin + " characters.";
    if (!/^[a-z][a-z0-9_]*$/.test(v)) return "Start with a letter; letters, numbers and _ only.";
    return null;
  }

  /* Email is validated, never "corrected". A shape check only — the real
     check is that the confirmation mail arrives. */
  function email(s) {
    return line(s, 254).toLowerCase();
  }
  function emailLooksValid(v) {
    return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v);
  }

  /* What a new password has to be, as a list the sign-up page can tick off
     while it is typed, plus a strength score for the meter.

     The rules are the ones that stop the passwords people actually lose
     accounts to — short, all one kind of character, or the address itself
     — and nothing more. No "one symbol and one capital": those rules make
     `Password1!`, not strong passwords. Length is what the meter rewards.

     Signing IN is never held to these; somebody whose password predates a
     rule must still be able to get into their account. */
  var PASSWORD_MIN = 8;
  function passwordCheck(pw, email, handleValue) {
    pw = String(pw || "");
    var lower = pw.toLowerCase();
    var local = String(email || "").toLowerCase().split("@")[0];
    var h = String(handleValue || "").toLowerCase();
    var personal = (local.length >= 3 && lower.indexOf(local) !== -1) ||
                   (h.length >= 3 && lower.indexOf(h) !== -1);
    var rules = [
      { id: "length", ok: pw.length >= PASSWORD_MIN, label: "At least " + PASSWORD_MIN + " characters" },
      { id: "letter", ok: /[a-z]/i.test(pw), label: "A letter" },
      { id: "number", ok: /[0-9]/.test(pw), label: "A number" },
      { id: "personal", ok: pw.length > 0 && !personal, label: "Not your email or handle" }
    ];
    var ok = rules.every(function (r) { return r.ok; });

    var score = 0;
    if (pw.length >= PASSWORD_MIN) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/[^a-z0-9]/i.test(pw)) score++;
    if (/(.)\1{2,}/.test(pw) || /^(?:password|qwerty|123456|abc123)/i.test(pw)) score = Math.min(score, 1);
    if (!ok) score = Math.min(score, 1);
    if (!pw.length) score = 0;

    return {
      ok: ok,
      rules: rules,
      score: score,
      label: ["Too short", "Weak", "Fair", "Good", "Strong"][score]
    };
  }

  /* A coordinate that came from a text field, a pasted link or the network.
     Returns null rather than a NaN that would poison a polyline later. */
  function coord(lat, lon) {
    var la = Number(lat), lo = Number(lon);
    if (!isFinite(la) || !isFinite(lo)) return null;
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
    /* Six decimals is about 11 cm. Anything past it is false precision that
       only makes two identical points compare unequal. */
    return { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 };
  }

  /* A fare. Negative fares and fares in the millions are typos or jokes. */
  function fare(v) {
    if (v === "" || v == null) return null;
    var n = Number(v);
    if (!isFinite(n) || n < 0 || n > LIMITS.fareMax) return null;
    return Math.round(n * 100) / 100;
  }

  /* ISO 3166-1 alpha-2, or null. Country is used to scope searches, so a
     free-text country would split "Philippines" from "philippines". */
  function countryCode(s) {
    var v = normalise(s).toUpperCase().replace(/[^A-Z]/g, "");
    return /^[A-Z]{2}$/.test(v) ? v : null;
  }

  /* A value that must be one of a known set. Anything else is not clamped
     to a default silently — the caller decides, because "the type I picked
     was quietly changed" is worse than an error. */
  function oneOf(value, allowed) {
    var v = normalise(value).trim();
    return allowed.indexOf(v) === -1 ? null : v;
  }

  /* Search text on its way into a PostgREST filter. The value is still sent
     as a parameter rather than interpolated into SQL, so this is about
     keeping a query sane rather than about injection: PostgREST's own
     filter grammar uses commas, parentheses and dots as syntax, and a
     stray one turns a search into a parse error. */
  function search(s) {
    return line(s, LIMITS.search).replace(/[(),.*:"'\\]/g, " ").replace(/ {2,}/g, " ").trim();
  }

  return {
    LIMITS: LIMITS,
    normalise: normalise,
    line: line,
    block: block,
    handle: handle,
    handleError: handleError,
    email: email,
    emailLooksValid: emailLooksValid,
    PASSWORD_MIN: PASSWORD_MIN,
    passwordCheck: passwordCheck,
    coord: coord,
    fare: fare,
    countryCode: countryCode,
    oneOf: oneOf,
    search: search
  };
})();
