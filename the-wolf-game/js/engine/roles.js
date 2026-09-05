/* roles.js — the role registry.
 *
 * Two halves that must agree. `data/list_of_roles.json` says what a role IS —
 * name, icon, team, the actions it may take and which doors those light up.
 * `js/roles/<id>.js` says what a role DOES — the code that runs when one of
 * those actions is performed, and the passives that fire around it.
 *
 * They are joined here, and the join is checked: a behaviour module for a role
 * the data has never heard of, or an action handler with no matching entry in
 * the data, throws at load. That is on purpose. The alternative is a role that
 * silently does nothing on the one night it mattered.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});

  var data = null;          // parsed list_of_roles.json
  var behaviours = {};      // id -> module
  var byId = {};            // id -> merged definition
  var order = [];

  /** Called by each js/roles/<id>.js at load. Order does not matter. */
  function define(id, mod) {
    if (behaviours[id]) throw new Error("[wg] role defined twice: " + id);
    behaviours[id] = mod || {};
  }

  /** Called once, after the JSON has landed and every module has run. */
  function link(json) {
    data = json;
    byId = {};
    order = [];
    json.roles.forEach(function (r) {
      var mod = behaviours[r.id];
      if (!mod) throw new Error("[wg] no behaviour module for role: " + r.id);
      var def = Object.assign({}, r);
      def.behaviour = mod;
      def.actionById = {};
      (r.actions || []).forEach(function (a) { def.actionById[a.id] = a; });

      // Every handler must correspond to a declared action, or the data and the
      // code have drifted and one of them is lying to the players.
      Object.keys(mod.actions || {}).forEach(function (aid) {
        if (!def.actionById[aid]) {
          throw new Error("[wg] " + r.id + " handles undeclared action '" + aid + "'");
        }
      });
      (r.actions || []).forEach(function (a) {
        if (!(mod.actions || {})[a.id] && !WG.roles.genericAction(a.id)) {
          throw new Error("[wg] " + r.id + " declares action '" + a.id + "' with nothing to run it");
        }
      });

      byId[r.id] = def;
      order.push(r.id);
    });

    Object.keys(behaviours).forEach(function (id) {
      if (!byId[id]) throw new Error("[wg] behaviour module for unknown role: " + id);
    });
    return byId;
  }

  /* Actions several roles share verbatim. A role may still override one by
   * declaring its own handler; the registry checks against both. */
  var generic = {};
  function defineGeneric(id, fn) { generic[id] = fn; }
  function genericAction(id) { return generic[id] || null; }

  function get(id) { return byId[id] || null; }
  function all() { return order.map(get); }
  function teamOf(id) { var r = byId[id]; return r ? r.team : "village"; }
  function isWolf(id) { return teamOf(id) === "werewolf"; }
  function isCult(id) { return teamOf(id) === "cult"; }

  /** The handler for one action on one role, generic fallback included. */
  function handler(roleId, actionId) {
    var r = byId[roleId];
    if (!r) return null;
    var own = (r.behaviour.actions || {})[actionId];
    return own || generic[actionId] || null;
  }

  /** Fire a passive hook on one role, if it has one. */
  function hook(roleId, name, ctx) {
    var r = byId[roleId];
    if (!r) return undefined;
    var fn = (r.behaviour.hooks || {})[name];
    return fn ? fn(ctx) : undefined;
  }

  /** Fire a hook on every role in play, in seat order. Used for board-wide
   *  passives (Diwata's curse, the Archangel's retribution) that care about
   *  something happening to somebody else. */
  function broadcastHook(state, name, ctx) {
    var out = [];
    state.players.forEach(function (p) {
      var r = byId[p.role];
      if (!r) return;
      var fn = (r.behaviour.hooks || {})[name];
      if (!fn) return;
      var res = fn(Object.assign({ self: p }, ctx));
      if (res) out.push(res);
    });
    return out;
  }

  /** The starting per-player state a role brings with it. Cloned, never shared. */
  function initialState(roleId) {
    var r = byId[roleId];
    return r ? JSON.parse(JSON.stringify(r.state || {})) : {};
  }

  /** The role an investigator sees, which is not always the role they have. */
  function apparentRole(state, player) {
    var r = byId[player.role];
    if (!r) return player.role;
    if (r.seenAs === "self.currentAppearance") return player.currentAppearance || "villager";
    if (r.seenAs) return r.seenAs;
    return player.role;
  }

  /** The leaders the Assassin is hunting, in the order the data lists them. */
  var LEADER_ROLES = ["alpha_wolf", "cult_leader", "mayor", "seer"];

  WG.roles = {
    define: define,
    defineGeneric: defineGeneric,
    genericAction: genericAction,
    link: link,
    get: get,
    all: all,
    teamOf: teamOf,
    isWolf: isWolf,
    isCult: isCult,
    handler: handler,
    hook: hook,
    broadcastHook: broadcastHook,
    initialState: initialState,
    apparentRole: apparentRole,
    LEADER_ROLES: LEADER_ROLES,
    get data() { return data; },
    get teams() { return (data && data.teams) || {}; },
    get universalActions() { return (data && data.universalActions) || []; }
  };
})(typeof window !== "undefined" ? window : globalThis);
