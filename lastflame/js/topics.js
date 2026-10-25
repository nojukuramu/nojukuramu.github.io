/* topics.js — every long explanation in the game, behind the (i) beside the
 * thing it explains, and Lola's notes. The interface says one line; this file
 * says the rest (CLAUDE.md: "Keep the interface quiet"). Copy lives here and
 * nowhere else, so one explanation can be opened from several places and
 * never drift. Bodies are trusted HTML written in this file. */

export const NOTES = [
  {
    title: "A note, in Lola's hand",
    body: "<p>Apo — the lamps must burn until morning. It does not come into the light.</p><p>Not while the rest of the house is dark, anyway.</p>"
  },
  {
    title: "A note, folded small",
    body: "<p>Tik-tik. Tik-tik.</p><p>When it is loud, it is far away. When you can barely hear it, it is already in the room.</p>"
  },
  {
    title: "A note, pushed under a door",
    body: "<p>Hide in the aparador if you must. Only if it does not see you go in.</p><p>If it sees, it knows. If you breathe, it knows.</p>"
  }
];

export const TOPICS = {
  play: {
    title: "How to play",
    body: `<p>The power is out, the typhoon is on the roof, and something has come into Lola's house. <b>Relight the five lamps, then get out by the front door.</b> You cannot fight it.</p>
<ul>
<li><b>Move</b> — WASD or the arrow keys; on a phone, the left half of the screen.</li>
<li><b>Look</b> — the mouse; on a phone, drag the right half.</li>
<li><b>Run</b> — Shift (push the stick all the way). <b>Crouch</b> — C or Ctrl.</li>
<li><b>Act</b> — E: hold it at a lamp to light it; press it at a door, a closet, a tin of oil, a note.</li>
<li><b>Lantern</b> — F turns the wick down or up. Right mouse lifts it to look at.</li>
<li><b>Hold your breath</b> — Space, for a few seconds.</li>
</ul>
<p>Headphones, if you have them. Every sound it makes is where it is.</p>
<p>At the fifth lamp, everything changes. <button class="about" data-info="end">What happens at the end</button></p>`
  },
  lamps: {
    title: "The lamps and your oil",
    body: `<p>Your lantern burns oil, faster when you run. When it goes out you are in the dark, and you cannot light a lamp without a flame — but any lamp you have already lit will light your lantern again.</p>
<p>Each lamp you light gives you some oil back, once. A few tins of kerosene are left around the house.</p>
<p>Lift the lantern (right mouse) to see roughly how much is left. There is no number for it, on purpose.</p>`
  },
  light: {
    title: "Light and dark",
    body: `<p>Your lantern shows you the way, and it shows you to it: lit, it can make you out from across a room — and it can see your light on the walls round a corner even when it cannot see you. With the wick turned down it has to be almost on top of you.</p>
<p>The dark gets into you. The longer you spend in it, and the nearer it comes, the worse you breathe — and past a point, it can hear you breathing. Light settles you again.</p>
<p>A lamp you have relit is a pool of light it will not step into. That holds for as long as some of the house is still dark.</p>`
  },
  hiding: {
    title: "Hiding",
    body: `<p>The aparadors — the tall wardrobes — are the only places to hide. One hides you completely <b>if it did not see you get in.</b> If it did, it will tear the doors open.</p>
<p>Inside, it can still hear you. Hold your breath (Space) when it is close; you can only hold it for so long, and letting it go too soon is loud.</p>
<p>A lantern left burning inside shines out through the slats.</p>`
  },
  hunter: {
    title: "What is in the house",
    body: `<p>It goes to what it hears and what it sees. Running is loud; crouching is quiet; some floorboards creak whatever you do; pots on the floor get kicked. A shut door slows it for a moment.</p>
<p>Its footsteps are always real — you will hear every step it takes, from where it is. The tiktik call is real too, but it works the way the old stories say: <b>loud when it is far, faint when it is near.</b></p>
<p>It is not stupid. Lose it and it searches the way you were going, not where it last saw you. A search may end with it tearing open the nearest closet, on a guess. It remembers how it left the doors, and notices one you have moved.</p>
<p>It hunts harder with every lamp you light.</p>`
  },
  fear: {
    title: "How afraid",
    body: `<p>This changes how the thing hunts, never how hard it hits:</p>
<ul><li><b>Gentle</b> — it sees less far, notices you more slowly, is slower in a chase, and stays away longer after one.</li>
<li><b>Normal</b> — the night as it was meant.</li>
<li><b>Merciless</b> — the opposite of gentle.</li></ul>`
  },
  mode: {
    title: "When it catches you",
    body: `<ul><li><b>Lola's Rules</b> — you wake by the last lamp you lit, a few seconds later, with the lamps still burning. It has gone somewhere else in the house.</li>
<li><b>One Night</b> — caught is the end. The next night is a new house.</li></ul>
<p>Either way the house is built fresh for every new night, so no route is ever learned by heart.</p>`
  },
  scares: {
    title: "Jump scares",
    body: `<p><b>Full</b> shows you what caught you. <b>Reduced</b> cuts to black instead, with no shriek. Nothing else about the night changes.</p>`
  },
  motion: {
    title: "Head bob and shaking",
    body: `<p>Turns off the walking bob, the screen shake and the slow warp that fear puts on the picture, for anyone they make unwell.</p>`
  },
  captions: {
    title: "Sound captions",
    body: `<p>Writes the sounds that matter at the bottom of the screen — its footsteps, a door, the tiktik — with which side they came from. For playing without sound, or without hearing.</p>`
  },
  quality: {
    title: "Graphics",
    body: `<p><b>Shadows</b> lets your lantern throw moving shadows, with a glow round every flame, the polished floors, the varnish and the brass reflect the room, and the walls and floors have depth — floorboard seams, panel edges, broken plaster — that moves as you do. <b>Fast</b> leaves those out and draws fewer pixels, for a phone or an older computer. Either way the lamps, the moon and the lightning keep their shadows — they are drawn once and kept, and they are what stops light coming through a wall. <b>Auto</b> picks Fast on a phone and Shadows elsewhere.</p>
<p><b>Unrestrained</b> holds nothing back: every pixel your screen has, smoothed edges, shadows twice as sharp and redrawn twice as often, textures kept sharp at a slant, the bounce light worked out twice as often. It is for a strong computer with a proper graphics card; on anything less it will stutter. Auto never picks it.</p>`
  },
  textures: {
    title: "Textures",
    body: `<p>How sharp the walls, floors and furniture are up close.</p>
<ul><li><b>Original</b> — the textures at the size they were made: 2k for the walls, floors and ceilings, 1k for every piece of furniture. About 16 MB, downloaded the first time you choose it and kept for offline after. Needs a computer with plenty of graphics memory.</li>
<li><b>High</b> — the textures the game ships with, made small so the whole game fits in a few megabytes. Always there, even offline.</li>
<li><b>Medium</b> and <b>Low</b> — High at half and a quarter of the size, made on your device: for a phone that is short of memory, or stutters when you walk into a new room.</li></ul>
<p>Changing it takes effect at once; nothing about the night changes.</p>`
  },
  end: {
    title: "The end of the night",
    body: `<p>When the fifth lamp is lit the house goes quiet for a few seconds. Then it turns: a doorway you came through is boarded up, a wall is broken through, the front door is unlocked — and what was waiting in the lamps comes out of them.</p>
<p><b>The dead</b> are not the aswang. They know roughly where you are — better the nearer they come, and far better while your lantern burns — and they drift through shut doors. When one sees you it comes straight for you: faster than you walk, slower than you run. They cannot open a closet, and if you stay hidden long enough they lose the thread.</p>
<p>The aswang is still in the house. While one of the dead has you running, it goes to where you are running to.</p>
<p>The front door creaks in the wind, and the moonlight comes in through it. Follow either.</p>`
  },
  update: {
    title: "Updates",
    body: `<p>Last Flame keeps itself on your device so it opens offline. When a new version is published it downloads quietly and waits; it never swaps itself in during a night. Reload when you are ready.</p>`
  },
  about: {
    title: "About Last Flame",
    body: `<p>A small horror game built from one piece of research: that fear comes from a plain goal, a scarce light, a threat you mostly cannot see, and pacing that rises and rests — and that simple horror goes stale in its second half unless the rules change. So at the fifth lamp, they do.</p>
<p>The house is a bahay na bato on a typhoon night; the thing in it is an aswang, the tiktik of the stories.</p>
<p>Furniture and surfaces: Poly Haven (CC0). Sounds: BigSoundBank, Kenney, OpenGameArt contributors and recordists on radio aporee and Wikimedia Commons (CC0 and public domain). Full list in the game's folder: assets/models/CREDITS.md and assets/sounds/CREDITS.md.</p>
<p>Nothing leaves your device. No accounts, no network after the first load.</p>`
  }
};
