/* topics.js — every long explanation in the game, behind the (i) beside the
 * thing it explains. The interface says one line; this file says the rest
 * (CLAUDE.md: "Keep the interface quiet"). Copy lives here and nowhere else.
 * Bodies are trusted HTML written in this file. Shape: Last Flame's. */

export const TOPICS = {
  howto: {
    title: "How to play",
    body: `<p>You are a mage in a world that does not end. <b>Draw your spells, walk out, and take the Sigils from the Wardens</b> of the great places.</p>
<ul>
<li><b>Waystones</b> stand where the roads meet. Step onto one to hold it: it heals you, you wake there if you fall, and from the map you can step to any waystone you hold.</li>
<li><b>Danger</b> rises the further you go from where you began. A road is a choice of direction.</li>
<li><b>Wardens</b> sleep at the fortresses, mage towers, plazas and courtyards. Each drops a <b>Sigil</b>, and each Sigil raises your circle rank — more to every page.</li>
<li><b>Chests</b> wait in the other structures: potions and experience.</li>
<li>The compass at the top points to the nearest Warden you have not beaten.</li>
</ul>
<p>The world grows from its seed: the same seed is the same world, for anyone.</p>`
  },
  controls: {
    title: "Controls",
    body: `<table class="keys">
<tr><th></th><th>Keyboard &amp; mouse</th><th>Touch</th><th>Gamepad</th></tr>
<tr><td>Move</td><td>W A S D</td><td>left thumb</td><td>left stick</td></tr>
<tr><td>Aim, cast</td><td>mouse, hold left click</td><td>right thumb (hold still: aims for you)</td><td>right stick, RT</td></tr>
<tr><td>Dash</td><td>Space or Shift</td><td>Dash</td><td>A</td></tr>
<tr><td>Payload</td><td>right click or F</td><td>the glowing button</td><td>LT</td></tr>
<tr><td>Scrolls</td><td>1–8, wheel</td><td>tap one</td><td>LB / RB</td></tr>
<tr><td>Potion</td><td>Q</td><td>the flask</td><td>Y</td></tr>
<tr><td>Spellbook</td><td>M, B or Tab</td><td>the book</td><td>Back</td></tr>
<tr><td>Map</td><td>N</td><td>the map</td><td>B</td></tr>
<tr><td>Pause</td><td>Esc</td><td>pause</td><td>Start</td></tr>
</table>`
  },
  spells: {
    title: "Drawing a spell",
    body: `<p>A spell is a drawing on a page.</p>
<ul>
<li><b>Glyph</b> — trace a closed shape through the ring's twelve dots. Its sides are its element: <b>3 Air, 4 Fire, 5 Earth, 6 Water</b>. Every glyph adds damage and power, and costs mana from its element's own pool.</li>
<li><b>Seal</b> — drag out a circle. Each seal of the first layer is something you throw; where it sits is where it leaves from. Its size, against the page's power, is its <b>spectrum</b>.</li>
<li><b>Rune</b> — tap a seal's rim. Each rune is one shot in that direction; the top of the page is where you aim.</li>
<li><b>Layer</b> — add a page under the first. Pull the trigger (right click) and every shot in flight bursts into it; a shot that runs out bursts anyway.</li>
</ul>
<p>The stamps place a perfect glyph; Mirror copies what you draw across the middle, so the page stays balanced.</p>`
  },
  spectrum: {
    title: "The spectrum",
    body: `<p>What a seal throws is its page's <b>power divided by its size</b>. A small seal with a lot of power behind it is a needle; a big one with little is a cannon.</p>
<ul>
<li><b>Needle, Lance, Beam</b> — sharp. Fast, pass through enemies, never push.</li>
<li><b>Dart</b> — a plain throw.</li>
<li><b>Wave</b> — a wide crescent that sweeps through everything once.</li>
<li><b>Burst, Cannon</b> — blow up where they stop.</li>
<li><b>Boulder</b> — slow and heavy; carries what it hits ahead of it.</li>
<li><b>Nova</b> — a huge seal with a lot of power: erupts where it sits.</li>
<li><b>Flicker</b> — too little power for its circle; a spark.</li>
</ul>
<p>Power is 50, plus 25 for every glyph that survives the stack, times the page's power. While you size a seal, a dashed ring marks each place the spectrum changes.</p>
<p>A payload layer inherits its parent's power, so the same rule decides it again: a slow Cannon can burst into Needles.</p>`
  },
  predators: {
    title: "Predators",
    body: `<p>Glyphs are read in the order you drew them, layer by layer, onto a stack. Each element preys on one other:</p>
<p class="cycle"><b>Water ▸ Fire ▸ Earth ▸ Air ▸ Water</b></p>
<p>If a glyph preys on the one just below it, the two annihilate: both are lost, and their mana is still spent. Draw Fire then Earth and you have both; draw Earth then Fire and you have nothing.</p>
<p>A lost glyph is drawn dashed on the page.</p>`
  },
  tier: {
    title: "Tiers",
    body: `<p>Every page is scored from its power, its spectrum, how many elements it mixes, how many shots and layers it has, and its balance. The score is its tier, <b>E</b> to <b>SSS</b>.</p>
<p>Each tier up adds 0.4 s to the cooldown and a quarter more mana. A small page casts often and cheaply; a great one is a great one, now and then.</p>
<p>Your staff has one cooldown: a scroll you switch to waits out the last one's.</p>`
  },
  balance: {
    title: "Balance",
    body: `<p>A page that mirrors left to right flies true. A lopsided one scatters, and loses up to half its power and damage.</p>
<p>Mirror, in the tools, keeps a page balanced as you draw.</p>`
  },
  mana: {
    title: "Mana",
    body: `<p>Four pools, one for each element. A glyph is paid from its own element's pool, and each pool fills at its own pace: <b>Air quickest, then Water, then Fire, Earth slowest</b>.</p>
<p>If you cannot pay for every glyph, the page still goes, without the ones you cannot afford. If you can pay for none, it throws the grey bolt instead.</p>
<p>The dot on each scroll says which: green, all of it; yellow, part; red, the grey bolt.</p>`
  },
  rank: {
    title: "Circle rank",
    body: `<p>How much one page can hold: glyphs, seals, runes, layers and power. You start at rank 1.</p>
<p>A <b>Sigil</b>, taken from a Warden, raises it by one, up to 6. A page drawn beyond your rank waits until you reach it; nothing on it is lost.</p>`
  },
  wardens: {
    title: "Wardens",
    body: `<ul>
<li><b>Verdant Warden</b> — in the woods and fields. Heals itself.</li>
<li><b>Ashfall Tyrant</b> — in villages, deserts and graveyards. Sets the ground under you burning.</li>
<li><b>Depths Harbinger</b> — in caves, rocks and swamps. Steps through to behind you.</li>
<li><b>Void Sentinel</b> — in ruins and camps. Unmakes your next spell.</li>
</ul>
<p>All four throw fans of bolts, more of them once they are badly hurt. Every trick is marked on the ground first, and a dash passes through it. A Warden does not leave its ground: walk away and it goes back to sleep, and mends.</p>`
  },
  waystones: {
    title: "Waystones",
    body: `<p>One stands at every place the roads meet. Step onto one and it is yours: it heals you and refills your mana while you stand on it, and it is where you wake if you fall.</p>
<p>From the map you can step to any waystone you hold — though not while a Warden is awake.</p>`
  },
  map: {
    title: "The map",
    body: `<p>Everything the seed has made within reach of where you stand: the lands, the roads, the waystones, the structures you have found. A gold mark is a Warden you have beaten.</p>
<p>Drag to look around; tap a waystone you hold to step there.</p>`
  },
  seed: {
    title: "Seeds",
    body: `<p>The world is grown from its seed: the lands, the roads, every structure and every creature's place. The same seed is the same world on every device, so you can give a seed to someone and walk the same roads.</p>
<p>Leave it blank for a new one.</p>`
  },
  quality: {
    title: "Graphics",
    body: `<ul>
<li><b>Low</b> — no shadows, no glow, fewer pixels. For older phones.</li>
<li><b>Medium</b> — soft shadows from the sun.</li>
<li><b>High</b> — shadows and glow, so spells and lanterns light up.</li>
</ul>
<p><b>Auto</b> starts at Medium on a phone and High elsewhere, and steps down once by itself if the game cannot keep up.</p>`
  },
  update: {
    title: "Updates",
    body: `<p>Magic Circles keeps itself on your device so it opens at once and plays offline. When a new version is out, a bar at the top offers it; nothing changes until you choose Reload.</p>
<p>It checks when you open it, every half hour while you play, and when the network comes back. "Check for updates" asks now.</p>`
  },
  privacy: {
    title: "What is stored",
    body: `<p>Your eight scrolls, your settings, and the journey you are on — its seed, where you stand, your level, which waystones you hold, which Wardens you have beaten and which chests you have opened — are kept in this browser's storage, and nowhere else.</p>
<p>Nothing is sent anywhere. There are no accounts and no ads.</p>`
  },
  credits: {
    title: "Credits",
    body: `<p>The models are <b>Kenney</b>'s (kenney.nl): the Nature, Fantasy Town, Graveyard, Castle, Survival, Mini Dungeon and Mini Characters kits, all CC0.</p>
<p>The renderer is three.js. Sounds are made as you hear them. The rest — the world, the spells, the drawing — is this game's own.</p>`
  }
};
