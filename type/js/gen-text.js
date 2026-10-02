/* ============================================================
   Type — ordinary sentences

   Two sources, mixed:
     * a shelf of short, hand-written lines — proverb-sized and original, so
       there is nothing to misattribute and nothing to quote at length
     * a composer that builds a sentence from a subject, a deed and a setting.
       Roughly fifty thousand of those, and they read like sentences, which is
       what typing practice wants; they do not have to be true.

   A challenge is one to several of them, so the same line almost never turns
   up twice in a sitting.
   ============================================================ */

import { NOUNS, ADJS, cap } from "./words.js";

const LINES = [
  "The best way to learn a thing is to start before you feel ready.",
  "A small step taken every day beats a giant leap taken once a year.",
  "Good tools do not make a craftsperson, but they never hurt.",
  "Patience is just speed that has learned to wait for the right moment.",
  "Every expert was once a beginner who refused to quit.",
  "The map is not the territory, and the plan is not the project.",
  "Write it down, because tomorrow you will remember it differently.",
  "A tidy desk is a good start, but a clear head is the real goal.",
  "Slow is smooth, and smooth is fast.",
  "If the door is closed, check whether it was ever locked.",
  "Some days the work is to keep going, and that is enough.",
  "Measure twice, cut once, and keep the offcuts for later.",
  "The quiet hour before everyone wakes is worth guarding.",
  "Rain on the roof is the oldest kind of music there is.",
  "Nothing is as simple as it looks from the outside of the kitchen.",
  "You can read the whole manual, or you can break one thing and learn faster.",
  "A question asked early costs a minute, and one asked late costs a week.",
  "The kettle always boils the moment you stop watching it.",
  "Make it work, make it right, and only then make it fast.",
  "A good habit is a promise that you keep without having to remember it.",
  "The sea does not argue with the shore, it simply returns.",
  "Where there is smoke there is usually a kitchen, and a hungry person nearby.",
  "Be kind to your future self and label the box before you close it.",
  "Even the longest road is only a lot of short ones in a row.",
  "A clean break is easier to mend than a clever crack.",
  "Light travels faster than sound, which is why some people look brilliant until they speak.",
  "Do not confuse being busy with being useful.",
  "The first draft is for you, and every draft after is for everyone else.",
  "When in doubt, go for a walk and let the problem follow you.",
  "A lighthouse does not run around looking for ships to save.",
  "Trust the process, but check the oven anyway.",
  "Bread rises because someone was patient and the yeast was not in a hurry.",
  "The loudest argument in the room is rarely the best one.",
  "A sharp pencil and an honest eraser will carry you a long way.",
  "Courage is mostly showing up on the days you would rather not.",
  "The bridge you cross today was somebody's problem last century.",
  "Curiosity is what makes a stranger's ordinary day interesting.",
  "Little by little the river cuts through the mountain.",
  "It is easier to steer a moving boat than one tied up at the dock.",
  "Practice does not make perfect, it makes permanent, so practice well.",
  "A map drawn from memory is a portrait of the person who drew it.",
  "Do the hard part first and the rest of the day will feel like a gift.",
  "The garden does not care how busy you were, only whether you watered it.",
  "A fresh page is the most generous thing a notebook can offer.",
  "No one remembers the shortcut, but everyone remembers the view.",
  "Small kindnesses cost almost nothing and are very hard to give back.",
  "The train leaves on time, so the trick is to be early and bring a book.",
  "Silence is a fine answer when the question was only noise.",
  "Fix the leak while it is a drip, and the ceiling will thank you.",
  "Anyone can be brave in a story, but the real thing happens at the dentist.",
  "Keep your tools sharp and your expectations a little sharper.",
  "Every cloud is just a small mystery that the wind has not yet solved.",
  "Listen first, because the answer is usually hiding in the other person's sentence.",
  "Coffee is a fine reason to start the morning, and a poor reason to skip breakfast.",
  "It always seems impossible until the moment it is finished.",
  "The best view on the mountain is the one you earned on the way up.",
  "A promise is a loan from your future self, so borrow carefully.",
  "Time spent sharpening the axe is never wasted, as long as you eventually chop.",
  "If you can explain it to a child, you probably understand it yourself.",
  "Dust settles on the plans we never begin and on the books we never open.",
  "The moon does its best work when everyone else has gone to bed.",
  "A calm mind sees the exit sign long before the crowd does.",
  "Nobody ever regretted tidying up before a long trip.",
  "Spend the first minute of the day deciding what the last one should look like.",
  "Words are cheap until you have to take them back.",
  "Give a person a fish and they eat for a day, teach them to cook and they invite you over.",
  "A late bus is only an early chance to read the next chapter.",
  "Wind teaches the tree to bend, and the tree remembers.",
  "Real progress is boring to watch and wonderful to look back on.",
  "Strong coffee, a long list, and a closed door can move a mountain by lunch.",
  "The oldest trick in the book is to simply begin.",
  "Make a mistake early, learn from it, and make a more interesting one tomorrow.",
  "An honest apology fits in one sentence, so there is no need for three paragraphs.",
  "Whatever you carry up the stairs, you will have to carry down again.",
  "Great ideas often arrive wearing old clothes and carrying no luggage.",
  "A thousand small decisions can build a house, or quietly pull it down.",
  "Learn the rules well enough to break them with style.",
  "Stars were here long before the first lamp, and will be here after the last.",
  "Some questions are doors, and some are walls painted to look like doors.",
  "The shortest distance between two people is usually a plain hello.",
  "Dreams need a calendar before they become plans.",
  "There is no such thing as a free lunch, but there is such a thing as a fair one."
];


const DEEDS = [
  "counted the lanterns along the harbor wall",
  "carried a crate of oranges up the hill",
  "mended the roof before the first snow arrived",
  "drew a map of the town from memory",
  "taught the old radio to sing again",
  "traded a pocket compass for a loaf of bread",
  "painted the fence a color nobody had a name for",
  "left a note under the door and ran for the bus",
  "carried the ladder across three gardens",
  "watched the fog roll over the empty market",
  "polished every window in the house twice",
  "kept a careful diary of the weather",
  "built a small boat from scraps and stubbornness",
  "wrote a letter and then decided to deliver it in person",
  "sorted the buttons by color, then by size, then by mood",
  "followed the sound of a piano down a narrow street",
  "found a key in the coat and went looking for its door",
  "fed the stray cats and apologized to the neighbors",
  "tuned the engine until it purred like a sleepy cat",
  "shared the last pear with a stranger on the platform",
  "planted a row of beans in the cracks of the pavement",
  "read the whole manual and then ignored it cheerfully",
  "learned the names of every bridge in the city",
  "asked the right question at exactly the wrong time",
  "swept the porch while the storm decided what to do",
  "carved a tiny dragon from a bar of soap",
  "stacked the firewood into a very proud pile",
  "forgot the umbrella and remembered the whole poem",
  "packed a lunch big enough for the entire hillside",
  "balanced a cup of tea on a very uncertain suitcase"
];

const SETTINGS = [
  "just before sunrise.", "while the kettle was still warm.", "long after the shops had closed.",
  "on the quietest day of the year.", "as the first train pulled in.", "with nothing but a pencil and a plan.",
  "under a sky the color of old pennies.", "somewhere between breakfast and lunch.", "in the middle of a very loud thunderstorm.",
  "when nobody else was looking.", "right on the edge of autumn.", "with the radio playing softly in the next room.",
  "and the whole town pretended not to notice.", "while the rest of the world was still asleep.", "just as the lights came on along the pier.",
  "on a Tuesday that felt like a Sunday.", "after a long and thoughtful silence.", "and called it a perfectly good morning.",
  "before the coffee had even finished brewing.", "to the great surprise of the pigeons."
];

function composed(rng) {
  const a = rng.pick(ADJS), n = rng.pick(NOUNS);
  const subj = rng.pick(["the " + a + " " + n + " keeper", "a " + a + " " + n + " seller", "the " + a + " " + n + " painter", "our " + a + " neighbor", "the " + a + " night watchman", "a " + a + " traveler", "the " + a + " baker from " + rng.pick(["the corner", "the old quarter", "across the river", "the lower hill"]), "the " + a + " clockmaker", "an " + a + " apprentice", "the " + a + " cartographer"]);
  const fixed = subj.replace(/^an (?=[^aeiou])/, "a ").replace(/^a (?=[aeiou])/, "an ");
  return cap(fixed) + " " + rng.pick(DEEDS) + " " + rng.pick(SETTINGS);
}

/** One sentence: a shelf line or a composed one. */
export function sentence(rng) {
  return rng.chance(0.42) ? rng.pick(LINES) : composed(rng);
}

const COUNT = { short: [1, 1], medium: [2, 3], long: [4, 6] };

export function genText(rng, length) {
  const [lo, hi] = COUNT[length] || COUNT.medium;
  const n = rng.int(lo, hi), out = [], seen = new Set();
  while (out.length < n) { const s = sentence(rng); if (!seen.has(s)) { seen.add(s); out.push(s); } }
  return { kind: "text", text: out.join(" ") };
}

export const SHELF = LINES;
