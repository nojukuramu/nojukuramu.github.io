/* ============================================================
   RouteCast — the info sheet

   The panel had grown a habit: every switch and every field carried a
   paragraph explaining itself, and the paragraphs were good, and there were
   far too many of them. A pane you have to read is a pane nobody reads. The
   PUBs pane was four screens of prose before it was anything else.

   So the explanations moved here, and what is left on the pane is one line.
   Every one of them is still one tap away, behind a small (i) beside the
   thing it explains — which is the right place for it in both directions:
   somebody who knows what a PUB is never reads the paragraph again, and
   somebody who does not can find it without leaving the screen or guessing
   which word to search for.

   How it works
   ------------
   One sheet, one scrim, one registry. A control opts in by carrying
   `data-info="<key>"`, and the click is delegated from the document, so
   markup that is rebuilt on every render — a rider list, a room list — costs
   nothing to wire and cannot go stale.

   Copy lives in TOPICS rather than in index.html. That is not tidiness for
   its own sake: it is the only way the same explanation can be reached from
   the Pubs pane, from a toast and from a map control without three copies of
   it drifting apart. It is also why index.html got a couple of hundred lines
   shorter.

   The body of a topic is trusted HTML written here, never anything from the
   network or from a stranger — nothing off the wire ever reaches this sheet.
   ============================================================ */
var RC = RC || {};

RC.info = (function () {
  "use strict";

  /* Each topic: a title, and a body of a few short paragraphs. The house rule
     for the copy is the same one the app follows everywhere else — say the
     consequence, not the feature. */
  var TOPICS = {
    fields: {
      title: "What a field takes",
      body:
        "<p>Anything you have: <code>14.5995, 120.9842</code>, a pasted map link, " +
        "one of your marks, or a place to search for.</p>" +
        "<p>Coordinates and marks are used <b>exactly</b> as written. Nothing is snapped " +
        "to a nearby landmark, so a gate in the middle of a field stays the gate in the " +
        "middle of the field.</p>"
    },

    marks: {
      title: "Marks",
      body:
        "<p>A mark is a coordinate you named yourself — a gate, a fork, a shed, home.</p>" +
        "<p>Reusing one costs nothing and goes exactly where you put it, which a searched " +
        "address does not: a geocoder will happily move your turning to the nearest road it " +
        "has a name for.</p>"
    },

    trip: {
      title: "Weather along the route",
      body:
        "<p>RouteCast breaks a route into checkpoints and reads the forecast for each one " +
        "<i>at the hour you get there</i> — not the forecast for now, and not the forecast " +
        "for the destination only.</p>" +
        "<p>So you can see where the rain, wind or heat will actually catch you, and whether " +
        "leaving an hour later dodges it.</p>" +
        "<p>Or skip the planning entirely: <b>Free drive</b> records the ride either way.</p>"
    },

    group: {
      title: "Riding together",
      body:
        "<p>Everyone in a ride sees one <b>planned route</b> and each other's live position.</p>" +
        "<p>It runs phone to phone — no account, and no server holding your track. Your name " +
        "and a room code are required, and the host has to let you in.</p>" +
        "<p>The planned route is static on purpose. It does not re-route when somebody leaves " +
        "it, so it stays the line everybody agreed on rather than the line one phone last " +
        "computed.</p>"
    },

    qr: {
      title: "The room as a picture",
      body:
        "<p>Point a phone at this to join. It carries the invite link, so there is nothing " +
        "to hear across a car park and nothing to type.</p>" +
        "<p>It opens the same door the link does: the other rider still has to add a name, " +
        "and you still have to let them in.</p>"
    },

    voice: {
      title: "Voice in a ride",
      body:
        "<p>Hold the microphone button beside the map controls. On the live path the room " +
        "hears you <i>while</i> you speak.</p>" +
        "<p><b>Hands-free</b> leaves the microphone open so there is no thumb on a button. It " +
        "works on your own, too — whoever joins next hears you straight away rather than " +
        "finding out thirty seconds later that they could not.</p>" +
        "<p><b>Mute the ride</b> is one-way: you still send, you just stop hearing the room.</p>" +
        "<p>Where a browser has no live audio path, voice falls back to recorded bursts and " +
        "nobody hears a word until the button comes back up. The talk button says which one " +
        "you are on.</p>"
    },

    pubs: {
      title: "PUBs — the public road",
      body:
        "<p>A ride is a room you are invited into. A <b>PUB</b> is the opposite.</p>" +
        "<p>Turn it on and your name and position are shared with every rider nearby who has " +
        "also turned it on, and you see theirs. It runs phone to phone like everything else " +
        "here, and nobody stores it.</p>" +
        "<p>But it is <b>public</b>, and the people who can see it are strangers. Anyone nearby " +
        "running RouteCast can see roughly where you are for as long as it is on. Do not leave " +
        "it on from home.</p>" +
        "<p>What leaves the phone is rounded to about eleven metres, there is a <b>Go dark</b> " +
        "button in the first card, and the rail button carries a live count the whole time PUBs " +
        "is on — so “am I still broadcasting” never needs a tap to answer.</p>"
    },

    "pubs-area": {
      title: "How an area works",
      body:
        "<p>There is no server. The area's code is <b>derived from where you are</b> — one code " +
        "per cell of the world about 110 km across — so two riders in the same region compute " +
        "the same code without ever having spoken.</p>" +
        "<p>Somebody still has to hold that room, so the first phone to arrive becomes the hub. " +
        "Every client tries to <i>join</i> first and only hosts when nothing answers. The hub " +
        "relays and holds nothing; when it rides away, the next phone picks the area up.</p>" +
        "<p>Ride into the next cell and you are reseated on that cell's hub, without losing the " +
        "room you were chatting in.</p>"
    },

    "pubs-rooms": {
      title: "PUB rooms",
      body:
        "<p>A PUB room is a chat room with the door wedged open. Anyone with the code can walk " +
        "in, and codes are published to the area, so in practice anyone nearby can.</p>" +
        "<p>It carries <b>no positions at all</b> — so you can walk into one without going " +
        "public, and going public does not put you in a room.</p>" +
        "<p>Open one of your own and you are holding it: it is advertised to the area the moment " +
        "it exists, and it is gone when you leave.</p>"
    },

    "pubs-ignore": {
      title: "Ignoring somebody",
      body:
        "<p>Ignore drops a rider where their messages <i>arrive</i>, not merely out of a list. " +
        "They cannot appear on your map or in a room you are in, and nothing they send is read.</p>" +
        "<p>It is local to this phone and it is permanent until you undo it. A hub relays; it " +
        "does not moderate — a self-appointed relay policing a public channel is worse than one " +
        "that does not.</p>"
    },

    heat: {
      title: "The heat map",
      body:
        "<p>Every road you have ridden, drawn from the same record that decides which line " +
        "RouteCast prefers when it plans.</p>" +
        "<p>It has never left this phone, and it is <b>not a track</b>: what is stored is which " +
        "~124 m stretches you crossed, how often, and how long each crossing took. Enough to " +
        "draw the roads you use; not enough to replay a journey.</p>" +
        "<p>Colour is assigned by rank rather than by value, so the map always says something " +
        "instead of painting one commute red and the rest of your life blue.</p>" +
        "<p><b>Speed</b> is the one that surprises people: the road you think of as the fast way " +
        "out of town is usually amber all the way to the bypass.</p>"
    },

    background: {
      title: "Running with the screen off",
      body:
        "<p>A ride does not stop because the phone went in a pocket. With this on, RouteCast " +
        "holds the display awake while you are looking at it and keeps the page running when " +
        "you are not — so the odometer, the position going to your ride and the ETA all survive " +
        "a locked screen and a switch to another app.</p>" +
        "<p>Three things do that: a screen wake lock re-taken every time you come back, a loop " +
        "of digital silence that keeps the browser from freezing the page, and a heartbeat in a " +
        "worker that writes the recorded roads down and re-arms a position watch that died " +
        "quietly.</p>" +
        "<p>What nothing can survive is the <b>browser itself</b> being closed. No web page can, " +
        "and this one does not pretend to.</p>" +
        "<p>Turned off, RouteCast behaves exactly as it did before any of this existed.</p>"
    },

    update: {
      title: "Updates",
      body:
        "<p>RouteCast installs its own copy so it opens instantly and works with no signal. " +
        "That copy is replaced when a new version is published.</p>" +
        "<p>A new version is never applied while you are riding on the old one — it waits, and " +
        "the bar at the top offers it. Reloading takes a second and keeps your saved routes, " +
        "marks and recorded roads; only a ride in progress is interrupted.</p>"
    }
  };

  var sheet = null, scrim = null, titleEl = null, bodyEl = null, lastFocus = null;

  function ensure() {
    if (sheet) return true;
    sheet = RC.el("info-sheet");
    scrim = RC.el("info-scrim");
    titleEl = RC.el("info-title");
    bodyEl = RC.el("info-body");
    return !!(sheet && titleEl && bodyEl);
  }

  function open(key) {
    if (!ensure()) return false;
    var topic = TOPICS[key];
    if (!topic) return false;
    try { lastFocus = document.activeElement; } catch (e) { lastFocus = null; }
    titleEl.textContent = topic.title;
    bodyEl.innerHTML = topic.body;
    sheet.hidden = false;
    var close = RC.el("info-close");
    if (close && close.focus) { try { close.focus(); } catch (e) {} }
    return true;
  }

  function close() {
    if (!ensure() || sheet.hidden) return false;
    sheet.hidden = true;
    // Back to whatever opened it, so a keyboard is not dropped at the top of
    // the pane every time somebody checks what a switch does.
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
    return true;
  }

  function init() {
    if (!ensure()) return;
    var closeBtn = RC.el("info-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (scrim) scrim.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    /* Delegated: the lists that carry these buttons are rebuilt from scratch
       on every render, and re-wiring them each time is how a button ends up
       doing nothing. */
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-info]") : null;
      if (!btn) return;
      e.preventDefault();
      open(btn.getAttribute("data-info"));
    });
  }

  return {
    init: init,
    open: open,
    close: close,
    has: function (key) { return !!TOPICS[key]; },
    /* Exposed for the harness: every data-info in the page must name a topic
       that exists, or it is a button that does nothing. */
    keys: function () { return Object.keys(TOPICS); }
  };
})();
