/* topics.js — the long copy, in one place.
 *
 * The interface says one line; everything a player might want explained
 * lives here and opens in the info sheet from a small (i). One registry, so
 * the same explanation can be reached from several screens without drifting.
 * tools/validate.js checks every data-info in the game names a topic here.
 * Some bodies are functions, built from data.js, so a table never says
 * something the game does not do. */

import { ENEMY, GATE, PERKS, DROP, MODIFIERS, BOSS } from "./data.js";

const b = (s) => "<b>" + s + "</b>";
const list = (o, f) => "<ul>" + Object.keys(o).map((k) => "<li>" + f(k, o[k]) + "</li>").join("") + "</ul>";

export const TOPICS = {
  about: {
    title: "What this is",
    body: "<p>" + b("Ballzooka") + " is the game from those ads — the one where a cannon fires balls through gates that multiply them — except it is real, and you can play it.</p>" +
      "<p>Drag to move the cannon. It fires on its own. Steer the stream through the best gates, and stop the horde before it crosses the dashed line.</p>" +
      "<p>No ads, no account, nothing sent anywhere. Progress is kept in this browser.</p>"
  },
  howto: {
    title: "Playing",
    body: "<p>" + b("Move") + " by dragging anywhere — your finger does not have to be on the cannon. With a mouse, the cannon follows the pointer; the arrow keys and A / D work too. " + b("P") + " or Escape pauses.</p>" +
      "<p>" + b("Gates") + " sit across the field. Every ball that passes through one is changed by it, once per gate. Two ×3 gates in a row turn one ball into nine.</p>" +
      "<p>" + b("Panels") + " slide down toward you in pairs. Drive under one to take it. Every ball that hits a panel nudges its number up — shoot a red panel long enough and it turns blue.</p>" +
      "<p>" + b("The horde") + " walks down. Anything that crosses the dashed line costs hearts. Lose them all and the level is over.</p>" +
      "<p>Kills fill the " + b("XP bar") + " (a perk to choose) and the " + b("Fever meter") + " (double fire rate for a few seconds). Coins buy permanent upgrades between levels.</p>"
  },
  gates: {
    title: "Gates",
    body: () => "<p>A gate acts on every ball that passes through it, once per ball per gate. A ball that bounces off the top (Ricochet) can pass the same gates again on the way down.</p>" +
      list({ mul: 1, charge: 1, div: 1, mystery: 1, fire: 1, gold: 1, big: 1, ice: 1 }, (k) => b({ mul: "×N", charge: "Blue ×", div: "÷N", mystery: "?", fire: "FIRE", gold: "GOLD", big: "BIG", ice: "ICE" }[k]) + " — " + GATE[k].line) +
      "<p>Some rows slide. A boss called the Gate Magus curses your best gate for a few seconds.</p>" +
      "<p>The game draws at most 600 balls. Past that, a gate makes the existing balls heavier instead of making new ones, so ×3 still means ×3: the counter at the bottom is the true total, and heavy balls are drawn larger.</p>"
  },
  horde: {
    title: "The horde",
    body: () => list(ENEMY, (k, e) => b(e.name) + " — " + e.line + (e.from > 1 ? " From level " + e.from + "." : "")) +
      "<p>Bosses arrive every fifth level, and every tenth wave in Endless:</p>" + list(BOSS, (k, B) => b(B.name) + " — " + B.line)
  },
  perks: {
    title: "Perks",
    body: () => "<p>Every few kills the XP bar fills and the game stops for a choice of three. Perks last for the level. One reroll per level.</p>" +
      list(PERKS, (k, p) => b(p.name) + " — " + p.line + (p.max > 1 ? " Up to " + p.max + "." : ""))
  },
  fever: {
    title: "Combo and Fever",
    body: "<p>Kills less than a second and a half apart chain into a " + b("combo") + ". The longer the combo, the faster the Fever meter fills and the more each kill scores.</p>" +
      "<p>A full meter starts " + b("Fever") + ": seven seconds of double fire rate and +25% critical chance, with the music to match. Losing a heart breaks the combo.</p>"
  },
  drops: {
    title: "Power-ups",
    body: () => "<p>Now and then a popped enemy drops a capsule. It falls toward the bottom: catch it with the cannon.</p>" + list(DROP, (k, d) => b(d.name) + " — " + d.line + (d.t ? " " + d.t + " seconds." : ""))
  },
  shop: {
    title: "The shop",
    body: "<p>Upgrades are permanent and apply to every mode. Prices rise with each level bought.</p>" +
      "<p>If a level keeps beating you, the shop is the answer: a few levels of Fire rate and Damage go a long way, and " + b("Barrels") + " — one more ball every shot, before any gate — is the big one.</p>" +
      "<p>Skins change only the look. A couple are earned with trophies rather than bought.</p>"
  },
  modes: {
    title: "Modes",
    body: "<p>" + b("Campaign") + " — levels one after another, a boss every fifth, the backdrop changing as you go. Three stars for a level without losing a heart.</p>" +
      "<p>" + b("Endless") + " — waves until you fall, faster and tougher every wave, with a boss every tenth. Pays half the coins.</p>" +
      "<p>" + b("Daily") + " — the same Endless seed for everybody today, with one twist. Your best score today is kept.</p>"
  },
  daily: {
    title: "Today's twist",
    body: () => list(MODIFIERS, (k, m) => b(m.name) + " — " + m.line)
  },
  wheel: {
    title: "Bonus wheel",
    body: "<p>The needle swings across the multipliers; tap to stop it, and the coins from the level are multiplied by where it lands. Yes, it is the ad's. No, there is no video to watch first.</p>"
  },
  revive: {
    title: "Free revive",
    body: "<p>Once per level you can get back up with half your hearts: the horde near the line is cleared and everything is frozen for three seconds. In the ads this costs a thirty-second video. Here it costs nothing.</p>"
  },
  privacy: {
    title: "Saving and privacy",
    body: "<p>Your progress is kept in this browser's local storage and nowhere else. Nothing is sent anywhere: there are no ads, analytics or accounts.</p>" +
      "<p>A level in progress is not saved — leaving it ends it. Clearing the browser's site data, or the button under Settings, starts over.</p>"
  },
  update: {
    title: "Updates",
    body: "<p>Once installed, the game runs from this device and works offline. It checks for a new version when it opens, every half hour, and when the network comes back, and offers a reload when one is ready; it never swaps itself out in the middle of a level.</p>"
  }
};
