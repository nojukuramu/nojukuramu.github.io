/* ============================================================
   The Long Light — noticing that a new version exists

   Lifted from Last Flame (lastflame/js/update.js), which is Ballzooka's
   (ballzooka/js/update.js), Bloomworks', Aeons', Hacks', Magic Sandbox's and
   RouteCast's (routecast/static/js/update.js) — one shape, on purpose, so
   every service worker in this repository answers the same "skip-waiting".
   Changes from Last Flame: the version is window.LL_VERSION, and the question
   asked before reloading is about a journey under way. A reload does not
   lose it — the walk is saved first — but it does stop it mid-step.

   How an update is noticed
   ------------------------
     * on load, and every 30 minutes while the page is visible
     * whenever the page comes back from hidden, at most that often
     * whenever the network comes back
   Each check is one conditional request for sw.js.

   How it is offered
   -----------------
   One dismissible bar at the top, and a version line in Settings with a
   manual "Check for updates". A new build never takes over by itself; if a
   journey is under way, reloading is confirmed first.
   ============================================================ */

const CHECK_MS = 30 * 60 * 1000;
// update() resolves the moment a new worker STARTS installing, so a manual
// check waits a beat before it can honestly say "you are up to date".
const SETTLE_MS = 1500;

let reg = null, ready = false, reloading = false, hadController = false;
let lastCheckAt = 0, dismissed = false, onState = null, busy = () => false, beforeReload = () => Promise.resolve();
const el = (id) => document.getElementById(id);

export function version() { return window.LL_VERSION || "?"; }

function fire() { if (typeof onState === "function") { try { onState(state()); } catch (e) {} } }
function render() {
  const bar = el("update-bar");
  if (bar) bar.hidden = !(ready && !dismissed);
  fire();
}
function announce() {
  if (ready) { render(); return; }
  ready = true; dismissed = false; render();
}
function watch(worker) {
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    // Installed while another worker is in charge = a newer build waiting.
    // With no controller it is simply the first install, not an update.
    if (worker.state === "installed" && navigator.serviceWorker.controller) announce();
  });
}

function check(manual) {
  if (ready) { if (manual) { dismissed = false; render(); } return Promise.resolve("ready"); }
  if (!reg) return Promise.resolve("unsupported");
  lastCheckAt = Date.now();
  return reg.update().then(() => new Promise((resolve) => {
    setTimeout(() => {
      if (reg.waiting) { announce(); resolve("ready"); return; }
      resolve(reg.installing ? "downloading" : "current");
    }, SETTLE_MS);
  }), () => "offline");
}

function doApply() {
  if (reg && reg.waiting) {
    // The waiting worker takes over, controllerchange fires, we reload. The
    // timeout is the belt to that brace: a worker that refuses to hand over
    // must not leave a dead button.
    reg.waiting.postMessage("skip-waiting");
    setTimeout(() => { if (!reloading) { reloading = true; location.reload(); } }, 2000);
    return;
  }
  reloading = true;
  location.reload();
}

export function init(registration, isBusy, save) {
  if (isBusy) busy = isBusy;
  if (save) beforeReload = save;
  const bar = el("update-bar");
  if (bar) {
    const go = el("update-go"), later = el("update-later");
    if (go) go.addEventListener("click", apply);
    if (later) later.addEventListener("click", () => { dismissed = true; render(); });
  }
  if (!("serviceWorker" in navigator) || !registration) { fire(); return; }
  reg = registration;
  hadController = !!navigator.serviceWorker.controller;
  if (reg.waiting && hadController) announce();
  watch(reg.installing);
  reg.addEventListener("updatefound", () => watch(reg.installing));
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The first worker claiming a page that had none is an install, not an
    // update; reloading for it would flash somebody's very first visit.
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  check(false);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || Date.now() - lastCheckAt < CHECK_MS) return;
    check(false);
  });
  window.addEventListener("online", () => check(false));
  setInterval(() => { if (!document.hidden) check(false); }, CHECK_MS);
  fire();
}

/** Ask now: resolves "ready", "downloading", "current", "offline" or "unsupported". */
export function checkNow() { return check(true); }

export function apply() {
  // A journey under way is saved before the reload and picks up where it
  // was, but the reload still stops it mid-step, so ask first then.
  if (busy() && !window.confirm("Update now? Your journey is saved and carries on from here.")) return;
  Promise.resolve(beforeReload()).catch(() => {}).then(doApply);
}

export function isReady() { return ready; }
export function supported() { return "serviceWorker" in navigator; }
export function state() { return { ready, dismissed, version: version(), supported: supported() }; }
export function onChange(fn) { onState = fn; fire(); }
