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
- **Stops, alternative routes, swap, and long-press on the map** to drop a point.

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

## Honest limitations

- **OSRM has no motorcycle profile.** The motorcycle timing is the driving profile with a
  speed factor applied — a reasonable approximation of filtering through traffic, not a
  simulation of it. Treat the ETA as a good guess, not a promise.
- **ETAs assume you keep moving.** Fuel, food and photo stops shift every downstream
  checkpoint. Add them as stops if they matter.
- **A forecast is a forecast.** Ten hours out it is a strong hint; three days out it is a
  mood. The further along the route, the more the arrival-time forecast is guessing.
- Points beyond the 16-day forecast horizon are shown as "no data" rather than invented.

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
    app.js                  the glue: map, form, and the render pipeline
```

Nothing is sent anywhere but those four services. Your last trip is remembered in
`localStorage` and never leaves the device.
