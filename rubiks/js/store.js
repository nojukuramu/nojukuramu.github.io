/* Rubiks — localStorage persistence for solves and settings
   All data stays on the device; a backup is a file the user saves. */
"use strict";

var RK = RK || {};

RK.store = (function () {
  var PREFIX = "rk.";

  function get(key, fallback) {
    try { var v = localStorage.getItem(PREFIX + key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }

  /* Returns false when the browser refuses (private mode, full quota) so the
     caller can say the solve was not kept, rather than losing it silently. */
  function set(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  function remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  }

  /* Solves are stored per event. Each solve:
     { time: ms, scramble: "...", date: epoch, penalty: null|"+2"|"DNF", comment?: "" } */
  function solves(ev) { return get("solves." + ev, []); }
  function save(ev, all) { return set("solves." + ev, all); }

  function addSolve(ev, solve) {
    var all = solves(ev);
    all.push(solve);
    all.saved = save(ev, all);
    return all;
  }

  function insertSolve(ev, index, solve) {
    var all = solves(ev);
    all.splice(Math.max(0, Math.min(index, all.length)), 0, solve);
    save(ev, all);
    return all;
  }

  function removeSolve(ev, index) {
    var all = solves(ev);
    if (index >= 0 && index < all.length) {
      all.splice(index, 1);
      save(ev, all);
    }
    return all;
  }

  function updateSolve(ev, index, updates) {
    var all = solves(ev);
    if (index >= 0 && index < all.length) {
      for (var k in updates) all[index][k] = updates[k];
      save(ev, all);
    }
    return all;
  }

  function clearSolves(ev) { save(ev, []); }

  var DEFAULTS = {
    inspection: false,
    alerts: "voice",     // voice | beep | off
    holdMs: 300,         // 0 | 300 | 550
    hideRunning: false,
    decimals: 2,
    preview: true,
    input: "timer",      // timer | typing
    target: null,        // ms
    wake: true,
    theme: "auto"        // auto | dark | light
  };

  function settings() {
    var s = get("settings", {}) || {}, out = {};
    for (var k in DEFAULTS) out[k] = s[k] === undefined ? DEFAULTS[k] : s[k];
    return out;
  }

  function saveSettings(s) { set("settings", s); }

  /* Backup: every event in one JSON file. Import merges by date so restoring
     the same file twice does not double the history. */
  function backup(eventIds) {
    var out = { app: "rubiks", version: 1, exported: Date.now(), events: {} };
    eventIds.forEach(function (id) {
      var s = solves(id);
      if (s.length) out.events[id] = s;
    });
    return out;
  }

  function restore(data, eventIds) {
    if (!data || data.app !== "rubiks" || typeof data.events !== "object") throw new Error("Not a Rubiks backup");
    var added = 0;
    eventIds.forEach(function (id) {
      var incoming = data.events[id];
      if (!Array.isArray(incoming)) return;
      var all = solves(id), seen = {};
      all.forEach(function (s) { seen[s.date + ":" + s.time] = true; });
      incoming.forEach(function (s) {
        if (!s || typeof s.time !== "number" || typeof s.date !== "number") return;
        if (seen[s.date + ":" + s.time]) return;
        all.push({ time: s.time, scramble: String(s.scramble || ""), date: s.date,
          penalty: s.penalty === "+2" || s.penalty === "DNF" ? s.penalty : null,
          comment: s.comment ? String(s.comment).slice(0, 500) : undefined });
        added++;
      });
      all.sort(function (a, b) { return a.date - b.date; });
      save(id, all);
    });
    return added;
  }

  return {
    get: get,
    set: set,
    remove: remove,
    solves: solves,
    addSolve: addSolve,
    insertSolve: insertSolve,
    removeSolve: removeSolve,
    updateSolve: updateSolve,
    clearSolves: clearSolves,
    settings: settings,
    saveSettings: saveSettings,
    backup: backup,
    restore: restore
  };
})();
