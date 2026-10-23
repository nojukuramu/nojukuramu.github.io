/* Rubiks — the core timer
 *
 * down() and up() are the only inputs; keyboard, touch and mouse all reduce
 * to them, so the state machine is the same whatever the solver presses.
 *
 *   idle --down/up--> inspecting           (only with inspection on)
 *   idle|inspecting --down--> holding --hold--> ready --up--> running
 *   holding --up (too early)--> back where it came from
 *   running --down--> stopped
 *
 * WCA inspection is 15 seconds. Starting between 15 and 17 is +2, after 17
 * is DNF; the solve reports which, and the app records it. */
"use strict";

var RK = RK || {};

RK.timer = (function () {
  var cfg = { holdMs: 300, inspection: false };

  var state = "idle";
  var startTime = 0, elapsed = 0;
  var inspStart = 0, inspPenalty = null, alerted = {};
  var holdTimeout = null, rafId = null;
  var armInspect = false;
  var handlers = { tick: null, change: null, inspect: null, alert: null };

  function call(name, a, b) {
    if (typeof handlers[name] === "function") try { handlers[name](a, b); } catch (e) {}
  }

  function fire(st) {
    state = st;
    call("change", state, elapsed);
  }

  function inspecting() { return inspStart > 0; }

  function loop() {
    var now = performance.now();
    if (state === "running") {
      elapsed = now - startTime;
      call("tick", elapsed);
    } else if (inspecting()) {
      var e = now - inspStart;
      [8, 12].forEach(function (s) {
        if (e >= s * 1000 && !alerted[s]) { alerted[s] = true; call("alert", s); }
      });
      call("inspect", e);
    } else { rafId = null; return; }
    rafId = requestAnimationFrame(loop);
  }

  function startLoop() { if (!rafId) rafId = requestAnimationFrame(loop); }

  function arm() {
    fire("holding");
    clearTimeout(holdTimeout);
    if (cfg.holdMs <= 0) { fire("ready"); return; }
    holdTimeout = setTimeout(function () { if (state === "holding") fire("ready"); }, cfg.holdMs);
  }

  function down() {
    if (state === "running") {
      elapsed = performance.now() - startTime;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      fire("stopped");
      return;
    }
    if (state === "idle" || state === "stopped") {
      if (cfg.inspection) { armInspect = true; return; }
      arm();
      return;
    }
    if (state === "inspecting") arm();
  }

  function up() {
    if (armInspect) {
      armInspect = false;
      inspStart = performance.now();
      alerted = {};
      fire("inspecting");
      startLoop();
      return;
    }
    if (state === "holding") {
      clearTimeout(holdTimeout);
      fire(inspecting() ? "inspecting" : "idle");
      return;
    }
    if (state === "ready") {
      var now = performance.now();
      inspPenalty = null;
      if (inspecting()) {
        var e = now - inspStart;
        inspPenalty = e > 17000 ? "DNF" : e > 15000 ? "+2" : null;
        inspStart = 0;
      }
      startTime = now;
      elapsed = 0;
      fire("running");
      startLoop();
    }
  }

  /* Abandon whatever is in progress: arming, inspection, or a running solve. */
  function cancel() {
    clearTimeout(holdTimeout);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    armInspect = false;
    inspStart = 0;
    elapsed = 0;
    fire("idle");
  }

  /* A press that ends without a release: the window lost focus, or the
     browser took the touch for a scroll. Starting the clock then would time
     nothing, so step back instead. */
  function disarm() {
    armInspect = false;
    if (state !== "holding" && state !== "ready") return;
    clearTimeout(holdTimeout);
    fire(inspecting() ? "inspecting" : "idle");
  }

  return {
    down: down,
    up: up,
    cancel: cancel,
    disarm: disarm,
    configure: function (c) { for (var k in c) cfg[k] = c[k]; },
    state: function () { return state; },
    inspPenalty: function () { return inspPenalty; },
    inspecting: inspecting,
    /* Anything but idle/stopped means a solve is under way and the rest of
       the interface should stay out of reach. */
    busy: function () { return armInspect || !(state === "idle" || state === "stopped"); },
    onTick: function (fn) { handlers.tick = fn; },
    onChange: function (fn) { handlers.change = fn; },
    onInspect: function (fn) { handlers.inspect = fn; },
    onAlert: function (fn) { handlers.alert = fn; }
  };
})();
