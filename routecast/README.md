# RouteCast

A map navigator for **cars and motorcycles** that answers the question a normal
navigator ignores: *what will the weather be doing where I am, when I get there?*

Plan a route, and RouteCast breaks it into checkpoints, works out roughly when you
will reach each one, and fetches the forecast for that place **at that hour** — not
the forecast for right now, and not the forecast for your destination only.

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
- **Drop a pin by moving the map.** Start, destination and every stop can be set with the
  classic centre-pin picker: the pin stays fixed, you move the map under it, and the address
  updates as you settle. The confirmed coordinate is always the exact centre — never the
  place Nominatim snapped to, which can be a block away from where you pointed.
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
- **Motorcycles avoid expressways.** Riders are barred from NLEX, SLEX, CAVITEX, Skyway and
  most Philippine expressways, so motorcycle routes ask the router to exclude motorways. If
  the routing server cannot honour that, the app says so rather than handing you an illegal
  route.
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

These are public, best-effort services. If one is busy the app says so rather than
pretending. Please don't point a load test at them.

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
    geocode.js              RC.geocode  — Nominatim search + reverse, throttled and cached
    router.js               RC.router   — OSRM routing, cumulative distance/duration arrays
    sampler.js              RC.sampler  — walks the route, emits checkpoints with ETAs
    weather.js              RC.weather  — Open-Meteo batching, hourly interpolation, WMO codes
    risk.js                 RC.risk     — vehicle-aware scoring, advice, departure planner
    pick.js                 RC.pick     — the centre-pin place picker
    nav.js                  RC.nav      — live navigation: route projection, live ETA, wake lock,
                                          reroute and forecast-refresh gating
    compass.js              RC.compass  — heading sources, north-up / course-up map rotation
    app.js                  the glue: map, form, the render pipeline, the draggable sheet
    pwa.js                  install prompt, iOS fallback, full-screen toggle
```

Nothing is sent anywhere but those four services. Your last trip is remembered in
`localStorage` and never leaves the device.
