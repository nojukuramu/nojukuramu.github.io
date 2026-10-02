/* ============================================================
   Type — the conversation

   Very rarely (one in ten thousand Normal Text challenges) the text is not a
   paragraph but a chat. Other people talk; the player's side is shown as
   phantom letters — faint, already written, waiting to be typed — and the
   moment a line is typed, the room answers.

   A script is a list of turns. A turn is [who, text]; "you" is the player.
   Names fill ‹p1›, ‹p2›, ‹p3›; every script has at least two player turns and
   starts with somebody else speaking, so the first thing on screen is a
   message and not a blank box.
   ============================================================ */

import { makeFiller } from "./fill.js";
import { NAMES } from "./words.js";

export const CONVO_CHANCE = 0.0001;

const SCRIPTS = [
  [["p1", "hey, are you still awake?"], ["you", "barely, but yes. what is going on?"], ["p2", "someone left the lights on in the lab again."], ["p1", "we are not going to say who."], ["you", "it was me, I will go and turn them off."], ["p2", "thank you, and bring the keys back this time."], ["you", "I promise, they are going on the hook."], ["p1", "good night, you two."]],
  [["p1", "does anyone know a good place for lunch near the station?"], ["p2", "there is a bakery on the corner with soup on Tuesdays."], ["you", "that one is great, and the bread is still warm at noon."], ["p1", "perfect, I will meet you both there at twelve."], ["p2", "save me the seat by the window."], ["you", "done, I will put my coat on it."]],
  [["p1", "the build is red again."], ["you", "which job is failing?"], ["p1", "the one that was green five minutes ago."], ["p2", "someone pushed a change to the config."], ["you", "I think that was me, reverting it now."], ["p2", "thanks, it is turning yellow already."], ["p1", "green. we are back in business."], ["you", "next time I will read the diff twice."]],
  [["p1", "I found a stray cat in the courtyard."], ["p2", "is it friendly or is it plotting something?"], ["you", "both, probably, give it some water first."], ["p1", "it drank all of it and wants more."], ["p2", "we should call it ‹p3›."], ["you", "perfect name, it already looks like a ‹p3›."], ["p1", "okay, ‹p3› it is. I will bring snacks tomorrow."]],
  [["p1", "are we still on for the hike on Saturday?"], ["you", "yes, if the weather holds."], ["p2", "the forecast says clear until the afternoon."], ["p1", "then we leave early and beat the clouds."], ["you", "I will bring the maps and a big thermos."], ["p2", "and I will bring the sandwiches."], ["p1", "see you both at the trailhead at seven."]],
  [["p1", "I cannot find my notebook anywhere."], ["p2", "the green one with the torn corner?"], ["p1", "that is the one, it has all of my ideas in it."], ["you", "I saw it on the bench by the library door."], ["p1", "you are a lifesaver, going there right now."], ["p2", "tell it we said hello."], ["you", "I will, and I will keep an eye out for your pen as well."], ["p1", "thank you, the pen is a lost cause."]],
  [["p1", "quick question about the schedule."], ["you", "sure, go ahead."], ["p1", "is the review on Thursday or Friday?"], ["p2", "Thursday afternoon, right after the demo."], ["you", "I will have the slides finished by Wednesday night."], ["p1", "wonderful, that gives us a day to practice."], ["p2", "bring coffee, it is going to be long."]],
  [["p1", "the garden finally has tomatoes."], ["you", "the first ones of the year, that is wonderful."], ["p2", "save a few for me before the birds notice."], ["p1", "I have already put a net over them."], ["you", "I will bring salt and good bread on Sunday."], ["p2", "now that is a proper plan."]],
  [["p1", "did the package arrive?"], ["you", "it is on the porch, the box is bigger than I expected."], ["p1", "that would be the lamp, hopefully in one piece."], ["p2", "shake it gently and listen for rattles."], ["you", "no rattles, only a faint smell of cardboard."], ["p1", "excellent, then it survived the trip."], ["p2", "send a picture when it is plugged in."]],
  [["p1", "can someone explain what a semicolon is for?"], ["p2", "it joins two sentences that are close friends."], ["you", "or it ends a line of code, depending on the room."], ["p1", "so it is a bridge and a full stop at once."], ["p2", "more or less, a polite pause with ambitions."], ["you", "that is the best explanation I have ever heard."], ["p1", "I will put it on a poster."]]
];

export function genConvo(rng) {
  const fill = makeFiller(rng, { p: (r) => r.pick(NAMES) });
  // p1..p3 are people; ‹p3› inside a line may be a cat, which is why they are all just names
  const script = rng.pick(SCRIPTS);
  const turns = script.map(([who, text]) => ({ who: who === "you" ? "you" : fill("‹" + who + "›"), me: who === "you", text: fill(text) }));
  const mine = turns.filter((t) => t.me).map((t) => t.text);
  return { kind: "convo", turns, text: mine.join("\n") };
}

export const CONVO_COUNT = SCRIPTS.length;
