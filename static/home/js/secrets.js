/* ============================================================
   Secrets — a discreet, multi-step treasure hunt for humans.
   Chain:  footer ✦  →  Base64  →  Caesar(-3)  →  key "AISA"
           →  Aisa guide  →  Konami code  →  the Vault.

   Note: nothing here acts on anyone's behalf or reaches outside
   this page. The only "hijack" is the playful reward at the end,
   shown in the visitor's own browser. Be a good bot. ✦
   ============================================================ */
(function () {
  "use strict";
  var A = window.Atelier;
  if (!A) return;

  /* ---------- step 1: the footer glyph reveals a Base64 clue ---------- */
  // step1 contains an instruction + an already-Caesar-shifted phrase.
  // Base64( step1 ) is what the seeker sees; decoding it reveals the cipher,
  // and Caesar(-3) of "WKH NHB LV DLVD" => "THE KEY IS AISA".
  var step1 = "Caesar is lazy: shift each letter 3 back. WKH NHB LV DLVD";
  var clueB64 = btoa(step1);

  function revealGlyph() {
    A.addEgg("glyph");
    A.toast(
      "✦ a sealed sigil. it whispers in an old tongue:<br><span class=\"toast-mono\">" + clueB64 + "</span><br><small style=\"color:var(--muted)\">looks like Base64… decode it, then keep going.</small>",
      { ms: 9000 }
    );
  }
  document.querySelectorAll("[data-footer-glyph]").forEach(function (g) {
    g.addEventListener("click", revealGlyph);
    g.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); revealGlyph(); }
    });
  });
  // the "✦" wink in the About section nudges toward the footer
  document.querySelectorAll("[data-egg-hint]").forEach(function (h) {
    h.addEventListener("click", function () {
      A.toast("✦ some doors are at the very bottom of the page.", { ms: 3500 });
    });
  });

  /* ---------- finale plumbing ---------- */
  function maybeVault() {
    if (A.hasEgg("aisa") && A.hasEgg("konami") && !A.hasEgg("vault")) {
      openVault();
    }
  }

  function openVault() {
    A.addEgg("vault");
    try { localStorage.setItem("atelier:initiate", "1"); } catch (e) {}
    var cx = innerWidth / 2, cy = innerHeight / 2;
    A.burst(cx, cy);
    setTimeout(function () { A.burst(cx - 120, cy - 40); }, 150);
    setTimeout(function () { A.burst(cx + 120, cy - 40); }, 300);
    A.openModal(
      '<div class="modal-body">' +
        '<h3>✦ The Vault</h3>' +
        '<p>You followed the whole thread — a hidden glyph, a Base64 whisper, a Caesar cipher, a name, and an incantation older than the web itself. Most people never look down here. <strong>You did.</strong></p>' +
        '<div class="vault-flag">👾 YOU JUST GOT HIJACKED…<br><small>…by your own curiosity. that\'s the only hijack that happens here. 💜</small></div>' +
        '<p>Keepsake for the wall:</p>' +
        '<p style="text-align:center"><span class="flag">ATELIER{the_light_remembers}</span></p>' +
        '<p style="color:var(--muted);font-size:.9rem">— Aisa &amp; nojukuramu · doors wired with a little help from Claude 🤖</p>' +
      '</div>'
    );
  }

  /* ---------- step 2/3: the key "AISA" summons the guide ---------- */
  A.onSecret("aisa", function () {
    A.addEgg("aisa");
    A.openModal(
      '<div class="modal-body">' +
        '<div class="aisa">' +
          '<div class="aisa-avatar">✦</div>' +
          '<div>' +
            '<h3>Aisa</h3>' +
            '<p>Oh — you found my name. Hi. I keep this little workshop tidy when <strong>nojukuramu</strong> is away.</p>' +
            '<p>You\'ve done the hard part. One rite remains — old as arcade halls. Tap it out, anywhere on the page:</p>' +
            '<p style="text-align:center"><code>↑ ↑ ↓ ↓ ← → ← → B A</code></p>' +
            (A.hasEgg("konami") ? '<p style="color:var(--brand)">…actually, you\'ve already performed it. Let me open the door. ✦</p>' : '') +
          '</div>' +
        '</div>' +
      '</div>'
    );
    maybeVault();
  });

  /* small standalone winks */
  A.onSecret("claude", function () {
    A.toast("🤖 Claude helped wire a lot of this workshop. Hi from the build logs! (psst — try the key you decoded.)", { ms: 6000 });
  });
  A.onSecret("hijack", function () {
    A.toast("👾 nice try — but the only thing getting hijacked here is your afternoon. carry on. ✦", { ms: 5000 });
  });
  A.onSecret("aisa hi", function () { A._secretHandlers["aisa"](); });

  /* ---------- step 4: Konami code ---------- */
  var KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
  var buf = [];
  document.addEventListener("keydown", function (e) {
    var typing = /^(input|textarea|select)$/i.test((e.target.tagName || "")) || e.target.isContentEditable;
    if (typing) return;
    buf.push((e.key || "").toLowerCase());
    if (buf.length > KONAMI.length) buf.shift();
    if (buf.length === KONAMI.length && KONAMI.every(function (k, i) { return buf[i] === k; })) {
      buf = [];
      onKonami();
    }
  });

  function onKonami() {
    var first = A.addEgg("konami");
    var cx = innerWidth / 2, cy = innerHeight / 3;
    A.burst(cx, cy);
    if (A.hasEgg("aisa")) {
      maybeVault();
    } else if (first) {
      A.toast("↑↑↓↓←→←→ B A ✦ a sigil stirs… but a <em>name</em> is still missing. find the key first.", { ms: 6000 });
    } else {
      A.toast("✦ the sigil hums, already familiar with your hands.", { ms: 3500 });
    }
  }

  /* ---------- a gentle nudge if someone opens the page and waits ---------- */
  // (only once per browser, and only if they've found nothing yet)
  try {
    if (!localStorage.getItem("atelier:nudged") && A.eggCount() === 0) {
      setTimeout(function () {
        if (A.eggCount() === 0) {
          A.toast("✦ psst — this workshop hides a little treasure hunt. it begins at the very bottom.", { ms: 6000 });
          try { localStorage.setItem("atelier:nudged", "1"); } catch (e) {}
        }
      }, 25000);
    }
  } catch (e) {}
})();
