/* modes.js — what a multiplayer room can be set up to play, and who wins.
 *
 * Pure: no DOM, no three.js, no network. tools/validate.js imports it into
 * Node and plays whole matches through it, so the rules a host enforces are
 * the rules the checks prove. lobby.js and net.js only ever carry what this
 * file decides.
 *
 * Four ways to play, the same as the room setup offers them:
 *
 *   coop     the climb, with friends: the tower's floors, its Anchors and
 *            Wardens, enemies that grow tougher with every mage in the room
 *   wipeout  two teams, one life each per round; the last team standing takes
 *            the round, and the first to take the target number wins
 *   tdm      two teams, respawning; the first team to the target kills wins
 *   ffa      everyone against everyone, respawning; first to the target kills
 *
 * Settings arrive from other people's browsers, so every field is re-checked
 * against these tables on the way in rather than trusted — the same stance
 * save.js takes towards localStorage. */

export const MODES = {
  coop:    { id: "coop",    name: "Co-op climb",     short: "Co-op", pvp: false, teams: false, respawn: false, target: null },
  wipeout: { id: "wipeout", name: "Wipe Out",        short: "Wipe Out", pvp: true, teams: true, respawn: false, target: { label: "Rounds to win", def: 4, min: 1, max: 9, step: 1 } },
  tdm:     { id: "tdm",     name: "Team deathmatch", short: "Team DM", pvp: true, teams: true, respawn: true, target: { label: "Kills to win", def: 20, min: 5, max: 60, step: 5 } },
  ffa:     { id: "ffa",     name: "Free for all",    short: "FFA", pvp: true, teams: false, respawn: true, target: { label: "Kills to win", def: 10, min: 3, max: 40, step: 1 } }
};
export const MODE_IDS = Object.keys(MODES);

/* PVP maps are the tower's own lands, each always built from the same seed,
   so everyone in a room stands on the same island and a map is learnable. */
export const MAPS = [
  { id: "verdant", name: "Verdant Reach", seed: 13007 },
  { id: "ember",   name: "Ember Wastes",  seed: 24011 },
  { id: "frost",   name: "Frostreach",    seed: 35023 },
  { id: "void",    name: "The Hollow",    seed: 46051 },
  { id: "storm",   name: "Stormspire",    seed: 57089 },
  { id: "sanctum", name: "The Practice Grounds", seed: 68111 }
];
export const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));

export const TEAMS = [
  { name: "Azure", color: "#5aa9ff", hex: 0x3f6fd8 },
  { name: "Ember", color: "#ffad4a", hex: 0xc9642c }
];
/* Free for all has no teams, so every mage gets a robe of their own. */
export const ROBES = [0x3d3f94, 0x2f8a6a, 0xa0344f, 0x8a6a1e, 0x5b3a9a, 0x2a7aa0, 0x9a4a2a, 0x4a5a6a];

export const MAX_PLAYERS = 8;
export const START_FLOORS = [1, 3, 5, 7, 9];
/* Player-on-player hits land at this fraction of what the same page does to
   the Unravelled: a page tuned to clear a camp would otherwise erase a mage. */
export const PVP_DAMAGE = 0.45;
export const RESPAWN_S = 4;
export const ROUND_BREAK_S = 4;

const clampInt = (v, a, b, d) => (typeof v === "number" && isFinite(v) ? Math.max(a, Math.min(b, Math.round(v))) : d);
export function cleanName(s, fallback) {
  const t = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return t || fallback || "";
}

export function defaultSettings(mode) {
  const M = MODES[mode] || MODES.coop;
  return {
    mode: M.id,
    name: "",
    max: M.id === "coop" ? 4 : M.id === "ffa" ? 6 : 8,
    map: "verdant",
    target: M.target ? M.target.def : 0,
    rank: 3,
    fog: false,
    priv: false,
    floor: 1
  };
}

/** Anything in, a valid room setup out. */
export function cleanSettings(raw, base) {
  const r = raw && typeof raw === "object" ? raw : {};
  const mode = MODES[r.mode] ? r.mode : (base && base.mode) || "coop";
  const M = MODES[mode];
  const d = defaultSettings(mode);
  const s = {
    mode,
    name: cleanName(r.name, d.name).slice(0, 24),
    max: clampInt(r.max, 2, MAX_PLAYERS, d.max),
    map: MAP_BY_ID[r.map] ? r.map : d.map,
    target: M.target ? clampInt(r.target, M.target.min, M.target.max, M.target.def) : 0,
    rank: clampInt(r.rank, 1, 5, d.rank),
    fog: !!r.fog,
    priv: !!r.priv,
    floor: START_FLOORS.includes(r.floor) ? r.floor : 1
  };
  return s;
}

/** A one-line description a room row can show. */
export function describe(s) {
  const M = MODES[s.mode] || MODES.coop;
  if (M.id === "coop") return M.name + (s.floor > 1 ? " · from floor " + s.floor : "");
  const map = MAP_BY_ID[s.map] ? MAP_BY_ID[s.map].name : "";
  return M.name + " · " + map + " · " + s.target + (M.id === "wipeout" ? " rounds" : " kills");
}

/* ---------------------------------------------------------------
   Teams
   --------------------------------------------------------------- */
/** The team a newcomer should join: the smaller one, Azure on a tie. */
export function pickTeam(roster) {
  const n = [0, 0];
  for (const p of roster) if (p.team === 0 || p.team === 1) n[p.team]++;
  return n[1] < n[0] ? 1 : 0;
}
/** Even the teams out before a match: nobody moves unless one side is more
    than one mage ahead, and then the newest arrivals move first. */
export function balanceTeams(roster) {
  const out = roster.map((p) => Object.assign({}, p, { team: p.team === 1 ? 1 : 0 }));
  for (;;) {
    const a = out.filter((p) => p.team === 0), b = out.filter((p) => p.team === 1);
    if (Math.abs(a.length - b.length) <= 1) break;
    const big = a.length > b.length ? a : b;
    big[big.length - 1].team = big === a ? 1 : 0;
  }
  return out;
}
/** Whether two mages may hurt each other. Nobody hurts themselves. */
export function hostile(mode, a, b) {
  if (!a || !b || a.id === b.id) return false;
  const M = MODES[mode];
  if (!M || !M.pvp) return false;
  if (M.teams) return a.team !== b.team;
  return true;
}

/* ---------------------------------------------------------------
   Scoring — kept by the host, sent whole to everyone on every change
   --------------------------------------------------------------- */
export function newScore(ids, target) {
  const k = {}, d = {};
  for (const id of ids) { k[id] = 0; d[id] = 0; }
  return { k, d, tk: [0, 0], r: [0, 0], round: 1, target: target || 1, over: false, winner: null };
}

/**
 * Someone fell. `killer` may be null (the island's edge, a stray blast).
 * Returns { over, winner } — winner is a team index in team modes and a
 * player id in free for all.
 */
export function recordKill(score, mode, teamOf, victim, killer) {
  if (score.over) return { over: true, winner: score.winner };
  score.d[victim] = (score.d[victim] || 0) + 1;
  const M = MODES[mode];
  const fair = killer != null && killer !== victim && hostile(mode, { id: killer, team: teamOf(killer) }, { id: victim, team: teamOf(victim) });
  if (fair) {
    score.k[killer] = (score.k[killer] || 0) + 1;
    if (M.teams) score.tk[teamOf(killer)]++;
  }
  if (mode === "tdm" && fair && score.tk[teamOf(killer)] >= score.target) return finish(score, teamOf(killer));
  if (mode === "ffa" && fair && score.k[killer] >= score.target) return finish(score, killer);
  return { over: false, winner: null };
}
function finish(score, winner) { score.over = true; score.winner = winner; return { over: true, winner }; }

/**
 * Wipe Out: after a death, has a team been wiped? `alive` is the list of
 * { id, team } still standing; `present` everyone taking part this round.
 * Returns null while both teams stand, else { round: winner (-1 = both fell),
 * over, winner }.
 */
export function roundCheck(score, present, alive) {
  const standing = [0, 0], playing = [0, 0];
  for (const p of present) playing[p.team]++;
  for (const p of alive) standing[p.team]++;
  if (!playing[0] || !playing[1]) return null;       // a team walked out: nothing to decide yet
  if (standing[0] && standing[1]) return null;
  const w = standing[0] ? 0 : standing[1] ? 1 : -1;
  if (w >= 0) score.r[w]++;
  if (w >= 0 && score.r[w] >= score.target) { finish(score, w); return { round: w, over: true, winner: w }; }
  score.round++;
  return { round: w, over: false, winner: null };
}

/** Who is ahead, for the HUD and the results. Team modes: a team index or -1
    for a tie. Free for all: a player id, or null when nobody has scored. */
export function leader(score, mode) {
  const M = MODES[mode];
  if (M.teams) {
    const v = mode === "wipeout" ? score.r : score.tk;
    return v[0] === v[1] ? -1 : v[0] > v[1] ? 0 : 1;
  }
  let best = null, bk = 0;
  for (const id in score.k) if (score.k[id] > bk) { bk = score.k[id]; best = id; }
  return best;
}

/* ---------------------------------------------------------------
   Rooms in a server's list
   --------------------------------------------------------------- */
/** Anything in, a listable room out — or null. Rows come from strangers. */
export function cleanListing(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = String(raw.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (code.length !== 6) return null;
  const s = cleanSettings(raw.s || {});
  return {
    code,
    s,
    host: cleanName(raw.host, "A mage"),
    n: clampInt(raw.n, 0, MAX_PLAYERS, 1),
    phase: raw.phase === "playing" ? "playing" : "lobby",
    v: String(raw.v || "").slice(0, 12)
  };
}

/** The room Quick join should take, or null to make one. Same version, not
    full, not private; a room still in its lobby beats one mid-match, and a
    busier room beats a quieter one. */
export function quickPick(rooms, version, skip) {
  const ok = rooms.filter((r) => r && r.v === version && !r.s.priv && r.n < r.s.max && !(skip && skip.includes(r.code)));
  ok.sort((a, b) => (a.phase === "lobby" ? 0 : 1) - (b.phase === "lobby" ? 0 : 1) || b.n - a.n);
  return ok[0] || null;
}
