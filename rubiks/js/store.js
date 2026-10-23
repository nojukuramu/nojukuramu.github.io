/* Rubiks — localStorage persistence for solves and settings
   All data stays on the device. */
"use strict";

var RK = RK || {};

RK.store = (function () {
  var PREFIX = "rk.";

  function get(key, fallback) {
    try { var v = localStorage.getItem(PREFIX + key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }

  function set(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) {}
  }

  function remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  }

  /* Solves are stored per puzzle type. Each solve:
     { time: ms, scramble: "...", date: epoch, penalty: null|"+2"|"DNF" } */
  function solves(puzzle) { return get("solves." + puzzle, []); }

  function addSolve(puzzle, solve) {
    var all = solves(puzzle);
    all.push(solve);
    set("solves." + puzzle, all);
    return all;
  }

  function removeSolve(puzzle, index) {
    var all = solves(puzzle);
    if (index >= 0 && index < all.length) {
      all.splice(index, 1);
      set("solves." + puzzle, all);
    }
    return all;
  }

  function updateSolve(puzzle, index, updates) {
    var all = solves(puzzle);
    if (index >= 0 && index < all.length) {
      for (var k in updates) all[index][k] = updates[k];
      set("solves." + puzzle, all);
    }
    return all;
  }

  function clearSolves(puzzle) { set("solves." + puzzle, []); }

  return {
    get: get,
    set: set,
    remove: remove,
    solves: solves,
    addSolve: addSolve,
    removeSolve: removeSolve,
    updateSolve: updateSolve,
    clearSolves: clearSolves
  };
})();
