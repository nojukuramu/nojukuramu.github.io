/* topics.js — the long copy, in one place.
 *
 * The interface says one line; everything a player might want explained
 * lives here and opens in the info sheet from a small (i). One registry, so
 * the same explanation can be reached from several panels without drifting.
 * tools/validate.js checks every data-info in the game names a topic here. */

const b = (s) => "<b>" + s + "</b>";

export const TOPICS = {
  about: {
    title: "What this is",
    body: "<p>" + b("Bloomworks") + " is an idle game about placing glowing contraptions on an endless grey world. Light flows through your machines, turns into Glow, and brings the land back to life.</p>" +
      "<p>You start with one Wellspring and one Hearth. Motes of light roll out, pass through your machines, and become Glow when a Hearth sells them. Spend Glow on more contraptions, higher Levels and more land.</p>" +
      "<p>Later, Tinkers build and upgrade for you, and you make the bigger choices. Three reset layers multiply everything, and no system has a final cap.</p>"
  },
  howto: {
    title: "Playing",
    body: "<p>" + b("Build") + " opens the contraptions. Pick one, then tap the ground to place it; " + b("Rotate") + " turns it before you place it. Tracks are laid by dragging a path.</p>" +
      "<p>" + b("Tap") + " a contraption to select it and see its Level, Mods and buttons. Tapping a Wellspring emits a mote at once; tapping anything else gives it ×2 Tempo for 10 s, then it rests for 30 s.</p>" +
      "<p>" + b("Drag") + " to look around, " + b("pinch") + " or scroll to zoom. Tap a dashed plot to claim it. A Golden Moth flying over your land is worth tapping.</p>" +
      "<p>Moving or removing a copy gives back 100% of its cost, so layouts are free to try.</p>"
  },
  motes: {
    title: "Motes",
    body: "<p>A mote is a glowing orb that carries Value from a Source to a Hearth. Every mote you see is Glow on its way.</p>" +
      "<p>" + b("Tier") + " is its rank: Spark, Orb, Gem, Star, Comet, Nova, Nebula, Galaxy, then the shapes repeat with a halo ring per cycle. A Fuser raises it; far Nodes emit higher Tiers. " + b("Hue") + " is Plain, a primary, a secondary or Prismatic. " + b("Stamps") + " are the marks processors put on it, once per processor type. " + b("Traits") + " are Lucky and Charged.</p>" +
      "<p>Tracks move motes at 2 tiles/s, up to 4 per tile. When the next tile is full, motes wait; nothing is ever lost. A mote that lands off a path becomes a " + b("Stray") + " and glows on the ground until a Hopper or a Courier moves it. A plot holds 50 Strays; past that, each new one turns into Bloom XP.</p>"
  },
  hues: {
    title: "Hues and Wishes",
    body: "<p>Red, Blue and Yellow come from Nodes and Prisms; Wellsprings emit Plain. A fusion holds every primary found in its inputs: two make a secondary (Purple, Green, Orange), three make Prismatic.</p>" +
      "<p>Hue Bonus on a fusion: ×1 for none or one primary, ×1.5 for a secondary, ×3 for Prismatic. Prismatic motes stay Prismatic, so a full rainbow line earns ×3.75 per fusion.</p>" +
      "<p>" + b("Hearth Wish") + ": each Hearth asks for one hue every 60 s, shown as a dot on it. Motes of that hue sell for ×3 until the next Wish.</p>"
  },
  fusion: {
    title: "Fusion",
    body: "<p>A Fuser takes 4 motes of the same Tier and makes 1 mote of the next Tier.</p>" +
      "<p>FusedValue = (v1 + v2 + v3 + v4) × FusionBonus × HueBonus. The Fusion Bonus starts at ×1.25 and Fuser Milestones raise it.</p>" +
      "<p>A Fuser takes Tiers up to 1 + Level ÷ 50. A fused mote keeps a stamp only if all four inputs had it, so you can stamp one big mote instead of four small ones. Traits do not pass through fusion, but the Value they added stays.</p>"
  },
  stamps: {
    title: "Processors and stamps",
    body: "<p>Each processor type stamps a mote once; a second Kiln lets a Kiln-stamped mote through with no change and no wait. Order matters for some: an Engraver counts the stamps already on the mote, and an Hourglass counts its age.</p>" +
      "<p>Every stamp rolls for Lucky. Processor Milestones add +10% of base Power, which keeps the stack from running away.</p>"
  },
  lucky: {
    title: "Lucky motes",
    body: "<p>Every stamp has a Lucky chance, 1% to begin with. A hit adds one Lucky level: ×10 Value. A mote can hit on every stamp, and each extra level is another ×10, with no cap.</p>" +
      "<p>Lucky 1 sparkles, Lucky 2 shines, Lucky 3 gets a rainbow halo, and Lucky 4 and up is a Supernova. Each Lucky level on a sold mote adds a point to the Rush meter.</p>" +
      "<p>The Workshop's Lucky Lens, Mods, Relics, Crystal tiles, Fog and Aurora raise the chance, so Lucky becomes a real growth path.</p>"
  },
  combo: {
    title: "Combo",
    body: "<p>Each Hearth has its own Combo. Every mote it sells adds +1; Combo loses 10% of itself each second. A steady flow holds it near 10 × motes sold per second.</p>" +
      "<p>ComboMultiplier = 1 + 0.5 × log2(1 + Combo / 100): ×1.5 at 100, ×2 at 300, ×3 at 1,500, ×5 at 25,500, ×9 at 6.5M. The flame on the Hearth shows it, and the pitch of sales rises with it.</p>"
  },
  chimes: {
    title: "Chimes and Chains",
    body: "<p>A Chime rings at 10 Charge (Milestones lower it, to 4). It gains +1 when a contraption on the 8 tiles around it finishes an action, +3 when a Charged mote passes beside it, and +5 when another Chime within 3 tiles rings.</p>" +
      "<p>When it rings, every contraption within 3 tiles does one free action: a Source emits, a processor handles its next mote, a Fuser fuses, a Hearth sells.</p>" +
      "<p>One ring can set off others: that is a " + b("Chain") + ". Each Chime rings once per Chain, and a Chain ends after 0.2 s without a ring. Motes made at Chain step k get ×(1 + 0.1 × k). Each step is a Rush point. Each Chime plays one note of a pentatonic scale set by its tile, so a good layout also sounds good.</p>"
  },
  rush: {
    title: "Rush",
    body: "<p>The Rush meter fills to 100 from Lucky levels, Chain steps and Charged motes (0.1 each). At 100, Rush runs for 20 s: every Tempo ×2 and Lucky chance ×2. The meter does not fill during a Rush. The Seed Tree adds length and strength.</p>"
  },
  bloom: {
    title: "Bloom",
    body: "<p>Bloom is the life of a plot. Bloom XP is the Value of every mote a contraption in the plot processes or sells; level n needs 10^(n+1) XP. Each level gives ×1.1 Power to every contraption in the plot, and it has no cap.</p>" +
      "<p>Barren, Sprout, Meadow, Grove, Wild, Lush, then Radiant, where light drifts up from the plants.</p>" +
      "<p>" + b("Overgrowth") + ": at a Harvest each plot keeps half its Bloom (rounded down) if that beats what it kept before, and starts there when you claim it again. An Eclipse resets Overgrowth.</p>"
  },
  critters: {
    title: "Critters",
    body: "<p>Critters move into plots with Bloom 2 or more, as many as the plot's Bloom level. Each biome has three common critters and one rare one that appears in only one kind of weather.</p>" +
      "<p>Fireflies lend Lucky chance, Hoppers carry Strays to Tracks, Ember Newts warm Kilns, Shore Crabs ferry motes along the water, Dune Skinks add ×1.1 to motes they cross, Snow Owls speed Moon Wells at night, Storm Goats lengthen a Launcher's throw, Prism Moths colour Plain motes.</p>" +
      "<p>See every critter of a biome and the Codex gives +10% Bloom XP there for ever.</p>"
  },
  weather: {
    title: "Weather",
    body: "<p>Each biome rolls new weather every 4 to 8 minutes, and the forecast shows the next one 2 minutes ahead.</p>" +
      "<p>Rain: Waterwheels ×2, Bloom XP ×1.5. Fog: Lucky ×1.5, Tempo −10%. Heatwave: Kilns and Sun Dishes ×1.5. Sandstorm: Polishers ×2, Launcher Range −50%. Snow: Tracks −25%, Moon Wells ×1.5. Storm: Storm Rods fire, and strikes charge nearby Chimes. Wind: Launcher Range +50%. Aurora (night, rare): Lucky ×3. Rift: Void tiles roll every 20 s.</p>" +
      "<p>About once an hour a " + b("Meteor Shower") + " lands Starstone nodes for 5 minutes; an Extractor on one gets ×10.</p>"
  },
  daynight: {
    title: "Day and night",
    body: "<p>A day is 12 minutes: 8 of day and 4 of night. Sun Dishes work by day, Moon Wells by night, and Lanterns at ×2 strength at night. Summer days are longer, Winter nights are longer. Your Constellations show in the night sky.</p>"
  },
  tiles: {
    title: "Tiles",
    body: "<p>" + b("Soil") + ": anything. " + b("Rock") + ": clear it for 5% of the plot cost (5% chance of a Mod). " + b("River") + ": Waterwheels only; carries motes downstream at 1.5 tiles/s for free. " + b("Lake") + ": nothing; Launchers throw over it. " + b("Ley Line") + ": ×1.5 Power. " + b("Node") + ": Extractors only. " + b("Vent") + ": a Kiln gets ×2. " + b("Ice") + ": Tracks only, 2× faster. " + b("Crystal") + ": +2% Lucky. " + b("Cliff") + " and " + b("Sky Gap") + ": only Launchers and Warp Pipes cross. " + b("Void") + ": a random effect, good or bad, every minute.</p>"
  },
  plots: {
    title: "Plots and Rings",
    body: "<p>A plot is 10×10 tiles. The Home Plot sits at the centre and is always yours. Ring is a plot's distance from home in plots; Ring r has 8r plots. You can claim a plot that shares an edge with one you own.</p>" +
      "<p>PlotCost = 900 × 8^(r−1) × 1.25^m, where m is how many plots you already own in that Ring this Season.</p>" +
      "<p>Far plots cost much more, but their Nodes are much richer: Richness = 1.6^r, and Node Tier = 1 + ⌊r/3⌋. Biomes appear by Ring: Meadow at home, Ember Wastes and Tidecoast from Ring 2, the Dune Sea from 3, Frostreach and the Highlands from 4, Crystal Hollows from 6, Skyreach from 8, the Fringe from 12 and Anomalies from 16, whose rules never run out.</p>"
  },
  ruins: {
    title: "Ruins",
    body: "<p>About one plot in six holds Ruins. Once the plot is yours, an Excavation costs 10× the plot cost and takes 2 to 10 minutes (Scouts dig 2× faster). Loot: a Wonder, a Relic, Mods, or a Lore page, better the farther out. Each site gives loot once per world; its Lore page stays in the Codex for ever.</p>"
  },
  levels: {
    title: "Levels, Milestones and Materials",
    body: "<p>A Level belongs to a type: one purchase upgrades every copy at once. Each Level adds 10% of base Tempo until the Tempo Cap. Past the cap a Source gets +5% of base Value per Level (Overclock).</p>" +
      "<p>LevelCost = LevelBase × g^(L−1), with g = 1.15 for Sources and 1.20 for everything else. Buy ×1, ×10, ×25, to the next Milestone, or Max.</p>" +
      "<p>Every 25th Level is a " + b("Milestone") + ": the type's bonus, and every copy changes Material in one wave across the map — Wood, Copper, Iron, Silver, Gold, Crystal, Starmetal, Voidglass, then a star mark per Milestone. Sources double their Value at each one.</p>"
  },
  specs: {
    title: "Specializations",
    body: "<p>At Level 100 a type offers two branches. Pick one; you can switch for free at the start of each Season.</p>"
  },
  workshop: {
    title: "Workshop",
    body: "<p>Workshop upgrades cost Glow and last until the next Harvest. Each has infinite levels; cost = base × 2.5^level.</p>"
  },
  mods: {
    title: "Mods",
    body: "<p>A Mod is an item you put in one copy, and it stays through every reset. Each copy has 1 slot, plus 1 per 100 Levels of its type (and one more once you have found all 8 Wonders).</p>" +
      "<p>Mods drop from Ruins, Commissions, Golden Moths, the Merchant, Meteor Showers, Rock clearing and the Wishing Well. Three identical Mods of one Rarity merge into one of the next: Common, Uncommon, Rare, Epic, Legendary, Mythic, then Ascended 1, 2, 3 and up, each twice as strong.</p>"
  },
  relics: {
    title: "Relics",
    body: "<p>A Relic is a permanent passive artifact, from Ruins, the Merchant, Commissions and secrets. A duplicate raises its Relic Level, and each level adds the base effect again, with no cap.</p>"
  },
  tinkers: {
    title: "Tinkers",
    body: "<p>Tinkers are helper bots that live in Tinker Huts (2 each, +1 per Hut Milestone, more from the Seed Tree). Give each a Job and change it any time.</p>" +
      "<p>" + b("Builder") + ": builds Ghosts and Blueprint stamps in order, as soon as you can pay. " + b("Upgrader") + ": buys Levels by the rule you pick. " + b("Courier") + ": carries Strays back to Tracks, or ferries motes between two linked contraptions. " + b("Scout") + ": claims the cheapest plot next to yours when you hold 3× its cost; digs Ruins 2× faster. " + b("Keeper") + ": catches Golden Moths (half the Windfall) and collects Commissions.</p>"
  },
  ghosts: {
    title: "Ghosts",
    body: "<p>At a Harvest every placed copy turns into a Ghost: a faint outline on the map. Builders rebuild Ghosts in their original order as soon as you can pay, and you can tap a Ghost to build it yourself. Move, delete or add Ghosts before they are built: switch on Plan in the Build panel to place Ghosts instead of copies.</p>"
  },
  blueprints: {
    title: "Blueprints",
    body: "<p>Select an area to save it as a Blueprint; Blueprints stay through every reset, Genesis included. Stamp one anywhere, in any rotation: it places Ghosts, and Builders do the rest. A part that uses a type you have not discovered shows in red. Share a Blueprint as a text code.</p>"
  },
  directives: {
    title: "Directives",
    body: "<p>Directives are IF-THEN rules the game checks once a second, from the top of the list down. They open in Season 3 with 2 slots; the Seed Tree adds up to 10 more, and every finished Constellation adds one, with no cap. A Directive can join up to 3 conditions with AND.</p>" +
      "<p>Harvest as an action needs Self-Seeding in the Seed Tree; Eclipse needs The Crown or Auto-Eclipse.</p><p>Example: IF Harvest gain ≥ 2 × current Seeds AND Season time ≥ 10 minutes, THEN Harvest.</p>"
  },
  offline: {
    title: "Offline progress",
    body: "<p>The game keeps running while it is closed: Offline Glow = online Glow × Offline Rate. The rate starts at 50% and the Seed Tree raises it to 100%. The time cap starts at 12 h; the Seed Tree adds days, and each Cracked Hourglass Relic Level adds 12 h more.</p>" +
      "<p>Tinkers work, Bloom grows and the weather changes while you are away. Golden Moths no Keeper catches become Moth Jars, up to 3. Commissions do not expire. The Logbook shows the totals, then plays a Time-lapse.</p>"
  },
  commissions: {
    title: "Commissions",
    body: "<p>The Notice Board shows 3 Commissions at a time; a new one appears every 15 minutes, or when you finish one. Each has a goal and a time limit. Rewards: a burst of Glow worth 10 minutes of production, one Mod, and a 1% chance of a Relic. Commission Rank rises with each one you finish, for harder goals and rarer Mods, with no cap.</p>"
  },
  moths: {
    title: "Golden Moths",
    body: "<p>A Golden Moth appears every 3 to 6 minutes over a plot you own and flies for 12 s. Tap it for a Windfall: Glow Burst (15 minutes of production, 40%), Frenzy (×7 Glow for 60 s, 30%), Lucky Rain (×10 Lucky chance for 30 s, 15%), Chain Storm (every Chime rings, 10%), or a Mod of Rare or better (5%).</p>"
  },
  merchant: {
    title: "The Wandering Merchant",
    body: "<p>The Merchant visits every 30 minutes and stays for 5, with 4 items: Mods and Moth Jars for Glow, a Weather Charm that sets the next weather in one biome, and rarely a Relic for Seeds.</p>"
  },
  feats: {
    title: "Feats",
    body: "<p>A Feat is an achievement worth +1% Glow for ever, and Feats stay through every reset. Most come in endless tiers. Some are hidden; their hints are in Lore pages.</p>"
  },
  codex: {
    title: "The Codex",
    body: "<p>The record of every contraption, Wonder, critter, biome, weather and Lore page you have found. A full chapter gives a permanent bonus: all critters of a biome give +10% Bloom XP there; all 8 Wonders give +1 Mod slot on every copy. Discoveries are permanent.</p>" +
      "<p>Secrets reward those who watch closely: a Prismatic T7 mote sold during an Aurora, a Chain that plays a Lore page's melody, shy critters in their weather, and Lore pages that point at a plot and a pattern.</p>"
  },
  seasons: {
    title: "Seasons and the Harvest",
    body: "<p>A Season is one run. Its kind rotates: Spring (Bloom XP ×2), Summer (long days, Sun Dishes ×1.5), Autumn (+25% Seeds from its Harvest), Winter (long nights, Moon Wells ×1.5, more Snow).</p>" +
      "<p>The first Harvest opens at 1M Glow in one Season; after that, any gain of 1 or more Seeds. SeedsEarned = ⌊10 × (L / 10^6)^(1/3)⌋, where L is all Glow since the last Eclipse; a Harvest pays that minus what you already earned. Each Seed earned gives +5% Glow, and spending Seeds does not lower it. The button turns gold when a Harvest would double your Seeds.</p>" +
      "<p>A Harvest resets Glow, Levels, copies (they become Ghosts), plots except home, the Workshop, and Bloom down to Overgrowth.</p>"
  },
  seedtree: {
    title: "The Seed Tree",
    body: "<p>Permanent upgrades bought with Seeds, kept until the next Eclipse. Node costs start at 5 Seeds and repeatable nodes cost ×2 per level. A node needs the one above it in its branch.</p>"
  },
  eclipse: {
    title: "Eclipse and the Sky",
    body: "<p>An Eclipse opens at 1M Seeds earned since the last one. StarsEarned = ⌊3 × (S / 10^6)^(1/2)⌋, where S is all Seeds since the last Genesis; the first Eclipse pays 3. Each Star gives +25% Glow.</p>" +
      "<p>Before the reset the sun goes dark for 30 s and every Moon Well works at ×10: a last show for the old run. An Eclipse resets all a Harvest does, plus Seeds, the Seed Tree and Overgrowth.</p>" +
      "<p>" + b("The Sky") + " is a star chart with fixed Star Points. Place each Star on a point; you can move them freely until your next Harvest. A full pattern becomes a Constellation with a permanent effect; each extra Star on a finished one adds +10% to it. Past the named ones, Wild Constellations keep appearing.</p>"
  },
  trials: {
    title: "Trials",
    body: "<p>Trials open after your first Eclipse. A Trial is a Season with a rule limit and a Glow goal; choose one when you Harvest. Passing it gives a permanent reward and raises its Rank. Each Rank multiplies the goal by 10 and adds the reward again, with no cap.</p>"
  },
  worldheart: {
    title: "The World Heart",
    body: "<p>After your first Eclipse a 5×5 World Heart can be grown in the Home Plot. It takes motes like a Hearth but pays no Glow. It grows in 7 Stages, each needing high-Tier motes, and its progress stays through Seasons and Eclipses. Each Stage gives ×2 all Glow until Genesis. At Depth d every Tier it asks for is 2d higher.</p>"
  },
  genesis: {
    title: "Genesis and the Cosmos",
    body: "<p>When the World Heart is complete, Genesis turns your world into a Planet. You start a new world with a new seed and choose one of three World Laws for it; Laws from earlier worlds stay, so each world has one more Law than the last.</p>" +
      "<p>Each Planet gives ×3 all Glow for ever, and keeps a Planet Trait from the Law you chose for its world. Stardust = ⌊Stars earned in that world ÷ 10⌋ + 25 × Depth, spent in the Cosmos Tree. Depth is the number of Geneses you have done; it has no cap.</p>"
  },
  numbers: {
    title: "Numbers",
    body: "<p>Short names run K, M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc; after Dc, letter pairs aa, ab and on to zz, then aaa. Scientific (1.23e45) and engineering notation are in Settings. No number has a cap; they grow past 10^308.</p>"
  },
  zen: {
    title: "Zen Mode and the Time-lapse",
    body: "<p>" + b("Zen Mode") + " hides the interface. The camera drifts slowly between your busiest spots while day, night and weather keep running. It works as a screensaver; tap anywhere to come back.</p>" +
      "<p>" + b("Time-lapse") + ": after 10 minutes or more away, a 10 s replay shows what changed — Tinkers building, Bloom spreading, new plots filling.</p>"
  },
  saving: {
    title: "Saving",
    body: "<p>The world saves itself every 30 seconds and whenever you leave the page, in this browser. Export it as a text code to keep it anywhere else, or to move it to another device.</p>"
  },
  privacy: {
    title: "What is stored",
    body: "<p>Your world and settings, in this browser's local storage. Nothing is sent anywhere; there are no accounts, and nothing here needs a connection once the game is installed.</p>"
  },
  active: {
    title: "Active play and idle play",
    body: "<p>Bloomworks rewards both. Active play — tapping Wellsprings early in a Season, catching Golden Moths yourself, picking Commissions and Merchant deals, redesigning layouts — earns about 1.5× to 2× the idle rate, so idle players never fall far behind.</p>"
  }
};
