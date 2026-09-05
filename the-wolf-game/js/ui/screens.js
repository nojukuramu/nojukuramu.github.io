/* screens.js — the drawing half.
 *
 * app.js is the wiring: transport, state, who is allowed to ask for what. This
 * is what any of that looks like. The split is the main thing the legacy build
 * did not have — one 8,500-line file where a role's rules, its HTML and the
 * transition that revealed it were the same three lines — and it is why adding
 * a phase here is an edit in two obvious places instead of a search.
 *
 * Every function takes the *view*: the redacted, per-player snapshot. There is
 * no path from here to the authoritative state, which is deliberate. A screen
 * cannot leak what it was never handed.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  var H = global.WG_HELPERS;
  var el = H.el, toast = H.toast, dispatch = H.dispatch;
  var CMD = WG.protocol.CMD;

  function avatarNode(p, size) {
    var n = el("span", { class: "avatar", style: size ? "width:" + size + "px;height:" + size + "px;flex:0 0 " + size + "px" : null });
    if (p && p.avatar) n.appendChild(el("img", { src: p.avatar, alt: "" }));
    else n.textContent = p && p.role ? p.role.icon : (p && !p.alive ? "🕯️" : "👤");
    return n;
  }

  function teamClass(p) { return p && p.role ? "team-" + p.role.team : ""; }

  /* ================= lobby ================= */

  function lobby(v) {
    var wrap = el("div");
    var manage = H.canManage(v);

    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "roomcode", text: v.code }),
      el("p", { class: "small dim", style: "text-align:center", text: "Read this out, or send the link." }),
      el("div", { class: "spread" }, [
        el("button", { class: "btn grow", onclick: function () { shareRoom(v.code); } }, ["Share the link"]),
        el("button", { class: "btn grow", onclick: function () { copy(v.code); } }, ["Copy the code"])
      ])
    ]));

    wrap.appendChild(playerList(v, manage));
    if (manage && v.pending && v.pending.length) wrap.appendChild(doorQueue(v));
    if (manage) wrap.appendChild(rosterBuilder(v));
    wrap.appendChild(settingsPanel(v, manage));

    if (manage) {
      var seats = v.players.filter(function (p) { return !p.spectator; }).length;
      var dealt = Object.keys(v.roster).reduce(function (n, k) { return n + v.roster[k]; }, 0);
      var problem = seats < 4 ? "You need at least four people."
        : dealt > seats ? "There are more roles in the bag than there are people."
        : null;
      wrap.appendChild(el("div", { class: "card" }, [
        problem ? el("p", { class: "small", style: "color:var(--warn)", text: problem }) : null,
        el("button", {
          class: "btn primary big wide", disabled: !!problem,
          onclick: function () { dispatch({ type: CMD.START }); }
        }, ["Start the night"])
      ]));
    } else {
      wrap.appendChild(el("div", { class: "card" }, [
        el("p", { class: "muted", style: "margin:0;text-align:center", text: "Waiting for the host to start." })
      ]));
    }
    return wrap;
  }

  function playerList(v, manage) {
    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [
      el("h3", { text: "In the village" }),
      el("span", { class: "pill", text: v.players.filter(function (p) { return !p.spectator; }).length + " seated" })
    ]));
    v.players.forEach(function (p) {
      var actions = [];
      if (manage && !p.isHost) {
        actions.push(el("button", {
          class: "btn small" + (p.cohost ? " on" : ""), title: "Co-host",
          onclick: function () { dispatch({ type: CMD.ROLE_GRANT, id: p.id, cohost: !p.cohost }); }
        }, [p.cohost ? "★" : "☆"]));
        actions.push(el("button", {
          class: "btn small danger",
          onclick: function () { if (confirm("Remove " + p.name + "?")) dispatch({ type: CMD.KICK, id: p.id }); }
        }, ["✕"]));
      }
      card.appendChild(el("div", { class: "row" }, [
        avatarNode(p, 34),
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
    card.appendChild(el("div", { class: "card-head" }, [el("h3", { text: "At the door" })]));
    v.pending.forEach(function (g) {
      card.appendChild(el("div", { class: "row" }, [
        el("div", { class: "grow" }, [el("div", { class: "row-title", text: g.name })]),
        el("button", { class: "btn small primary", onclick: function () { dispatch({ type: CMD.APPROVE, id: g.id, ok: true }); } }, ["Let in"]),
        el("button", { class: "btn small", onclick: function () { dispatch({ type: CMD.APPROVE, id: g.id, ok: false }); } }, ["No"])
      ]));
    });
    return card;
  }

  /* The bag. Steppers rather than a multi-select, because the question is never
   * "which roles exist" — it is "how many of this one". */
  function rosterBuilder(v) {
    var card = el("div", { class: "card flush" });
    var seats = v.players.filter(function (p) { return !p.spectator; }).length;
    var dealt = Object.keys(v.roster).reduce(function (n, k) { return n + v.roster[k]; }, 0);

    card.appendChild(el("div", { class: "card-head" }, [
      el("h3", { text: "The bag" }),
      el("span", { class: "pill" + (dealt === seats ? " ok" : dealt > seats ? " bad" : ""), text: dealt + " / " + seats })
    ]));

    var body = el("div", { style: "padding:12px 16px 16px" });

    // The balance bar: four sides, at a glance, before anybody is dealt in.
    var byTeam = { village: 0, werewolf: 0, cult: 0, solo: 0 };
    Object.keys(v.roster).forEach(function (rid) {
      var r = WG.roles.get(rid); if (r) byTeam[r.team] += v.roster[rid];
    });
    var bar = el("div", { class: "bar" });
    ["werewolf", "cult", "solo", "village"].forEach(function (t) {
      if (!byTeam[t]) return;
      bar.appendChild(el("i", { class: "team-" + t, style: "flex:" + byTeam[t] + ";background:var(--team)" }));
    });
    body.appendChild(el("div", { class: "tally" }, [
      el("span", { class: "small dim", text: "Balance" }), bar,
      el("span", { class: "small", text: byTeam.werewolf + " wolf · " + byTeam.village + " village" +
        (byTeam.cult ? " · " + byTeam.cult + " cult" : "") + (byTeam.solo ? " · " + byTeam.solo + " solo" : "") })
    ]));

    body.appendChild(el("div", { class: "spread", style: "margin-bottom:10px;flex-wrap:wrap" }, [
      el("button", { class: "btn small", onclick: function () { setRoster(H.suggestRoster(seats)); } }, ["Suggest for " + seats]),
      el("button", { class: "btn small", onclick: function () { setRoster(chaos(seats)); } }, ["Chaos"]),
      el("button", { class: "btn small", onclick: function () { setRoster({}); } }, ["Empty the bag"])
    ]));

    ["werewolf", "village", "cult", "solo"].forEach(function (team) {
      body.appendChild(el("div", { class: "spread", style: "margin:14px 0 6px" }, [
        el("span", { class: "team-dot team-" + team }),
        el("h3", { style: "margin:0;font-size:.94rem", text: WG.roles.teams[team].name })
      ]));
      var grid = el("div", { class: "roster" });
      WG.roles.all().filter(function (r) { return r.team === team; }).forEach(function (r) {
        var n = v.roster[r.id] || 0;
        grid.appendChild(el("div", { class: "roster-item team-" + team + (n ? " in" : "") }, [
          el("button", { class: "ico", style: "background:none;border:none;cursor:pointer;font-size:1.2rem",
            title: "What is a " + r.name + "?", onclick: function () { H.showRoleCard(r.id); } }, [r.icon]),
          el("span", { class: "grow" }, [
            el("div", { class: "rn", text: r.name }),
            el("div", { class: "rd", text: r.tagline })
          ]),
          el("span", { class: "stepper" }, [
            el("button", { onclick: function () { bump(r.id, -1); }, "aria-label": "One fewer " + r.name }, ["−"]),
            el("span", { class: "n", text: String(n) }),
            el("button", { onclick: function () { bump(r.id, 1); }, "aria-label": "One more " + r.name }, ["+"])
          ])
        ]));
      });
      body.appendChild(grid);
    });

    card.appendChild(body);
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
    var all = WG.roles.all();
    var roster = {};
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

  /* Settings, grouped by the question a host is actually asking. The old build
   * had one column of unrelated checkboxes; these are four tabs because there
   * are four decisions, and they are not the same decision. */
  var GROUPS = {
    flow:   { label: "Clock",    icon: "⏱" },
    rules:  { label: "Rules",    icon: "⚖️" },
    room:   { label: "Room",     icon: "🚪" },
    events: { label: "Events",   icon: "🎲" },
    look:   { label: "Look",     icon: "🎨" }
  };
  var COPY = {
    "flow.endNightEarly":  ["End the night early", "Close it as soon as everybody has spent their turn."],
    "flow.endVotingEarly": ["End the vote early", "Close it as soon as everybody has voted."],
    "rules.revealRolesOnDeath": ["Reveal roles on death", "The village is told what somebody was."],
    "rules.firstNightImmunity": ["First night is safe", "Nobody can be killed on night one."],
    "rules.showVoteCounts": ["Show the tally", "Everybody sees the vote counts as they land."],
    "rules.showPersonalVotes": ["Show who voted for you", "You can see the names on your own rope."],
    "rules.allowSkipVote": ["Allow skipping", "The village can vote to hang nobody."],
    "rules.allowSelfVote": ["Allow voting for yourself", "Mostly for the Jester."],
    "rules.villagerPromotion": ["Villagers can be promoted", "Enough night work and a Villager becomes something else."],
    "rules.animalSpeech": ["Cats and dogs really cannot talk", "Their messages are replaced with meows and barks."],
    "room.joinApproval": ["Approve everyone at the door", "A six-character code is guessable. This is the lock."],
    "room.chat": ["Chat", "Discussion happens in the app."],
    "room.deadChat": ["The dead get their own channel", "Which the living cannot read."],
    "room.allowSpectators": ["Latecomers can watch", "They join as spectators rather than players."],
    "events.enabled": ["Events", "A festival, a plague, a blood moon. Occasionally."],
    "look.timeOfDayTheme": ["Colour follows the clock", "The room goes from night to dawn to noon to dusk as you play."],
    "look.reduceMotion": ["Reduce motion", "Nothing slides, pulses or drifts."],
    "look.sound": ["Sound", "The clock, the alarm, the verdict."]
  };

  function settingsPanel(v, manage) {
    var card = el("div", { class: "card" });
    card.appendChild(el("h3", { text: "Settings" }));
    var tabs = el("div", { class: "tabs" });
    var body = el("div");
    var cur = global.WG_APP.settingsTab || "flow";

    Object.keys(GROUPS).forEach(function (g) {
      tabs.appendChild(el("button", {
        class: cur === g ? "on" : "", onclick: function () { global.WG_APP.settingsTab = g; WG.app.render(); }
      }, [GROUPS[g].icon + " " + GROUPS[g].label]));
    });
    card.appendChild(tabs);

    var cfg = v.config;
    if (cur === "flow") {
      body.appendChild(el("p", { class: "small dim", text:
        "How long each part of the round runs. The colour of the room tracks these, so a longer discussion is a longer morning." }));
      var presets = (WG.clock.flow.roomConfig || {}).presets || {};
      body.appendChild(el("div", { class: "spread", style: "margin-bottom:10px" },
        Object.keys(presets).map(function (name) {
          return el("button", {
            class: "btn small" + (cfg.flow.preset === name ? " on" : ""), disabled: !manage,
            onclick: function () { patch("flow", { preset: name, durations: presets[name] }); }
          }, [name]);
        })));
      Object.keys(cfg.flow.durations).forEach(function (id) {
        var ph = WG.clock.phase(id) || { name: id, icon: "•" };
        body.appendChild(el("div", { class: "row", style: "padding-left:0;padding-right:0" }, [
          el("span", { text: ph.icon }),
          el("div", { class: "grow" }, [
            el("div", { class: "row-title", text: ph.name }),
            el("div", { class: "row-sub", text: ph.description || "" })
          ]),
          el("input", {
            type: "number", min: "5", max: "1200", value: String(cfg.flow.durations[id]),
            style: "width:88px", disabled: !manage,
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
          el("span", { class: "label" }, [
            el("b", { text: ev.icon + " " + ev.name }),
            el("span", { text: ev.shortDescription })
          ])
        ]));
      });
    } else {
      Object.keys(cfg[cur]).forEach(function (k) {
        if (typeof cfg[cur][k] !== "boolean") return;
        body.appendChild(toggle(cur + "." + k, cfg, manage, patch));
      });
      if (cur === "room") {
        body.appendChild(el("label", { class: "field", style: "margin-top:10px" }, [
          el("span", { text: "Maximum players" }),
          el("input", {
            type: "number", min: "4", max: "40", value: String(cfg.room.maxPlayers), disabled: !manage,
            onchange: function (e) { patch("room", { maxPlayers: Math.max(4, Math.min(40, Number(e.target.value) || 24)) }); }
          })
        ]));
      }
    }

    card.appendChild(body);
    if (!manage) card.appendChild(el("p", { class: "small dim", text: "Only the host and co-hosts can change these." }));
    return card;

    function patch(group, changes) {
      var next = JSON.parse(JSON.stringify(v.config));
      Object.assign(next[group], changes);
      // The look settings are this device's business, not the room's.
      if (group === "look" && changes.reduceMotion != null) WG.theme.setMotion(!changes.reduceMotion);
      dispatch({ type: CMD.CONFIG, config: next });
    }
  }

  function toggle(path, cfg, enabled, patch) {
    var parts = path.split("."), group = parts[0], key = parts[1];
    var copy = COPY[path] || [key, ""];
    var on = !!cfg[group][key];
    return el("label", { class: "toggle" }, [
      el("input", {
        type: "checkbox", checked: on, disabled: !enabled,
        onchange: function () { var c = {}; c[key] = !on; patch(group, c); }
      }),
      el("span", { class: "track" }),
      el("span", { class: "label" }, [el("b", { text: copy[0] }), el("span", { text: copy[1] })])
    ]);
  }

  /* ================= role reveal ================= */

  function reveal(v) {
    var me = v.me;
    if (!me || !me.role) {
      return el("div", { class: "card empty" }, [el("span", { class: "ico", text: "👁️" }), "You are watching this one."]);
    }
    var r = me.role;
    var wrap = el("div", { class: "reveal" });
    wrap.appendChild(el("div", { class: "rolecard team-" + r.team }, [
      el("div", { class: "icon", text: r.icon }),
      el("div", { class: "name", text: r.name }),
      el("div", { class: "tagline", text: r.tagline }),
      el("p", { text: r.description }),
      r.lore ? el("div", { class: "lore", text: r.lore }) : null,
      el("dl", {}, [
        el("dt", { text: "You win by" }), el("dd", { text: r.winCondition })
      ]),
      r.actions && r.actions.length ? el("ul", { class: "abilities" }, r.actions.map(function (a) {
        return el("li", {}, [el("span", { class: "ico", text: a.icon }),
          el("span", {}, [el("b", { text: a.label }), " — ", a.description])]);
      })) : null,
      r.passives && r.passives.length ? el("ul", { class: "abilities" }, r.passives.map(function (pp) {
        return el("li", {}, [el("span", { class: "ico", text: "◆" }),
          el("span", {}, [el("b", { text: pp.name }), " — ", pp.description])]);
      })) : null
    ]));
    if (me.brief) wrap.appendChild(briefCard(me.brief));
    wrap.appendChild(el("button", {
      class: "btn primary big wide", disabled: me.ready,
      onclick: function () { dispatch({ type: CMD.READY }); }
    }, [me.ready ? "Waiting for the others…" : "I have read it"]));
    return wrap;
  }

  function briefCard(b) {
    return el("div", { class: "card" }, [
      el("h3", { text: b.title }),
      el("ul", { class: "abilities" }, b.lines.map(function (l) {
        return el("li", {}, [el("span", { class: "ico", text: "›" }), el("span", { text: l })]);
      }))
    ]);
  }

  /* ================= night ================= */

  function night(v) {
    var wrap = el("div");
    var me = v.me;
    if (!me || !me.role) return watching(v);

    if (me.quiz) return quizScreen(me.quiz);
    if (me.prompt) return promptScreen(me.prompt);

    wrap.appendChild(turnState(v));

    if (global.WG_APP.pendingSwap) {
      wrap.appendChild(el("div", { class: "turn-state blocked" }, [
        "🔁 Now pick the second house — the one it changes places with.",
        el("button", { class: "btn small", style: "margin-left:auto",
          onclick: function () { global.WG_APP.pendingSwap = null; WG.app.render(); } }, ["Cancel"])
      ]));
    }

    wrap.appendChild(village(v));

    if (me.brief) wrap.appendChild(briefCard(me.brief));
    if (v.night && v.night.packTally) wrap.appendChild(packPanel(v));
    wrap.appendChild(privatePanel());
    if (v.config.room.chat) {
      var team = me.role.team === "werewolf" ? "pack" : me.role.team === "cult" ? "cult" : (!me.alive ? "dead" : null);
      if (team) wrap.appendChild(chatPanel(v, team, team === "pack" ? "The pack" : team === "cult" ? "The cult" : "The dead"));
    }
    return wrap;
  }

  function turnState(v) {
    var t = v.me.turn;
    if (!t) return el("div", { class: "turn-state spent" }, ["You are watching tonight."]);
    if (t.blocked) return el("div", { class: "turn-state blocked" }, ["☎️ You are on hold. Answer the call before you can do anything."]);
    if (t.spent) {
      return el("div", { class: "turn-state spent" }, [
        "Your night is spent.",
        el("span", { class: "grow" }),
        el("span", { class: "small dim", text: (v.night.turnsSpent) + " of " + v.night.turnsTotal + " done" })
      ]);
    }
    return el("div", { class: "turn-state" }, [
      "🌙 Pick a house. You will be offered whatever you can do there.",
      el("span", { class: "grow" }),
      el("span", { class: "small dim", text: (v.night.turnsSpent) + "/" + v.night.turnsTotal })
    ]);
  }

  /** The village: one door per player, and the state of the house is the only
   *  thing a door has to say. */
  function village(v) {
    var grid = el("div", { class: "village" });
    (v.houses || []).forEach(function (h) {
      var p = v.players.filter(function (x) { return x.id === h.id; })[0] || {};
      var cls = ["house", h.state];
      if (h.isOwn) cls.push("own");
      if (h.visited) cls.push("visited");
      if (h.reported) cls.push("reported");
      if (!h.occupantAlive) cls.push("dead");
      var badge = null;
      if (h.state === "dead-tonight" && !h.reported) badge = el("span", { class: "badge bad", text: "body" });
      else if (h.reported) badge = el("span", { class: "badge", text: "reported" });
      else if (p.marked) badge = el("span", { class: "badge bad", text: "marked" });
      else if (h.isOwn) badge = el("span", { class: "badge accent", text: "you" });

      grid.appendChild(el("button", {
        class: cls.join(" "),
        onclick: function () { knock(h.id); }
      }, [
        badge,
        avatarNode(p, 46),
        el("span", { class: "name", text: p.name || "?" }),
        el("span", { class: "tag", text: p.role ? p.role.name : (h.occupantAlive ? "" : "dead") })
      ]));
    });
    return grid;
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

  /* The sheet you get for knocking. This is the whole interaction model: a door
   * first, then what your role can do about what is behind it. */
  function doorSheet(data) {
    var v = WG.app.currentView();
    var p = v.players.filter(function (x) { return x.id === data.houseId; })[0] || {};
    var box = el("div");

    box.appendChild(el("div", { class: "sheet-head" }, [
      avatarNode(p, 52),
      el("div", { class: "grow" }, [
        el("div", { class: "sheet-title", text: data.occupant }),
        el("div", { class: "row-sub", text: {
          own: "Your own house.",
          living: "Somebody is asleep in there.",
          dead: "Empty. It has been for a while.",
          "dead-tonight": "The door is open and nobody answered.",
          quiet: "Quiet. Nothing to see."
        }[data.state] || "" })
      ])
    ]));

    if (data.discovery) {
      box.appendChild(el("div", { class: "discovery" }, [
        el("div", { class: "lead", text: "💀 " + data.occupant + " is dead." }),
        el("p", { style: "margin:0", text: data.discovery.text }),
        data.discovery.first ? el("p", { class: "small", style: "margin:8px 0 0;color:var(--warn)",
          text: "You are the first person to find them." }) : null
      ]));
    }

    var usable = data.offers.filter(function (o) { return o.actionId !== "peek"; });
    if (!usable.length) {
      box.appendChild(el("div", { class: "empty" }, [
        el("span", { class: "ico", text: "🚪" }),
        "There is nothing here for you tonight."
      ]));
    }
    usable.forEach(function (o) {
      box.appendChild(el("button", {
        class: "offer" + (o.spendsTurn ? "" : " free"), disabled: !o.enabled,
        onclick: function () { chooseOffer(data, o); }
      }, [
        el("span", { class: "ico", text: o.icon }),
        el("span", { class: "body" }, [
          el("span", { class: "verb", text: o.houseVerb || o.label }),
          el("span", { class: "desc", text: o.description }),
          (o.charges != null || !o.enabled) ? el("span", { class: "meta" + (o.enabled ? "" : " warn"),
            text: o.enabled ? (o.charges + " left") : o.reason }) : null
        ])
      ]));
    });
    return box;
  }

  /* Some actions need a second question before they mean anything: which role
   * you are naming, what the quiz says, which house the swap pairs with. */
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

  function askRoleGuess(door, o) {
    var chosen = null;
    var grid = el("div", { class: "roster", style: "max-height:44dvh;overflow-y:auto" });
    WG.roles.all().forEach(function (r) {
      grid.appendChild(el("button", {
        class: "roster-item team-" + r.team, onclick: function (e) {
          chosen = r.id;
          [].forEach.call(grid.children, function (c) { c.classList.remove("in"); });
          e.currentTarget.classList.add("in");
        }
      }, [el("span", { class: "ico", text: r.icon }), el("span", { class: "grow" }, [el("div", { class: "rn", text: r.name })])]));
    });
    H.openModal(el("div", {}, [
      el("h2", { text: "Name what they are" }),
      el("p", { class: "small dim", text: "Right, and " + door.occupant + " dies. Wrong, and you do." }),
      grid,
      el("button", {
        class: "btn primary wide", style: "margin-top:12px", onclick: function () {
          if (!chosen) return toast("Pick a role first.", "warn");
          dispatch({ type: CMD.ACT, houseId: door.houseId, actionId: o.actionId, payload: { roleGuess: chosen } });
          H.closeModal();
        }
      }, ["Go in"])
    ]));
  }

  function askQuiz(door, o) {
    var q = el("input", { type: "text", placeholder: "Your question", maxlength: "200" });
    var cs = [0, 1, 2, 3].map(function (i) { return el("input", { type: "text", placeholder: "Answer " + (i + 1), maxlength: "80" }); });
    var correct = 0;
    var picks = el("div", { class: "spread", style: "flex-wrap:wrap" }, [0, 1, 2, 3].map(function (i) {
      return el("button", {
        class: "btn small" + (i === 0 ? " on" : ""), onclick: function (e) {
          correct = i;
          [].forEach.call(picks.children, function (c) { c.classList.remove("on"); });
          e.currentTarget.classList.add("on");
        }
      }, ["#" + (i + 1) + " is right"]);
    }));
    H.openModal(el("div", {}, [
      el("h2", { text: "Put " + door.occupant + " on hold" }),
      el("p", { class: "small dim", text: "Tomorrow night they cannot do anything until they get this right." }),
      el("label", { class: "field" }, [el("span", { text: "Question" }), q])
    ].concat(cs.map(function (c, i) {
      return el("label", { class: "field" }, [el("span", { text: "Answer " + (i + 1) }), c]);
    })).concat([
      picks,
      el("button", {
        class: "btn primary wide", style: "margin-top:12px", onclick: function () {
          var choices = cs.map(function (c) { return c.value.trim(); });
          if (!q.value.trim() || choices.some(function (c) { return !c; })) return toast("Fill all five boxes.", "warn");
          dispatch({ type: CMD.ACT, houseId: door.houseId, actionId: o.actionId,
            payload: { quiz: { question: q.value.trim(), choices: choices, correct: correct } } });
          H.closeModal();
        }
      }, ["Place the call"])
    ])));
  }

  function askRevive(door, o) {
    var mode = "random", role = null, reveal_ = true;
    var pool = WG.roles.all().filter(function (r) {
      return r.team === "village" && ["archangel", "mayor"].indexOf(r.id) < 0;
    });
    var grid = el("div", { class: "roster", style: "max-height:36dvh;overflow-y:auto", hidden: true });
    pool.forEach(function (r) {
      grid.appendChild(el("button", {
        class: "roster-item team-village", onclick: function (e) {
          role = r.id;
          [].forEach.call(grid.children, function (c) { c.classList.remove("in"); });
          e.currentTarget.classList.add("in");
        }
      }, [el("span", { class: "ico", text: r.icon }), el("span", { class: "grow" }, [el("div", { class: "rn", text: r.name })])]));
    });
    var modes = el("div", { class: "spread" }, [
      el("button", { class: "btn small on", onclick: function (e) { mode = "random"; grid.hidden = true; only(e); } }, ["Let fate pick"]),
      el("button", { class: "btn small", onclick: function (e) { mode = "manual"; grid.hidden = false; only(e); } }, ["I will pick"])
    ]);
    function only(e) { [].forEach.call(modes.children, function (c) { c.classList.remove("on"); }); e.currentTarget.classList.add("on"); }

    H.openModal(el("div", {}, [
      el("h2", { text: "Raise " + door.occupant }),
      el("p", { class: "small dim", text: "They come back tonight, with their turn intact, as something new." }),
      modes, grid,
      el("label", { class: "toggle" }, [
        el("input", { type: "checkbox", checked: true, onchange: function (e) { reveal_ = e.target.checked; } }),
        el("span", { class: "track" }),
        el("span", { class: "label" }, [el("b", { text: "Tell the village what they are now" })])
      ]),
      el("button", {
        class: "btn primary wide", onclick: function () {
          if (mode === "manual" && !role) return toast("Pick a role, or let fate do it.", "warn");
          dispatch({ type: CMD.ACT, houseId: door.houseId, actionId: o.actionId,
            payload: { assignment: mode, newRole: role, reveal: reveal_ } });
          H.closeModal();
        }
      }, ["Call them back"])
    ]));
  }

  function quizScreen(q) {
    return el("div", { class: "card reveal" }, [
      el("h2", { text: "☎️ Please hold" }),
      el("p", { class: "muted", text: "Somebody has you on the line. You cannot do anything tonight until you answer correctly." }),
      el("h3", { text: q.question }),
      el("div", { class: "stack" }, q.choices.map(function (c, i) {
        return el("button", { class: "btn wide", onclick: function () { dispatch({ type: CMD.QUIZ_ANSWER, choice: i }); } }, [c]);
      })),
      q.attempts ? el("p", { class: "small", style: "color:var(--warn)", text: q.attempts + " wrong so far." }) : null
    ]);
  }

  function promptScreen(pr) {
    return el("div", { class: "card reveal" }, [
      el("h2", { text: "Somebody is at your door" }),
      el("p", { class: "muted", text: pr.question }),
      el("div", { class: "spread" }, [
        el("button", { class: "btn primary grow", onclick: function () { dispatch({ type: CMD.CONSENT, offerId: pr.id, ok: true }); } }, [pr.accept]),
        el("button", { class: "btn grow", onclick: function () { dispatch({ type: CMD.CONSENT, offerId: pr.id, ok: false }); } }, [pr.decline])
      ])
    ]);
  }

  function packPanel(v) {
    var tally = v.night.packTally || {};
    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [el("h3", { text: "🐺 The pack" })]));
    var any = false;
    Object.keys(tally).forEach(function (hid) {
      any = true;
      var p = v.players.filter(function (x) { return x.id === hid; })[0] || {};
      card.appendChild(el("div", { class: "row" }, [
        el("div", { class: "grow" }, [el("div", { class: "row-title", text: p.name || hid })]),
        el("span", { class: "pill accent", text: tally[hid] + (tally[hid] === 1 ? " howl" : " howls") })
      ]));
    });
    if (!any) card.appendChild(el("div", { class: "row" }, [el("span", { class: "row-sub", text: "Nobody has howled yet." })]));
    card.appendChild(el("div", { class: "row" }, [
      el("span", { class: "row-sub", text: "The kill happens the moment the last of you has voted — not at dawn." })
    ]));
    return card;
  }

  function privatePanel() {
    var lines = WG.app.privateLog();
    if (!lines.length) return el("span");
    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [el("h3", { text: "Your night" })]));
    var body = el("ul", { class: "log", style: "padding:4px 16px 12px" });
    lines.slice(-14).forEach(function (e) {
      body.appendChild(el("li", { class: e.kind || "", text: e.text }));
    });
    card.appendChild(body);
    return card;
  }

  /* ================= dawn / verdict ================= */

  function dawn(v) {
    var wrap = el("div", { class: "reveal" });
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", { text: v.phase === "verdict" ? "⚖️ The verdict" : "🌅 What the village found" }));
    var lines = v.publicLog.filter(function (e) { return e.round === v.round; });
    if (!lines.length) lines = v.publicLog.slice(-4);
    var list = el("ul", { class: "log" });
    lines.forEach(function (e) { list.appendChild(el("li", { class: e.kind || "", text: e.text })); });
    card.appendChild(list);
    wrap.appendChild(card);
    wrap.appendChild(privatePanel());
    wrap.appendChild(rollCall(v));
    if (v.me) {
      wrap.appendChild(el("button", {
        class: "btn primary big wide", disabled: v.me.ready,
        onclick: function () { dispatch({ type: CMD.READY }); }
      }, [v.me.ready ? "Waiting for the others…" : "Ready"]));
    }
    return wrap;
  }

  function rollCall(v) {
    var card = el("div", { class: "card flush" });
    var alive = v.players.filter(function (p) { return p.alive && !p.spectator; });
    card.appendChild(el("div", { class: "card-head" }, [
      el("h3", { text: "Still standing" }), el("span", { class: "pill", text: String(alive.length) })
    ]));
    var grid = el("div", { class: "village", style: "padding:12px 16px 16px;margin:0" });
    v.players.filter(function (p) { return !p.spectator; }).forEach(function (p) {
      grid.appendChild(el("div", { class: "house" + (p.alive ? "" : " dead") + " " + teamClass(p) }, [
        avatarNode(p, 46),
        el("span", { class: "name", text: p.name }),
        el("span", { class: "tag", text: p.role ? p.role.name : (p.alive ? "" : "dead") })
      ]));
    });
    card.appendChild(grid);
    return card;
  }

  /* ================= discussion ================= */

  function discussion(v) {
    var wrap = el("div");
    wrap.appendChild(rollCall(v));
    if (v.me && v.me.role && v.me.role.id === "cat") {
      wrap.appendChild(el("div", { class: "turn-state blocked" }, ["🐱 You can only meow. Whatever you type comes out as meows."]));
    }
    if (v.me && v.me.role && v.me.role.id === "dog") {
      wrap.appendChild(el("div", { class: "turn-state blocked" }, ["🐶 You can only bark. Whatever you type comes out as barks."]));
    }
    if (v.config.room.chat) wrap.appendChild(chatPanel(v, "day", "The village square"));
    if (v.me && !v.me.alive && v.config.room.deadChat) wrap.appendChild(chatPanel(v, "dead", "The dead"));
    wrap.appendChild(logPanel(v));
    return wrap;
  }

  function chatPanel(v, channel, title) {
    var card = el("div", { class: "card" });
    card.appendChild(el("h3", { text: title }));
    var box = el("div", { class: "chat" });
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
    card.appendChild(el("div", { class: "chat-form" }, [input, el("button", { class: "btn", onclick: send }, ["Send"])]));
    setTimeout(function () { box.scrollTop = box.scrollHeight; }, 0);
    return card;
  }

  function logPanel(v) {
    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [el("h3", { text: "What has happened" })]));
    var list = el("ul", { class: "log", style: "padding:4px 16px 12px" });
    v.publicLog.slice(-20).forEach(function (e) { list.appendChild(el("li", { class: e.kind || "", text: e.text })); });
    card.appendChild(list);
    return card;
  }

  /* ================= voting ================= */

  function voting(v) {
    var wrap = el("div");
    var votes = v.votes || {};
    if (!v.me || !v.me.alive) {
      wrap.appendChild(el("div", { class: "turn-state spent" }, ["The dead do not vote. You can watch."]));
    }
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", { text: "Who hangs?" }));
    card.appendChild(el("p", { class: "small dim", text: votes.cast + " of " + votes.total + " votes in. You can change yours until the clock runs out." }));

    var grid = el("div", { class: "vote-grid" });
    v.players.filter(function (p) { return p.alive && !p.spectator; }).forEach(function (p) {
      var n = votes.counts ? (votes.counts[p.id] || 0) : null;
      var who = votes.detail ? Object.keys(votes.detail).filter(function (k) { return votes.detail[k] === p.id; })
        .map(function (k) { var x = v.players.filter(function (y) { return y.id === k; })[0]; return x ? x.name : "?"; }) : [];
      grid.appendChild(el("button", {
        class: "vote-btn" + (votes.mine === p.id ? " mine" : ""),
        disabled: !v.me || !v.me.alive || (p.isMe && !v.config.rules.allowSelfVote),
        onclick: function () { dispatch({ type: CMD.VOTE, targetId: p.id }); }
      }, [
        avatarNode(p, 32),
        el("span", { class: "grow" }, [
          el("div", { class: "row-title", text: p.name }),
          who.length ? el("div", { class: "voters", text: who.join(", ") }) : null
        ]),
        n != null ? el("span", { class: "n", text: String(n) }) : null
      ]));
    });
    card.appendChild(grid);

    if (v.config.rules.allowSkipVote) {
      card.appendChild(el("button", {
        class: "btn wide" + (votes.mine === "SKIP" ? " on" : ""), style: "margin-top:10px",
        disabled: !v.me || !v.me.alive,
        onclick: function () { dispatch({ type: CMD.VOTE, targetId: "SKIP" }); }
      }, ["Hang nobody" + (votes.counts && votes.counts.SKIP ? " (" + votes.counts.SKIP + ")" : "")]));
    }
    if (votes.onMe && votes.onMe.length) {
      card.appendChild(el("p", { class: "small", style: "color:var(--warn);margin-top:10px",
        text: votes.onMe.length + (votes.onMe.length === 1 ? " person has" : " people have") + " voted for you." }));
    }
    wrap.appendChild(card);
    if (v.config.room.chat) wrap.appendChild(chatPanel(v, "day", "Last words"));
    return wrap;
  }

  /* ================= game over ================= */

  function gameOver(v) {
    var w = v.winner || {};
    var wrap = el("div", { class: "reveal" });
    wrap.appendChild(el("div", { class: "card", style: "text-align:center" }, [
      el("div", { style: "font-size:3rem", text: (WG.roles.teams[w.team] || {}).icon || "🏁" }),
      el("h1", { text: (WG.roles.teams[w.team] || {}).name || "Over" }),
      el("p", { class: "muted", text: w.message || "" })
    ]));

    var card = el("div", { class: "card flush" });
    card.appendChild(el("div", { class: "card-head" }, [el("h3", { text: "Everybody, finally" })]));
    v.players.filter(function (p) { return !p.spectator; }).forEach(function (p) {
      card.appendChild(el("div", { class: "row " + teamClass(p) }, [
        el("span", { class: "team-dot" }),
        avatarNode(p, 34),
        el("div", { class: "grow" }, [
          el("div", { class: "row-title", text: p.name }),
          el("div", { class: "row-sub", text: p.role ? p.role.icon + " " + p.role.name : "?" })
        ]),
        el("span", { class: "pill" + (p.alive ? " ok" : ""), text: p.alive ? "survived" : "died night " + (p.diedNight || "?") })
      ]));
    });
    wrap.appendChild(card);
    wrap.appendChild(logPanel(v));

    if (H.canManage(v)) {
      wrap.appendChild(el("div", { class: "card" }, [
        el("button", { class: "btn primary big wide", onclick: function () { dispatch({ type: CMD.ABORT }); } }, ["Back to the lobby"])
      ]));
    }
    return wrap;
  }

  function watching(v) {
    return el("div", { class: "card empty" }, [
      el("span", { class: "ico", text: "👁️" }),
      el("h2", { text: "You are watching" }),
      el("p", { class: "muted", text: "The village is asleep. You will see what it finds in the morning." })
    ]);
  }

  /* ================= host controls ================= */

  function hostControls(v) {
    return el("div", { class: "card" }, [
      el("div", { class: "spread", style: "flex-wrap:wrap" }, [
        el("span", { class: "small dim grow", text: "Host" }),
        el("button", { class: "btn small", onclick: function () { dispatch({ type: CMD.EXTEND, seconds: 60 }); } }, ["+1 min"]),
        el("button", { class: "btn small", onclick: function () { dispatch({ type: CMD.SKIP_PHASE }); } }, ["Move on ›"]),
        el("button", { class: "btn small danger", onclick: function () {
          if (confirm("End the game and go back to the lobby?")) dispatch({ type: CMD.ABORT });
        } }, ["End"])
      ])
    ]);
  }

  /* ================= sharing ================= */

  function roomUrl(code) {
    return location.origin + location.pathname + "#/join/" + code;
  }
  function shareRoom(code) {
    var url = roomUrl(code);
    if (navigator.share) {
      navigator.share({ title: "The Wolf Game", text: "Room " + code, url: url }).catch(function () { copy(url); });
    } else copy(url);
  }
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("Copied."); },
      function () { toast(text); });
    else toast(text);
  }

  WG.screens = {
    lobby: lobby, reveal: reveal, night: night, dawn: dawn,
    discussion: discussion, voting: voting, gameOver: gameOver,
    hostControls: hostControls, doorSheet: doorSheet, rollCall: rollCall
  };
})(typeof window !== "undefined" ? window : globalThis);
