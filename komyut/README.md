# TheCommuters

A social app for directions. (Formerly KomyutApp; it still lives at
`/komyut/`, so installed copies and the email links already sent keep
working.)

Almost nothing in the Philippines is on a published timetable. The jeepney
that gets you from Cubao to Montalban exists, runs a route everybody who
rides it knows, charges a fare everybody who rides it knows — and is written
down nowhere. The knowledge is real, it is just held by people rather than by
an operator.

TheCommuters is somewhere to put it. Anybody can **file a route**: list the
stops in order, say what kind of ride it is, say what it costs. Anybody can
**vote on one**, which is how a route that has been rerouted or has quietly
stopped running sinks out of the way. And once there are routes in an area,
the app will **plan a trip across them**, transfers included — because a
commute here is almost never one ride.

Live at <https://nojukuramu.github.io/komyut/>.

It is aimed at the Philippines first and it is not limited to it: a route
carries its own country and currency, so a tuk-tuk line in Chiang Mai works
exactly the same way a tricycle line in Antipolo does.

## What it does

- **Routes people filed themselves.** Jeepney, bus, UV Express, tricycle,
  habal-habal, train, ferry, shuttle, pedicab. Each one carries its stops in
  order, the line between them, a fare range, and whatever the person who
  filed it thought was worth knowing — where it waits, when it stops running,
  which sign to look for.

- **A trip planner that changes rides.** Pin where you are and where you are
  going, and it chains community routes together, up to two changes. It
  prefers routes people have backed with votes over routes that merely look
  fast on a map, and it tells you how far you walk — which on a Philippine
  commute is the number that decides whether a route is usable in the rain,
  and exactly the number a "fastest route" ranking makes invisible.

- **A reliability meter, and it is not a vote count.** Ten up and nothing
  else is weaker evidence than two hundred up and three down, and a plain
  ratio calls them identical. The meter asks instead: given this many votes,
  how low could the real approval plausibly be? So a route earns confidence
  by being voted on, not only by being voted on well. It falls as a route
  ages without anybody confirming it, because routes change. For a trip with
  changes it shows the **weakest leg**, not the average — the weak leg is the
  one that strands you.

- **A validated tag.** Somebody trusted checked the route against the real
  line. It is a floor, not a trump card: a validated route the community has
  since voted down still falls, because the tag means *it was right when it
  was checked*.

- **Comments, per route.** Flat, not threaded, and votable. "Still runs, but
  it turns at the market now" is the most valuable sentence in this app and
  it needs somewhere to go.

- **The weather along the line.** The forecast for each stretch of a route at
  the hour you would reach it — not the forecast for now, and not the
  forecast for where it ends. Same idea as
  [RouteCast](https://nojukuramu.github.io/routecast/), applied to a commute:
  the useful question is whether the twenty minutes you spend standing at the
  transfer are the twenty minutes the squall arrives.

- **A proper sign-in page.** Signing in, creating an account, "forgot my
  password", "check your inbox", a new password from a reset link, choosing
  a handle and changing a password are one full-screen page with a step for
  each. Every field is checked as it is typed and says so beside itself:
  the handle says whether it is free, the password ticks off its rules and
  fills a strength meter, the confirmation says whether it matches. A
  password can be shown, Caps Lock is noticed, "keep me signed in" decides
  whether the session outlives the tab, "send it again" counts down rather
  than being refused, and "sign out on every device" is one button.

- **Email links land somewhere.** A confirmation link signs you in and says
  so in one line; a reset link lands on a "choose a new password" step; an
  expired or already-used one says which, rather than dropping you on a page
  that looks like nothing happened. The tokens those links carry are wiped
  from the address bar the moment they are read.

- **Read everything signed out.** Search every route, open every one, read
  every comment, plan every trip, with no account at all. An account is for
  *writing* — filing, voting, commenting — so that a vote means one person
  and a route has somebody's name against it.

- **It installs, and it tells you when it has been updated.** A cached app
  with no update path is a phone quietly running a build from three deploys
  ago. TheCommuters watches for a new version, offers it in one dismissible
  line, and never applies it on its own.

## Setting it up

The app needs a [Supabase](https://supabase.com) project. Everything else —
maps, routing, geocoding, forecast — is free and key-less.

1. **Make a project.** Any region; the free tier is plenty.

2. **Run the schema.** In the dashboard, **SQL Editor → New query**, paste
   the whole of [`supabase/schema.sql`](supabase/schema.sql), and **Run**.
   It is one script — do not run it a piece at a time — and it takes a
   couple of seconds. It creates the tables, the triggers that keep the
   vote counts honest, the Row Level Security policies and the functions
   the app calls. It is written to be re-runnable, so running it again
   after an edit is safe and will not drop anybody's routes.

   Then run [`supabase/verify.sql`](supabase/verify.sql) the same way. It
   writes nothing and returns a list of what the database now has; every
   row should say `ok`.

   If the app says **"The community database is not set up yet"**, this is
   the step it means: PostgREST answered with a 404, which only ever means
   it has no such table or function. Run `schema.sql` again (it also
   reloads PostgREST's schema cache and gives a profile to any account
   that signed up before it existed), and check **Settings → Data API**
   lists `public` among the exposed schemas.

3. **Fill in two values** in [`static/js/config.js`](static/js/config.js):

   ```js
   SUPABASE_URL:      "https://<your-project>.supabase.co",
   SUPABASE_ANON_KEY: "<the publishable key>"
   ```

   Project Settings → API. Newer projects call it the **Publishable key**
   and it starts `sb_publishable_`; older ones call it **anon public** and
   it is a JWT. Either works. Not the secret key (`sb_secret_` /
   `service_role`) — see the note below about which of these is a secret
   and which is not.

4. **Allow the app's address to be redirected to.** Authentication → URL
   Configuration → **Redirect URLs** → Add URL:

   ```
   https://nojukuramu.github.io/komyut/**
   ```

   Add `http://localhost:8000/**` (or whatever port you serve on) as well
   if you work on it locally.

   This list is the part that matters. The app asks GoTrue to send people
   back to its own page — it passes `redirect_to` on both sign-up and
   password reset — and GoTrue refuses any address that is not on this
   list, falling back to **Site URL** instead.

   Site URL is worth setting too, as the backstop for anything that does
   not name a redirect:

   | Field | Set it to |
   |---|---|
   | Site URL | `https://nojukuramu.github.io/komyut/` |

   Note the path. Site URL is one value for the **whole Supabase project**,
   and this origin carries a dozen apps, so `https://nojukuramu.github.io/`
   on its own drops people on the site's front page with an access token
   stuck to the end of the URL and nothing there to read it. That is why
   the app names its own redirect rather than trusting this setting.

   Whichever route they arrive by, the app reads the tokens out of the
   fragment those links come back on, signs you in and wipes them from the
   address bar; a reset link lands on a "choose a new password" step.

5. **Set the auth options you want.** Authentication → Providers → Email.
   Leave email confirmation on and the app says "check your email"; turn it
   off and sign-up signs you straight in. Either works.

6. **Make yourself a moderator**, once you have signed up:

   ```sql
   update public.profiles set is_moderator = true where handle = 'yourname';
   ```

   A moderator is the only account that can move the validated tag, hide
   somebody else's route, or read the reports.

Without step 3 the app still runs: the map, the route builder and the weather
all work, and every community surface says it is not connected rather than
failing silently.

### About that key

The house rule in this repository is *no API keys, and therefore no service
that needs one*, and this is worth a word.

That rule exists because a **secret** in a public script is a donation. A
Supabase **publishable key** is not a secret: it is the identifier every
browser session is supposed to carry, it is safe to print on a billboard, and
on its own it grants nothing at all. What decides who may read and write what
is Row Level Security, enforced in Postgres where the browser cannot reach
it. Every policy this app relies on is in `supabase/schema.sql` so it can be
read rather than trusted.

The keys that *would* be a donation — the secret key (`sb_secret_` /
`service_role`), the database password, the JWT secret — are not here and
must never be. `tools/validate.js` checks the shape of what is in
`config.js` and fails on anything that is not a publishable key, because
"we pasted the right one" is not a mechanism either.

## How it is put together

No build step, no framework, no bundler. Plain HTML, CSS and JavaScript, with
Leaflet vendored under `vendor/`.

Notably, **the Supabase SDK is not vendored**. What this app needs from
Supabase is two ordinary REST APIs — PostgREST for the tables and GoTrue for
sign-in — and both are plain HTTP with JSON. `static/js/supa.js` is that
conversation written out, in about the space the SDK's import statement would
take, with a chainable query builder in the shape the SDK uses so the calling
code reads the way somebody who knows Supabase expects. The alternative was a
minified ESM blob carrying a realtime client and a storage client this app
never touches, which nobody would ever read.

Quite a lot came straight from elsewhere in this repository rather than being
invented again:

| Here | Came from |
|---|---|
| `static/js/util.js` | `routecast/static/js/util.js`, namespace changed |
| `static/js/update.js` | `routecast/static/js/update.js`, near-verbatim |
| `static/js/info.js` | RouteCast's info-sheet mechanism, own topics |
| `static/js/geocode.js` | `routecast/static/js/geocode.js` |
| `sw.js` | the shape all four PWAs here share, same `"skip-waiting"` word |
| `vendor/leaflet/` | RouteCast's copy |

The rest:

| File | What it is |
|---|---|
| `static/js/sanitize.js` | what a stranger is allowed to write down |
| `static/js/supa.js` | PostgREST + GoTrue, written out |
| `static/js/transit.js` | route types, and the reliability model |
| `static/js/routes.js` | every read and write of community data |
| `static/js/plan.js` | the journey search, transfers included |
| `static/js/router.js` | OSRM, multi-stop |
| `static/js/weather.js` | Open-Meteo along a line |
| `static/js/map.js` | the one module that touches Leaflet |
| `static/js/ui.js` | the card, the meter, the vote control |
| `static/js/builder.js` `detail.js` `browse.js` `planner.js` `account.js` `finder.js` | the five panes and the place picker |
| `static/js/auth.js` | the sign-in page: every step, checked as it is typed |
| `static/js/app.js` | the shell: tabs, sheet, toast, pin picking |

### The journey search, briefly

One request fetches every route whose bounding box overlaps a padded box
around the two pins. Each route's polyline is sampled every 120 m and dropped
into a grid of ~300 m cells; two routes sharing a cell can be changed between
there. Then a cheapest-first search over *routes* rather than over points: a
state is "on route R, at metre M along it", and the moves are get off and
walk to the destination, or get off at a shared cell and get on the route
that shares it.

A leg's cost is its time at that vehicle's realistic average speed plus its
typical boarding wait, with walking counted at 1.7× its duration — ten minutes
walking is not ten minutes sitting — and then inflated by how unreliable the
route is:

```
weight = 1 + (1 - reliability) * 0.8
```

which is how "prefer the nearest route with the best votes" becomes a number
rather than a slogan. A route nobody has voted on is never excluded; it is
simply beaten by a route people have backed, unless it saves you a real walk.

Routes are treated as running **both** directions, because almost every
jeepney and tricycle line does and the alternative would hide the return trip
on every route in the database. A genuinely one-way loop is the case this
gets wrong.

## Security

This is the first app in this repository where one person's typing is shown
to another person, so a few things are mechanical rather than careful:

- **Markup enters the DOM in exactly one function.** `KM.glyph` in `util.js`,
  and what it puts there can only ever be one of the icon constants in
  `icons.js`. Every route name, description, place name, handle and comment
  reaches the page through `textContent`. `tools/validate.js` fails if any
  other module assigns to `innerHTML` at all.
- **The page's Content-Security-Policy is `script-src 'self'`** with no
  `unsafe-inline` — which is why the theme bootstrap is a file
  (`static/js/boot.js`) rather than an inline block. `default-src 'none'`,
  and `connect-src` names the four services the app may speak to.
- **Input is normalised on the way in.** Control characters, bidirectional
  overrides (which reorder what is *displayed* without changing what is
  stored) and zero-width characters are stripped; every Unicode space
  collapses; text is NFC-normalised. Accents and non-Latin scripts are
  deliberately left alone — a filter that rejects a real place name is a bug,
  not a protection.
- **The committed key is checked for its shape.** `config.js` is the one
  file allowed to carry one, so it is the one file looked at properly: the
  harness fails on a secret key or a session token, and on a `service_role`
  JWT in particular.
- **Every limit is enforced twice.** `sanitize.js` applies it in the client
  and the schema repeats it as a `CHECK`, and `tools/validate.js` fails if
  the two ever disagree.
- **Nothing derived is writable.** Vote counts, comment counts and the
  bounding box are maintained by triggers; a client that `PATCH`es `upvotes`
  gets a 200 and no change. The validated tag is refused to non-moderators by
  a trigger, so even a policy mistake later cannot open it.
- **No dynamic SQL anywhere.** Search, voting and the bbox lookup are
  functions taking parameters.
- **Where you are is not shared with anybody.** It centres the map, starts a
  trip, and places a stop when you ask. It is not sent to the database.

## Checking it

```
node tools/validate.js    # 173 checks: static, security, and the pure logic
node tools/e2e.js         # the app in a real browser, every service stubbed
node tools/make-icons.js  # regenerates static/*.png
```

`validate.js` needs nothing. `e2e.js` needs `playwright` installed (the
browser itself is usually already on the machine); without it, it says so and
exits cleanly rather than failing.

The browser pass is worth describing, because half of it is one test: the
stubbed database returns a route whose name and description are markup and a
comment whose body is a `<script>` tag that sets a global. The suite then
asserts the global was never set, that the name reads back as the exact
characters that were sent, and that no element was created from any of it.
Every outside request is answered locally and anything unaccounted for is
failed loudly — a request to an address nobody expected is exactly what an
injection would produce.

## Credit

Maps and place search from [OpenStreetMap](https://www.openstreetmap.org/)
and its contributors, routing from the
[OSRM](https://project-osrm.org/) demo server, forecast from
[Open-Meteo](https://open-meteo.com/). None of them needs a key and none of
them is asked for anything until you ask for it first.
