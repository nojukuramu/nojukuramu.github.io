/* screens.js — the drawing half.
 *
 * app.js is the wiring: transport, state, who may ask for what. This is what
 * any of it looks like. Every function takes the *view* — the redacted,
 * per-player snapshot — and there is no path from here to the authoritative
 * state, so a screen cannot leak what it was never handed.
 *
 * Each screen returns `{ body, dock }`: the thing you look at, and the thing
 * you press. `body` must fit the stage it is given at any size, on any screen,
 * without the page scrolling. Where a list genuinely can be arbitrarily long —
 * a chat, a log, the roster — it gets `.pane.scroll` and scrolls inside itself.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  var H = global.WG_HELPERS;
  var el = H.el, toast = H.toast, dispatch = H.dispatch, icon = H.icon;
  var CMD = WG.protocol.CMD;

  function face(p, size, cls) {
    var n = el("span", { class: cls || "vote-face", style: size ? "width:" + size + "px;height:" + size + "px;flex:0 0 " + size + "px" : null });
    if (p && p.avatar) n.appendChild(el("img", { src: p.avatar, alt: "" }));
    else n.appendChild(icon(p && p.role ? p.role.icon : (p && !p.alive ? "skull" : "person"), Math.round((size || 30) * 0.6)));
    return n;
  }
  function teamClass(p) { return p && p.role ? "team-" + p.role.team : ""; }
  function playerOf(v, id) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === id) return v.players[i];
    return null;
  }

  /* ================= lobby ================= */

  function lobby(v) {
    var manage = H.canManage(v);
    var body = el("div", { class: "pane grow scroll" });

    body.appendChild(el("div", { class: "card" }, [
      el("div", { class: "roomcode", text: v.code }),
      el("div", { class: "spread", style: "margin-top:6px" }, [
        el("button", { class: "btn small grow", onclick: function () { shareRoom(v.code); } }, [icon("link", 15), "Share"]),
        el("button", { class: "btn small grow", onclick: function () { copy(v.code); } }, [icon("copy", 15), "Copy code"])
      ])
    ]));

    if (manage && v.pending && v.pending.length) body.appendChild(doorQueue(v));
    body.appendChild(playerList(v, manage));
    if (manage) body.appendChild(rosterBuilder(v));
    body.appendChild(settingsPanel(v, manage));

    var dock;
    if (manage) {
      var seats = v.players.filter(function (p) { return !p.spectator; }).length;
      var dealt = Object.keys(v.roster).reduce(function (n, k) { return n + v.roster[k]; }, 0);
      var problem = seats < 4 ? "Four players minimum."
        : dealt > seats ? "More roles than players." : null;
      dock = el("button", {
        class: "btn primary big wide", disabled: !!problem,
        onclick: function () { dispatch({ type: CMD.START }); }
      }, [icon("moon", 18), problem || "Start the night"]);
    } else {
      dock = el("div", { class: "turn-state" }, [icon("hourglass", 17), "Waiting for the host."]);
    }
    return { body: body, dock: dock };
  }

  function playerList(v, manage) {
    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [
      icon("users", 17), el("h3", { text: "In the village" }),
      el("span", { class: "pill", text: String(v.players.filter(function (p) { return !p.spectator; }).length) })
    ]));
    v.players.forEach(function (p) {
      var actions = [];
      if (manage && !p.isHost) {
        actions.push(el("button", {
          class: "btn small" + (p.cohost ? " on" : ""), title: "Co-host",
          onclick: function () { dispatch({ type: CMD.ROLE_GRANT, id: p.id, cohost: !p.cohost }); }
        }, [icon("star", 14)]));
        actions.push(el("button", {
          class: "btn small danger", title: "Remove",
          onclick: function () { if (confirm("Remove " + p.name + "?")) dispatch({ type: CMD.KICK, id: p.id }); }
        }, [icon("close", 14)]));
      }
      card.appendChild(el("div", { class: "row" }, [
        face(p, 30),
        el("div", { class: "grow" }, [
          el("div", { class: "row-title", text: p.name + (p.isMe ? " (you)" : "") }),
          el("div", { class: "row-sub", text: p.isHost ? "Host" : p.cohost ? "Co-host" : p.spectator ? "Watching" : "Player" })
        ]),
        p.connected ? null : el("span", { class: "pill warn", text: "away" })
      ].concat(actions)));
    });
    return card;
  }

  function doorQueue(v) {
    var card = el("div", { class: "card flush", style: "border-color:var(--accent-line)" });
    card.appendChild(el("div", { class: "card-head" }, [icon("door", 17), el("h3", { text: "At the door" })]));
    v.pending.forEach(function (g) {
      card.appendChild(el("div", { class: "row" }, [
        el("div", { class: "grow" }, [el("div", { class: "row-title", text: g.name })]),
        el("button", { class: "btn small primary", onclick: function () { dispatch({ type: CMD.APPROVE, id: g.id, ok: true }); } }, [icon("check", 14), "In"]),
        el("button", { class: "btn small", onclick: function () { dispatch({ type: CMD.APPROVE, id: g.id, ok: false }); } }, [icon("close", 14)])
      ]));
    });
    return card;
  }

  function rosterBuilder(v) {
    var card = el("div", { class: "card flush" });
    var seats = v.players.filter(function (p) { return !p.spectator; }).length;
    var dealt = Object.keys(v.roster).reduce(function (n, k) { return n + v.roster[k]; }, 0);

    card.appendChild(el("div", { class: "card-head" }, [
      icon("mask", 17), el("h3", { text: "The bag" }),
      el("span", { class: "pill" + (dealt === seats ? " ok" : dealt > seats ? " bad" : ""), text: dealt + "/" + seats })
    ]));

    var box = el("div", { style: "padding:10px 13px 13px" });
    var byTeam = { village: 0, werewolf: 0, cult: 0, solo: 0 };
    Object.keys(v.roster).forEach(function (rid) {
      var r = WG.roles.get(rid); if (r) byTeam[r.team] += v.roster[rid];
    });
    var bar = el("div", { class: "bar" });
    ["werewolf", "cult", "solo", "village"].forEach(function (t) {
      if (byTeam[t]) bar.appendChild(el("i", { class: "team-" + t, style: "flex:" + byTeam[t] + ";background:var(--team)" }));
    });
    box.appendChild(el("div", { class: "tally" }, [
      bar,
      el("span", { class: "dim", text: byTeam.werewolf + "W · " + byTeam.village + "V" +
        (byTeam.cult ? " · " + byTeam.cult + "C" : "") + (byTeam.solo ? " · " + byTeam.solo + "S" : "") })
    ]));

    box.appendChild(el("div", { class: "spread", style: "margin-bottom:8px" }, [
      el("button", { class: "btn small grow", onclick: function () { setRoster(H.suggestRoster(seats)); } }, ["Suggest"]),
      el("button", { class: "btn small grow", onclick: function () { setRoster(chaos(seats)); } }, ["Chaos"]),
      el("button", { class: "btn small grow", onclick: function () { setRoster({}); } }, ["Clear"])
    ]));

    ["werewolf", "village", "cult", "solo"].forEach(function (team) {
      box.appendChild(el("div", { class: "spread", style: "margin:11px 0 5px" }, [
        el("span", { class: "team-dot team-" + team }),
        el("h3", { style: "margin:0;font-size:.86rem", text: WG.roles.teams[team].name })
      ]));
      var grid = el("div", { class: "roster" });
      WG.roles.all().filter(function (r) { return r.team === team; }).forEach(function (r) {
        var n = v.roster[r.id] || 0;
        grid.appendChild(el("div", { class: "roster-item team-" + team + (n ? " in" : "") }, [
          el("button", {
            style: "background:none;border:none;cursor:pointer;color:inherit;padding:0;display:flex",
            title: r.name, onclick: function () { H.showRoleCard(r.id); }
          }, [icon(r.icon, 19)]),
          el("span", { class: "grow" }, [
            el("div", { class: "rn", text: r.name }),
            el("div", { class: "rd", text: r.tagline })
          ]),
          el("span", { class: "stepper" }, [
            el("button", { onclick: function () { bump(r.id, -1); }, "aria-label": "Fewer" }, [icon("minus", 13)]),
            el("span", { class: "n", text: String(n) }),
            el("button", { onclick: function () { bump(r.id, 1); }, "aria-label": "More" }, [icon("plus", 13)])
          ])
        ]));
      });
      box.appendChild(grid);
    });

    card.appendChild(box);
    return card;

    function bump(rid, d) {
      var next = Object.assign({}, v.roster);
      next[rid] = Math.max(0, (next[rid] || 0) + d);
      if (!next[rid]) delete next[rid];
      setRoster(next);
    }
    function setRoster(r) { dispatch({ type: CMD.ROLESET, roles: r }); }
  }

  function chaos(n) {
    var all = WG.roles.all(), roster = {};
    var wolves = Math.max(1, Math.round(n / 4.5));
    var pool = all.filter(function (r) { return r.team === "werewolf"; });
    for (var i = 0; i < wolves; i++) {
      var w = pool[Math.floor(Math.random() * pool.length)];
      roster[w.id] = (roster[w.id] || 0) + 1;
    }
    var rest = all.filter(function (r) { return r.team !== "werewolf"; });
    for (var j = wolves; j < n; j++) {
      var r2 = rest[Math.floor(Math.random() * rest.length)];
      roster[r2.id] = (roster[r2.id] || 0) + 1;
    }
    return roster;
  }

  /* Settings grouped by the question a host is actually asking. */
  var GROUPS = { flow: ["Clock", "clock"], rules: ["Rules", "scales"], room: ["Room", "door"],
                 events: ["Events", "star"], look: ["Look", "contrast"] };
  var COPY = {
    "flow.endNightEarly": ["End night early", "Close it once every turn is spent."],
    "flow.endVotingEarly": ["End vote early", "Close it once everyone has voted."],
    "rules.trustNoone": ["Don't believe anyone", "Dawn names nobody. Only reported bodies are ever announced."],
    "rules.revealRolesOnDeath": ["Reveal roles on death", "The village learns what they were."],
    "rules.firstNightImmunity": ["First night is safe", "Nobody dies on night one."],
    "rules.showVoteCounts": ["Show the tally", "Everyone sees the counts."],
    "rules.showPersonalVotes": ["Show votes on you", "You see who voted for you."],
    "rules.allowSkipVote": ["Allow skipping", "The village can hang nobody."],
    "rules.allowSelfVote": ["Allow self-votes", "Mostly for the Jester."],
    "rules.villagerPromotion": ["Villagers can be promoted", "Night work earns a real role."],
    "rules.animalSpeech": ["Animals cannot talk", "Cats and dogs send only noises."],
    "room.joinApproval": ["Approve at the door", "A six-character code is guessable."],
    "room.chat": ["Chat", "Discussion happens in the app."],
    "room.deadChat": ["The dead get a channel", "The living cannot read it."],
    "room.allowSpectators": ["Latecomers can watch", "They join as spectators."],
    "events.enabled": ["Events", "A festival, a plague, a blood moon."],
    "look.timeOfDayTheme": ["Colour follows the clock", "Night to dawn to noon to dusk."],
    "look.reduceMotion": ["Reduce motion", "Nothing drifts or pulses."],
    "look.sound": ["Sound", "The clock, the alarm, the verdict."]
  };

  function settingsPanel(v, manage) {
    var card = el("div", { class: "card" });
    var cur = global.WG_APP.settingsTab || "flow";
    var tabs = el("div", { class: "tabs" });
    Object.keys(GROUPS).forEach(function (g) {
      tabs.appendChild(el("button", {
        class: cur === g ? "on" : "", onclick: function () { global.WG_APP.settingsTab = g; WG.app.render(); }
      }, [icon(GROUPS[g][1], 14), GROUPS[g][0]]));
    });
    card.appendChild(tabs);

    var body = el("div"), cfg = v.config;
    if (cur === "flow") {
      var presets = (WG.clock.flow.roomConfig || {}).presets || {};
      body.appendChild(el("div", { class: "spread", style: "margin:8px 0" },
        Object.keys(presets).map(function (name) {
          return el("button", {
            class: "btn small grow" + (cfg.flow.preset === name ? " on" : ""), disabled: !manage,
            onclick: function () { patch("flow", { preset: name, durations: presets[name] }); }
          }, [name]);
        })));
      Object.keys(cfg.flow.durations).forEach(function (id) {
        var ph = WG.clock.phase(id) || { name: id, icon: "star" };
        body.appendChild(el("div", { class: "row", style: "padding-left:0;padding-right:0" }, [
          icon(ph.icon, 16),
          el("div", { class: "grow" }, [el("div", { class: "row-title", text: ph.name })]),
          el("input", {
            type: "number", min: "5", max: "1200", value: String(cfg.flow.durations[id]),
            style: "width:78px;min-height:36px", disabled: !manage,
            onchange: function (e) {
              var d = Object.assign({}, cfg.flow.durations);
              d[id] = Math.max(5, Math.min(1200, Number(e.target.value) || d[id]));
              patch("flow", { durations: d, preset: "custom" });
            }
          })
        ]));
      });
      body.appendChild(toggle("flow.endNightEarly", cfg, manage, patch));
      body.appendChild(toggle("flow.endVotingEarly", cfg, manage, patch));
    } else if (cur === "events") {
      body.appendChild(toggle("events.enabled", cfg, manage, patch));
      (WG.events.data.events || []).forEach(function (ev) {
        var on = cfg.events.allowed.indexOf(ev.id) >= 0;
        body.appendChild(el("label", { class: "toggle" }, [
          el("input", {
            type: "checkbox", checked: on, disabled: !manage || !cfg.events.enabled,
            onchange: function () {
              var next = cfg.events.allowed.filter(function (x) { return x !== ev.id; });
              if (!on) next.push(ev.id);
              patch("events", { allowed: next });
            }
          }),
          el("span", { class: "track" }),
          el("span", { class: "label grow" }, [
            el("b", { text: ev.name }), el("span", { text: ev.shortDescription })
          ])
        ]));
      });
    } else {
      Object.keys(cfg[cur]).forEach(function (k) {
        if (typeof cfg[cur][k] === "boolean") body.appendChild(toggle(cur + "." + k, cfg, manage, patch));
      });
      if (cur === "room") {
        body.appendChild(el("label", { class: "field", style: "margin-top:8px" }, [
          el("span", { text: "Maximum players" }),
          el("input", {
            type: "number", min: "4", max: "40", value: String(cfg.room.maxPlayers), disabled: !manage,
            onchange: function (e) { patch("room", { maxPlayers: Math.max(4, Math.min(40, Number(e.target.value) || 24)) }); }
          })
        ]));
      }
    }
    card.appendChild(body);
    return card;

    function patch(group, changes) {
      var next = JSON.parse(JSON.stringify(v.config));
      Object.assign(next[group], changes);
      if (group === "look" && changes.reduceMotion != null) WG.theme.setMotion(!changes.reduceMotion);
      dispatch({ type: CMD.CONFIG, config: next });
    }
  }

  function toggle(path, cfg, enabled, patch) {
    var parts = path.split("."), group = parts[0], key = parts[1];
    var copy = COPY[path] || [key, ""];
    var on = !!cfg[group][key];
    return el("label", { class: "toggle" }, [
      el("input", { type: "checkbox", checked: on, disabled: !enabled,
        onchange: function () { var c = {}; c[key] = !on; patch(group, c); } }),
      el("span", { class: "track" }),
      el("span", { class: "label grow" }, [el("b", { text: copy[0] }), el("span", { text: copy[1] })])
    ]);
  }

  /* ================= role reveal ================= */

  function reveal(v) {
    var me = v.me;
    if (!me || !me.role) {
      return { body: el("div", { class: "pane grow center" }, [
        el("div", { class: "empty" }, [icon("eye", 40), "You are watching this one."])
      ]) };
    }
    var r = me.role;
    var body = el("div", { class: "pane grow scroll reveal" });
    body.appendChild(el("div", { class: "rolecard team-" + r.team }, [
      el("div", { class: "crest" }, [icon(r.icon, 46, { weight: 1.15 })]),
      el("div", { class: "name", text: r.name }),
      el("div", { class: "tagline", text: r.tagline }),
      el("p", { text: r.description }),
      r.lore ? el("div", { class: "lore", text: r.lore }) : null,
      el("dl", { style: "margin:0" }, [el("dt", { text: "You win by" }), el("dd", { text: r.winCondition })]),
      H.abilityList(r)
    ]));
    if (me.brief) body.appendChild(briefCard(me.brief));
    return {
      body: body,
      dock: el("button", {
        class: "btn primary big wide", disabled: me.ready,
        onclick: function () { dispatch({ type: CMD.READY }); }
      }, [me.ready ? "Waiting for the others" : "Ready"])
    };
  }

  function briefCard(b) {
    var card = el("div", { class: "card" });
    card.appendChild(el("h3", { text: b.title }));
    card.appendChild(el("ul", { class: "abilities" }, b.lines.map(function (l) {
      return el("li", {}, [icon("arrowRight", 15), el("span", { text: l })]);
    })));
    return card;
  }

  /* ================= night ================= */

  function night(v) {
    var me = v.me;
    if (!me || !me.role) return watching();
    if (me.quiz) return { body: quizScreen(me.quiz) };
    if (me.prompt) return { body: promptScreen(me.prompt) };

    var body = el("div", { class: "pane grow", style: "display:flex;flex-direction:column;gap:8px;min-height:0" });
    var swap = global.WG_APP.pendingSwap;
    if (swap) {
      body.appendChild(el("div", { class: "turn-state blocked" }, [
        icon("swap", 17), el("span", { class: "grow", text: "Pick the second house." }),
        el("button", { class: "btn small", onclick: function () { global.WG_APP.pendingSwap = null; WG.app.render(); } }, ["Cancel"])
      ]));
    }
    body.appendChild(el("div", { class: "village-wrap" }, [
      WG.village.render(v, {
        onPick: function (id) { knock(id); },
        subtitle: function (h, p) { return p.role ? p.role.name : null; }
      })
    ]));

    var side = el("div", { style: "display:flex;flex-direction:column;gap:6px" });
    if (me.brief) side.appendChild(briefCard(me.brief));
    if (v.night && v.night.packTally) side.appendChild(packPanel(v));
    var priv = privatePanel();
    if (priv) side.appendChild(priv);
    if (side.children.length) {
      var wide = global.matchMedia && global.matchMedia("(min-width: 900px)").matches;
      if (wide) {
        var split = el("div", { class: "split" });
        var vw = body.querySelector(".village-wrap");
        body.removeChild(vw);
        split.appendChild(vw);
        side.className = "pane scroll";
        split.appendChild(side);
        body.appendChild(split);
      }
    }

    return { body: body, dock: turnState(v) };
  }

  function turnState(v) {
    var t = v.me.turn;
    if (!t) return el("div", { class: "turn-state spent" }, [icon("eye", 16), "Watching tonight."]);
    if (t.blocked) return el("div", { class: "turn-state blocked" }, [icon("phone", 16), "On hold. Answer the call."]);
    if (t.spent) {
      return el("div", { class: "turn-state spent" }, [
        icon("check", 16), el("span", { class: "grow", text: "Night spent." }),
        el("span", { class: "dim", text: v.night.turnsSpent + "/" + v.night.turnsTotal })
      ]);
    }
    return el("div", { class: "turn-state" }, [
      icon("door", 16), el("span", { class: "grow", text: "Pick a house." }),
      el("span", { class: "dim", text: v.night.turnsSpent + "/" + v.night.turnsTotal })
    ]);
  }

  function knock(houseId) {
    var swap = global.WG_APP.pendingSwap;
    if (swap) {
      global.WG_APP.pendingSwap = null;
      dispatch({ type: CMD.ACT, houseId: houseId, actionId: swap.actionId, payload: {} });
      return;
    }
    dispatch({ type: CMD.KNOCK, houseId: houseId });
  }

  /* The sheet you get for knocking: who lives here, and what you can do about it. */
  function doorSheet(data) {
    var v = WG.app.currentView();
    var p = playerOf(v, data.houseId) || {};
    var box = el("div");

    box.appendChild(el("div", { class: "sheet-head" }, [
      face(p, 46, "sheet-avatar"),
      el("div", { class: "grow" }, [
        el("div", { class: "sheet-title", text: data.occupant }),
        el("div", { class: "row-sub", text: {
          own: "Your house.", living: "Asleep inside.",
          dead: "Empty for a while now.", "dead-tonight": "Door open. No answer.",
          quiet: "Quiet."
        }[data.state] || "" })
      ])
    ]));

    if (data.discovery) {
      box.appendChild(el("div", { class: "discovery" }, [
        el("div", { class: "lead" }, [icon("skull", 19), data.occupant + " is dead."]),
        el("p", { style: "margin:0", text: data.discovery.text }),
        data.discovery.first ? el("p", { class: "small", style: "margin:6px 0 0;color:var(--warn)", text: "You found them first." }) : null
      ]));
    }

    var usable = data.offers.filter(function (o) { return o.actionId !== "peek"; });
    if (!usable.length) {
      box.appendChild(el("div", { class: "empty" }, [icon("door", 32), "Nothing for you here."]));
    }
    usable.forEach(function (o) {
      box.appendChild(el("button", {
        class: "offer", disabled: !o.enabled, onclick: function () { chooseOffer(data, o); }
      }, [
        icon(o.icon, 20),
        el("span", { class: "body" }, [
          el("span", { class: "verb" }, [
            o.houseVerb || o.label,
            o.spendsTurn ? null : el("span", { class: "free-tag", text: "free" })
          ]),
          el("span", { class: "desc", text: o.description }),
          (o.charges != null || !o.enabled) ? el("span", {
            class: "meta" + (o.enabled ? "" : " warn"),
            text: o.enabled ? (o.charges + " left") : o.reason
          }) : null
        ])
      ]));
    });
    return box;
  }

  function chooseOffer(door, o) {
    if (o.arity === 2) {
      global.WG_APP.pendingSwap = { actionId: o.actionId, firstId: door.houseId };
      dispatch({ type: CMD.ACT, houseId: door.houseId, actionId: o.actionId, payload: {} });
      H.closeModal();
      return;
    }
    if (o.authoring === "roleGuess") return askRoleGuess(door, o);
    if (o.authoring === "quiz") return askQuiz(door, o);
    if (o.options && o.options.indexOf("manual") >= 0) return askRevive(door, o);
    dispatch({ type: CMD.ACT, houseId: door.houseId, actionId: o.actionId, payload: {} });
    H.closeModal();
  }

  function pickList(list, onPick, cap) {
    var chosen = null;
    var grid = el("div", { class: "roster", style: "max-height:" + (cap || "40dvh") + ";overflow-y:auto" });
    list.forEach(function (r) {
      grid.appendChild(el("button", {
        class: "roster-item team-" + r.team, onclick: function (e) {
          chosen = r.id;
          [].forEach.call(grid.children, function (c) { c.classList.remove("in"); });
          e.currentTarget.classList.add("in");
          onPick(r.id);
        }
      }, [icon(r.icon, 18), el("span", { class: "grow" }, [el("div", { class: "rn", text: r.name })])]));
    });
    return grid;
  }

  function askRoleGuess(door, o) {
    var chosen = null;
    var grid = pickList(WG.roles.all(), function (id) { chosen = id; });
    H.openModal(el("div", {}, [
      el("h2", { text: "Name what they are" }),
      el("p", { class: "small dim", text: "Right, they die. Wrong, you do." }),
      grid,
      el("button", {
        class: "btn primary wide", style: "margin-top:10px", onclick: function () {
          if (!chosen) return toast("Pick a role.", "warn");
          dispatch({ type: CMD.ACT, houseId: door.houseId, actionId: o.actionId, payload: { roleGuess: chosen } });
          H.closeModal();
        }
      }, ["Go in"])
    ]));
  }

  function askQuiz(door, o) {
    var q = el("input", { type: "text", placeholder: "Question", maxlength: "200" });
    var cs = [0, 1, 2, 3].map(function (i) { return el("input", { type: "text", placeholder: "Answer " + (i + 1), maxlength: "80" }); });
    var correct = 0;
    var picks = el("div", { class: "spread" }, [0, 1, 2, 3].map(function (i) {
      return el("button", {
        class: "btn small grow" + (i === 0 ? " on" : ""), onclick: function (e) {
          correct = i;
          [].forEach.call(picks.children, function (c) { c.classList.remove("on"); });
          e.currentTarget.classList.add("on");
        }
      }, [String(i + 1)]);
    }));
    H.openModal(el("div", {}, [
      el("h2", { text: "Put " + door.occupant + " on hold" }),
      el("p", { class: "small dim", text: "They cannot act tomorrow night until they get this right." }),
      el("label", { class: "field" }, [el("span", { text: "Question" }), q])
    ].concat(cs.map(function (c, i) {
      return el("label", { class: "field" }, [el("span", { text: "Answer " + (i + 1) }), c]);
    })).concat([
      el("div", { class: "small dim", style: "margin-bottom:5px", text: "Which one is right" }), picks,
      el("button", {
        class: "btn primary wide", style: "margin-top:10px", onclick: function () {
          var choices = cs.map(function (c) { return c.value.trim(); });
          if (!q.value.trim() || choices.some(function (c) { return !c; })) return toast("Fill all five boxes.", "warn");
          dispatch({ type: CMD.ACT, houseId: door.houseId, actionId: o.actionId,
            payload: { quiz: { question: q.value.trim(), choices: choices, correct: correct } } });
          H.closeModal();
        }
      }, ["Call"])
    ])));
  }

  function askRevive(door, o) {
    var mode = "random", role = null, tell = true;
    var pool = WG.roles.all().filter(function (r) {
      return r.team === "village" && ["archangel", "mayor"].indexOf(r.id) < 0;
    });
    var grid = pickList(pool, function (id) { role = id; }, "32dvh");
    grid.hidden = true;
    var modes = el("div", { class: "spread" }, [
      el("button", { class: "btn small grow on", onclick: function (e) { mode = "random"; grid.hidden = true; only(e); } }, ["Random role"]),
      el("button", { class: "btn small grow", onclick: function (e) { mode = "manual"; grid.hidden = false; only(e); } }, ["I choose"])
    ]);
    function only(e) { [].forEach.call(modes.children, function (c) { c.classList.remove("on"); }); e.currentTarget.classList.add("on"); }

    H.openModal(el("div", {}, [
      el("h2", { text: "Raise " + door.occupant }),
      el("p", { class: "small dim", text: "They return tonight, with their turn intact." }),
      modes, grid,
      el("label", { class: "toggle" }, [
        el("input", { type: "checkbox", checked: true, onchange: function (e) { tell = e.target.checked; } }),
        el("span", { class: "track" }),
        el("span", { class: "label", text: "Tell the village what they are" })
      ]),
      el("button", {
        class: "btn primary wide", onclick: function () {
          if (mode === "manual" && !role) return toast("Pick a role.", "warn");
          dispatch({ type: CMD.ACT, houseId: door.houseId, actionId: o.actionId,
            payload: { assignment: mode, newRole: role, reveal: tell } });
          H.closeModal();
        }
      }, ["Call them back"])
    ]));
  }

  function quizScreen(q) {
    var body = el("div", { class: "pane grow scroll reveal" });
    body.appendChild(el("div", { class: "card" }, [
      el("div", { class: "spread", style: "margin-bottom:6px" }, [icon("phone", 20), el("h2", { text: "Please hold" })]),
      el("p", { class: "muted small", text: "You cannot act until you answer." }),
      el("h3", { style: "margin:10px 0", text: q.question }),
      el("div", { class: "stack" }, q.choices.map(function (c, i) {
        return el("button", { class: "btn wide", onclick: function () { dispatch({ type: CMD.QUIZ_ANSWER, choice: i }); } }, [c]);
      })),
      q.attempts ? el("p", { class: "small", style: "color:var(--warn);margin-top:8px", text: q.attempts + " wrong so far." }) : null
    ]));
    return body;
  }

  function promptScreen(pr) {
    var body = el("div", { class: "pane grow center reveal" });
    body.appendChild(el("div", { class: "card" }, [
      el("div", { class: "spread", style: "margin-bottom:6px" }, [icon("door", 20), el("h2", { text: "Someone is at your door" })]),
      el("p", { class: "muted", text: pr.question }),
      el("div", { class: "spread", style: "margin-top:10px" }, [
        el("button", { class: "btn primary grow", onclick: function () { dispatch({ type: CMD.CONSENT, offerId: pr.id, ok: true }); } }, [pr.accept]),
        el("button", { class: "btn grow", onclick: function () { dispatch({ type: CMD.CONSENT, offerId: pr.id, ok: false }); } }, [pr.decline])
      ])
    ]));
    return body;
  }

  function packPanel(v) {
    var tally = v.night.packTally || {};
    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [icon("howl", 16), el("h3", { text: "The pack" })]));
    var any = false;
    Object.keys(tally).forEach(function (hid) {
      any = true;
      var p = playerOf(v, hid) || {};
      card.appendChild(el("div", { class: "row" }, [
        el("div", { class: "grow" }, [el("div", { class: "row-title", text: p.name || hid })]),
        el("span", { class: "pill accent", text: String(tally[hid]) })
      ]));
    });
    if (!any) card.appendChild(el("div", { class: "row" }, [el("span", { class: "row-sub", text: "No howls yet." })]));
    return card;
  }

  function privatePanel() {
    var lines = WG.app.privateLog();
    if (!lines.length) return null;
    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [icon("eye", 16), el("h3", { text: "Your night" })]));
    var body = el("ul", { class: "log", style: "padding:2px 13px 10px" });
    lines.slice(-10).forEach(function (e) {
      body.appendChild(el("li", { class: e.kind || "" }, [icon(logIcon(e.kind), 15), el("span", { text: e.text })]));
    });
    card.appendChild(body);
    return card;
  }

  function logIcon(kind) {
    return { death: "skull", saved: "shield", revive: "wings", act: "check", read: "eye",
      pack: "howl", trap: "trap", transform: "swap", warn: "hourglass", bite: "cat",
      hidden: "skull", team: "users", prompt: "door", sick: "virus", morning: "sunrise",
      report: "alarm", vote: "scales", event: "star", end: "flag", start: "moon",
      retribution: "flame", room: "users" }[kind] || "star";
  }

  /* ================= dawn / verdict ================= */

  function dawn(v) {
    var body = el("div", { class: "pane grow", style: "display:flex;flex-direction:column;gap:8px;min-height:0" });
    var lines = v.publicLog.filter(function (e) { return e.round === v.round; });
    if (!lines.length) lines = v.publicLog.slice(-4);

    var card = el("div", { class: "card reveal" });
    var list = el("ul", { class: "log" });
    lines.forEach(function (e) {
      list.appendChild(el("li", { class: e.kind || "" }, [icon(logIcon(e.kind), 16), el("span", { text: e.text })]));
    });
    card.appendChild(list);
    body.appendChild(card);

    body.appendChild(el("div", { class: "village-wrap" }, [
      WG.village.render(v, { selectable: false })
    ]));

    return {
      body: body,
      dock: v.me ? el("button", {
        class: "btn primary big wide", disabled: v.me.ready,
        onclick: function () { dispatch({ type: CMD.READY }); }
      }, [v.me.ready ? "Waiting for the others" : "Ready"]) : null
    };
  }

  /* ================= discussion ================= */

  function discussion(v) {
    var body = el("div", { class: "split" });

    var left = el("div", { style: "display:flex;flex-direction:column;min-height:0" }, [
      el("div", { class: "village-wrap" }, [WG.village.render(v, { selectable: false })])
    ]);
    body.appendChild(left);

    var right = el("div", { style: "display:flex;flex-direction:column;gap:6px;min-height:0" });
    if (v.me && v.me.role && (v.me.role.id === "cat" || v.me.role.id === "dog")) {
      right.appendChild(el("div", { class: "turn-state blocked" }, [
        icon(v.me.role.id, 16),
        "You can only " + (v.me.role.id === "cat" ? "meow" : "bark") + "."
      ]));
    }
    if (v.config.room.chat) right.appendChild(chatPanel(v, v.me && !v.me.alive && v.config.room.deadChat ? "dead" : "day"));
    else right.appendChild(logPanel(v));
    body.appendChild(right);

    return { body: body };
  }

  function chatPanel(v, channel) {
    var card = el("div", { class: "card", style: "display:flex;flex-direction:column;min-height:0;flex:1" });
    card.appendChild(el("div", { class: "spread", style: "margin-bottom:4px;flex:0 0 auto" }, [
      icon("chat", 15),
      el("h3", { class: "grow", text: channel === "dead" ? "The dead" : channel === "pack" ? "The pack" : "The square" })
    ]));
    var box = el("div", { class: "chat pane scroll grow" });
    ((v.chat || {})[channel] || []).forEach(function (m) {
      var me = v.me && m.id === v.me.id;
      var animal = /^(meow|bark)( |$)/.test(m.text);
      box.appendChild(el("div", { class: "msg" + (me ? " me" : "") + (animal ? " animal" : "") }, [
        el("span", { class: "who", text: m.name }),
        el("span", { class: "text grow", text: m.text })
      ]));
    });
    card.appendChild(box);
    var input = el("input", { type: "text", placeholder: "Say something", maxlength: "300" });
    var send = function () {
      var t = input.value.trim();
      if (!t) return;
      dispatch({ type: CMD.CHAT, text: t, channel: channel });
      input.value = "";
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
    card.appendChild(el("div", { class: "chat-form" }, [input, el("button", { class: "btn", onclick: send }, [icon("arrowRight", 16)])]));
    setTimeout(function () { box.scrollTop = box.scrollHeight; }, 0);
    return card;
  }

  function logPanel(v) {
    var card = el("div", { class: "card flush", style: "display:flex;flex-direction:column;min-height:0;flex:1" });
    card.appendChild(el("div", { class: "card-head" }, [icon("flag", 16), el("h3", { text: "So far" })]));
    var list = el("ul", { class: "log pane scroll grow", style: "padding:2px 13px 10px" });
    v.publicLog.slice(-30).forEach(function (e) {
      list.appendChild(el("li", { class: e.kind || "" }, [icon(logIcon(e.kind), 15), el("span", { text: e.text })]));
    });
    card.appendChild(list);
    return card;
  }

  /* ================= voting ================= */

  function voting(v) {
    var votes = v.votes || {};
    var body = el("div", { class: "pane grow", style: "display:flex;flex-direction:column;gap:8px;min-height:0" });

    if (!v.me || !v.me.alive) {
      body.appendChild(el("div", { class: "turn-state spent" }, [icon("eye", 16), "The dead do not vote."]));
    }
    body.appendChild(el("div", { class: "spread", style: "flex:0 0 auto" }, [
      icon("scales", 18),
      el("h2", { class: "grow", text: "Who hangs?" }),
      el("span", { class: "pill", text: votes.cast + "/" + votes.total })
    ]));

    var grid = el("div", { class: "vote-grid pane scroll grow" });
    v.players.filter(function (p) { return p.alive && !p.spectator; }).forEach(function (p) {
      var n = votes.counts ? (votes.counts[p.id] || 0) : null;
      var who = votes.detail ? Object.keys(votes.detail).filter(function (k) { return votes.detail[k] === p.id; })
        .map(function (k) { var x = playerOf(v, k); return x ? x.name : "?"; }) : [];
      grid.appendChild(el("button", {
        class: "vote-btn" + (votes.mine === p.id ? " mine" : ""),
        disabled: !v.me || !v.me.alive || (p.isMe && !v.config.rules.allowSelfVote),
        onclick: function () { dispatch({ type: CMD.VOTE, targetId: p.id }); }
      }, [
        face(p, 30),
        el("span", { class: "grow" }, [
          el("div", { class: "row-title", text: p.name }),
          who.length ? el("div", { class: "voters", text: who.join(", ") }) : null
        ]),
        n != null ? el("span", { class: "n", text: String(n) }) : null
      ]));
    });
    body.appendChild(grid);

    var dock = el("div", { style: "display:flex;flex-direction:column;gap:6px" });
    if (votes.onMe && votes.onMe.length) {
      dock.appendChild(el("div", { class: "turn-state blocked" }, [
        icon("scales", 16), votes.onMe.length + (votes.onMe.length === 1 ? " vote" : " votes") + " on you."
      ]));
    }
    if (v.config.rules.allowSkipVote) {
      dock.appendChild(el("button", {
        class: "btn wide" + (votes.mine === "SKIP" ? " on" : ""),
        disabled: !v.me || !v.me.alive,
        onclick: function () { dispatch({ type: CMD.VOTE, targetId: "SKIP" }); }
      }, ["Hang nobody" + (votes.counts && votes.counts.SKIP ? " (" + votes.counts.SKIP + ")" : "")]));
    }
    return { body: body, dock: dock };
  }

  /* ================= game over ================= */

  function gameOver(v) {
    var w = v.winner || {};
    var body = el("div", { class: "pane grow scroll reveal" });
    body.appendChild(el("div", { class: "card", style: "text-align:center" }, [
      el("div", { style: "color:var(--team," + "var(--accent))" , class: "team-" + w.team },
        [icon((WG.roles.teams[w.team] || {}).icon || "flag", 44, { weight: 1.15 })]),
      el("h1", { style: "margin:6px 0 2px", text: (WG.roles.teams[w.team] || {}).name || "Over" }),
      el("p", { class: "muted small", text: w.message || "" })
    ]));

    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [icon("users", 16), el("h3", { text: "Everybody" })]));
    v.players.filter(function (p) { return !p.spectator; }).forEach(function (p) {
      card.appendChild(el("div", { class: "row " + teamClass(p) }, [
        el("span", { class: "team-dot" }),
        face(p, 30),
        el("div", { class: "grow" }, [
          el("div", { class: "row-title", text: p.name }),
          el("div", { class: "row-sub", text: p.role ? p.role.name : "?" })
        ]),
        el("span", { class: "pill" + (p.alive ? " ok" : ""), text: p.alive ? "alive" : "night " + (p.diedNight || "?") })
      ]));
    });
    body.appendChild(card);
    body.appendChild(logPanel(v));

    return {
      body: body,
      dock: H.canManage(v) ? el("button", {
        class: "btn primary big wide", onclick: function () { dispatch({ type: CMD.ABORT }); }
      }, [icon("back", 18), "Back to the lobby"]) : null
    };
  }

  function watching() {
    return { body: el("div", { class: "pane grow center" }, [
      el("div", { class: "empty" }, [icon("eye", 40), el("h2", { text: "Watching" }),
        el("p", { class: "muted small", text: "You will see what the morning brings." })])
    ]) };
  }

  /* ================= host controls ================= */

  function hostControls(v) {
    return el("div", { class: "spread" }, [
      el("span", { class: "small dim grow", text: "Host" }),
      el("button", { class: "btn small", title: "Add a minute", onclick: function () { dispatch({ type: CMD.EXTEND, seconds: 60 }); } }, [icon("clock", 14), "+1m"]),
      el("button", { class: "btn small", onclick: function () { dispatch({ type: CMD.SKIP_PHASE }); } }, ["Skip", icon("arrowRight", 14)]),
      el("button", { class: "btn small danger", title: "End the game", onclick: function () {
        if (confirm("End the game?")) dispatch({ type: CMD.ABORT });
      } }, [icon("close", 14)])
    ]);
  }

  /* ================= sharing ================= */

  function roomUrl(code) { return location.origin + location.pathname + "#/join/" + code; }
  function shareRoom(code) {
    var url = roomUrl(code);
    if (navigator.share) navigator.share({ title: "The Wolf Game", text: "Room " + code, url: url }).catch(function () { copy(url); });
    else copy(url);
  }
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("Copied.", "ok"); }, function () { toast(text); });
    else toast(text);
  }

  WG.screens = {
    lobby: lobby, reveal: reveal, night: night, dawn: dawn,
    discussion: discussion, voting: voting, gameOver: gameOver,
    hostControls: hostControls, doorSheet: doorSheet, logIcon: logIcon
  };
})(typeof window !== "undefined" ? window : globalThis);
