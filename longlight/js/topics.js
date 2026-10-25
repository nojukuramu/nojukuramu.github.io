/* topics.js — every long explanation in the game, and every word the
 * world has written in it.
 *
 * The house rule (CLAUDE.md): the interface says one line, and the long copy
 * lives behind a small (i), here in one place (info.js opens it). The story
 * lives here too, for the same reason: no dialogue, no people — only what
 * was left behind. Notes, a radio log, a roster, a postcard, a ledger; a
 * cause that is never given; survivors pointed toward and never shown.
 *
 * Bodies are trusted HTML written in this file; nothing from storage or the
 * network ever reaches them. */

/* ------------------------------------------------------------------ */
/* What was left behind                                               */

export const CLUES = {
  map: { title: "Route map", body: "<p>Coast Base to East Cape Station. <b>Follow the flags.</b></p><p>Camps every km or two — fuel and food at each. A beacon on the nearest rise at every camp: light it as you leave, so the next camp knows you are coming.</p><p class=\"hand\">Glacier: keep to the flag line. Do not leave it.</p>" },
  note_bunk: { title: "On the table", body: "<p class=\"hand\">Back by supper. Don't let the stove go out. — R.</p><p class=\"aside\">The clock on the wall says seventeen minutes past four. It has said so for some time.</p>" },
  log_radio: { title: "Radio log", body: "<p><b>Day 1.</b> No traffic on any band. Not the coast stations, not the ships. Not even the weather.</p><p><b>Day 3.</b> Our own voice comes back to us a second late, as if the sky had a wall in it.</p><p><b>Day 6.</b> Decided: we walk to East Cape. They have the long-range set and the big fuel store. Flags are up the whole way.</p><p><b>Day 7.</b> He still won't wake. We can't carry him over the glacier. Leaving the lantern, fuel, food. Light the beacons as you go, so we know you're coming.</p>" },
  roster: { title: "Duty roster", body: "<p>Week 9.</p><p>Galley — Ines<br>Radio — Tom<br>Fuel — Sam<br>Met — Oyelaran<br>Doctor — <i>(crossed out)</i><br>Night watch — <i>(crossed out)</i></p><p class=\"aside\">Eleven names on the back. One has been circled.</p>" },
  generator: { title: "The generator", body: "<p>It coughs and will not catch. A note is taped to the tank:</p><p class=\"hand\">Don't waste fuel on this. There's nothing left to power. — S.</p>" },
  camp1: { title: "Camp One log", body: "<p>All eleven here. Cold, but fine.</p><p>Radio silent. The sky very clear tonight — clearer than any of us has seen it. Nobody slept much.</p><p>Moving on at first light. Leaving fuel for him.</p>" },
  camp2: { title: "Scratched into the table", body: "<p>A tally: eleven strokes. Under it, ten.</p><p class=\"hand\">K. went back for him. We said we'd wait a day. We waited two.</p>" },
  sled: { title: "The sledge", body: "<p>Half drifted over. A tag on the load:</p><p class=\"hand\">Too heavy for the slope. Will come back for it.</p>" },
  camp3: { title: "A postcard, never sent", body: "<p class=\"hand\">Dear Mum — the sun here never goes down. It goes round and round like it's lost. You'd love it. Home in March. All my love.</p>" },
  camp4: { title: "Camp Four log", body: "<p>Glacier crossing took all day. Two went in to the waist. The flags hold the safe line — stay on it.</p><p>Got the radio talking. Nothing to say to it.</p><p>A light in the north last night, very far. Argued about whether it was a star.</p>" },
  camp5: { title: "Camp Five", body: "<p>Eight left this camp. Fuel enough for the tower at East Cape if we don't burn it on the way.</p><p>We are cold. We are going.</p>" },
  station: { title: "East Cape log", body: "<p>We lit the tower every night we could.</p><p>The sea ice is going out. When the water opens we go too — there is a boat, and somewhere to go to, we think.</p><p class=\"hand\">Whoever comes after: light it again. Someone out there might see it.</p>" },
  ledger: { title: "The ledger", body: "<p>Names, in different hands, each with the day they came in. Seven of them.</p><p class=\"aside\">The next line is blank.</p>" },
  radio_dead: { title: "The radio", body: "<p>Dead. With tools, it might be made to talk.</p>" }
};

/* What the radios say, where they still say anything. */
export const RADIO = {
  default: { title: "The radio", body: "<p>Static. A carrier that comes and goes under it.</p><p>No voice.</p>" },
  song: { title: "The radio", body: "<p>Static — and then, faint, an old tune on a piano, from somewhere.</p><p>It plays to the end. The static comes back.</p>" },
  morse: { title: "The radio", body: "<p>Static. Then, very faint, dots and dashes: three short, three long, three short. Again.</p><p>Then only static.</p>" },
  mended: { title: "The radio", body: "<p>It hums. A sweep across every band.</p><p>Static, and once, for a moment, something like a voice reading numbers. Then nothing.</p>" }
};

/* When he goes under: what he sees, never who he is. */
export const MEMORIES = [
  "A kitchen, warm. Someone laughing at something he said. He can't remember what he said.",
  "A hand on his shoulder, waking him. “We're going. Hold on.” The hand let go.",
  "A train at night, the window black, his own face in it. He was going somewhere he wanted to go.",
  "Rain on a roof. He had forgotten rain.",
  "Summer, and a dog running at him through tall grass, and nothing to be afraid of."
];

/* ------------------------------------------------------------------ */
/* The (i) sheets                                                     */

export const TOPICS = {
  about: {
    title: "About The Long Light",
    body: `<p>A quiet walk across a piece of Antarctica in the last weeks of summer, lighting beacons for people who may not be there.</p>
      <p><b>The land</b> is generated from a seed, the proven way: Musgrave's ridged multifractal through a domain warp, on Jonas Wagner's simplex noise; weathered by Beyer's droplet erosion and a talus pass; then buried in an ice sheet so only the steep rock shows. Sea ice with leads and bergs, a glacier with crevasses, sastrugi lying along the wind. Every journey is a new coast.</p>
      <p><b>The sun</b> is a real sun at 79 degrees south: it goes round instead of setting, and over the journey it sinks into the polar night.</p>
      <p><b>The pictures</b> are Poly Haven and ambientCG (CC0): snow, rock, ice, corrugated sheet, and the station's things. <b>The sounds</b> are BigSoundBank (CC0); <b>the music</b> is played live on Versilian's VSCO 2 upright piano, sampled by Simon Dalzell, and its cello section (CC0).</p>
      <p>No accounts, no tracking, nothing sent anywhere. It plays offline once installed.</p>`
  },
  play: {
    title: "How to play",
    body: `<p>Walk east along the flags, from camp to camp, to the last station. At each camp there is fuel, food, and a beacon on the nearest rise: light it.</p>
      <p><b>Keyboard and mouse:</b> WASD to walk, Shift to hurry, E to take, read, open, light (hold), F for the lantern, Q (hold) to check yourself, Tab for your pack, M for the map, Esc to pause.</p>
      <p><b>Touch:</b> the left of the screen walks (push the stick all the way to hurry), the right looks; the buttons do the rest.</p>
      <p><b>Gamepad:</b> sticks to walk and look, A to act, X lantern, Y check, B pack, Back map.</p>
      <p>There is no clock and no marker. The sun is the clock: the shadows go round you like a sundial's. The flags are the way.</p>`
  },
  survival: {
    title: "Food, warmth, fuel",
    body: `<p>None of them is shown unless you check (hold Q, or the body button).</p>
      <p><b>Warmth</b> goes toward what the place allows. Sun on you warms; shade and wind take it; a hut out of the wind, a stove, a burning beacon give it back. Hurrying warms a little. The season turns colder as the sun sinks.</p>
      <p><b>Food</b> drains slowly, faster when you hurry or shiver. Camps hold tins and rations. Fish come up through the holes in the sea ice, if you have a line; near a fire they cook.</p>
      <p><b>Fuel</b> is carried in cans. Beacons burn it, stoves burn it, the lantern sips it. It comes from the camps.</p>
      <p>If one runs out, you black out. What that costs is the difficulty.</p>`
  },
  diff: {
    title: "Difficulty",
    body: `<p>None of them adds anything to fear. A blackout is a gentle failure, not a punishment.</p>
      <p><b>Easy.</b> Things drain very slowly and supplies are common; a beacon takes one can. Black out, and you wake later where you fell. It never ends the walk.</p>
      <p><b>Normal.</b> Slow drain, fair supplies, two cans a beacon. You wake having lost time, and some of what you carried.</p>
      <p><b>Hard.</b> Moderate drain, scarce supplies, three cans a beacon: a camp's fuel is the beacon or the stove. You wake weak; a second blackout ends the walk.</p>
      <p>The difficulty is chosen for each new journey.</p>`
  },
  quality: {
    title: "Graphics",
    body: `<p><b>Fast</b> is for a phone: one ring of shadow close round you, the sky's light from a hemisphere instead of the sky itself, no bloom, the land's detail pulled in.</p>
      <p><b>Normal</b> casts the sun's shadows in three cascades out to half a kilometre, lights the land with the sky (re-photographed as the sun moves), blooms the glare and the fires.</p>
      <p><b>Unrestrained</b> holds nothing back: four cascades of 4096 out to nearly two kilometres — a ridge's shadow reaches you across the valley at a low sun — every pixel the screen has, edges smoothed four times over, the land at its finest furthest out, more snow in the air, the sky's light renewed every second.</p>`
  },
  assets: {
    title: "Textures and models",
    body: `<p><b>Packed</b> is what installs: the snow, rock and ice at 1k, everything else at 512 or 256, the models simplified — the whole game in about 12 MB, and offline.</p>
      <p><b>Full quality</b> is the same Poly Haven and ambientCG originals as they were downloaded: 2k surfaces, 1k model textures, every model's full geometry — about 35 MB more, fetched the first time you choose it and kept after. It is never part of the install.</p>
      <p>Switching is immediate once the download is in; nothing restarts.</p>`
  },
  beacons: {
    title: "Beacons",
    body: `<p>One on a rise above every camp, a few more on hills between, and the tower at the last station.</p>
      <p>A lit beacon stays lit. In daylight it is a small quiet glow and a column of smoke; in the polar night, a bright point you can see from across the coast. The trail of them behind you is the only mark you leave that the wind does not take.</p>`
  },
  motion: {
    title: "Head bob",
    body: "<p>The camera rises and falls a little with each step, and leans as you turn. Off keeps the horizon still.</p>"
  },
  captions: {
    title: "Sound captions",
    body: "<p>Words for the sounds that carry meaning — ice cracking out on the bay, an engine or the wind, far off — with an arrow for the side they come from.</p>"
  },
  update: {
    title: "Updates",
    body: `<p>The game is cached so it opens instantly and plays with no connection. It looks for a new version when it opens, every 30 minutes while it is open, when you come back to it, and when the network returns.</p>
      <p>A new version never replaces the one you are playing by itself: a bar offers the reload, and if a journey is under way it asks first. Your journey is saved either way.</p>`
  },
  save: {
    title: "Your journey",
    body: "<p>The walk is saved in this browser as you go — every twenty seconds, and whenever you pause or put the game away. Nothing leaves the device. Starting a new journey replaces it.</p>"
  }
};
