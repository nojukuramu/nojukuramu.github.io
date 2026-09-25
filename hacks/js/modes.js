/* modes.js — what a match can be, who wins it, and what hacks may do in it.
 *
 * The shape is Magic Sandbox's modes.js (on its multiplayer branch), kept so
 * lobby.js could be lifted with only its import line changed: the same
 * cleanSettings / cleanListing / cleanName / pickTeam / balanceTeams /
 * quickPick / describe, the same stance that settings arrive from strangers
 * and are re-checked on the way in. The modes themselves are this game's.
 *
 *   ffa       everyone against everyone; first to the kill count
 *   tdm       two teams; first team to the kill count
 *   practice  alone (or with dummies): the map, your movement, your hacks
 *
 * Hack rules are a room setting, because what is fair is the room's call:
 *
 *   visual    hacks may read everything and draw on your screen — ESP,
 *             radar, bone drawing, speedometers — and nothing else
 *   assist    and press your buttons and move your aim — aimbots, bunny
 *             hop and strafe scripts, triggerbots, recoil control
 *   full      and change your own body — its velocity, gravity, speed,
 *             jump, and where it stands
 *
 * No setting lets a hack change anybody else, or anyone's health, ammo or
 * score. That is not a rule here; there is no API for it (hackapi.js).
 *
 * Pure: no DOM, no three.js, no network. tools/validate.js plays matches
 * through it. */

export const MODES = {
  ffa:      { id: "ffa",      name: "Free for all",    short: "FFA",      pvp: true,  teams: false, target: { label: "Kills to win", def: 25, min: 5, max: 100, step: 5 } },
  tdm:      { id: "tdm",      name: "Team deathmatch", short: "Team DM",  pvp: true,  teams: true,  target: { label: "Kills to win", def: 50, min: 10, max: 150, step: 10 } },
  practice: { id: "practice", name: "Practice",        short: "Practice", pvp: false, teams: false, target: null }
};
export const MODE_IDS = Object.keys(MODES);
/** Rooms offer the fighting modes; practice is a solo thing. */
export const ROOM_MODES = ["ffa", "tdm"];

export const HACK_RULES = {
  visual: { id: "visual", name: "Visual only", level: 1 },
  assist: { id: "assist", name: "Assist",      level: 2 },
  full:   { id: "full",   name: "Full self",   level: 3 }
};
export const HACK_RULE_IDS = Object.keys(HACK_RULES);

export const DIFFS = {
  easy:   { id: "easy",   name: "Easy",   react: 0.55, aimErr: 0.11, turn: 5,  bhop: 0,    strafe: 0.2 },
  normal: { id: "normal", name: "Normal", react: 0.35, aimErr: 0.06, turn: 9,  bhop: 0.35, strafe: 0.5 },
  hard:   { id: "hard",   name: "Hard",   react: 0.22, aimErr: 0.035, turn: 14, bhop: 0.8,  strafe: 0.8 },
  insane: { id: "insane", name: "Insane", react: 0.14, aimErr: 0.018, turn: 22, bhop: 1,    strafe: 1 }
};
export const DIFF_IDS = Object.keys(DIFFS);

export const TEAMS = [
  { name: "Cyan",   color: "#39c6e8", hex: 0x39c6e8 },
  { name: "Orange", color: "#ff8a3d", hex: 0xff8a3d }
];
/* Free for all: everybody gets a colour of their own. */
export const COLORS = [0x39c6e8, 0xff8a3d, 0x9b7bff, 0x6fdc7a, 0xff5f7e, 0xf2d35b, 0x5b8cff, 0xff9ff3, 0x4de0c2, 0xc9a37a, 0xa6e05b, 0xe07a5b];

export const MAX_PLAYERS = 12;
export const RESPAWN_S = 3;
export const MAX_BOTS = 11;

const clampInt = (v, a, b, d) => (typeof v === "number" && isFinite(v) ? Math.max(a, Math.min(b, Math.round(v))) : d);
export function cleanName(s, fallback) {
  const t = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return t || fallback || "";
}

export function defaultSettings(mode) {
  const M = MODES[mode] || MODES.ffa;
  return {
    mode: M.id,
    name: "",
    max: 8,
    target: M.target ? M.target.def : 0,
    time: 10,              // minutes; 0 is no limit
    bots: 4,               // fill the room with bots up to this many players
    diff: "normal",
    hacks: "full",
    priv: false
  };
}

/** Anything in, a valid match setup out. */
export function cleanSettings(raw, base) {
  const r = raw && typeof raw === "object" ? raw : {};
  const mode = MODES[r.mode] ? r.mode : (base && base.mode) || "ffa";
  const M = MODES[mode];
  const d = defaultSettings(mode);
  return {
    mode,
    name: cleanName(r.name, d.name).slice(0, 24),
    max: clampInt(r.max, 2, MAX_PLAYERS, d.max),
    target: M.target ? clampInt(r.target, M.target.min, M.target.max, M.target.def) : 0,
    time: clampInt(r.time, 0, 30, d.time),
    bots: clampInt(r.bots, 0, MAX_PLAYERS, d.bots),
    diff: DIFFS[r.diff] ? r.diff : d.diff,
    hacks: HACK_RULES[r.hacks] ? r.hacks : d.hacks,
    priv: !!r.priv
  };
}

/** A one-line description a room row can show. */
export function describe(s) {
  const M = MODES[s.mode] || MODES.ffa;
  const bits = [M.name];
  if (M.target) bits.push(s.target + " kills");
  if (s.bots) bits.push("bots to " + s.bots);
  bits.push("hacks: " + HACK_RULES[s.hacks].name.toLowerCase());
  return bits.join(" · ");
}

/** How many bots a match should run, given the people in it. */
export function botCount(settings, humans) {
  if (settings.mode === "practice") return clampInt(settings.bots, 0, MAX_BOTS, 0);
  return Math.max(0, Math.min(MAX_BOTS, settings.bots - humans, MAX_PLAYERS - humans));
}

/* ---------------------------------------------------------------
   Teams
   --------------------------------------------------------------- */
export function pickTeam(roster) {
  const n = [0, 0];
  for (const p of roster) if (p.team === 0 || p.team === 1) n[p.team]++;
  return n[1] < n[0] ? 1 : 0;
}
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
/** Whether two players may hurt each other. Nobody hurts themselves; no friendly fire. */
export function hostile(mode, a, b) {
  if (!a || !b || a.id === b.id) return false;
  const M = MODES[mode];
  if (!M) return false;
  if (M.teams) return a.team !== b.team;
  return true;
}

/* ---------------------------------------------------------------
   Scoring — kept by the host (or by you, alone), sent whole on change
   --------------------------------------------------------------- */
export function newScore(target) {
  return { k: {}, d: {}, tk: [0, 0], target: target || 0, over: false, winner: null };
}
/**
 * Someone died. `killer` may be null (fell out of the map). Returns
 * { over, winner }: a team index in team deathmatch, a player id in free
 * for all, nothing in practice.
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
  if (!M.target || !fair) return { over: false, winner: null };
  if (mode === "tdm" && score.tk[teamOf(killer)] >= score.target) return finish(score, teamOf(killer));
  if (mode === "ffa" && score.k[killer] >= score.target) return finish(score, killer);
  return { over: false, winner: null };
}
function finish(score, winner) { score.over = true; score.winner = winner; return { over: true, winner }; }

/** Time ran out: whoever leads wins (a draw is -1 in teams, null alone). */
export function timeUp(score, mode) {
  if (score.over) return score.winner;
  const l = leader(score, mode);
  score.over = true; score.winner = l;
  return l;
}

export function leader(score, mode) {
  const M = MODES[mode];
  if (M.teams) return score.tk[0] === score.tk[1] ? -1 : score.tk[0] > score.tk[1] ? 0 : 1;
  let best = null, bk = 0, tie = false;
  for (const id in score.k) {
    if (score.k[id] > bk) { bk = score.k[id]; best = +id; tie = false; }
    else if (score.k[id] === bk && bk > 0) tie = true;
  }
  return tie ? null : best;
}

/* ---------------------------------------------------------------
   Rooms in a server's list
   --------------------------------------------------------------- */
export function cleanListing(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = String(raw.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (code.length !== 6) return null;
  const s = cleanSettings(raw.s || {});
  if (!ROOM_MODES.includes(s.mode)) return null;
  return {
    code,
    s,
    host: cleanName(raw.host, "A player"),
    n: clampInt(raw.n, 0, MAX_PLAYERS, 1),
    phase: raw.phase === "playing" ? "playing" : "lobby",
    v: String(raw.v || "").slice(0, 12)
  };
}

export function quickPick(rooms, version, skip) {
  const ok = rooms.filter((r) => r && r.v === version && !r.s.priv && r.n < r.s.max && !(skip && skip.includes(r.code)));
  ok.sort((a, b) => (a.phase === "lobby" ? 0 : 1) - (b.phase === "lobby" ? 0 : 1) || b.n - a.n);
  return ok[0] || null;
}
