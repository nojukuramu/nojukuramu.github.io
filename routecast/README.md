# RouteCast

A map navigator for **cars and motorcycles** that answers the question a normal
navigator ignores: *what will the weather be doing where I am, when I get there?*

Plan a route, and RouteCast breaks it into checkpoints, works out roughly when you
will reach each one, and fetches the forecast for that place **at that hour** — not
the forecast for right now, and not the forecast for your destination only.

Or skip the planning entirely and hit **Free drive**: the dashboard, the recorder and
the local forecast, with no destination and nothing to count down to.

Or ride it with other people: **Group ride** puts a room of phones on one map, with one
static planned route everybody can see, everyone's live position, chat, live push-to-talk
voice, and — for whoever drifts off the agreed line — a set of real routes back to it.
It runs phone to phone, with no server holding anybody's position.

Or open the door entirely: **PUBs** is the public road. Turn it on and every rider nearby
who has also turned it on is on your map, and you are on theirs; open a **PUB room** and
anyone can walk in and talk. Same phone-to-phone transport, no accounts, nothing stored.

Live at <https://nojukuramu.github.io/routecast/>.

## What it does

- **Two vehicles, two judgements.** A car and a motorcycle do not care about the same
  weather. The bike profile weighs crosswind gusts, wind chill at highway speed, standing
  water, visor fogging and night visibility far more heavily; the car profile mostly cares
  about aquaplaning-grade rain, fog, storms and ice.
- **Weather along the route, not at the end of it.** Checkpoints are spaced along the
  polyline (every 10–80 km, automatically, or a spacing you pick). Each one gets an ETA
  from the routing engine's own per-segment timings, and a forecast interpolated to that
  exact minute.
- **The route is coloured by what's coming.** Green through amber to red, per stretch,
  so a wall of rain two hours out is visible before you leave.
- **A departure planner.** The same forecast data is re-scored for departures from three
  hours earlier to six hours later, so you can see whether waiting an hour dodges the
  squall. No extra network calls — it re-reads the hourly series already fetched.
- **Group ride.** A room of riders on one map (see below): one shared **planned route**
  that is static by design, live positions, a roster with a door on it, chat, push-to-talk
  voice, and routes back to the line for anyone who leaves it. Joining is a six-character
  code read aloud, a link, or the host's **QR code** pointed at with a camera.
- **PUBs — the public road.** A group ride is a room you are invited into; a PUB is the
  opposite. Switch it on and your name and position go to every rider in your area who has
  switched it on, and theirs come back. Anyone can also open a **PUB room**: a chat room
  with the door wedged open, published to the area so it is walked into rather than
  invited to. Off by default, one tap to go dark, and a local ignore list that drops
  somebody where their messages *arrive* rather than filtering them out of a list. There
  is still no server: the area code is derived from where you are, and the first phone in
  an area holds it for everybody until it leaves (see below).
- **A heat map of your own riding.** The recorder has been writing down which roads you
  actually use since the first ride, because that is what makes the planner prefer a line
  you know. *Your roads* now draws it: every recorded stretch, coloured by **visits**,
  by **your own average speed on it**, by **how long each crossing takes you**, or by
  **how lately you rode it**. The speed one is the one that surprises people. Colour is
  assigned by rank rather than by value, so the map always says something instead of
  painting one commute red and the rest of your life blue.
- **A panel that says one line.** Every switch and every field used to carry a paragraph
  explaining itself. The paragraphs were good and there were far too many of them — the PUBs
  pane was four screens of prose before it was anything else. The explanations now live behind
  a small **(i)** beside the thing they explain, which is the right place for them in both
  directions: somebody who knows what a PUB is never reads it again, and somebody who does not
  can find it without leaving the screen.
- **It tells you when it has been updated.** A cached app with no update path is a phone
  quietly running a build from three deploys ago. RouteCast watches for a new version, offers it
  in one dismissible line, and — crucially — **never applies it on its own**: a service worker
  swapping the code out halfway to somewhere is not an improvement. See below.
- **Gear and riding advice** derived from the actual numbers, not generic filler.
- **An ETA that has been told the truth.** The routing engine's own timings are
  free-flow: no traffic, no signals, no junction delay. That optimism used to
  matter twice over here, because the forecast is read *at the ETA* — an ETA half
  an hour fast reads the weather for the wrong hour and reports sunshine into a
  squall. Every route is now calibrated before anything is sampled: a structural
  correction for the router's optimism, a time-of-week congestion curve applied
  **per edge in a forward pass** (leave at 06:30 and the far end of the route is
  scored after the peak, not during it), and — as soon as you have ridden with
  navigation on — your own measured pace in place of the default. The panel always
  says which of those produced the number.
- **Traffic, without a key.** Every live-traffic feed worth having needs an API key
  and a server to hide it in; this is a static page with neither, and a key in a
  public script is a donation, not a secret. So congestion is predicted from a
  time-of-week model — the ordinary two-peak commuter curve, with a long Philippine
  evening peak — grounded in your own recorded speeds on the actual roads as soon as
  there are any. Each checkpoint is scored at the hour you reach *it*.
- **It remembers the roads you really took.** Not the planned line: the line. Every
  fix during navigation is quantised to a ~124 m cell, and each crossing between
  cells is recorded as a piece of road you have used, weighed by how often. Planning
  then prefers a route built out of roads you already know — but only when it is
  meaningfully more familiar *and* not meaningfully slower, so this never quietly
  hands you a scenic detour. Car and motorcycle are kept apart; a road learned in a
  car still counts on a bike, at a discount. It never leaves the device, and
  *Your roads* in the panel shows what is stored and deletes all of it in one tap.
- **Saved and reusable routes.** Keep a trip by name and pull it back with one tap —
  every stop, the vehicle and the checkpoint spacing come back with it. What is saved
  is the *points*, never the geometry: reloading re-routes and re-forecasts, because
  roads change, the traffic model has moved on, and last March's polyline is not a
  route, it is a memory.
- **A driving dashboard.** Speed, large enough to read at a glance and smoothed so it
  sits still; the next turn, taken from the routing engine's own manoeuvre list;
  average pace, elapsed time, live elevation and road grade from the terrain model,
  the current congestion level, and how good the GPS fix actually is.
- **Terrain.** One elevation request per route draws the profile of the ride before
  you set off — total climb, total descent, and the shape of it — with a marker
  showing where you are on that profile while you ride.
- **Free driving.** Navigation without a destination. Speed, distance covered, moving
  and stopped time, average and top speed, climb, the sky where you actually are — and
  the same ride recorder that runs during navigation, so a road you rode without
  planning it is still a road RouteCast knows. It records the roads and deliberately
  does *not* touch the pace model: that learns from a ride against a prediction, and a
  free ride has none. The travelled line is drawn behind you as you go.
- **The map owns the screen.** Every other surface is a thin overlay with its own
  gutter, and none of them is allowed into the middle of the display. A rail of
  buttons across the top — buttons, with map in the gaps between them. One line for
  the next turn. A compact HUD strip along the bottom carrying speed and a scrolling
  row of stat pods, which in landscape becomes the same pods as a narrow column down
  the left edge, because a 380px-tall screen cannot spare 80px at the bottom and can
  easily spare 96px at the side. Nothing reflows the map when it appears.
- **A planner with two states.** Open and closed, each with a button. The old sheet
  snapped between three heights on a drag that lived on a 4px handle, and a pointer
  the browser dropped mid-gesture left it stranded half way up until a reload. Now it
  is a bottom sheet in portrait and a left drawer in landscape and on desktop, it
  opens and closes on named controls, a flick down dismisses it, and the gesture is
  bound to the window so it always finishes. Inside, four tabs — Route, Trip, Marks,
  You — instead of one endless scroll.
- **A field takes whatever you have.** Start, destination and every stop accept a
  coordinate (`14.5995, 120.9842`, hemisphere letters, degrees/minutes/seconds, a
  `geo:` URI, or a pasted Google Maps or OpenStreetMap link), one of your saved marks,
  or a place to search for. A coordinate is used *exactly as written* and costs no
  request at all — nothing is snapped to a nearby landmark. Free text that matches
  several places is shown as a list and stops there rather than silently resolving to
  the first hit, which is how a rider ends up at the wrong Poblacion.
- **Saved marks.** A mark is a coordinate you named yourself — a gate, a fork, a shed,
  home. Mark the centre of the map, mark where you are, or save the pin you are
  already aiming. Marks appear above the search results as you type, sit on the map as
  quiet pins you can tap, and go exactly where you put them every time. Re-saving the
  same spot renames it instead of stacking a duplicate, and a pin dropped within 40 m
  of a mark is labelled with your name for it rather than the geocoder's. It never
  leaves the device.
- **Drop a pin on the exact point, not the nearest landmark.** Start, destination and every stop can be set with the
  classic centre-pin picker: the pin stays fixed, you move the map under it, and the address
  updates as you settle. **The confirmed coordinate is always the exact centre**, to five
  decimal places — about a metre — and never the place the geocoder snapped to, which is
  routinely a block away and occasionally on the far side of a river. The coordinate is
  shown live under the address so you can see the difference, and it holds for every way of
  marking a point: the pin, a long-press on the map, and *use my location*. A reverse lookup
  still runs, but only to find a readable **name**; its own coordinates are thrown away. The
  exactness is recorded with the point and survives being saved and reloaded.
- **Live navigation.** Follow the route as you ride: distance and time remaining, an ETA that
  slips when you do, a progress track marked with every weather checkpoint, and an alert when
  the next one turns caution or danger. Because the ETA is live, the forecasts are re-read for
  when you will *now* arrive — running an hour late can change the weather you meet.
- **It reroutes when you actually leave the road, and not before.** Missing a turn gets you a new
  route from where you are, through whatever stops are still ahead, pointed the way you are
  facing. A lane-width GPS wobble, a flyover or a tunnel does not — see *Staying live without
  polling* below for what has to be true before a request is spent.
- **The forecast keeps up on its own.** ETAs are re-timed against the hourly data already in
  memory every minute, for free; the data itself is refetched on a much longer clock, and only
  for the checkpoints still ahead of you.
- **Compass, with the map rotating to your heading.** Tap the compass to switch between north-up
  and course-up. Course-up turns the map so the way you are pointing is up and keeps you at the
  centre; the weather chips and pins counter-rotate so every label stays readable. The heading
  comes from your GPS course while you are moving and from the phone's magnetometer when you are
  stopped, which is what you want at a junction. Reaching for the map to look around drops you
  back to north-up.
- **The map does not fight you.** Who owns the view while you are riding used to be
  settled by whoever moved it last, which meant reaching over to check the junction
  ahead ended with the next fix yanking the view back a heartbeat after your thumb
  left the glass. There is now one piece of state for it, and it is decided by intent:
  a **drag** means "let me look elsewhere", so following stops, a Re-centre control
  appears, and nothing moves the map until you ask or until you have been done looking
  for twelve seconds; a **zoom** means "let me look closer at the same thing", so
  following continues and the zoom you chose becomes the zoom it follows at. The app's
  own pans are flagged before they are made and can never be mistaken for yours. A fix
  arriving mid-drag is ignored — a pointer on the glass always wins; the camera does
  nothing at all while the page is hidden, and re-seats in one move when you come back;
  a long jump is a cut rather than a hundred-kilometre slideshow; and the whole-route
  overview and a tapped checkpoint stand down until Re-centre rather than being undone
  by the next fix, because those are decisions, not stray pans.
- **Motorcycles avoid expressways, four ways.** Riders are barred from NLEX, SLEX,
  CAVITEX, Skyway and most Philippine expressways.
  1. **An exclusion ladder, strictest first.** OSRM's stock car profile declares three
     excludable classes and accepts them combined, so the first request sends
     `exclude=motorway,toll`. Every PH expressway a motorcycle is barred from is also
     tolled, and a few of them are tagged `trunk` rather than `motorway` in OSM, so the
     combined exclusion catches roads the plain one leaves in the line. It is also the
     request most likely to be refused — which is why it is a rung and not the only
     one: a refusal drops to plain `exclude=motorway`, and a refusal of *that* drops to
     no exclusion, each rung tried in turn and the first the server honours winning.
  2. **Alternatives, ranked by legality.** Every routing request asks for three lines
     rather than one, and for a rider they are sorted by metres spent on an expressway
     before they are sorted by time — with a 200 m dead band so a shared on-ramp never
     costs real minutes. This now happens whether or not the exclusion was accepted;
     it used to be a fallback only.
  3. **The line's own names AND refs are read back.** An expressway step routinely
     comes back named after the surface road it parallels, with the expressway only in
     OSRM's `ref` field: reading the instruction alone missed NLEX entirely. Both are
     checked, on every route, excluded or not.
  4. **One second opinion.** If the exclusion was honoured and the winning line *still*
     spends more than 800 m on something named like an expressway, RouteCast spends one
     more request with alternatives to see whether a clean line exists, and takes it
     only if it is genuinely cleaner. The panel names the metres and the road either
     way. None of the four is presented as a guarantee.
- **Planning is cheaper than it was.** Finished route responses are cached in memory
  for 90 seconds, keyed by the exact request, and an in-flight request is shared rather
  than duplicated — so toggling the vehicle to look at the difference and toggling it
  back, or tapping a saved route twice, costs one round trip to a public demo server
  instead of four. Failures are never cached; a reload is a clean slate.
- **Stops, alternative routes, swap, and long-press on the map** to drop a point.
- **Built for a phone.** The map owns the screen and everything else lives in a bottom sheet you
  drag between three heights. Safe-area aware, dynamic viewport heights so nothing jumps when the
  browser chrome hides, 44px touch targets, and inputs sized so iOS never zooms on focus.
- **Installable, and the status bar stays.** An Install button appears where the browser
  supports it, and becomes an "Add to Home Screen" walkthrough on iOS Safari, which has no
  install prompt. There is deliberately **no full-screen toggle**: it used to be there, and
  all it did was hide the clock, the signal bars and the battery meter behind a map — three
  things a phone on a handlebar is better at than anything RouteCast draws, traded for a
  strip of tiles. The manifest asks for `standalone` rather than `fullscreen` for the same
  reason. Installed or not, the notification bar is on the screen.

## The data, and why there are no API keys

Everything here is free and key-less, on purpose — this is a static page on GitHub Pages
with no backend to hide a secret in.

| Purpose | Service | Notes |
|---------|---------|-------|
| Map tiles | [OpenStreetMap](https://www.openstreetmap.org/copyright) | standard tile server |
| Place search | [Nominatim](https://nominatim.org/) | throttled to 1 request/second, as their usage policy requires |
| Routing | [OSRM demo server](https://project-osrm.org/) | `driving` profile, with alternatives |
| Forecast | [Open-Meteo](https://open-meteo.com/) | hourly, up to 16 days, batched by location |
| Terrain | [Open-Meteo elevation](https://open-meteo.com/en/docs/elevation-api) | Copernicus DEM GLO-90, up to 100 points per request |
| Traffic | *none* | predicted locally — see below |

These are public, best-effort services. If one is busy the app says so rather than
pretending. Please don't point a load test at them.

### Why there is no traffic API

Because there is no free, key-less one, and pretending otherwise would be worse than
saying so. TomTom, HERE, Google and Waze all require a key; a key in a public
JavaScript file on GitHub Pages is not a secret, it is a gift to whoever reads the
source. The government feeds that *are* open (511.org and its equivalents) cover
American metros, not Luzon.

So congestion is predicted rather than fetched, from two things this app can stand
behind:

1. **A time-of-week profile.** Congestion is overwhelmingly a function of *when* you
   set off, and the shape of a weekday is not a mystery: a sharp morning peak, a long
   evening one that starts before five and does not clear until well past eight, a
   Friday evening that is its own weather system, and Sunday mornings that are
   genuinely empty. Motorcycles are scored on a damped version of the same curve —
   a bike filters, so it feels a fraction of a jam a car sits in — while the *road* is
   still reported as congested as it actually is.
2. **Your own rides.** Once there is history, your measured speed on these exact roads
   and your measured ratio of real time to predicted time at this hour of the week both
   beat any generic curve, and the profile fades behind them.

Both are arithmetic over local data. Neither costs a request. The panel says which one
answered, in as many words, so a model is never presented as a measurement.

### Where the ETA correction comes from

Three multipliers, applied to each edge of the route in one forward pass:

```
edge_duration  x  base      the router's structural optimism, or your measured pace
               x  traffic   relative congestion at the moment you reach THAT edge
```

The pass is forward rather than a single multiply because the clock moves while you
drive: leaving at 06:30, the far end of a three-hour route is scored well after the
morning peak, not during it.

The `traffic` term is the **relative** curve — normalised so its average over a week is
exactly 1. That matters: a learned bias already contains the average congestion you ride
in, so an absolute curve would charge you for it twice. Before you have ridden anything,
`base` is a published default (1.22 for a car, 1.12 for a motorcycle); afterwards it is
your own ratio, weighted towards the bucket for this hour of the week and clamped so a
run of unusual rides cannot double an ETA. A ride only teaches the model if it was long
enough to mean anything and you actually got most of the way there — a route abandoned
after two turns says nothing about how long that road takes.

## Staying live without polling

Live is not the same as chatty. Everything that updates during a ride is driven by the
geolocation fixes the browser is already handing us — nothing polls — and every behaviour that
would cost a request has its own gate:

| What | How often it costs a request | The gate |
|------|------------------------------|----------|
| Re-timing the ETA, and every downstream checkpoint's forecast with it | never | re-samples the hourly series already in memory, once a minute |
| Refetching the forecast | every 15 minutes at most | only the checkpoints still ahead, capped at 24 of them; skipped while the page is hidden or offline, and skipped for any point already refetched in the last 10 minutes |
| Rerouting | only when you are genuinely on another road | must be more than 90 m off the line, *and* further off than the fix's own accuracy circle can explain, for four fixes running, and past a backoff that widens 15s → 30s → 1m → 2m → 5m |

Rejoining the route cancels a pending reroute and resets the backoff, so a rider who wanders off
once and comes straight back is treated as a first offence next time. A reroute asks for one
route with no alternatives, and the forecast for the new line is served from an in-memory cache
keyed by a ~5 km grid — a detour that rejoins the corridor you were already on usually costs no
weather request at all. Nothing is written to disk; the service worker still never caches a
forecast, and a reload starts clean.

Map rotation costs nothing at all: one CSS transform on the map element, eased along the shortest
arc and written only when the angle has actually moved more than a degree and a half.

## Group ride

A ride is a room. One rider hosts it, the others join with a six-character code, and
everything after that travels **directly between the phones** — WebRTC data channels over
the same transport this site already uses for KaraokeNatin and The Wolf Game
(`static/js/peer.js`). A public PeerJS broker is borrowed for the introduction only: it
relays a handful of SDP messages keyed by peer id and then has nothing further to do with
the ride. Nobody's position, chat or voice ever reaches a server.

### The planned route is static, and that is the whole point

The host plans a route the ordinary way and then sets it as the ride's planned route. It
is simplified (Douglas–Peucker, ~10 m), rounded to about a metre, chunked, and sent to
every rider — so the line on your screen is **the same geometry as the line on theirs**,
not each phone's own idea of the same road. It is drawn in its own colour (indigo,
dashed, `--rc-planned`), deliberately off both the matcha accent and the four risk
colours, because it has to read as a different *kind* of line at a glance through a
visor.

It does not move. It is not re-routed because you took a wrong turn, it does not follow
your position, and planning something of your own does not touch it. A planned route that
quietly rewrote itself per rider would not be a plan.

### Leaving the line, and the ways back

When a rider is more than 160 m from the planned route (and back inside 90 m before the
warning clears — one threshold would flicker all the way down a parallel road), one line
appears over the map: how far off you are, and a **Ways back** button. It is a button, not
a card that covers the road.

Opening it asks the router for up to three genuinely different answers, all of them real
routes rather than drawn guesses:

1. **Direct to a stop** — straight to the next stop or the destination, ignoring the
   planned line entirely. Sometimes the detour you took really is the shorter way to the
   next meeting point.
2. **Back to the planned route** — to the nearest point on the line, found by
   perpendicular projection onto its segments, not by snapping to the nearest vertex.
3. **Rejoin, then on to the stop** — one routing request through that nearest point and
   on to the stop, so the geometry actually runs along the planned road rather than being
   two lines stapled together.

Every candidate is scored on time **plus** how much of it is spent more than 70 m from
the planned corridor (a mild minute-per-kilometre penalty), so the recommendation is not
simply "whatever is fastest for me" — which, in a group, is the wrong question. All of
them are drawn: grey for the ones you have not picked, the accent colour for the one you
have. Tapping one on the map selects it; *Ride the highlighted one* hands it to live
navigation exactly as if you had planned it yourself.

Asking costs routing requests, so it is rate limited: at most one round per 45 seconds
unless you have moved 400 m or asked for a refresh yourself. Being lost is not a reason
to hammer a public demo server.

### The Ride tab

Everything about a room that is not on the map is one tab in the planner, and it used to be
six identically-styled blocks in a single column: the same uppercase grey heading over each
one, ten actions that were all the same green text link, and the two things a rider actually
reaches for mid-ride — the code, and whether they are still connected — sitting somewhere in
the middle of it. Whether you were connected, reconnecting, or waiting in a lobby was an
11.5px grey sentence.

It is now read top to bottom in the order it is needed:

- **The room card.** The code, large, and one state pill beside it — *Hosting*, *Connected*,
  *Finding the ride…*, *Reconnecting…*, *Waiting at the door* — each with its own colour, and
  a dot that pulses only while something is genuinely in flight. Copy, Invite and Leave are
  buttons rather than links, and Leave turns red under the thumb instead of looking like the
  other two. The invite link is spelled out underneath, because a button whose entire result
  happened on the clipboard is a button you cannot check.
- **The door**, when anybody is at it: its own amber box, one row per rider, a solid
  **Let in** and a quiet **Refuse**. This is the one control in the app with a safety
  consequence, and it no longer looks like everything else.
- **Riders**, with the count in the heading and each rider's *state* — host, waiting, off
  the line, offline — as a coloured tag rather than more grey text on the end of a sentence,
  because scanning a roster is looking for the odd one out.
- **The planned route** as three numbers — distance, moving time, stops — instead of one
  run-on line, with how far off the line you are as its own row: green when you are on it,
  amber when you are not.
- **Voice**, which now says which of the two paths the room is on (*Live*, *Recorded clips*,
  *Muted*, *Listen only*, or who is talking right now). That mattered and was previously
  readable only as a tooltip on a button on the other side of the screen: on the live path
  the room hears you mid-sentence, and on the fallback nobody hears a syllable until your
  thumb comes up.
- **Chat**, unchanged.
- **Host settings**, folded away. They are set once at the start of a ride and then never
  touched, and they used to sit between the riders and the chat.

Each section is separated by a hairline and real space. Inside a room the sections had no
gap between them at all, which is most of why the pane read as one undifferentiated scroll.

### The door

A room code is six characters against a public broker, and somebody will eventually guess
one. So:

- **A name is required.** "Who is that dot" is a safety question when you are driving.
- **Approval is on by default.** A guest who has not been let in can do exactly two
  things — say who they are, and ask for a snapshot. Every other message is refused *at
  the host*, not filtered out of a UI the sender is not obliged to be running.
- **A refusal is a refusal.** A refused or removed rider is told and disconnected, so
  their own reconnect loop stops dialling.
- Chat is attributed to the channel it arrived on, never to what the payload claims; it
  is length-capped and rate limited per rider; positions are range-checked and stamped
  with the receiver's clock, because a clock you do not own cannot age a marker.
- The host can turn chat or voice off for the whole room, and turning the door off lets
  in everyone already waiting rather than leaving a lobby nobody can be admitted from.

### Joining by camera

Six characters read aloud across a car park is fine until it is windy, or the other rider
still has their helmet on, or the code has an `O` and a `0` in it. So the host can put the
room code up as a **QR code** — tap *Show QR* in the room card — and it carries the ordinary
invite link, nothing else.

A guest points a camera at it from the join form. The scan **fills the code in and stops**,
for exactly the same reason the `?ride=` link does: a room is somewhere you choose to be,
the name is still required, and the host still has to let you in. Pointing a camera at a
poster is not consent to broadcast your position.

What comes back off a camera is a stranger's claim in the same way a message off the wire
is, so it is read narrowly: a `ride=` parameter in a URL, or a bare six-character code, and
nothing else. A URL that merely *contains* six characters somewhere is not a room, which is
why `codeFromScan` is checked against café wifi notices and unrelated links rather than only
against the codes it is supposed to accept.

Scanning uses the browser's own `BarcodeDetector`. Where it is missing — Safari and Firefox
at the time of writing — there is no honest fallback short of shipping a decoder, so the
button says to type the six characters instead of opening a camera that will never find
anything. Drawing a code works everywhere: the encoder is ~540 lines and has no CDN behind
it.

### Voice

Push to talk: hold the microphone button beside the map controls and speak. The room
hears you *while* you are speaking — voice rides the peer connection's own audio path
(Opus over SRTP, packetised every 20 ms), not the data channel. **Hands-free** simply
leaves the gate open.

The trick that makes the button instant is that there is nothing to set up when it is
pressed. Each link is negotiated with an audio transceiver already in it, empty, from the
moment the link exists — so starting to talk is a local `replaceTrack()` and a gain ramp,
with no offer, no answer and no round trip through a public broker. The microphone is
kept warm for a minute and a half after a release, so the second press costs nothing
either.

Opus is tuned for a motorbike rather than a podcast: wideband instead of full band,
in-band FEC so a lost packet is repaired from the next one instead of waiting for a
retransmit that would arrive too late to be a warning, and DTX so an open microphone on a
quiet rider costs the uplink almost nothing.

**A de-jitter buffer is worth its delay exactly once, at the ear.** The receiver asks for
40 ms — low enough to stay conversational, and the browser is free to grow it when a link
deserves it — but only on a device that is the *end* of the line for that audio. The host
is not: what arrives there is re-mixed and sent straight back out, so a buffer held on its
receive side was simply added to the one the guest at the far end was already holding. The
same smoothing, bought twice, and paid for by everyone in the room listening to anyone but
the host. The relay hop now asks for as little delay as the stack will give it, and
`tools/voice-latency.js` measures the difference: guest to guest through the mix came down
from about 175 ms to about 130 ms on a link with no network latency in it at all.

**Nothing waits for a server that has stopped answering.** Candidates are trickled through
the broker as they arrive, but because public brokers drop messages under load the first
description also carries whatever has been gathered by the time it is sent — so there is a
moment's wait before the offer goes out. That wait used to end when ICE gathering
*completed*, and a STUN or TURN server that has quietly died never completes gathering: it
sits there until the browser's own retransmit schedule gives up. Both ends paid it in turn,
so one dead entry in the list added about a second to every link, and the talk button was a
recorder for all of it. The wait is now over what has **arrived** rather than over a state
that may never be reached — a reflexive or relay candidate ends it immediately, host
candidates alone end it 300 ms later — and trickle carries the rest as it always did.
Measured against a deliberately black-holed STUN server, joining a ride went from 2.1 s to
1.2 s; against a dead relay in an otherwise healthy list, from 2.1 s to 1.2 s as well.

The ICE configuration can be replaced wholesale by setting `window.RC_ICE` before the
scripts load, which is both how the latency suite points at the servers it starts itself
and the escape hatch for anyone who would rather use their own relay than borrow a public
one.

The star still holds. Guests send one stream to the host and get one back; the host is a
mixer, building for each guest the sum of everyone *else* plus its own microphone. That
is how a guest hears the whole room over a single stream, and why nobody ever hears
themselves. Two people talking at once are two people talking at once, not a queue.

**The clip path is still there** as a fallback, and is what runs against a peer too old
to have the audio section, a browser without transceivers, or a host that cannot mix: the
utterance is recorded whole, base64-chunked down the data channel, relayed and played.
It is correct and it is slow — nothing leaves the phone until the recording stops — which
is precisely what the live path exists to fix. The talk button says which one you are on.

### What it costs

Nothing polls a server. Positions go out on a 2.5-second timer *or* sooner if the rider
actually moved 30 m, and the host sends one batched message for the whole room rather
than one per rider. Voice costs nothing at all until a thumb is on the button. The room's
own geolocation watch exists so presence works when neither navigation nor free drive is
running; when either of them is, their fixes are reused rather than a second watch paid
for.

## PUBs

Two things, deliberately separate, and you can have either without the other.

**Being visible** is your name and your position going out to the area. It is off until
you switch it on, and the switch is next to one sentence about what it means rather than
buried in a settings page. What leaves the phone is rounded to four decimal places — about
eleven metres — because a public broadcast does not need to say which side of the road you
are on. There is a **Go dark** button in the first card of the pane, and the rail button
carries a live count the whole time PUBs is on, because "am I still broadcasting" is a
question that must never need a tap to answer.

**A PUB room** is a chat room with no door. It carries no positions at all, so you can
walk into one without going public. Codes are published to the area, so a PUB is found
rather than shared.

### How an area works with no server

The app already knows how to introduce two browsers with nothing but a six-character code
(`peer.js`, over a public PeerJS broker). A ride's code is random and secret. A PUB's is
neither: it is **derived from where you are**, one code per ~1° cell of the world, so two
riders in the same region compute the same code without ever having spoken.

Somebody still has to hold that room, so the first phone to arrive becomes the area's hub.
Every client tries to *join* the area code first and only takes it over as host when
nothing answers; if two phones start at the same instant, one is told the code is taken
and quietly becomes a guest of the other. The hub is a relay and nothing else — it holds
the area's presence list for as long as it is there, and when it leaves the next phone to
notice picks the room up. Ride into the next cell and you are reseated on that cell's hub,
without losing the room you were chatting in.

Ride codes are drawn from an alphabet with no `0`, `1`, `I` or `O` in it — the characters
that get misread aloud. PUB codes start with one of those on purpose (`0` for an area, `1`
for a room), so a PUB can never land on somebody's private ride and a ride can never be
mistaken for a PUB.

### What it refuses

Everything off the wire is a stranger's claim. Names and messages are stripped of control
characters and capped; a fix that is not a plausible coordinate is dropped rather than
drawn at (0, 0); nobody can claim to be travelling at Mach 3 or facing 900 degrees; one
loud rider cannot flood a room. A stranger's dot is a **hollow ring**, never the solid dot
a rider in your own ride gets, because the difference has to survive a glance at a moving
map. And a hub relays; it does not moderate — a self-appointed relay moderating a public
channel is worse than one that does not, which is why the ignore list is local, permanent
and applied where messages arrive.

## Running with the screen off

A ride does not stop because the phone went in a pocket. It used to here: the tab was
backgrounded, timers were throttled to one tick a minute, the wake lock was taken away,
and a rider who pulled the phone out at the next junction found a dashboard that had
quietly lost ten kilometres.

`background.js` is the one place that fights that, and navigation, free drive, the room
and PUBs all just take a counted hold on it for as long as their session lasts. Three
things, worth knowing apart because the first is famous, the second is what actually
works, and the third is what everybody assumes is happening and is not:

1. **The screen wake lock**, re-taken on every return to visibility. The browser releases
   it whenever the page is hidden and does not give it back, which is the whole of "it
   worked until I took a call".
2. **A loop of digital silence.** A page that is playing audio is a page the browser will
   not freeze, so timers keep firing and `watchPosition` keeps delivering. It is
   inaudible, it does not duck your music, and it can only *start* from a user
   gesture — which is exactly what tapping Go or Free drive is.
3. **A heartbeat in a Web Worker.** A `setTimeout` in a hidden page is clamped to once a
   minute; the same timer in a worker is not clamped nearly as hard. It flushes the
   recorded roads and re-arms a position watch that died silently in a frozen page.

There is a switch for all of it in *You*, and it is honest: turned off, the app behaves
exactly as it did before any of this existed.

## Updates

A service worker makes an app open instantly and work with no signal by serving a copy of itself
from a cache. The cost of that is the one failure nobody reports as a bug: a phone running an old
build, with a fix in it the rider was told about and cannot see.

The shape is the one [The Wolf Game](../the-wolf-game/) and [KaraokeNatin](../karaokenatin/)
already use in this repository — including the `"skip-waiting"` message, so all three apps'
service workers answer the same word. Reusing it was the point; see the repository's
[`CLAUDE.md`](../CLAUDE.md).

What RouteCast adds is the half a navigator specifically needs: **an update never takes over
mid-ride.** `sw.js` used to call `skipWaiting()` inside `install`, which means a deploy could
swap the code out from under somebody halfway to somewhere. It no longer does. A new worker
installs, parks itself in `waiting`, and the page offers it. The rider decides when — and if a
ride is running, reloading is confirmed first, because a reload ends it.

A new version is noticed on load, every 30 minutes while the page is visible, whenever the page
comes back from hidden, and whenever the network returns. Each check is one conditional request
for `sw.js`, which is a few hundred bytes when nothing has changed. The offer is one line above
the map with a **Reload** and a dismiss; *You* carries the version number permanently and a
manual **Check for updates** for the rider who has been told a fix exists and would rather go and
get it.

One number covers all of it: the page declares `RC_VERSION`, `sw.js` carries the same value as
its cache name, and `tools/validate.js` refuses to let the two drift apart. Bumping it is what
publishes an update.

## Honest limitations

- **OSRM has no motorcycle profile.** Motorcycle routes are the driving profile with
  motorways excluded and a speed factor applied — a reasonable approximation of filtering through traffic, not a
  simulation of it. Treat the ETA as a good guess, not a promise.
- **ETAs assume you keep moving.** Fuel, food and photo stops shift every downstream
  checkpoint. Add them as stops if they matter.
- **A forecast is a forecast.** Ten hours out it is a strong hint; three days out it is a
  mood. The further along the route, the more the arrival-time forecast is guessing.
- Points beyond the 16-day forecast horizon are shown as "no data" rather than invented.
- **An update needs a reload, and a reload ends a ride.** Nothing can be hot-swapped into a
  running page, so a new version waits until the rider is ready for it rather than interrupting.
  A phone that never reloads stays on its build indefinitely, which is the correct trade.
- **Nothing survives the browser being closed.** Everything in *Running with the screen
  off* keeps a ride alive through a locked screen, another app and a phone in a pocket.
  None of it — and nothing any web page can do — keeps it alive once the browser itself is
  killed, or once iOS suspends the whole app. On the way back, every wake-up re-establishes
  the truth rather than trusting state that was frozen along with the page.
- **A PUB is only as populated as your area.** There is no directory and no server: you
  see the riders who happen to be in your ~110 km cell with PUBs on at that moment. On a
  quiet road that is nobody, and the pane says so rather than pretending.
- **A PUB area is held by a phone.** When the hub rides away, the area goes quiet for a
  few seconds until somebody else notices and picks it up. That is the honest cost of
  having no server, and it resolves itself.
- **The heat map is as coarse as the record.** It is drawn from the same ~124 m cell
  chain the planner uses, so it shows the roads you use and not the lane you were in —
  and a stretch with no usable speed is left out of the speed view rather than parked at
  one end of the ramp pretending to be the slowest thing on the map.
- **Course-up is a riding mode, not a browsing mode.** Leaflet has no rotation of its own, so the
  map element is rotated with a CSS transform — which means Leaflet's pointer maths no longer
  matches what you see. Rather than let dragging drift off-axis, dragging is disabled while
  rotated (a drag drops you back to north-up instead), zoom is anchored to the map centre, and
  Leaflet's own zoom buttons are hidden. A rotated rectangle also only covers its container if it
  is grown to that container's diagonal, so course-up loads roughly 1.4x the tiles. That is the
  price of the mode, and it is why north-up stays the default.
- **A reroute is a new route, not a repair.** It drops the alternatives you were offered and
  re-samples the checkpoints from where you are, so the departure planner's advice belongs to the
  trip you originally planned.
- **The traffic model is a model.** It knows what time it is, not what is happening. It cannot
  see the accident that closed two lanes ten minutes ago, and no amount of history will teach
  it to. Treat it as "this hour is usually bad", which is genuinely useful for choosing a
  departure time and useless for choosing a lane.
- **The road history is a grid, not a map.** OSRM hands back a polyline, not OSM way ids, so
  there is nothing stable to key a road by; a ~124 m cell chain is the honest approximation.
  It is fine enough to tell a highway from the service road beside it and coarse enough that a
  wobbling fix does not invent a new road every second, but it cannot distinguish a flyover
  from the street underneath it.
- **Familiarity is a preference, not a rule.** It reorders the alternatives the router already
  offered; it cannot ask for a route down a particular road, because OSRM has no way to be
  asked. If your favourite road is not in any of the offered lines, adding a stop on it is
  still the only way to insist.
- **The expressway check reads names.** It is a heuristic over free text: it can miss an unnamed
  motorway segment and be fooled by an unusual one. It is a second opinion on top of
  `exclude=motorway`, never a substitute for reading the signs.
- **A free ride teaches roads, not timings.** There was no estimate for it to be right
  or wrong about, so it is recorded as roads travelled and nothing else. Its elevation
  comes from the phone's GPS altitude with a three-metre deadband rather than from the
  terrain model — there is no route to fetch a profile for — so treat the climb figure
  as a shape, not a survey.
- **DEM elevation is not your altimeter.** The terrain model is 90 m resolution and steadier
  than a phone's GPS altitude, which is why the dashboard prefers it — but on a bridge or in a
  cutting it reports the ground, not the road. The tile says which source it is using.
- **A group ride is only as up as its host.** The room is a star: everyone talks to the
  host and the host relays. That is what makes one authoritative planned route possible,
  and it means the host's connection is the room. If the host closes the tab, the ride
  ends for everybody; there is no host migration.
- **Voice is a walkie-talkie, not a conference call.** It is live now, but it is still
  half-duplex by habit: a thumb on a button, eyes on the road. A peer that cannot
  negotiate the audio section falls back to recorded clips, where you hear a sentence
  only once it is finished, and a host whose browser has no Web Audio cannot mix, so its
  whole room falls back with it. Autoplay rules mean a phone that has not been touched
  yet may need one tap before it will play anything.
- **The signalling broker is somebody else's, and so is the relay.** Rooms are introduced
  through public PeerJS brokers and hard NATs fall back to a public TURN relay. A relay
  that has stopped answering no longer costs a second of setup, but it still costs the
  riders who needed it their link: there is no free public TURN server that can be relied
  on, and this app has no server of its own to run one. `window.RC_ICE` is there for anyone
  who does. If both are down, a guest cannot find a host — the app retries for as long as
  you leave it open, but there is no backend here to fix that.
- **A room code is not a password.** It is six characters, which is why approval is on by
  default and why it should stay on. Turn it off only among people you can see.
- **Positions are as good as the phones sending them.** A rider in a tunnel goes stale
  rather than wrong: their last known dot dims instead of vanishing, which is information,
  not a promise about where they are now.
- **Twelve riders.** A host holds one connection per rider; the cap is its uplink, not a
  licence limit.
- **Recorded roads live in `localStorage`.** Persistent storage is requested but only ever
  granted as a heuristic, and clearing site data clears the lot. There is no export yet.

## How it is built

Plain HTML, CSS and JavaScript in the style of the rest of this site — no build step, no
framework, no bundler. Leaflet is vendored locally in `vendor/`.

```
routecast/
  index.html
  sw.js                     service worker: caches the shell, never the forecast
  manifest.webmanifest
  static/css/app.css
  static/js/
    util.js                 formatting, storage, fetch with timeout/retry, rate-limit queue,
                                          bearings and the course tracker every mode shares
    info.js                 RC.info     — the sheet every (i) opens, and all the long copy
    update.js               RC.update   — noticing a new build, and offering it rather than
                                          applying it
    icons.js                inline SVG weather and UI icons
    background.js           RC.background — wake lock, silence, worker heartbeat: the ride
                                          keeps running with the screen off
    history.js              RC.history  — the roads you actually rode, and how long they took
    heat.js                 RC.heat     — that record, drawn: visits, speed, held-up, recency
    traffic.js              RC.traffic  — time-of-week congestion, grounded in your own rides
    eta.js                  RC.eta      — per-edge ETA calibration; everything downstream reads it
    coords.js               RC.coords   — coordinate parsing: decimals, DMS, geo:, map links
    routes.js               RC.routes   — saved routes, kept as points rather than geometry
    marks.js                RC.marks    — saved marks: coordinates you named yourself
    geocode.js              RC.geocode  — Nominatim search + reverse, throttled and cached
    router.js               RC.router   — OSRM routing, cumulative arrays, expressway detection
    sampler.js              RC.sampler  — walks the route, emits checkpoints with ETAs
    weather.js              RC.weather  — Open-Meteo batching, hourly interpolation, WMO codes
    elevation.js            RC.elevation— Open-Meteo DEM profile, climb/descent, grade at a point
    risk.js                 RC.risk     — vehicle-aware scoring, advice, departure planner
    pick.js                 RC.pick     — the centre-pin place picker
    qr.js                   RC.qr       — a QR encoder, lifted from KaraokeNatin; no CDN
    peer.js                 RC.net      — WebRTC data channels over a public broker; no backend
    voice.js                RC.voice    — live voice: the pre-negotiated audio path, host mixing
    rejoin.js               RC.rejoin   — planned-route geometry: projection, simplify, ways back
    group.js                RC.group    — the room: roster, the door, chat, voice, the planned route
    groupui.js              RC.groupui  — the room on screen: the Ride tab, the layers, the
                                          cards, and the rail of riders above the speedometer
    pubs.js                 RC.pubs     — the public road: area hubs, presence, PUB rooms
    pubsui.js               RC.pubsui   — PUBs on screen: the Pubs tab, the strangers layer
    nav.js                  RC.nav      — live navigation: route projection, live ETA, wake lock,
                                          reroute and forecast-refresh gating, ride recording
    free.js                 RC.free     — free driving: the dashboard and the recorder, no route
    follow.js               RC.follow   — the camera: who owns the map, you or the app
    compass.js              RC.compass  — heading sources, north-up / course-up map rotation
    app.js                  the glue: map, form, the render pipeline, the draggable sheet
    pwa.js                  install prompt and the iOS add-to-home-screen fallback
  tools/validate.js         static + pure-module suite: `node tools/validate.js`
  tools/group-e2e.js        two real browsers, one room: `node tools/group-e2e.js`
  tools/voice-latency.js    three browsers, one room, a stopwatch on the voice path
  tools/broker.js           a local stand-in for the public broker; not shipped
  tools/stun.js             a STUN server, ~150 lines, with a dead mode and a slow one
  tools/turn.js             a TURN server that actually relays, for the relay-only case
```

## Testing

```
node tools/validate.js
```

No dependencies, no build step. It runs two halves. The static half reads the source as
text: no emoji anywhere (every glyph in this app is an inline SVG, deliberately), every
SVG well formed, every element id the JavaScript reaches for present in `index.html`,
every script the page loads also in the service worker's shell, every `var(--token)`
defined, and the light and dark palettes carrying the same set of tokens as each other.
The behaviour half runs the pure modules in a sandbox with just enough browser to
satisfy them, and checks the things that would be expensive to get wrong: that a parked
phone records no roads and a GPS jump records no road, that a road ridden once reads as
familiar and one never ridden does not, that familiarity never buys a route that is
genuinely slow, that the relative traffic curve averages exactly 1 over a week, that
a calibrated ETA is slower than the router's and that leaving at 3am beats leaving at
5pm by more than a flat multiplier could manage, that a ride too short to mean anything
is thrown away, that a road named "Skyway Avenue" is not mistaken for the Skyway and one
carrying NLEX only in its `ref` still is, that `14.5995N` reads as a decimal coordinate
rather than as one degree four minutes in the Gulf of Guinea while a street address reads
as neither, that a mark re-saved on the same spot renames rather than duplicates, and that
a free ride's odometer refuses a parked phone's jitter, a step inside its own error circle
and a teleport alike.

It also checks the things the newer features would be expensive to get wrong: that a
moving vehicle has a heading even when the chipset reports none and a parked one does not,
that a turn is followed and a reported GPS course is used as given; that the recorded
roads come back as real geometry at roughly the speed they were ridden, and that riding a
road a second time makes one segment hotter rather than inventing a second one; and that
two riders in the same region derive the same PUB area code while riders in different
regions do not, that an area code can never be mistaken for a ride code, and that a
stranger cannot claim to be at 99,999 km/h or facing 905 degrees.

Two invariants that are cheap to check and expensive to lose are checked as text: that the
version the page reports and the version the worker serves are the same number, and that every
`skipWaiting()` in the service worker is one the page asked for — an update that installs itself
is the bug the whole mechanism replaces. The info sheet is checked the same way: every **(i)** in
the page has to name a topic that exists, no topic may be unreachable, and no hint in the panel
may have grown back into a paragraph.

The QR encoder is checked there too, against the tables in ISO/IEC 18004 rather than
against itself: that every version leaves exactly the standard number of free data modules,
that the block layouts account for every codeword, that the finder and timing patterns
survive masking, that version selection tracks the documented byte-mode capacities and that
an oversized payload fails loudly instead of drawing a convincing symbol that decodes to
nothing. Those invariants came across with the encoder because they are what caught its one
real bug — alignment patterns wrongly omitted where they cross the timing lines, which
silently shifted every data module from version 7 up. The rule for what a *scanned* string
is allowed to mean is pinned next to them.

The group ride's own arithmetic is checked in the same half: that the nearest point on a
planned line is found abeam rather than at a vertex, that a straight line simplifies to
its endpoints while a corner never does, that a route laid over the planned one counts as
nothing off the corridor while one a kilometre to the side counts as all of it, that a
stop already passed drops off the list while a destination never does, that three
distinct ways back are offered with exactly one recommended and the same road is never
offered twice under two names, and that what arrives off the wire is treated as a
stranger's claim — an impossible speed clamped, a coordinate outside the globe refused, a
heading normalised, a timestamp replaced with the receiver's own.

```
node tools/group-e2e.js
```

The room itself cannot be tested in one JavaScript context, so this one drives **two real
Chromium contexts** through the real transport, with the public broker replaced by
`tools/broker.js` on localhost and OSRM, Open-Meteo, Nominatim and the tiles answered
locally. It checks the claims that are about another machine: that a code finds a host,
that an unapproved guest reaches a lobby and nothing it sends reaches the room, that the
planned route arrives whole and byte-identical rather than recomputed, that a rider's own
re-plan does not move it, that drifting off it produces several ways back with one
highlighted, that a push-to-talk clip recorded from a fake microphone is encoded, chunked,
relayed and heard at the other end, that a guest cannot post under the host's name or
flood the room, and that nothing overflows the screen in either orientation.

It also joins a third rider **by camera**: the host's QR is drawn for real, and a stubbed
`BarcodeDetector` hands the app what a reader would have seen, so what is under test is the
path from "the detector saw this string" to "the rider is at the door" — including that the
camera is released the moment the code is read, that scanning alone puts nobody in the room,
and that a scanned rider can be refused like any other. It needs Playwright; everything else
in `tools/` needs nothing at all.

```
node tools/voice-latency.js
```

"Voice feels slow" is not something you can fix; a number is. This puts **three** Chromium
contexts in one room — a host and two guests — replaces each one's microphone with a tone
whose start time the test knows, and watches for that tone arriving at the far end with an
analyser. Three numbers come out: how long after joining the talk button stops being a
recorder, how long a guest takes to reach the host, and how long a guest takes to reach
*another* guest, which is the long way round through the host's mix.

The ICE servers are its own. `tools/stun.js` is a STUN Binding server with two failure
modes bolted on — `black` answers nothing at all, `slow` answers late — and `tools/turn.js`
is a real TURN server (Allocate, CreatePermission, ChannelBind, ChannelData and the Send
and Data indications) that relays over UDP and can be told to add latency to every packet
it carries. Borrowing a public server for this would have measured that server's afternoon
rather than this app's code, and no public server can be asked to die on cue.

Five cases run: STUN answering, STUN black-holed, a dead TURN entry sitting in an
otherwise healthy list, `iceTransportPolicy: "relay"` with both riders forced through the
relay, and a relay 120 ms away. The second and third are the ones that found something —
see below.

Nothing is sent anywhere but those services. Your last trip, your saved routes and the
record of the roads you have ridden all live in `localStorage` and never leave the device —
nothing is uploaded, and there is no analytics of any kind. *Your roads* in the panel shows
exactly what has been kept and throws all of it away in one tap.

A group ride is the one thing here that shares anything, and it shares it with the people
in the room and nobody else: positions, chat and voice go straight to the other phones
over WebRTC. Nothing is stored anywhere central, nothing outlives the room, and the only
thing kept on your own device is the name you last used.
