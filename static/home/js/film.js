/* ============================================================
   nojukuramu — film simulations

   The camera this page dresses up as would let you choose the film it
   pretends to shoot on, so this does too. A simulation is one CSS filter,
   applied to everything on the page that is a picture — the scene behind
   the lens and every frame on the contact sheet — and to the few marks
   that carry a project's colour. The chrome, the type and the black are
   left alone: the body of a camera does not change with its film.

   The choice is a per-visitor convenience and is remembered in this
   browser only.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var KEY = "home.film";
  var doc = document.documentElement;

  /* Named for what they do, not after anybody's film stock. */
  var FILMS = [
    { id: "standard", name: "Standard", filter: "none" },
    { id: "vivid", name: "Vivid", filter: "saturate(1.55) contrast(1.12)" },
    { id: "chrome", name: "Chrome", filter: "saturate(.58) contrast(1.12) sepia(.12) brightness(.97)" },
    { id: "mono", name: "Mono", filter: "grayscale(1) contrast(1.3) brightness(1.04)" },
    { id: "cinema", name: "Cinema", filter: "saturate(.6) contrast(.88) brightness(1.08) hue-rotate(-10deg)" },
    { id: "amber", name: "Amber", filter: "sepia(.42) saturate(1.3) hue-rotate(-14deg) contrast(1.05)" }
  ];

  var listeners = [];
  var current = 0;

  function recall() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function remember(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function apply(i, quiet) {
    current = ((i % FILMS.length) + FILMS.length) % FILMS.length;
    var f = FILMS[current];
    doc.style.setProperty("--film", f.filter);
    doc.setAttribute("data-film", f.id);
    if (!quiet) remember(f.id);
    for (var k = 0; k < listeners.length; k++) { try { listeners[k](f, current); } catch (e) {} }
  }

  var saved = recall();
  var at = 0;
  FILMS.forEach(function (f, i) { if (f.id === saved) at = i; });
  apply(at, true);

  NJ.film = {
    films: FILMS,
    current: function () { return FILMS[current]; },
    set: function (id) {
      for (var i = 0; i < FILMS.length; i++) if (FILMS[i].id === id) { apply(i); return; }
    },
    next: function () { apply(current + 1); },
    onchange: function (fn) { listeners.push(fn); fn(FILMS[current], current); }
  };

  /* the chip in the header: a click winds on to the next one */
  var btn = document.getElementById("film-btn");
  var label = document.getElementById("film-name");
  if (btn && label) {
    NJ.film.onchange(function (f) {
      label.textContent = f.name;
      btn.setAttribute("aria-label", "Film simulation: " + f.name + ". Change it");
      btn.classList.remove("wound");
      void btn.offsetWidth;
      btn.classList.add("wound");
    });
    btn.addEventListener("click", function () { NJ.film.next(); });
  }
})(window);
