/* themes.js — the five places the tower passes through, as data.
 *
 * Each theme lasts two floors: the first ends at three Anchors, the second at
 * a Warden. Colours are chosen so the enemy thread colour never matches the
 * ground it walks on, and enemy shots are the same hot magenta everywhere —
 * the one colour in the game that always means "move". */

export const ENEMY_SHOT = 0xff3d7a;
export const DANGER = 0xff4040;

export const THEMES = {
  verdant: {
    id: "verdant", name: "Verdant Reach",
    sky: 0x1b2b38, ground: 0x4c7a38, ground2: 0x6e9c46, dirt: 0x7a6040, edge: 0x3d5c2c,
    cliff: 0x6a5238, cliffDark: 0x2e241b,
    hemiSky: 0xd4ebff, hemiGround: 0x3a4a28, hemiI: 1.15, sun: 0xffe6bd, sunI: 2.7, exposure: 1.05, bloom: 0.7,
    accent: 0xff5ea8, weather: "pollen", grass: 0x7fb24e, music: 0
  },
  ember: {
    id: "ember", name: "Ember Wastes",
    sky: 0x1f100d, ground: 0x2e211f, ground2: 0x3d2a24, dirt: 0x1c1413, edge: 0x2a1a16,
    cliff: 0x3a1f18, cliffDark: 0x150a08,
    hemiSky: 0xffc2a0, hemiGround: 0x1e0e0a, hemiI: 0.75, sun: 0xffb27a, sunI: 1.7, exposure: 1.0, bloom: 0.85,
    accent: 0xffb13b, weather: "embers", grass: 0x6b4630, music: 1
  },
  frost: {
    id: "frost", name: "Frostreach",
    sky: 0x192a3c, ground: 0xb9cde0, ground2: 0xd9e6f2, dirt: 0x8ea6bf, edge: 0x9fb6cc,
    cliff: 0x6d88a4, cliffDark: 0x2a3a4e,
    hemiSky: 0xe8f3ff, hemiGround: 0x5a728c, hemiI: 1.0, sun: 0xeef6ff, sunI: 2.2, exposure: 0.92, bloom: 0.6,
    accent: 0x5fe3ff, weather: "snow", grass: 0x9fb8c9, music: 2
  },
  void: {
    id: "void", name: "The Hollow",
    sky: 0x110d1d, ground: 0x2e2742, ground2: 0x3e335a, dirt: 0x1e192d, edge: 0x241d35,
    cliff: 0x2a2140, cliffDark: 0x0c0914,
    hemiSky: 0xbca8ff, hemiGround: 0x1a1426, hemiI: 1.0, sun: 0xcbbcff, sunI: 1.9, exposure: 1.12, bloom: 0.95,
    accent: 0xd58bff, weather: "motes", grass: 0x5b4a8a, music: 3
  },
  storm: {
    id: "storm", name: "Stormspire",
    sky: 0x161b25, ground: 0x4b5262, ground2: 0x5e6677, dirt: 0x363b47, edge: 0x3a404d,
    cliff: 0x363c4a, cliffDark: 0x14171d,
    hemiSky: 0xb3c1dd, hemiGround: 0x22262f, hemiI: 1.05, sun: 0xd2dbff, sunI: 1.9, exposure: 1.08, bloom: 0.8,
    accent: 0xf6e55a, weather: "rain", grass: 0x6d7160, music: 4
  },
  sanctum: {
    id: "sanctum", name: "The Practice Grounds",
    sky: 0x2a2140, ground: 0x587c42, ground2: 0x7a9c4c, dirt: 0x8a6c48, edge: 0x44602f,
    cliff: 0x7a5c40, cliffDark: 0x2e2019,
    hemiSky: 0xffd9b8, hemiGround: 0x3a3a28, hemiI: 1.1, sun: 0xffc98f, sunI: 2.6, exposure: 1.05, bloom: 0.75,
    accent: 0xff5ea8, weather: "pollen", grass: 0x86b252, music: 0
  }
};

const ORDER = ["verdant", "ember", "frost", "void", "storm"];
export const FINAL_FLOOR = 10;

export function themeForFloor(f) { return THEMES[ORDER[Math.floor((f - 1) / 2) % ORDER.length]]; }

/** What a floor asks of you. Odd floors: three Anchors. Even floors: a
 *  Warden. The tenth: the Loom Heart. Past it, Endless keeps the rhythm. */
export function floorKind(f) {
  if (f === FINAL_FLOOR) return "heart";
  return f % 2 === 1 ? "anchors" : "warden";
}

/** Enemy toughness grows gently; the player grows by boons and rank. */
export function floorScale(f) {
  return { hp: 1 + 0.26 * (f - 1) + (f > FINAL_FLOOR ? 0.12 * (f - FINAL_FLOOR) * (f - FINAL_FLOOR) / 4 : 0), dmg: 1 + 0.09 * (f - 1) };
}
