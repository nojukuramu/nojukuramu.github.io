/* ============================================================
   Type — the rules of a race, with no DOM and no network in them

   Settings, listings and results all arrive from strangers over a data
   channel, so each is re-checked on the way in (the same stance as Hacks'
   modes.js, whose cleanSettings / cleanListing / cleanName / quickPick this
   follows). The room and the directory live in lobby.js; the page lives in
   mp.js; this file is the part both can be tested against.

   A race is the same challenge for everyone: the host picks a seed, every
   browser builds the challenge from (category, length, seed) with the same
   generator, and each types it alone. Only progress travels.
   ============================================================ */

export const MAX_PLAYERS = 8;
export const CATS = ["all", "text", "terminal", "code", "keys"];
export const LENS = ["short", "medium", "long"];

/** How long between "start" and "go", and how long a race waits for stragglers once somebody has finished. */
export const COUNTDOWN_MS = 4000;
export const STRAGGLER_MS = 25000;
/** A quick-match room starts this long after a second person arrives. */
export const AUTO_START_MS = 8000;

const ADJ = ["Quick", "Quiet", "Brave", "Sleepy", "Jolly", "Nimble", "Plucky", "Dapper", "Breezy", "Zesty", "Mellow", "Spry", "Cosy", "Witty", "Humble", "Lucky"];
const NOUN = ["Pebble", "Otter", "Kettle", "Comet", "Biscuit", "Heron", "Lantern", "Pickle", "Walrus", "Maple", "Teacup", "Badger", "Cricket", "Sparrow", "Noodle", "Mango"];

export function randomName(rand) {
  const r = rand || Math.random;
  return ADJ[Math.floor(r() * ADJ.length)] + " " + NOUN[Math.floor(r() * NOUN.length)];
}

export function cleanName(s, fallback) {
  const t = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return t || fallback || "";
}

const clampInt = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

export function cleanSettings(raw, base) {
  const r = raw && typeof raw === "object" ? raw : {};
  const b = base || {};
  return {
    cat: CATS.indexOf(r.cat) >= 0 ? r.cat : (b.cat || "all"),
    len: LENS.indexOf(r.len) >= 0 ? r.len : (b.len || "medium"),
    max: clampInt(r.max, 2, MAX_PLAYERS, b.max || 6),
    priv: r.priv === undefined ? !!b.priv : !!r.priv,
    auto: r.auto === undefined ? !!b.auto : !!r.auto
  };
}

export function cleanListing(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = String(raw.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (code.length !== 6) return null;
  return {
    code,
    s: cleanSettings(raw.s || {}),
    host: cleanName(raw.host, "A player"),
    n: clampInt(raw.n, 0, MAX_PLAYERS, 1),
    phase: raw.phase === "playing" ? "playing" : "lobby",
    v: String(raw.v || "").slice(0, 12)
  };
}

/** The room quick match should walk into: an open lobby of this version, quick-match rooms first, fuller first. */
export function quickPick(rooms, version, skip) {
  const ok = rooms.filter((r) => r && r.v === version && !r.s.priv && r.phase === "lobby" && r.n < r.s.max && !(skip && skip.includes(r.code)));
  ok.sort((a, b) => (b.s.auto ? 1 : 0) - (a.s.auto ? 1 : 0) || b.n - a.n || (a.code < b.code ? -1 : 1));
  return ok[0] || null;
}

/**
 * Two people who press "find a match" at the same moment both find an empty
 * list and both host. The one with the larger code gives way: it joins the
 * smaller, so exactly one room survives without anyone having to agree.
 */
export function yieldTo(myCode, rooms, version) {
  const better = rooms.filter((r) => r && r.v === version && r.s.auto && !r.s.priv && r.phase === "lobby" && r.n < r.s.max && r.code < myCode);
  better.sort((a, b) => (a.code < b.code ? -1 : 1));
  return better[0] || null;
}

export function describe(s) {
  const cat = { all: "Mixed", text: "Text", terminal: "Terminal", code: "Code", keys: "Keys" }[s.cat] || "Mixed";
  const len = { short: "Short", medium: "Medium", long: "Long" }[s.len] || "Medium";
  return cat + " · " + len;
}

/** Order a finished (or unfinished) race: those who finished by time, then the rest by how far they got. */
export function rank(results) {
  return results.slice().sort((a, b) => {
    const fa = a.ms > 0, fb = b.ms > 0;
    if (fa !== fb) return fa ? -1 : 1;
    if (fa) return a.ms - b.ms;
    return (b.n || 0) - (a.n || 0);
  });
}

/** A progress report from a stranger, clamped to what is possible for this challenge. */
export function cleanProgress(m, total) {
  const n = clampInt(m && m.n, 0, total, 0);
  return { n, w: clampInt(m && m.w, 0, 400, 0) };
}

/** A finish report. Time is the sender's own clock from "go"; the host only checks it is believable. */
export function cleanFinish(m, total) {
  const ms = clampInt(m && m.ms, 0, 3600000, 0);
  // faster than ~30 characters a second is not a person, and the host does not rank it
  const plausible = ms > 0 && total / (ms / 1000) <= 30;
  return { ms: plausible ? ms : 0, w: clampInt(m && m.w, 0, 400, 0), acc: clampInt(m && m.acc, 0, 100, 0), ok: plausible };
}
