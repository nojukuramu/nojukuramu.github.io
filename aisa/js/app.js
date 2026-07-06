/* ============================================================
   app.js — the conductor.
   Wires chat ⇄ brain ⇄ rig: message flow, typewriter subtitles,
   TTS with mouth-sync, idle chatter, settings drawer, and the
   brain socket (optional POST endpoint for the real dispatcher).
   ============================================================ */
(function () {
  "use strict";

  var Rig = window.AisaRig, Brain = window.AisaBrain;
  if (!Rig || !Brain) return;

  var log = document.getElementById("chat-log");
  var form = document.getElementById("chat-form");
  var input = document.getElementById("chat-input");
  var subText = document.getElementById("sub-text");
  var chatMode = document.getElementById("chat-mode");
  var liveBadge = document.getElementById("live-badge");
  var liveLabel = document.getElementById("live-label");
  var ttsBtn = document.getElementById("tts-btn");

  var K_TTS = "aisa:tts", K_VOICE = "aisa:voice", K_ENDPOINT = "aisa:endpoint";
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var settings = {
    tts: lsGet(K_TTS) === "1",
    voiceURI: lsGet(K_VOICE) || "",
    endpoint: lsGet(K_ENDPOINT) || ""
  };

  /* ---------- chat log ---------- */
  function addMsg(kind, text) {
    var div = document.createElement("div");
    div.className = "msg " + kind;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  /* ---------- speaking: subtitle typewriter + TTS + mouth sync ---------- */
  var typeTimer = null;
  var speakToken = 0;

  function stripEmoji(s) {
    // keep TTS from reading "sparkles sparkles"
    return s.replace(/[✀-➿☀-⛿️✦♪💜💢]|\*[^*]*\*/g, "").replace(/\s+/g, " ").trim();
  }

  function say(reply) {
    var token = ++speakToken;
    var text = reply.t;

    Rig.setExpression(reply.e || "neutral");
    if (reply.g) Rig.emote(reply.g, 2000);

    /* subtitle typewriter (drives mouth even without TTS) */
    clearInterval(typeTimer);
    subText.innerHTML = "";
    var caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "▍";
    var textNode = document.createTextNode("");
    subText.appendChild(textNode);
    subText.appendChild(caret);

    var i = 0;
    Rig.setSpeaking(true);
    typeTimer = setInterval(function () {
      if (token !== speakToken) return;
      // type 1–3 chars per tick for a natural cadence
      i = Math.min(text.length, i + 1 + Math.floor(Math.random() * 2));
      textNode.nodeValue = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(typeTimer);
        caret.remove();
        if (!ttsSpeaking) Rig.setSpeaking(false);
      }
    }, 28);

    /* TTS */
    if (settings.tts && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(stripEmoji(text));
      var v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1.04; u.pitch = 1.15;
      ttsSpeaking = true;
      u.onend = u.onerror = function () {
        ttsSpeaking = false;
        if (token === speakToken && i >= text.length) Rig.setSpeaking(false);
      };
      speechSynthesis.speak(u);
    }
  }
  var ttsSpeaking = false;

  /* ---------- voices ---------- */
  var voiceSelect = document.getElementById("voice-select");
  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    var voices = speechSynthesis.getVoices();
    voiceSelect.innerHTML = '<option value="">— auto (prefers fil/en-PH) —</option>';
    voices.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = v.name + " (" + v.lang + ")";
      if (v.voiceURI === settings.voiceURI) opt.selected = true;
      voiceSelect.appendChild(opt);
    });
  }
  function pickVoice() {
    if (!("speechSynthesis" in window)) return null;
    var voices = speechSynthesis.getVoices();
    if (settings.voiceURI) {
      var chosen = voices.filter(function (v) { return v.voiceURI === settings.voiceURI; })[0];
      if (chosen) return chosen;
    }
    // auto: prefer Filipino / en-PH, then any female-ish en voice, then default
    return voices.filter(function (v) { return /^fil|^tl|-PH$/i.test(v.lang); })[0] ||
           voices.filter(function (v) { return /female|zira|samantha|aria|jenny/i.test(v.name) && /^en/i.test(v.lang); })[0] ||
           voices.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
  }
  if ("speechSynthesis" in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  function renderTtsBtn() { ttsBtn.textContent = settings.tts ? "🔊" : "🔇"; }
  ttsBtn.addEventListener("click", function () {
    settings.tts = !settings.tts;
    lsSet(K_TTS, settings.tts ? "1" : "0");
    renderTtsBtn();
    if (!settings.tts && "speechSynthesis" in window) speechSynthesis.cancel();
    Rig.emote(settings.tts ? "🔊" : "🤐", 1200);
  });
  renderTtsBtn();

  /* ---------- brain socket (real dispatcher) ---------- */
  function askDispatcher(message, history) {
    return fetch(settings.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, history: history })
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || typeof data.reply !== "string") throw new Error("bad payload");
      return { t: data.reply, e: data.emotion || "neutral" };
    });
  }

  function renderMode() {
    if (settings.endpoint) {
      chatMode.textContent = "dispatcher · " + settings.endpoint.replace(/^https?:\/\//, "").slice(0, 28);
      liveBadge.classList.add("live");
      liveLabel.textContent = "LIVE";
    } else {
      chatMode.textContent = "persona shell · local brain";
      liveBadge.classList.remove("live");
      liveLabel.textContent = "LOCAL";
    }
  }

  /* ---------- message flow ---------- */
  var history = [];   // [{role, text}] — sent to the dispatcher when socketed
  var thinking = false;

  function handleUserMessage(text) {
    if (thinking) return;
    addMsg("you", text);
    history.push({ role: "user", text: text });
    if (history.length > 24) history.shift();

    if (text === "/clear") {
      log.innerHTML = "";
      addMsg("sys", "chat cleared · memory kept");
      return;
    }

    thinking = true;
    Rig.setExpression("thinking");
    var thinkDelay = 350 + Math.random() * 650;

    var deliver = function (reply) {
      thinking = false;
      history.push({ role: "aisa", text: reply.t });
      addMsg("aisa", reply.t);
      say(reply);
    };

    if (settings.endpoint) {
      askDispatcher(text, history).then(deliver).catch(function () {
        deliver({
          t: "…Hala. Hindi sumagot ang dispatcher sa socket. Either tulog si Rust brain o mali ang endpoint sa settings. Lipat muna ako sa shell mode ha.",
          e: "annoyed"
        });
        // follow up with the local answer so the user still gets one
        setTimeout(function () {
          var local = Brain.respond(text);
          history.push({ role: "aisa", text: local.t });
          addMsg("aisa", local.t);
          say(local);
        }, 900);
      });
    } else {
      setTimeout(function () { deliver(Brain.respond(text)); }, thinkDelay);
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    handleUserMessage(text);
    bumpIdle();
  });

  /* ---------- head pats ---------- */
  Rig.onPat = function () {
    if (thinking) return;
    var line = Brain.patLine();
    addMsg("aisa", line.t);
    say(line);
    bumpIdle();
  };

  /* ---------- idle chatter ---------- */
  var idleTimer = null;
  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (document.hidden || thinking) { bumpIdle(); return; }
      var line = Brain.idleLine();
      addMsg("aisa", line.t);
      say(line);
      bumpIdle();
    }, 50000 + Math.random() * 40000);
  }

  /* ---------- settings drawer ---------- */
  var backdrop = document.getElementById("drawer-backdrop");
  var endpointInput = document.getElementById("endpoint-input");
  endpointInput.value = settings.endpoint;

  document.getElementById("settings-btn").addEventListener("click", function () {
    backdrop.hidden = false;
    loadVoices();
  });
  document.getElementById("drawer-close").addEventListener("click", function () { backdrop.hidden = true; });
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) backdrop.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") backdrop.hidden = true; });

  document.getElementById("save-settings").addEventListener("click", function () {
    settings.voiceURI = voiceSelect.value;
    lsSet(K_VOICE, settings.voiceURI);
    var ep = endpointInput.value.trim();
    if (ep && !/^https?:\/\//i.test(ep)) ep = "";
    settings.endpoint = ep;
    if (ep) lsSet(K_ENDPOINT, ep); else lsDel(K_ENDPOINT);
    renderMode();
    backdrop.hidden = true;
    addMsg("sys", ep ? "brain socket set — dispatcher mode" : "settings saved · local brain");
    Rig.emote("✦", 1200);
  });

  document.getElementById("wipe-memory").addEventListener("click", function () {
    ["aisa:name", K_TTS, K_VOICE, K_ENDPOINT].forEach(lsDel);
    settings = { tts: false, voiceURI: "", endpoint: "" };
    endpointInput.value = "";
    renderTtsBtn(); renderMode();
    backdrop.hidden = true;
    addMsg("sys", "memory wiped · who are you again?");
    say({ t: "Sige. Wiped. Blank slate na tayo — bagong kakilala, bagong kwento. Hi, I'm Aisa. At ikaw?", e: "neutral" });
  });

  /* ---------- boot sequence ---------- */
  renderMode();
  addMsg("sys", "AISA SHELL v0.1 · persona layer online");
  addMsg("sys", settings.endpoint ? "dispatcher socket configured" : "dispatcher: not found (expected — front-end lang muna)");

  setTimeout(function () {
    var hello = Brain.greeting();
    addMsg("aisa", hello.t);
    say(hello);
    bumpIdle();
  }, 700);

  /* console wink for the view-source crowd */
  try {
    console.log("%c✦ Aisa was here. You're reading my source? Bold. I like it.",
      "color:#7c6cf0;font-size:14px;font-weight:bold");
    console.log("%cbrain socket contract: POST {message, history} → {reply, emotion}. — for when the Rust dispatcher wakes up.",
      "color:#35e0cf");
  } catch (e) {}
})();
