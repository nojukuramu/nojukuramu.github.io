/* ============================================================
   KomyutApp — the two things that must happen before paint

   This file exists because of the Content-Security-Policy in index.html.
   RouteCast declares its version and picks its theme in inline <script>
   blocks in the head, which is fine for an app with no user-submitted
   content. KomyutApp shows strings written by strangers, so its policy is
   `script-src 'self'` with no 'unsafe-inline' at all — which is worth far
   more than the two lines it costs, but does mean the head scripts have to
   be a file.

   Loaded synchronously, before the stylesheet, so the theme attribute is
   on <html> before anything is painted and there is no white flash on a
   dark phone.
   ============================================================ */
(function () {
  "use strict";

  /* The app's version, declared once. sw.js carries the same number in its
     cache name and tools/validate.js refuses to let the two drift apart.
     Bumping it is what publishes an update. */
  window.KM_VERSION = "1";

  try {
    var saved = localStorage.getItem("km:theme");
    var theme = saved ? JSON.parse(saved) : null;
    if (theme !== "light" && theme !== "dark") {
      theme = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) { /* the default in the markup stands */ }
})();
