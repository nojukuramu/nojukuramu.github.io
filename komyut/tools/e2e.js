#!/usr/bin/env node
/* ============================================================
   KomyutApp — the app in a real browser
   `node tools/e2e.js`

   tools/validate.js can check that the wiring is wired and that the pure
   functions are right. It cannot check that a tab opens a pane, that the
   route builder draws a line, or — the one that matters most here — that a
   route name written by somebody hostile arrives on the page as TEXT.

   So this drives Chromium through the app with every outside service
   stubbed at the network layer. Nothing reaches the internet: the page is
   served from disk, the community database, the router, the geocoder, the
   forecast and the map tiles are all answered locally, and any request
   this file has not accounted for is failed loudly rather than allowed —
   which is a test in itself, because a request to an address nobody
   expected is exactly what an injection would produce.

   The hostile fixture
   -------------------
   The stubbed database returns a route whose name, description and place
   names are markup, and a comment whose body is a <script> tag that sets a
   global. The test then asserts three things: the global was never set,
   the route's name reads back as the exact characters that were sent, and
   the page contains no element that came from them.

   Run: node tools/e2e.js
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.log("playwright is not installed here; skipping the browser pass.");
  console.log("  npm install playwright   (the browser itself is already on the image)");
  process.exit(0);
}

const ROOT = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"
};

/* `node tools/e2e.js --shots <dir>` also writes a screenshot at each of the
   named moments below. Nothing in the suite depends on them; they exist so
   a change to the layout can be looked at rather than argued about. */
const SHOT_DIR = (() => {
  const i = process.argv.indexOf("--shots");
  return i === -1 ? null : (process.argv[i + 1] || path.join(ROOT, "shots"));
})();
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
let shotN = 0;
async function shot(page, name) {
  if (!SHOT_DIR) return;
  shotN++;
  await page.screenshot({ path: path.join(SHOT_DIR, String(shotN).padStart(2, "0") + "-" + name + ".png") });
}

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (ok || extra === undefined ? "" : "  -> " + extra));
  if (!ok) failures++;
}
function section(t) { console.log("\n" + t); }

/* ---------- the fixture ---------- */
const HOSTILE_NAME = '<img src=x onerror="window.__pwned=1">Cubao line';
const HOSTILE_DESC = 'Runs past </p><script>window.__pwned=2<\/script> the terminal';
const HOSTILE_COMMENT = 'Still running <script>window.__pwned=3<\/script> as of today';
const HOSTILE_HANDLE = 'juan';
const BAD_PASSWORD = 'hunter2hunter2';
const GOOD_PASSWORD = 'correct-horse-9';

function polyline6(points) {
  let out = "", lastLat = 0, lastLon = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : (v << 1);
    let s = "";
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lat, lon] of points) {
    const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6);
    out += enc(la - lastLat) + enc(lo - lastLon);
    lastLat = la; lastLon = lo;
  }
  return out;
}

const LINE = [];
for (let i = 0; i <= 40; i++) LINE.push([14.60 + i * 0.0008, 121.00 + i * 0.0008]);

const ROUTE_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  name: HOSTILE_NAME,
  route_type: "jeepney",
  description: HOSTILE_DESC,
  origin_name: "<b>Cubao</b>",
  destination_name: "Montalban",
  city: "Quezon City",
  country_code: "PH",
  fare_min: 13, fare_max: 45, currency: "PHP",
  distance_m: 8400, duration_s: 1800,
  upvotes: 12, downvotes: 1, score: 11, comment_count: 1,
  validated: true,
  last_confirmed_at: new Date().toISOString(),
  created_at: new Date(Date.now() - 86400000).toISOString(),
  author_handle: HOSTILE_HANDLE,
  author: { handle: HOSTILE_HANDLE, display_name: null },
  relevance: 0.5
};

const FULL_ROUTE = Object.assign({}, ROUTE_ROW, {
  path: LINE,
  stops: [
    { lat: 14.60, lon: 121.00, name: "<i>Cubao</i> terminal" },
    { lat: 14.632, lon: 121.032, name: "Montalban" }
  ],
  author_id: "22222222-2222-2222-2222-222222222222",
  status: "published",
  validated_note: "Checked <b>on the ground</b>",
  updated_at: ROUTE_ROW.created_at
});

const COMMENT_ROW = {
  id: "33333333-3333-3333-3333-333333333333",
  route_id: ROUTE_ROW.id,
  body: HOSTILE_COMMENT,
  upvotes: 3, downvotes: 0, score: 3, deleted: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  user_id: "44444444-4444-4444-4444-444444444444",
  author: { handle: "maria", display_name: null }
};

/* ---------- a server that fills in the config ---------- */
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    if (rel === "static/js/config.js") {
      /* Whatever project config.js points at, the test points at its own
         stub instead — matched by the field name rather than by the value,
         so this keeps working once somebody has filled the real one in.
         Nothing is written back, so a run never touches the working tree,
         and the suite can never reach a real database by accident. */
      const src = fs.readFileSync(file, "utf8")
        .replace(/SUPABASE_URL:\s*"[^"]*"/, 'SUPABASE_URL: "https://test.supabase.co"')
        .replace(/SUPABASE_ANON_KEY:\s*"[^"]*"/, 'SUPABASE_ANON_KEY: "test-anon-key"');
      if (src.indexOf("test.supabase.co") === -1) {
        throw new Error("could not point config.js at the stub — the field names have changed");
      }
      res.writeHead(200, { "Content-Type": type }).end(src);
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

async function main() {
  const site = await serve();
  const origin = "http://127.0.0.1:" + site.address().port;

  /* The image ships a Chromium under PLAYWRIGHT_BROWSERS_PATH that may be
     a different build number from whatever playwright package is installed
     here, so the binary is named explicitly rather than looked up. */
  const bundled = [
    path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers", "chromium", "chrome-linux", "chrome"),
    path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers", "chromium-1194", "chrome-linux", "chrome")
  ].find((p) => fs.existsSync(p));

  const browser = await chromium.launch(bundled ? { executablePath: bundled } : {});
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    permissions: []
  });
  const page = await ctx.newPage();

  const errors = [];
  const cspViolations = [];
  const unexpected = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy/i.test(t)) cspViolations.push(t);
  });

  const json = (body) => ({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body)
  });

  /* Registered on the CONTEXT, not the page: the email-link tests below
     open fresh pages, and a page-level route would not cover them. */
  await ctx.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();

    if (url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) {
      return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    }
    if (url.includes("tile.openstreetmap.org")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    }
    if (url.includes("test.supabase.co")) {
      if (url.includes("/rpc/search_routes")) return route.fulfill(json([ROUTE_ROW]));
      if (url.includes("/rpc/routes_in_bbox")) return route.fulfill(json([FULL_ROUTE]));
      if (url.includes("/rpc/cast_route_vote")) {
        return route.fulfill(json([{ upvotes: 13, downvotes: 1, score: 12, my_vote: 1 }]));
      }
      if (url.includes("/route_comments")) return route.fulfill(json([COMMENT_ROW]));
      if (url.includes("/route_votes") || url.includes("/comment_votes")) return route.fulfill(json([]));
      if (url.includes("/routes")) return route.fulfill(json([FULL_ROUTE]));
      if (url.includes("/profiles")) {
        return route.fulfill(json([{
          id: "44444444-4444-4444-4444-444444444444",
          handle: "juan_dc", display_name: null, is_moderator: false,
          created_at: new Date(Date.now() - 30 * 86400000).toISOString()
        }]));
      }
      if (url.includes("/auth/v1")) {
        const USER = { id: "44444444-4444-4444-4444-444444444444", email: "juan@example.com" };
        /* Who am I, and change my password: both are /auth/v1/user, told
           apart by method the way GoTrue does. */
        if (url.includes("/auth/v1/user")) return route.fulfill(json(USER));
        if (url.includes("/auth/v1/recover") || url.includes("/auth/v1/logout")) {
          return route.fulfill(json({}));
        }
        /* The first password is wrong and the second is right, so the same
           stub covers both the refusal and the sign-in. */
        const body = route.request().postData() || "";
        if (body.indexOf(GOOD_PASSWORD) === -1) {
          return route.fulfill({ status: 400, contentType: "application/json",
            body: '{"message":"Invalid login credentials"}' });
        }
        return route.fulfill(json({
          access_token: "test.access.token", refresh_token: "test-refresh",
          expires_in: 3600, user: USER
        }));
      }
      return route.fulfill(json([]));
    }
    if (url.includes("api.open-meteo.com")) {
      const hours = [], temp = [], code = [], rest = [];
      for (let i = 0; i < 48; i++) {
        const d = new Date(Date.now() + i * 3600000);
        hours.push(d.toISOString().slice(0, 16));
        temp.push(30 + (i % 4));
        code.push(i % 8 === 0 ? 95 : 1);
        rest.push(0);
      }
      const one = {
        hourly: {
          time: hours, temperature_2m: temp, apparent_temperature: temp,
          precipitation: rest, precipitation_probability: rest, weather_code: code,
          wind_speed_10m: rest, wind_gusts_10m: rest, relative_humidity_2m: rest,
          is_day: hours.map(() => 1)
        }
      };
      return route.fulfill(json([one, one, one, one, one, one]));
    }
    if (url.includes("nominatim")) {
      if (url.includes("/reverse")) {
        return route.fulfill(json({ display_name: "Araneta Center, Cubao, Quezon City", lat: "14.62", lon: "121.05", type: "bus_station" }));
      }
      /* Both of these sit ON the stubbed route, a short walk from it, so
         the planner has a real answer to give rather than an empty state.
         Whether it finds one is the thing being tested. */
      return route.fulfill(json([
        { display_name: "Cubao terminal, Quezon City", lat: "14.6008", lon: "121.0012", type: "bus_station" },
        { display_name: "Montalban, Rizal", lat: "14.6310", lon: "121.0312", type: "town" }
      ]));
    }
    if (url.includes("router.project-osrm.org")) {
      return route.fulfill(json({
        code: "Ok",
        routes: [{
          geometry: polyline6(LINE),
          distance: 8400, duration: 1800,
          legs: [{ distance: 8400, duration: 1800 }]
        }]
      }));
    }

    unexpected.push(url);
    return route.abort();
  });

  await page.goto(origin + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  /* ---------------------------------------------------------- */
  section("It comes up");
  check("no page errors on load", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("the map drew", await page.locator(".leaflet-container").count() === 1);
  check("the sheet opens on Find", await page.getAttribute("#sheet", "data-open") === "true");
  check("the tab bar has four targets", await page.locator(".km-tab").count() === 4);
  check("the service worker registered",
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r)));
  check("the version is shown somewhere permanent",
    (await page.textContent("#version-text")).startsWith("v"));

  await shot(page, "find");
  section("Tabs move between panes");
  await page.click('.km-tab[data-tab="browse"]');
  await page.waitForTimeout(500);
  check("the Routes pane is showing", await page.isVisible("#pane-browse"));
  check("the Find pane is not", !(await page.isVisible("#pane-find")));
  check("the ride-type chips were built from the type table",
    await page.locator("#browse-types .km-chip").count() >= 9);
  /* Two controls that a class rule was quietly overriding into view. */
  check("the clear button is not offered on an empty search box",
    !(await page.isVisible("#browse-clear")));
  check("the install button is not offered where the browser has not asked",
    !(await page.isVisible("#install-btn")));

  await page.click('.km-tab[data-tab="browse"]');
  check("tapping the tab you are on closes the sheet",
    await page.getAttribute("#sheet", "data-open") === "false");
  await page.click('.km-tab[data-tab="browse"]');
  await page.waitForTimeout(400);

  /* ---------------------------------------------------------- */
  await shot(page, "browse");
  section("A hostile route is rendered as text");
  await page.waitForSelector(".km-card", { timeout: 5000 });
  check("the stubbed route arrived", await page.locator(".km-card").count() === 1);

  const nameText = await page.textContent(".km-card-name");
  check("the route name reads back exactly as it was sent",
    nameText === HOSTILE_NAME, JSON.stringify(nameText));
  check("no <img> was created from the route name",
    await page.locator(".km-card img").count() === 0);
  check("the origin name is text, not bold",
    await page.locator(".km-card-from b").count() === 0);
  check("the validated tag is shown", await page.locator(".km-tag-validated").count() === 1);
  check("the reliability meter is shown", await page.locator(".km-card .km-meter").count() === 1);
  check("the vote control is shown", await page.locator(".km-card .km-vote").count() === 1);
  check("there is no Load more on a single page of results",
    !(await page.isVisible("#browse-more")));

  section("Its detail, its weather and its comments");
  await page.click(".km-card-main");
  await page.waitForSelector(".km-d-name", { timeout: 5000 });
  check("the detail opened", await page.isVisible("#detail"));
  check("the name is still exactly the characters that were sent",
    (await page.textContent(".km-d-name")) === HOSTILE_NAME);
  check("the description is a paragraph of text",
    (await page.textContent(".km-d-para")).indexOf("<script>") !== -1);
  check("no <script> element came from the description",
    await page.locator("#detail script").count() === 0);
  check("the route drew on the map", await page.locator(".leaflet-overlay-pane path").count() >= 2);

  await page.waitForSelector(".km-wx", { timeout: 6000 });
  check("the weather strip filled in", await page.locator(".km-wx").count() >= 4);
  check("a stormy checkpoint is marked as such",
    await page.locator(".km-wx.km-sev-severe, .km-wx.km-sev-caution").count() >= 1);

  await page.waitForSelector(".km-comment", { timeout: 6000 });
  check("the comment arrived", await page.locator(".km-comment").count() === 1);
  check("the comment body is exactly the characters that were sent",
    (await page.textContent(".km-comment-body")) === HOSTILE_COMMENT);

  await shot(page, "detail");
  const pwned = await page.evaluate(() => window.__pwned);
  check("nothing hostile ever executed", pwned === undefined, "window.__pwned = " + pwned);
  check("the page carries no script it was not served",
    await page.evaluate(() => Array.prototype.every.call(
      document.querySelectorAll("script"), (s) => !!s.src)));

  section("Signed out, it asks rather than fails");
  await page.click("#detail-back");
  await page.waitForTimeout(300);
  await page.click('.km-tab[data-tab="build"]');
  await page.waitForTimeout(400);
  check("the builder is locked behind sign-in", await page.isVisible("#build-locked"));
  check("and the form is not offered", !(await page.isVisible("#build-form")));

  await page.click('.km-tab[data-tab="you"]');
  await page.waitForTimeout(300);
  check("the You pane offers sign in", await page.isVisible("#you-out"));
  await page.fill("#auth-email", "not-an-email");
  await page.click("#auth-go");
  await page.waitForTimeout(200);
  check("a bad address is refused before any request",
    (await page.textContent("#auth-err")).indexOf("email address") !== -1);
  await page.fill("#auth-email", "juan@example.com");
  await page.fill("#auth-password", BAD_PASSWORD);
  await page.click("#auth-go");
  await page.waitForTimeout(600);
  check("a refused sign-in says so without naming which half was wrong",
    (await page.textContent("#auth-err")).indexOf("do not match") !== -1);
  check("the password field was cleared", (await page.inputValue("#auth-password")) === "");

  /* ---------------------------------------------------------- */
  section("Signing in, and filing a route");
  await page.fill("#auth-password", GOOD_PASSWORD);
  await page.click("#auth-go");
  await page.waitForTimeout(800);
  check("signed in", await page.isVisible("#you-in"));
  check("the handle is shown", (await page.textContent("#you-handle")) === "@juan_dc");

  await page.click('.km-tab[data-tab="build"]');
  await page.waitForTimeout(400);
  check("the builder is unlocked now", await page.isVisible("#build-form"));
  check("it starts with no stops", await page.locator("#build-stops .km-stop-empty").count() === 1);

  async function addStopBySearch(nth) {
    await page.click("#build-add-search");
    await page.waitForSelector("#finder:not([hidden])");
    await page.fill("#finder-q", "terminal");
    await page.waitForSelector("#finder-results .km-finder-row", { timeout: 6000 });
    await page.locator("#finder-results .km-finder-row").nth(nth).click();
    await page.waitForTimeout(400);
  }

  await addStopBySearch(0);
  check("one stop is listed", await page.locator("#build-stops .km-stop").count() === 1);
  check("the first stop is marked A",
    (await page.textContent("#build-stops .km-stop .km-stop-n")) === "A");
  check("a lone stop cannot be moved up",
    await page.locator('#build-stops .km-stop-tool[aria-label="Move up"]').isDisabled());

  await addStopBySearch(1);
  check("two stops are listed", await page.locator("#build-stops .km-stop").count() === 2);
  check("the last stop is marked B",
    (await page.textContent("#build-stops .km-stop:last-child .km-stop-n")) === "B");

  await page.waitForFunction(
    () => !document.getElementById("build-measure").hidden &&
          /km|m\b/.test(document.getElementById("build-distance").textContent),
    null, { timeout: 8000 });
  check("the line drew itself without a button being pressed",
    (await page.textContent("#build-distance")).indexOf("km") !== -1,
    await page.textContent("#build-distance"));
  check("and it says how long it takes",
    (await page.textContent("#build-duration")).indexOf("min") !== -1);
  check("the line is on the map", await page.locator(".leaflet-overlay-pane path").count() >= 2);

  const beforeSwap = await page.textContent("#build-stops .km-stop .km-stop-name");
  await page.locator('#build-stops .km-stop-tool[aria-label="Move down"]').first().click();
  await page.waitForTimeout(300);
  check("the arrows reorder the stops",
    (await page.textContent("#build-stops .km-stop:last-child .km-stop-name")) === beforeSwap);
  await page.locator('#build-stops .km-stop-tool[aria-label="Move up"]').last().click();
  await page.waitForTimeout(300);

  check("a type is chosen by default",
    await page.locator("#build-types .km-chip.is-on").count() === 1);
  await page.click('#build-types .km-chip[data-type="tricycle"]');
  check("and the choice moves",
    (await page.textContent("#build-types .km-chip.is-on")).indexOf("Tricycle") !== -1);

  await shot(page, "builder");
  await page.click("#build-save");
  await page.waitForTimeout(400);
  check("filing a route with no name is refused before any request",
    !(await page.locator("#build-name-err").isHidden()) ||
    !(await page.locator("#build-err").isHidden()));

  await page.fill("#build-name", "Cubao to Montalban, via Batasan");
  await page.fill("#build-fare-min", "13");
  await page.fill("#build-fare-max", "45");
  await page.fill("#build-desc", "Waits by the overpass. Last trip about 10pm.");
  check("the description counts down", (await page.textContent("#build-desc-count")).indexOf("/ 600") !== -1);

  await page.waitForTimeout(400);
  await page.click("#build-save");
  await page.waitForTimeout(1200);
  check("the route was filed and its page opened", await page.isVisible("#detail"));
  check("the builder was cleared afterwards",
    await page.evaluate(() => KM.builder._stops().length) === 0);
  await page.click("#detail-back");
  await page.waitForTimeout(300);

  /* ---------------------------------------------------------- */
  section("The trip planner");
  await page.click('.km-tab[data-tab="find"]');
  await page.waitForTimeout(300);
  async function pickPlace(button, nth) {
    await page.click(button);
    await page.waitForSelector("#finder:not([hidden])");
    await page.fill("#finder-q", "terminal");
    await page.waitForSelector("#finder-results .km-finder-row", { timeout: 6000 });
    await page.locator("#finder-results .km-finder-row").nth(nth).click();
    await page.waitForTimeout(300);
  }

  await pickPlace("#find-from", 0);
  check("the start was set from a search",
    (await page.textContent("#find-from-text")).indexOf("Cubao") !== -1,
    await page.textContent("#find-from-text"));

  await pickPlace("#find-to", 1);
  check("the end was set from a search",
    (await page.textContent("#find-to-text")).indexOf("Montalban") !== -1,
    await page.textContent("#find-to-text"));

  await page.waitForSelector(".km-itin", { timeout: 8000 });
  const itins = await page.locator(".km-itin").count();
  check("the planner found a way across", itins >= 1, itins + " itineraries");
  check("it names the route you would ride",
    (await page.textContent(".km-itin .km-leg-link")) === HOSTILE_NAME);
  check("it leads with a time", /\d/.test(await page.textContent(".km-itin-time")));
  check("it shows how far you walk",
    (await page.textContent(".km-itin-walk")).indexOf("walking") !== -1);
  check("it shows the fare it would cost",
    (await page.textContent(".km-itin-fare")).indexOf("13") !== -1);
  check("the reliability of the weakest leg is shown before anything else",
    await page.locator(".km-itin-trust .km-meter").count() >= 1);
  check("the itinerary drew on the map",
    await page.locator(".leaflet-overlay-pane path").count() >= 2);

  await shot(page, "itineraries");
  section("Dropping a pin");
  await page.click("#find-to");
  await page.waitForSelector("#finder:not([hidden])");
  await page.click("#finder-pin");
  await page.waitForTimeout(400);
  check("picking a pin hides the sheet and shows the pin bar",
    await page.isVisible("#pick-bar") && await page.getAttribute("#sheet", "data-open") === "false");
  await page.click("#pick-cancel");
  await page.waitForTimeout(400);
  check("cancelling takes the pin bar away", (await page.isVisible("#pick-bar")) === false);
  /* Cancelling a pin returns you to the place finder you left, rather than
     dropping you on the map with nothing chosen. */
  check("and puts you back in the finder you came from", await page.isVisible("#finder"));
  await page.click("#finder-back");
  await page.waitForTimeout(400);
  check("leaving the finder puts the sheet back",
    await page.getAttribute("#sheet", "data-open") === "true");

  section("The info sheet");
  await page.click('.km-tab[data-tab="browse"]');
  await page.waitForTimeout(300);
  await page.click('[data-info="votes"]');
  await page.waitForTimeout(200);
  check("the info sheet opened", await page.isVisible("#info-sheet"));
  check("it carries the topic's title",
    (await page.textContent("#info-title")).length > 3);
  await page.click("#info-close");
  await page.waitForTimeout(200);
  check("and it closes", !(await page.isVisible("#info-sheet")));

  /* ----------------------------------------------------------
     Coming back from a link in an email.

     GoTrue verifies the token and bounces the browser back to the
     project's Site URL with the result in the fragment. Each of the three
     things it can say gets its own fresh page, because this is entirely
     about what happens during boot.
     ---------------------------------------------------------- */
  section("Arriving on a confirmation link");
  let landN = 0;
  async function land(hash, opts) {
    const p2 = await ctx.newPage();
    const errs = [];
    p2.on("pageerror", (e) => errs.push(String(e.message)));
    if (opts && opts.signedOut) {
      /* Pages in one context share localStorage, and the tests above have
         signed in. Somebody clicking a link on a browser that has never
         signed in is a different case and has to be set up as one — so
         this is the LAST of these to run, since it empties the storage the
         others rely on. */
      await p2.goto(origin + "/index.html");
      await p2.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    }
    /* A unique query string, because a navigation that differs only in the
       fragment is a same-document one: the page would not reload and none
       of this runs at boot. */
    await p2.goto(origin + "/index.html?land=" + (++landN) + hash, { waitUntil: "networkidle" });
    await p2.waitForTimeout(900);
    return { page: p2, errors: errs };
  }

  const confirmed = await land("#access_token=a.b.c&refresh_token=r1&expires_in=3600&token_type=bearer&type=signup");
  check("a confirmed address arrives signed in",
    await confirmed.page.evaluate(() => KM.supa.signedIn()));
  check("it says so in one line rather than moving them somewhere",
    (await confirmed.page.textContent("#toast")).indexOf("confirmed") !== -1,
    await confirmed.page.textContent("#toast"));
  check("and it leaves them on Find, because there is nothing to do in You",
    await confirmed.page.isVisible("#pane-find"));
  check("it knows who they are",
    (await confirmed.page.textContent("#you-handle")) === "@juan_dc");
  check("the tokens are wiped out of the address bar",
    (await confirmed.page.evaluate(() => location.hash)) === "",
    await confirmed.page.evaluate(() => location.hash));
  check("and out of the history entry too",
    (await confirmed.page.evaluate(() => location.href)).indexOf("access_token") === -1);
  check("no page errors landing on it", confirmed.errors.length === 0, confirmed.errors.join(" | "));
  await confirmed.page.close();

  section("Arriving on a password-reset link");
  const recovery = await land("#access_token=a.b.c&refresh_token=r1&expires_in=3600&type=recovery");
  check("it asks for a new password", await recovery.page.isVisible("#you-recover"));
  check("and does not show the account yet", !(await recovery.page.isVisible("#you-in")));
  check("nor the sign-in form", !(await recovery.page.isVisible("#you-out")));
  check("the tokens are wiped here too",
    (await recovery.page.evaluate(() => location.hash)) === "");

  await recovery.page.fill("#recover-password", "short");
  await recovery.page.click("#recover-go");
  await recovery.page.waitForTimeout(200);
  check("a short new password is refused before any request",
    (await recovery.page.textContent("#recover-err")).indexOf("eight") !== -1);

  await recovery.page.fill("#recover-password", "a-longer-one-9");
  await recovery.page.click("#recover-go");
  await recovery.page.waitForTimeout(700);
  check("a good one is saved and drops you into the account",
    await recovery.page.isVisible("#you-in"));
  check("the new password is not left in the field",
    (await recovery.page.inputValue("#recover-password")) === "");
  await recovery.page.close();

  section("Arriving on a link that has expired");
  const EXPIRED = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  /* A link failing is not a reason to throw away a working session, so the
     signed-in case goes first — and before the one below, which empties
     this origin's storage. */
  const expiredWhileIn = await land(EXPIRED);
  check("an expired link leaves an existing session alone",
    await expiredWhileIn.page.evaluate(() => KM.supa.signedIn()));
  check("and still says the link did not work",
    (await expiredWhileIn.page.textContent("#auth-err")).indexOf("expired") !== -1,
    await expiredWhileIn.page.textContent("#auth-err"));
  await expiredWhileIn.page.close();

  const expired = await land(EXPIRED, { signedOut: true });
  check("it says so in words somebody can act on",
    (await expired.page.textContent("#auth-err")).indexOf("expired") !== -1,
    await expired.page.textContent("#auth-err"));
  check("it does not claim to have signed anybody in",
    (await expired.page.evaluate(() => KM.supa.signedIn())) === false);
  check("it offers the sign-in form to try again from",
    await expired.page.isVisible("#you-out"));
  check("it does not ask for a new password on a link that never worked",
    !(await expired.page.isVisible("#you-recover")));
  check("and it still clears the fragment",
    (await expired.page.evaluate(() => location.hash)) === "");
  check("no page errors on a failed link", expired.errors.length === 0, expired.errors.join(" | "));
  await expired.page.close();

  section("Nothing went anywhere it should not have");
  check("no request to an address the test did not expect",
    unexpected.length === 0, unexpected.slice(0, 4).join(" | "));
  check("no Content-Security-Policy violation",
    cspViolations.length === 0, cspViolations.slice(0, 3).join(" | "));
  check("still no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  site.close();

  console.log("\n" + (failures ? failures + " failed" : "All good."));
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
