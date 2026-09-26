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

    layers: {
      title: "The base map",
      body:
        "<p>What the ground under everything else is drawn from. The route, the weather " +
        "chips, your marks and everybody else on the ride sit on top of it and do not " +
        "change with it.</p>" +
        "<p><b>Standard</b> is the plain OpenStreetMap map, drawn as pictures. Everything " +
        "below it is drawn from <b>vector</b> data instead, which is what allows a tilted " +
        "camera, buildings with height, and a palette that is ours rather than a tile " +
        "server\u0027s.</p>" +
        "<p>The four flat-coloured ones are minimaps: no names, few colours, and the road " +
        "network carrying the whole picture. They are the easiest maps here to read at a " +
        "glance, which is the trick every game minimap is playing.</p>" +
        "<p>Vector maps come from OpenFreeMap, which serves the planet with no key and no " +
        "account. The first one you pick downloads the engine, about a megabyte, once.</p>"
    },

    "drive-camera": {
      title: "Riding behind the camera",
      body:
        "<p>Start a ride on a 3D map and the view tilts in behind you: the road ahead runs " +
        "up the screen, the buildings stand up, and the map turns as you do.</p>" +
        "<p>The turning is the same compass the flat map uses \u2014 north-up and course-up " +
        "still mean what they meant, and the compass button still switches between them.</p>" +
        "<p><b>It is not a cage.</b> Drag to look ahead, pinch to zoom, twist with two " +
        "fingers to turn it, drag with two to tilt it. Doing any of that stops the camera " +
        "following, exactly as dragging the flat map does, and the <b>Re-centre</b> button " +
        "brings it back \u2014 as does simply leaving it alone for a few seconds.</p>" +
        "<p>Everything the flat map draws is drawn in the 3D scene too: the route in the " +
        "colours the forecast gave it, the weather chips, the checkpoint dots, your marks, " +
        "the other riders and the heat map. Icons nearer to you are drawn larger, because " +
        "they are.</p>" +
        "<p>It needs a browser that can draw 3D. If yours cannot, the map stays flat and " +
        "says so rather than going blank.</p>"
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

    dashboard: {
      title: "The dashboard",
      body:
        "<p><b>Strip</b> is the speed and a row of tiles you can swipe. <b>Big</b> puts the speed " +
        "on a gauge with your first three tiles, large enough to read on a mount at arm's length. " +
        "<b>Minimal</b> keeps the speed and one tile in a corner and gives the map the rest.</p>" +
        "<p>Pick the tiles for navigating and for free drive separately — they are different " +
        "rides. The arrow moves a tile earlier; the first ones are what Big and Minimal show.</p>" +
        "<p><b>Rain</b> says when the next rain reaches you, read off the forecast already " +
        "fetched. <b>Wind</b> points where it is blowing <i>relative to you</i> — the part " +
        "that pushes a bike sideways is what matters, not the compass direction.</p>" +
        "<p><b>Warn me above</b> is a speed you choose. There is no free, key-less source of " +
        "speed limits, and a guessed limit would be worse than none, so this is yours: the " +
        "number turns red and the phone buzzes once each time you cross it.</p>"
    },

    guidance: {
      title: "Guidance out loud",
      body:
        "<p>Turns are said twice at most: once early enough to change lanes, about twenty " +
        "seconds ahead at your speed, and once as the junction arrives. A road that only " +
        "changes its name is not announced a kilometre early.</p>" +
        "<p>Rain, wind or fog that the forecast marks as caution or danger is announced once, " +
        "while it is still up to ten kilometres off — early enough to stop for a jacket.</p>" +
        "<p>It uses the voice your phone already has, so nothing is downloaded and nothing " +
        "leaves the phone. A helmet speaker paired to the phone hears it too. The speaker in the " +
        "turn banner silences it for the rest of the ride.</p>" +
        "<p><b>Buzz</b> needs a phone that can vibrate from a web page: Android can, iPhone " +
        "cannot.</p>"
    },

    battery: {
      title: "The battery saver",
      body:
        "<p>A navigator is the app most likely to be running at fifteen per cent, on a mount, in " +
        "the sun. The saver makes it do less: the 3D camera moves less often, buildings stay " +
        "flat, the decorative motion stops, and the forecast is refreshed half as often.</p>" +
        "<p>None of that touches what matters: the position, the route, the turns and the " +
        "recorder are exactly as they were.</p>" +
        "<p><b>Auto</b> turns it on by itself at 20% when the phone is not charging — where the " +
        "browser will say what the battery is doing. Chrome on Android does; Safari and Firefox " +
        "do not, so on those Auto never switches on and <b>On</b> is the way to ask for it.</p>" +
        "<p>Whatever this is set to, a stopped ride no longer keeps the 3D view redrawing a " +
        "picture that is not changing.</p>"
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
