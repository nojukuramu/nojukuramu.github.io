/* ============================================================
   Type — the conversation

   Very rarely (one in ten thousand Normal Text challenges) the text is not a
   paragraph but a chat. Other people talk; the player's side is shown as
   phantom letters — faint, already written, waiting to be typed — and the
   moment a line is typed, the room answers.

   A script is { tag, turns, title?, cast? }. A turn is [who, text]:
     "you"       the player: phantom letters in the box
     "p1".."p3"  other people, named from the pool for their cast
     "sys"       a small centred line: "Seen 9:43 pm", a date, a call that
                 went unanswered. Not a person, and it never waits for you.
   Every script starts with somebody else (or a "sys" line), has at least two
   player lines, and fills ‹p1› ‹p2› ‹p3› from names. cast: { p1: "f" } picks
   from a pool of women's names where the story needs it.

   The tags exist so tools/validate.js can promise the kinds the page is meant
   to have: a breakup where you are the one explaining, a breakup where you are
   the one being left, long sweet messages, the one who never replies.
   ============================================================ */

import { makeFiller } from "./fill.js";

export const CONVO_CHANCE = 0.0001;

const F = ["Ada", "Cleo", "Dara", "Faye", "Hana", "Juno", "Lena", "Nora", "Pia", "Rhea", "Tess", "Uma", "Wren", "Yara", "Mia", "Ines", "Chloe", "Bea"];
const M = ["Ben", "Eli", "Gus", "Ivo", "Milo", "Otis", "Sol", "Vic", "Xavi", "Zed", "Kai", "Leo", "Noah", "Theo", "Marco", "Dev"];
const ANY = F.concat(M);
const POOLS = { f: F, m: M, any: ANY };

const sc = (tag, turns, opts) => Object.assign({ tag, turns }, opts || {});

const SCRIPTS = [
  /* ---- you are the one explaining ---- */
  sc("explain", [
    ["p1", "we need to talk."],
    ["you", "okay. is everything alright?"],
    ["p1", "you cancelled on me three times this month."],
    ["you", "I know how it looks, but the launch at work ate every single weekend, and I should have told you instead of going quiet."],
    ["p1", "it is not only the plans. it is that I always find out last."],
    ["you", "you are right about that, and I am sorry. I thought I was protecting you from the stress, but all I did was shut you out."],
    ["p1", "I do not want to be protected. I want to be included."],
    ["you", "then let me fix it properly. I will tell you the second a plan changes, even if it is awkward, and I will clear this Saturday completely."],
    ["p1", "I have heard promises before."],
    ["you", "I know, and I will not ask you to believe me today. I am only asking you to watch what I do this month."],
    ["p1", "I think I need some time to think about it."],
    ["you", "take all the time you need. I will be here, and I will keep my word either way."],
    ["p1", "okay. goodnight."]
  ], { title: "‹p1›" }),
  sc("explain", [
    ["p1", "you forgot my birthday."],
    ["you", "I did not forget it, I swear. the reservation was for the right night, I just wrote the wrong date on the card."],
    ["p1", "a card with the wrong date is still a forgotten birthday."],
    ["you", "fair, and I am not going to argue with that. I was so busy planning the surprise that I forgot the one part you would actually see."],
    ["p1", "that is the thing, you plan everything except the small things."],
    ["you", "I hear you. the big plans were never the point, were they? it is the ordinary Tuesday where I remember you hate cilantro."],
    ["p1", "yes. exactly that."],
    ["you", "then give me a chance to be good at the Tuesdays. I will start tomorrow with the cilantro-free dinner you asked for in March."],
    ["p1", "I honestly do not know if I can do this anymore."],
    ["you", "that is okay, you do not have to know tonight. I just did not want you to leave thinking I did not care."],
    ["p1", "I know you care. that is what makes this so hard."]
  ], { title: "‹p1›" }),
  sc("explain", [
    ["p1", "are you free to talk? it is about the move."],
    ["you", "yes, I am here."],
    ["p1", "you said you would come with me, and now you are saying you want to stay."],
    ["you", "I did say that, and I meant it when I said it. then my mother got sick, and I could not leave her with nobody."],
    ["p1", "you could have told me that the day it happened."],
    ["you", "I should have. I kept hoping it would sort itself out before I had to say it out loud, because saying it made it real."],
    ["p1", "I would have understood. I just needed to know."],
    ["you", "I know that now. I am telling you everything from here on, even the parts that make me look bad."],
    ["p1", "the job starts in two weeks. I have to decide."],
    ["you", "then decide for yourself, not for me. I will be proud of you whichever way you go."],
    ["p1", "that makes it harder, you know."],
    ["you", "I know. I am sorry. I love you either way."]
  ], { title: "‹p1›" }),

  /* ---- you are the one being left ---- */
  sc("left", [
    ["p1", "hey. can you talk for a minute?"],
    ["you", "of course. you sound serious."],
    ["p1", "I have been thinking for weeks and I do not know how to say this. I do not think we should be together anymore."],
    ["you", "oh. I did not see this coming at all. can you tell me what changed?"],
    ["p1", "nothing dramatic. we just want different things and I kept pretending we did not."],
    ["you", "I wish you had told me sooner, but I understand. I would rather hear the truth than have you stay out of guilt."],
    ["p1", "I am really sorry. you did nothing wrong."],
    ["you", "thank you for saying that. I will be sad for a while, and that is okay. I hope you find what you are looking for."],
    ["p1", "you deserve someone who is certain about you."],
    ["you", "take care of yourself, okay? and drink some water, you always forget."],
    ["p1", "I will. goodbye."]
  ], { title: "‹p1›" }),
  sc("left", [
    ["p1", "it is not you, it is me."],
    ["you", "that is the oldest line in the book, you know."],
    ["p1", "I know. I am sorry. I could not think of a better one."],
    ["you", "was there anything I could have done differently?"],
    ["p1", "no. you were kind and patient and I still felt like I was disappearing."],
    ["you", "I wish I had noticed. I think I was so happy that I stopped asking how you were."],
    ["p1", "it is not your fault. I should have said something months ago."],
    ["you", "maybe we both should have. I do not want us to end angry, though."],
    ["p1", "I do not either. I will always be glad I met you."],
    ["you", "me too. I am keeping the good parts, and there were so many of them."],
    ["p1", "thank you for being gentle about this."],
    ["you", "you can have the good mug back, by the way. I only kept it hostage for emotional reasons."]
  ], { title: "‹p1›" }),
  sc("left", [
    ["sys", "Today 7:12 pm"],
    ["p1", "I met someone. I wanted you to hear it from me and not from anyone else."],
    ["you", "wow. okay. thank you for telling me yourself."],
    ["p1", "I never meant for it to happen like this. it started after we had already stopped talking."],
    ["you", "I believe you. it still stings, but I would rather it sting honestly than quietly."],
    ["p1", "are you angry?"],
    ["you", "a little, mostly sad. we had four good years, and I do not want one hard evening to erase them."],
    ["p1", "I do not want that either. you taught me how to be patient."],
    ["you", "and you taught me how to say what I feel. I hope they make you laugh the way you used to laugh with me."],
    ["p1", "that is the kindest thing anyone has said to me this week."],
    ["you", "be happy, okay? I will be fine. it just might take me a few Sundays."]
  ], { title: "‹p1›" }),
  sc("left", [
    ["p1", "the distance is too much. I cannot keep doing this."],
    ["you", "is this about the visit that got cancelled? I can fix that, I can take the earlier flight."],
    ["p1", "it is not one visit. it is six months of waiting for a screen to light up."],
    ["you", "I know it has been lonely. I tried to make up for it with long calls, but I see now that a call is not a hug."],
    ["p1", "I have been looking at the ceiling every night and wishing you were here."],
    ["you", "me too. I will never stop wishing that. but I also will not ask you to wait for something that makes you unhappy."],
    ["p1", "I feel like I am giving up on us."],
    ["you", "you are not giving up, you are being honest, and that took courage. I am proud of you for it, even though it hurts."],
    ["p1", "can we still be friends?"],
    ["you", "give me a little time, and then yes. I would like that very much."]
  ], { title: "‹p1›" }),

  /* ---- long, sweet messages ---- */
  sc("sweet", [
    ["p1", "happy anniversary, you."],
    ["you", "happy anniversary. I have been trying to write something good all day, so please be patient with me. two years ago I was nervous about everything, and then you laughed at my terrible joke and the whole room felt warmer."],
    ["p1", "that joke was genuinely terrible."],
    ["you", "I know, and I am still grateful for it. thank you for the quiet mornings, for the soup when I was sick, and for believing in me on the days I could not. I love building an ordinary life with you."],
    ["p1", "you are going to make me cry at my desk."],
    ["you", "good. I will bring tissues and pancakes tonight. here is to the next fifty years of bad jokes."]
  ], { title: "‹p1›", cast: { p1: "any" } }),
  sc("sweet", [
    ["p1", "are you still up?"],
    ["you", "always for you. I know the time difference is cruel, but I wanted to say goodnight properly. today I saw a little bakery that smelled exactly like your kitchen, and I stood outside for ten minutes just missing you."],
    ["p1", "I miss you so much it feels silly."],
    ["you", "it does not feel silly to me. I am counting the days on the calendar, and every one I cross off is a day closer to your front door. until then I will send you every good thing I find."],
    ["p1", "send me the bakery, at least."],
    ["you", "I will take a picture of the whole shelf. now close your eyes, dream something kind, and I will see you in the morning, which is your night."],
    ["p1", "goodnight, my favorite person."]
  ], { title: "‹p1›" }),
  sc("sweet", [
    ["p1", "I got the letter you sent. I do not even know what to say."],
    ["you", "you do not have to say anything. I just wanted you to know that when everyone else told me to give up, you sat on my floor with cold pizza and told me I was allowed to be bad at something for a while."],
    ["p1", "I only said what you needed to hear."],
    ["you", "that is exactly why it mattered. you never told me what I wanted to hear, you told me the truth with a kind face, and I have been braver every day since. thank you for being that person for me."],
    ["p1", "okay, now I am actually crying on the bus."],
    ["you", "then the letter worked. take the long way home and buy yourself something sweet, you earned it just by being you."]
  ], { title: "‹p1›" }),
  sc("sweet", [
    ["p1", "mom says you are moving at the end of the month."],
    ["you", "I am, and I have been dreading telling you. you have been my best friend since we were seven, and the idea of a hallway without you in it feels wrong."],
    ["p1", "it feels wrong to me too."],
    ["you", "but I made a list of the things I will never let distance take: the Sunday calls, the terrible movies we pretend to hate, the secret handshake that only works if neither of us remembers it properly."],
    ["p1", "you are so dramatic. I love it."],
    ["you", "I learned from the best. promise me you will visit, and that when I am famous you will tell the interviewer I was always like this."],
    ["p1", "I promise. and I will bring the awful handshake."]
  ], { title: "‹p1›", cast: { p1: "any" } }),

  /* ---- trying to impress someone who never replies ---- */
  sc("ghost", [
    ["sys", "Today 9:41 pm"],
    ["you", "hey ‹p1›, it is me, the guy from the bookstore who pretended to need a gift for his aunt."],
    ["sys", "Delivered"],
    ["you", "I do not actually have an aunt."],
    ["sys", "Seen 9:43 pm"],
    ["you", "anyway, you have excellent taste in poetry and I would love to hear your top three."],
    ["sys", "Seen 9:44 pm"],
    ["you", "also I know a place that does pancakes at midnight, if you are ever hungry and unsupervised."],
    ["sys", "Seen 9:52 pm"],
    ["you", "no pressure, obviously. I am just a calm person who is totally fine."],
    ["sys", "Typing..."],
    ["sys", "Typing stopped."]
  ], { title: "‹p1›", cast: { p1: "f" } }),
  sc("ghost", [
    ["p2", "bro did she reply?"],
    ["you", "not yet, but she watched my story twice, so I think that is basically a yes."],
    ["p2", "that is not how any of this works."],
    ["you", "I will send her a very clever message. something poetic about her laugh in the library."],
    ["p2", "you have never heard her laugh."],
    ["you", "then it will be a very mysterious message. she will be intrigued."],
    ["p2", "please do not send it."],
    ["you", "too late. it says: your presence makes the quiet section feel less quiet."],
    ["sys", "Seen 10:12 pm"],
    ["p2", "I am putting my phone in a drawer."],
    ["you", "she left me on read. but the little checkmark looked a bit warm, so I am staying optimistic."],
    ["sys", "Seen 10:12 pm"]
  ], { title: "‹p2›" }),
  sc("ghost", [
    ["sys", "Tuesday"],
    ["you", "good morning ‹p1›! I made too much coffee and thought of you, which is a very efficient way to say I think of you."],
    ["sys", "Delivered"],
    ["you", "I realise that sounded weird. I mean it in a normal, healthy, well-adjusted way."],
    ["sys", "Delivered"],
    ["you", "wednesday: I saw a dog today that looked exactly like a dog you once described, and I almost cried."],
    ["sys", "Seen Wednesday"],
    ["you", "thursday: I have started telling people we are talking. it is mostly me talking, but it counts."],
    ["sys", "Seen Thursday"],
    ["you", "friday: so about that dinner. I am free all weekend, and also every other day, for the rest of time."],
    ["sys", "..."]
  ], { title: "‹p1›", cast: { p1: "f" } }),

  /* ---- and the rest of ordinary life ---- */
  sc("funny", [
    ["p1", "we should totally hang out soon!"],
    ["you", "yes! let us definitely do that. how about this weekend?"],
    ["p1", "oh, this weekend is crazy. next week?"],
    ["you", "next week works. which day is good for you?"],
    ["p1", "let me check and get back to you!"],
    ["you", "perfect. I will keep my calendar open."],
    ["p1", "amazing. we should totally hang out soon!"],
    ["you", "I will see you in about four months, then."]
  ], { title: "‹p1›" }),
  sc("funny", [
    ["p1", "Hi! Thanks for contacting support. Have you tried turning it off and on again?"],
    ["you", "yes, three times, and once in the other order."],
    ["p1", "I understand. Have you tried turning it off and on again?"],
    ["you", "I just told you that I did. can I speak to a person?"],
    ["p1", "I am a person! Mostly. Have you tried turning it off and on again?"],
    ["you", "I am going to describe the problem one more time, very slowly, and I want you to read every word."],
    ["p1", "Great news! Your ticket is number 4,812. Please hold."],
    ["you", "how long will I be holding?"],
    ["p1", "Have you tried turning it off and on again?"]
  ], { title: "Support", cast: { p1: "any" } }),
  sc("funny", [
    ["p1", "did you eat today?"],
    ["you", "yes mom, I had a proper lunch with vegetables and everything."],
    ["p1", "what vegetables?"],
    ["you", "there was a tomato on the burger, and that is a fruit, but it is a vegetable in spirit."],
    ["p1", "I am sending you soup. it is already on the bus."],
    ["you", "you cannot send soup on a bus, that is not a thing."],
    ["p1", "the driver said he would keep it warm. his name is Ruben."],
    ["you", "I love you, but I am a grown adult with a refrigerator."],
    ["p1", "the refrigerator does not love you back."]
  ], { title: "Mom", cast: { p1: "any" } }),
  sc("funny", [
    ["p1", "hello, I think I have the wrong number, but you seem nice."],
    ["you", "that is kind of you. I am afraid I do not know anyone called Gerald."],
    ["p1", "that is fine. Gerald owes me forty dollars and a casserole dish."],
    ["you", "then I would very much like to help you find Gerald."],
    ["p1", "really? that is the nicest thing a stranger has done all week."],
    ["you", "I have a flashlight and nothing to do until Thursday."],
    ["p1", "okay, we start at the community pool, he is always there on Sundays."],
    ["you", "I will bring snacks. tell me how serious a casserole dish is, legally."],
    ["p1", "very. it was my grandmother's."]
  ], { title: "Unknown number", cast: { p1: "any" } }),
  sc("funny", [
    ["p1", "k."],
    ["you", "k? just k? did I do something wrong?"],
    ["p1", "no, I meant okay."],
    ["you", "okay with a full stop, or k with a full stop? those are different emotions."],
    ["p1", "you are overthinking it."],
    ["you", "I am a person who has to know whether a period is angry or just tired."],
    ["p1", "it is tired. I promise it is tired."],
    ["you", "thank you. I can finally sleep without analysing punctuation."],
    ["p1", "k"],
    ["you", "no full stop. now I am terrified."]
  ], { title: "‹p1›" }),
  sc("funny", [
    ["p1", "your dog is in my garden again."],
    ["you", "I am so sorry. he has a talent for escaping, and I think he considers your garden the better restaurant."],
    ["p1", "he dug up my tulips."],
    ["you", "I will replace every one, and I will also fix the gap in the fence tonight, even if I have to do it with a very awkward ladder."],
    ["p1", "he is looking at me with those eyes."],
    ["you", "he does that. it is a weapon, and he knows exactly how to use it."],
    ["p1", "fine, but I am keeping one of his toys as a hostage."],
    ["you", "that is fair. his favorite is the squeaky duck, and he will negotiate."]
  ], { title: "Neighbour", cast: { p1: "any" } }),
  sc("funny", [
    ["p1", "the dishes have been in the sink for four days."],
    ["you", "they are not dishes anymore, they are an ecosystem, and I think we should respect it."],
    ["p1", "I found a plate older than my phone."],
    ["you", "that is a vintage, and you are being unkind to a plate with history."],
    ["p1", "I am going to wash them now, and you are going to dry."],
    ["you", "I accept those terms, but only if we put music on and pretend it is a cooking show."],
    ["p1", "fine. you are the host."],
    ["you", "welcome back to the show, tonight we make a fresh start out of a very old pan."]
  ], { title: "Roommates", cast: { p1: "any" } }),
  sc("funny", [
    ["p1", "Hello, I am calling to confirm your interview for the marketing position."],
    ["you", "thank you, yes, I am very excited. I applied for the design role, though."],
    ["p1", "oh. are you sure?"],
    ["you", "I am fairly sure. I wrote a cover letter about my deep love of typography."],
    ["p1", "that explains the font. one moment, I will check with the team."],
    ["you", "of course. I am happy to be marketing or design, I contain multitudes."],
    ["p1", "the team says you are now both. can you start Monday?"],
    ["you", "I would love to. do I get two desks?"]
  ], { title: "Recruiter", cast: { p1: "any" } }),

  /* ---- ordinary friends ---- */
  sc("casual", [["p1", "hey, are you still awake?"], ["you", "barely, but yes. what is going on?"], ["p2", "someone left the lights on in the lab again."], ["p1", "we are not going to say who."], ["you", "it was me, I will go and turn them off."], ["p2", "thank you, and bring the keys back this time."], ["you", "I promise, they are going on the hook."], ["p1", "good night, you two."]]),
  sc("casual", [["p1", "does anyone know a good place for lunch near the station?"], ["p2", "there is a bakery on the corner with soup on Tuesdays."], ["you", "that one is great, and the bread is still warm at noon."], ["p1", "perfect, I will meet you both there at twelve."], ["p2", "save me the seat by the window."], ["you", "done, I will put my coat on it."]]),
  sc("casual", [["p1", "the build is red again."], ["you", "which job is failing?"], ["p1", "the one that was green five minutes ago."], ["p2", "someone pushed a change to the config."], ["you", "I think that was me, reverting it now."], ["p2", "thanks, it is turning yellow already."], ["p1", "green. we are back in business."], ["you", "next time I will read the diff twice."]]),
  sc("casual", [["p1", "I found a stray cat in the courtyard."], ["p2", "is it friendly or is it plotting something?"], ["you", "both, probably, give it some water first."], ["p1", "it drank all of it and wants more."], ["p2", "we should call it ‹p3›."], ["you", "perfect name, it already looks like a ‹p3›."], ["p1", "okay, ‹p3› it is. I will bring snacks tomorrow."]]),
  sc("casual", [["p1", "are we still on for the hike on Saturday?"], ["you", "yes, if the weather holds."], ["p2", "the forecast says clear until the afternoon."], ["p1", "then we leave early and beat the clouds."], ["you", "I will bring the maps and a big thermos."], ["p2", "and I will bring the sandwiches."], ["p1", "see you both at the trailhead at seven."]]),
  sc("casual", [["p1", "I cannot find my notebook anywhere."], ["p2", "the green one with the torn corner?"], ["p1", "that is the one, it has all of my ideas in it."], ["you", "I saw it on the bench by the library door."], ["p1", "you are a lifesaver, going there right now."], ["p2", "tell it we said hello."], ["you", "I will, and I will keep an eye out for your pen as well."], ["p1", "thank you, the pen is a lost cause."]]),
  sc("casual", [["p1", "quick question about the schedule."], ["you", "sure, go ahead."], ["p1", "is the review on Thursday or Friday?"], ["p2", "Thursday afternoon, right after the demo."], ["you", "I will have the slides finished by Wednesday night."], ["p1", "wonderful, that gives us a day to practice."], ["p2", "bring coffee, it is going to be long."]]),
  sc("casual", [["p1", "the garden finally has tomatoes."], ["you", "the first ones of the year, that is wonderful."], ["p2", "save a few for me before the birds notice."], ["p1", "I have already put a net over them."], ["you", "I will bring salt and good bread on Sunday."], ["p2", "now that is a proper plan."]]),
  sc("casual", [["p1", "did the package arrive?"], ["you", "it is on the porch, the box is bigger than I expected."], ["p1", "that would be the lamp, hopefully in one piece."], ["p2", "shake it gently and listen for rattles."], ["you", "no rattles, only a faint smell of cardboard."], ["p1", "excellent, then it survived the trip."], ["p2", "send a picture when it is plugged in."]]),
  sc("casual", [["p1", "can someone explain what a semicolon is for?"], ["p2", "it joins two sentences that are close friends."], ["you", "or it ends a line of code, depending on the room."], ["p1", "so it is a bridge and a full stop at once."], ["p2", "more or less, a polite pause with ambitions."], ["you", "that is the best explanation I have ever heard."], ["p1", "I will put it on a poster."]])
];

export const TAGS = ["explain", "left", "sweet", "ghost", "funny", "casual"];
export const CONVO_COUNT = SCRIPTS.length;
export const scripts = () => SCRIPTS;

export function genConvo(rng, only) {
  const pool = only ? SCRIPTS.filter((s) => s.tag === only) : SCRIPTS;
  const script = rng.pick(pool);
  const cast = Object.assign({ p1: "any", p2: "any", p3: "any" }, script.cast || {});
  const fill = makeFiller(rng, { p: (r, name) => r.pick(POOLS[cast[name]] || ANY) });
  const turns = script.turns.map(([who, text]) => {
    if (who === "sys") return { who: "", me: false, sys: true, text: fill(text) };
    return { who: who === "you" ? "you" : fill("‹" + who + "›"), me: who === "you", sys: false, text: fill(text) };
  });
  const title = fill(script.title || "‹p1›");
  const mine = turns.filter((t) => t.me).map((t) => t.text);
  return { kind: "convo", tag: script.tag, title, turns, text: mine.join("\n") };
}
