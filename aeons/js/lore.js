/* lore.js — what the world remembers.
 *
 * Nothing here is told outright. There is no opening crawl and nobody explains
 * the mist at the edge of the map, why the enemy builds what you build, or who
 * cut the ruins. There are only fragments: an inscription in a ruin, a line
 * when a phase turns, a thing somebody says when an era begins. Read enough
 * of them and a shape appears. The Codex keeps the ones you have found, in the
 * order you found them, never in the order they were written. */

/** Found in ruins, in no particular order. */
export const RUIN_FRAGMENTS = [
  "The stones here were cut by hands like yours. The marks are older than the river beside them.",
  "A hearth, cold. The ash in it is arranged in the pattern you were taught as a child.",
  "Someone scratched a tally into the lintel. It stops at twenty-seven.",
  "A statue faces the mist. Its hand is raised, as if to wave, or to stop something.",
  "The doorway is the right size for you. Every doorway out here is.",
  "Bones beneath the floor, laid with care. Beside each one, a small carved flame.",
  "Here the walls were built twice, the second time over the first, by builders who did not know.",
  "An instrument for measuring the sky. Every star on its dial is in the wrong place, or in the right place, later.",
  "The mural shows a great light raised at the edge of the world. The rest of the wall is burned.",
  "A child's toy, a wooden spear. It is warm, though the sun has not reached this place in years.",
  "Words in a tongue you almost know. One of them is the name of your first fire.",
  "They kept seeds here, sorted and labelled. Most of the labels are the names of eras.",
  "A map of this land. Your Hearth is on it, marked, with a date that has not happened.",
  "Someone has written, over and over, 'do not light it'. Someone else has crossed every one out.",
  "The roof fell long ago. The mosaic underneath shows two armies, wearing the same colours.",
  "A bell with no clapper. The tongue was taken; the bell was left to wait.",
  "Machines, rusted into the rock. Their shapes would not be invented for a thousand years.",
  "A ring of standing stones, and in the middle a smaller ring, and in that a smaller one, down to a point.",
  "The mist has been here. Every surface it touched is smooth, as if worn by a very long time.",
  "A last letter, unsent: 'If you are reading this you came the way we came. Go further than we did.'",
  "Footprints pressed into stone, walking towards the edge. None walk back.",
  "On the altar, an offering of tools: a flint, a bronze blade, a key, a coil of wire. Room for more.",
  "A garden that has gone wild. The flowers in it do not grow anywhere else in the world.",
  "They drew the enemy on the walls. They drew them very carefully, the way you draw a face you love.",
  "An archive, emptied. On the shelf where the last book stood, a fine ring of dust.",
  "A clock carved in stone, with ten hours on it. The hand points at the first."
];

/** One line as each era begins (index = era). */
export const ERA_LINES = [
  "Fire, and the dark pulls back a little.",
  "Metal from the earth. The others, out in the mist, will have it soon.",
  "Iron does not care whose hand holds it.",
  "Crowns, and walls to keep them. Somewhere a wall is built in answer.",
  "The sound of powder carries further than anyone meant.",
  "Steam. The mist thins where the engines run, and the edge is further than it was.",
  "Engines in the air. From up there the ruins line up into roads.",
  "Every signal you send is answered, a heartbeat late, from the other side.",
  "The stars, close enough to read. One of them is not a star.",
  "Aether. It remembers. It remembers you."
];

/** Said when a phase turns. {n} is the phase now beginning. */
export const PHASE_LINES = [
  "Something moves in the mist.",
  "They have built again, where you have not looked.",
  "More of them. Or the same ones, closer.",
  "Their gates bear a mark. It is familiar.",
  "The land opens further, and they are already there.",
  "They learn as you learn.",
  "The mist draws back. It is not making way for you.",
  "Their fires burn the same colour as yours.",
  "You hear them singing. You know the tune.",
  "Every one you break, two remember.",
  "The edge is further now. They came from it.",
  "They wear what you wore, an age ago.",
  "Their towers face the same way yours do.",
  "No banners. Only your sigil, reversed."
];

/** When a base falls. */
export const FALL_LINES = [
  "The fires go out. Under the rubble, a carved flame.",
  "Silence where they were. The mist moves on.",
  "Among the ruins, something of yours. You do not remember losing it.",
  "Their hearth was laid the way you lay yours.",
  "They did not run. They never run."
];

/** The end of the long road. */
export const BEACON_LINE = "The Beacon burns. Out past the last of the mist, something lights an answer.";
export const MIRROR_LINE = "It is your Hearth. It is your hall, your towers, your colours turned inside out. It has been waiting.";
export const EPILOGUE = [
  "The last of them falls, and the mist does not come back.",
  "Under the Mirror's hearth there is ash, arranged in the pattern you were taught as a child.",
  "Somewhere very far behind you, in the first age, a fire is being lit.",
  "This time, perhaps, they will go further."
];

/** Champions' lines, when called and when they fall. */
export const HERO_LINES = {
  warden: { call: "I have stood here before.", fall: "Hold. Hold the..." },
  huntress: { call: "I know these woods. I know all of them.", fall: "Not this time..." },
  sage: { call: "I remember how this ends. Let us try something else.", fall: "Again, then." },
  shade: { call: "They will not see me. They never do.", fall: "Seen..." },
  artificer: { call: "Show me what is broken.", fall: "Just one more..." }
};

/** The enemy is never named. Their things are called what yours are, with this in front. */
export const ENEMY_PREFIX = "Hollow";
