# RouteCast

A map navigator for **cars and motorcycles** that answers the question a normal
navigator ignores: *what will the weather be doing where I am, when I get there?*

Plan a route, and RouteCast breaks it into checkpoints, works out roughly when you
will reach each one, and fetches the forecast for that place **at that hour** — not
the forecast for right now, and not the forecast for your destination only.

Or skip the planning entirely and hit **Free drive**: the dashboard, the recorder and
the local forecast, with no destination and nothing to count down to.

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
- **Installable and full screen.** An Install button appears where the browser supports it (and
  becomes an "Add to Home Screen" walkthrough on iOS Safari, which has no install prompt). A
  full-screen toggle uses the Fullscreen API where it exists, and hides itself where it does not
  rather than sitting there dead — on an iPhone, installing to the home screen *is* how you get
  full screen.

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

## Honest limitations

- **OSRM has no motorcycle profile.** Motorcycle routes are the driving profile with
  motorways excluded and a speed factor applied — a reasonable approximation of filtering through traffic, not a
  simulation of it. Treat the ETA as a good guess, not a promise.
- **ETAs assume you keep moving.** Fuel, food and photo stops shift every downstream
  checkpoint. Add them as stops if they matter.
- **A forecast is a forecast.** Ten hours out it is a strong hint; three days out it is a
  mood. The further along the route, the more the arrival-time forecast is guessing.
- Points beyond the 16-day forecast horizon are shown as "no data" rather than invented.
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
    util.js                 formatting, storage, fetch with timeout/retry, rate-limit queue
    icons.js                inline SVG weather and UI icons
    history.js              RC.history  — the roads you actually rode, and how long they took
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
    nav.js                  RC.nav      — live navigation: route projection, live ETA, wake lock,
                                          reroute and forecast-refresh gating, ride recording
    free.js                 RC.free     — free driving: the dashboard and the recorder, no route
    follow.js               RC.follow   — the camera: who owns the map, you or the app
    compass.js              RC.compass  — heading sources, north-up / course-up map rotation
    app.js                  the glue: map, form, the render pipeline, the draggable sheet
    pwa.js                  install prompt, iOS fallback, full-screen toggle
  tools/validate.js         the whole test suite: `node tools/validate.js`
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

Nothing is sent anywhere but those services. Your last trip, your saved routes and the
record of the roads you have ridden all live in `localStorage` and never leave the device —
nothing is uploaded, and there is no analytics of any kind. *Your roads* in the panel shows
exactly what has been kept and throws all of it away in one tap.
