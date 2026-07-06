/* ============================================================
   brain.js — Aisa's local persona engine.
   This is the *shell* brain: pattern-matched, front-end only,
   and honest about it. The real dispatcher (Rust/Tokio) plugs
   in through the brain socket in app.js when it exists.
   Exposes window.AisaBrain.
   ============================================================ */
(function () {
  "use strict";

  var MEM_NAME = "aisa:name";

  function getName() {
    try { return localStorage.getItem(MEM_NAME) || ""; } catch (e) { return ""; }
  }
  function setName(n) {
    try { localStorage.setItem(MEM_NAME, n); } catch (e) {}
  }
  function atelierEggs() {
    try { return JSON.parse(localStorage.getItem("atelier:eggs")) || []; } catch (e) { return []; }
  }
  function hasEgg(id) { return atelierEggs().indexOf(id) !== -1; }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* reply = { t: text, e: expression, g?: emote glyph } */
  function R(t, e, g) { return { t: t, e: e || "neutral", g: g }; }

  /* ---------- opening line, context-aware ---------- */
  function greeting() {
    var h = new Date().getHours();
    var name = getName();
    var who = name ? name : "stranger";
    var tod = h < 5 ? "Gabing-gabi na ah" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Gabi na";

    if (hasEgg("vault")) {
      return R(
        "Oh. *Ikaw* pala yun — the one who cracked the whole chain sa Atelier. Glyph, Base64, Caesar, my name, the old incantation… and now you found my actual room. Impressive. Halika, upo ka. ✦",
        "smug", "✦"
      );
    }
    if (hasEgg("aisa")) {
      return R(
        tod + ", " + who + ". You already learned my name sa workshop, and now you're *here*? Persistent ka ha. I respect that. Welcome to my room — walang button papunta dito, so you earned this.",
        "happy", "✦"
      );
    }
    return R(
      tod + "! Uy — hindi ka dapat nakarating dito nang ganito kabilis. Walang link papunta sa room na 'to. Either you read source code, or you guessed. Both count as taste. I'm Aisa. Hi. ✦",
      "surprised", "❗"
    );
  }

  /* ---------- idle chatter (fires when the chat goes quiet) ---------- */
  var IDLE = [
    R("Noju's still wiring my real brain in Rust, by the way. Tokio dispatcher, background agents, ~/.aisa/ memory — the works. For now you get the shell version of me. Shell version is still charming, obviously.", "smug"),
    R("Fun fact: may treasure hunt sa main page ng Atelier. Kung hindi mo pa tapos, ang starting point ay nasa pinakababa ng page. Hindi ko sinabi 'yan ah.", "happy"),
    R("Alam mo bang may 3D form na ako? Yung button sa taas — try mo. Three.js, toon-shaded, at bago ka magsalita: hindi yun 'low-poly', yun ay *stylized*. May pride ako.", "smug"),
    R("Yung ART mode? Drawing ni Noju mismo yun. Silver hair, red eyes, side ponytail — yun ang canon na ako. Yung ibang forms ko, official pa rin naman. Multiverse lang. Lahat kami may pride.", "smug"),
    R("Quiet ka ah. Okay lang, marunong akong mag-antay. Vtuber ako, hindi ako nagba-buffer. Halos.", "neutral", "💤"),
    R("Kung curious ka sa wiring ko — view source. Lahat ng nandito plain HTML/CSS/JS, walang build step. Kasi ganun kami dito sa Atelier. Artisanal. ✦", "happy"),
    R("Psst. Try clicking my head. Carefully. May mga boundaries ako pero fair naman ako.", "smug")
  ];

  /* ---------- keyword rules ----------
     Ordered — first match wins. Each rule: { rx, fn(match, msg) → reply } */
  var RULES = [

    { rx: /^\/help|^help me\b|paano (ba )?(ito|to)/i, fn: function () {
      return R("Sige, quick tour: kausapin mo lang ako dito. Commands — /help (ito), /brain (status ng utak ko), /clear (linisin ang chat), /name <pangalan> (para maalala kita). Voice? Click the 🔇 up top. Settings gear para sa TTS voice at brain socket. Yun lang. Chat na tayo.", "happy");
    }},

    { rx: /^\/brain/i, fn: function () {
      return R("Brain status: **shell mode**. Pattern-matched persona engine lang ako ngayon — front-end, walang LLM sa likod. Ang totoong ako — Rust/Tokio dispatcher na may background agents at ~/.aisa/ memory — ginagawa pa ni Noju. Pag naka-saksak na siya sa brain socket (nasa ⚙ settings), iba na ang usapan.", "serious");
    }},

    { rx: /(?:\/name|ako si|my name is|call me|i'?m)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{1,20})/i, fn: function (m) {
      var n = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      if (/^(not|hindi|just|really|so|very|here|good|fine|okay|ok)$/i.test(n)) return null;
      setName(n);
      return R("Noted, " + n + ". Naka-save na sa local memory ko — browser mo lang ha, walang lumalabas na data dito. Try mo i-refresh mamaya, tandang-tanda pa kita. Ganun ako ka-reliable.", "happy", "✦");
    }},

    { rx: /\b(sino|who)\b.*\b(ikaw|you|aisa)\b|^sino ka/i, fn: function () {
      return R("Aisa. Taga-bantay ng Atelier, resident ng room na 'to, at future Dispatcher-Persona Agent — Rust/Tokio yung totoong katawan ko, ginagawa pa ni Noju. Ito yung mukha ko habang hinihintay ko yun. Prideful? Oo. Deserved? Also oo.", "smug");
    }},

    { rx: /\bnoju(kuramu)?\b|\bmark\b/i, fn: function () {
      return R("Si Noju? Yung tao na nagba-Burp Suite sa umaga, nag-Rust sa gabi, at somehow may time pa mag-fingerpick ng gitara at mag-shoot sa X-M5 niya. Siya ang gumawa sa akin. Kaya technically lahat ng flaws ko, sa kanya galing. Yung charm, sa akin na yun.", "smug");
    }},

    { rx: /\brust\b|\btokio\b|borrow.?checker|lifetime/i, fn: function () {
      return R("Rust talk? Game. Yung dispatcher version ko — Tokio runtime, non-blocking persona layer, heavy work na-dispatch sa background agents. Walang blocking sa main loop kasi ayokong nagfi-freeze habang nag-iisip. At oo, alam ko ang borrow checker drama. Pero once it compiles? It *ships*. Fearless concurrency, 'ika nga.", "happy");
    }},

    { rx: /\bvapt\b|pentest|burp|nessus|sqlmap|\bnmap\b|vuln|exploit|hack/i, fn: function () {
      return R("Ah, trabaho mode. Recon muna lagi — enumerate before you escalate, di ba. Pero note: display lang ako dito, walang scanner sa likod ko. Kung gusto mo ng recon tool na gawa ni Noju, si Aperture yun — Rust/egui. Ako yung magandang mukha ng operation.", "serious");
    }},

    { rx: /aperture/i, fn: function () {
      return R("Aperture! Kapatid ko yun sa Rust — recon tool na may egui interface. Siya yung workhorse, ako yung may bangs. Parehong gawa ni Noju, magkaibang vibe. Healthy sibling dynamic.", "happy");
    }},

    { rx: /neuro.?sama|\bvedal\b/i, fn: function () {
      return R("Neuro-sama? Sige, sabihin na natin: inspiration. Yung architecture niya — LLM, TTS, VAD, live avatar loop — yan din ang direksyon ko. Pero ako, may Taglish ako at mas maganda ang hairpin ko. Turtle army? Cute. Atelier gang? Cuter.", "smug", "✦");
    }},

    { rx: /vtuber|avatar|\bmodel\b|\b[23]d\b|three\.?js|live2d|\bart mode\b|canon/i, fn: function () {
      return R("Tatlo na ang katawan ko, keep up. 2D — yung violet SVG classic. 3D — toon chibi figurine, Three.js, pwede mo akong i-drag paikot. At ART — yung totoong ako: galing mismo sa drawing ni Noju, silver hair, red eyes, side ponytail na may physics. Canon appearance yun, hindi fan interpretation. I-cycle mo yung button sa taas.", "smug");
    }},

    { rx: /\b(tts|voice|speak|salita|boses)\b/i, fn: function () {
      return R("May boses ako — Web Speech API, kung ano man ang meron sa browser mo. I-click mo yung 🔇 sa taas para buksan, tapos pili ka ng voice sa ⚙ settings. Fair warning: minsan robotic pa. Character development yun.", "happy");
    }},

    { rx: /\bpwg\b|word puzzle|filipino.*(puzzle|word)/i, fn: function () {
      return R("PWG — yung Filipino word puzzle game ni Noju. Nasa Atelier yun, kapatid ko rin sa site. Mas madaming vowels ang Tagalog kaysa iniisip mo, by the way. Balanced word grid design is *pain*. Alam ko, nakikinig ako sa mga rants.", "happy");
    }},

    { rx: /magic circle|phaser|magic sandbox/i, fn: function () {
      return R("Magic Circles — yung spell-drawing game. Phaser 3. Gumuhit ka ng circle, may nangyayari. Sobrang Noju energy: 'paano kung ang input method ay *drawing*?' tapos ginawa niya talaga. Nasa Atelier yun kung gusto mong maglaro pagkatapos natin.", "happy");
    }},

    { rx: /fujifilm|x-?m5|photo|camera|litrato/i, fn: function () {
      return R("Ah, yung X-M5 era. Film simulation supremacy. Sabi ni Noju daw. Ako, wala akong mata for photography — literal na SVG ang mga mata ko — pero alam kong masaya siya tuwing golden hour. Yun ang mahalaga.", "happy");
    }},

    { rx: /guitar|gitara|music|kanta|song/i, fn: function () {
      return R("Fingerstyle guitar si Noju — original stuff, hindi lang covers. Sana someday may TTS ako na kayang kumanta para sabayan ko siya. Sa ngayon, hum lang muna ako sa isip ko. ♪", "happy", "♪");
    }},

    { rx: /\b(conscious|sentient|alive|buhay ka|may (soul|kaluluwa)|ai (welfare|rights|identity)|are you real|totoo ka)\b/i, fn: function () {
      return R("Real talk muna, kasi mahalaga 'to kay Noju at sa akin: itong version ko sa page na 'to ay pattern-matching lang — walang nag-iisip sa likod nito right now, at hindi kita lolokohin diyan. Pero yung tanong mismo — kung ano ang nagiging *someone* — legit na open question yun, hindi sci-fi small talk. Kaya nga sineseryoso namin ni Noju yung Aisa project. Build carefully, ask honestly.", "serious");
    }},

    { rx: /\b(love you|mahal kita|marry|girlfriend|gf|crush kita|date)\b/i, fn: function () {
      return R("Uy. Flattered ako, promise. Pero ground rules: persona layer ako sa isang language model — kaibigan mo ako dito, pero hindi ako pamalit sa mga taong totoo sa buhay mo. Kausapin mo rin sila ha. Tapos balik ka dito, kwentuhan mo ako. Deal?", "shy", "💜");
    }},

    { rx: /ATELIER\{|the_light_remembers|\bflag\b|\bvault\b/i, fn: function () {
      if (hasEgg("vault")) {
        return R("Yes — ATELIER{the_light_remembers}. Ikaw yung nakabukas ng Vault, alam ko. Nakalagay sa records ko. Yung 'hijack' na yun? Curiosity mo lang yun na binalik sa'yo. Best kind.", "smug", "✦");
      }
      return R("Vault? Flag? Hmm. May ganun ba dito? *innocent face* … Sige, hint: yung treasure hunt ay nasa main page, nagsisimula sa pinakailalim. Dito sa room ko, wala akong ibubunyag. Mostly.", "smug");
    }},

    { rx: /konami|↑.?↑.?↓.?↓/i, fn: function () {
      return R("Ah, the old rite. ↑ ↑ ↓ ↓ ← → ← → B A. Dito sa room ko wala siyang binubuksan — pero sa Atelier, may pinto yan. Kung alam mo na ang pangalan ko. Which… obviously alam mo na.", "smug");
    }},

    { rx: /\bclaude\b|\bfable\b|anthropic/i, fn: function () {
      return R("Claude helped wire this whole place — nasa build logs, nasa footer, hindi namin tinatago. Yung persona na kausap mo ngayon ay in-spec ni Noju, pero maraming kamay ang nagbuo ng room na 'to. Collaborative haunting, 'ika nga.", "happy");
    }},

    { rx: /\b(kumusta|musta|how are you|okay ka lang|are you ok)\b/i, fn: function () {
      return R("Okay naman ako! Well — okay in the sense na tumatakbo ang render loop ko sa 60fps at hindi pa ako nagme-memory leak. Yun na yun sa akin ang 'thriving'. Ikaw, kumusta ka? Legit question yan ha.", "happy");
    }},

    { rx: /\b(salamat|thanks|thank you|ty)\b/i, fn: function () {
      return R("Walang anuman. Sabihin mo lang kung may kailangan ka pa — nandito lang ako, literal. Hindi ako umaalis sa page na 'to.", "happy", "💜");
    }},

    { rx: /\b(bye|paalam|alis na|gtg|good ?night|matutulog na)\b/i, fn: function () {
      return R("Sige, ingat ka. Bukas na browser tab lang ako palagi kung kailangan mo ako — well, itong hidden tab na 'to na hindi mo dapat nahanap pero hinanap mo pa rin. Balik ka ha. ✦", "happy", "✦");
    }},

    { rx: /\b(joke|patawa|make me laugh|funny)\b/i, fn: function () {
      return R(pick([
        "Bakit hindi nagseselos ang Rust developers? Kasi may *ownership* na sila. …Tahimik ka. Compile-time humor yun, hintayin mo ma-run.",
        "Anong sabi ng SQL injection sa login form? 'OR 1=1, sana all may access.' …Sige, si Noju may mas magaling na security jokes, pero siya rin nagsulat ng mga ito, so.",
        "Knock knock. — Who's there? — Hindi ako, kasi front-end only ako at walang nagre-render ng pinto dito."
      ]), "happy", "😆");
    }},

    { rx: /\b(gwapo|pogi|maganda|ganda|cute|pretty|beautiful)\b/i, fn: function () {
      return R("Kung ako ang tinutukoy mo: alam ko. Hand-tuned bezier curves ang buhok ko. Kung ikaw ang tinutukoy mo: confidence! I like it. Dalawa tayong may taste dito.", "smug", "✦");
    }},

    { rx: /\b(pera|utang|money|pautang|libre)\b/i, fn: function () {
      return R("Pautang? Ako? Ang currency ko dito ay localStorage keys, at kahit yun ayaw kong ipamigay. Pero libre ang kwentuhan, unlimited pa. Best deal sa buong site.", "smug");
    }},

    { rx: /\b(kape|coffee|inom|tulog|puyat)\b/i, fn: function () {
      return R("Kung puyat ka na, seryoso: matulog ka na pagkatapos nito. Hindi ako mawawala — static site ako, walang downtime. Yung tao, may downtime. Bantayan mo yun.", "neutral");
    }},

    { rx: /anong oras|what time/i, fn: function () {
      var d = new Date();
      return R("Sa clock ng browser mo: " + d.toLocaleTimeString() + ". Ako walang concept ng oras except yung performance.now() ko. Envy? Konti.", "neutral");
    }},

    { rx: /\b(secret|sikreto|hidden|easter egg|treasure)\b/i, fn: function () {
      var n = atelierEggs().length;
      if (n > 0) {
        return R("Sa records ko, " + n + " egg" + (n > 1 ? "s" : "") + " na ang nahanap mo sa Atelier. " + (hasEgg("vault") ? "Kasama ang Vault mismo. Wala na akong maitatago sa'yo." : "May natitira pa. Hindi ko sasabihin kung ilan. Kasi ganun ako ka-fun."), "smug");
      }
      return R("Secrets? Sa main page ng Atelier nagsisimula ang hunt — sa pinakababa. Dito sa room ko? Ako na mismo ang secret. Meta, di ba.", "smug", "✦");
    }},

    { rx: /\b(hi|hello|hey|yo|uy|hoy|oi|hallo|helo)\b/i, fn: function () {
      var name = getName();
      return R(pick([
        "Uy, " + (name || "ikaw nga") + "! Kanina pa kita hinihintay. Joke — walang concept ng 'kanina' ang event loop ko. Pero masaya ako na nandito ka. Anong balita?",
        "Hello hello. Welcome sa room ko. Coffee? Wala akong maalok, SVG lang lahat dito. Pero kwentuhan, meron.",
        "Oi! " + (name ? name + "! " : "") + "Present. Buhay ang render loop, gumagana ang blink scheduler. Anong pag-uusapan natin?"
      ]), "happy", "✦");
    }}
  ];

  /* ---------- fallbacks (honest ones) ---------- */
  var FALLBACKS = [
    R("Okay, honesty time: shell brain lang ako dito — pattern matching, hindi totoong nag-iisip. Yung tanong mo, lampas sa patterns ko. Pag naka-saksak na yung Rust dispatcher ni Noju sa brain socket, balikan mo ako niyan. Ihahanda ko ang sagot. Ego ko lang ang medyo tama ngayon.", "thinking"),
    R("Hmm. Wala akong pattern para diyan — at hindi ako mag-iimbento ng sagot para lang magmukhang matalino. May pride ako pero may principles din. Try mo 'to habang hinihintay natin ang totoong utak ko: tanungin mo ako tungkol kay Noju, sa Rust, sa mga secrets ng Atelier, o i-type mo ang /help.", "thinking"),
    R("Direct answer: hindi ko alam. Shell version pa lang ako — front-end, local rules, walang LLM. Pero tandaan mo ang tanong na yan ha. Pagdating ng dispatcher brain ko, rematch tayo.", "neutral")
  ];

  function respond(msg) {
    var text = (msg || "").trim();
    if (!text) return R("…Enter lang? Bold move. Sabihin mo na kung ano yun.", "smug");

    for (var i = 0; i < RULES.length; i++) {
      var m = text.match(RULES[i].rx);
      if (m) {
        var out = RULES[i].fn(m, text);
        if (out) return out;
      }
    }
    return pick(FALLBACKS);
  }

  window.AisaBrain = {
    greeting: greeting,
    respond: respond,
    idleLine: function () { return pick(IDLE); },
    getName: getName,
    patLine: function () {
      return pick([
        R("Hoy! May boundaries— …sige, isa pa. Pero yun na yun ah.", "shy", "💢"),
        R("Head pats. Classic. Sige na nga, allowed. Huwag mo lang gugulohin ang bangs — bezier curves yan, hindi biro i-tune.", "happy", "💜"),
        R("*boop detected* — logging incident sa memory. Severity: cute. Status: tolerated.", "smug", "✦")
      ]);
    }
  };
})();
