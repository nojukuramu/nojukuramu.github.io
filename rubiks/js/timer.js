/* Rubiks — the core timer
   Space or touch to arm, release to start, press again to stop.
   States: idle -> holding -> ready -> running -> stopped -> idle */
"use strict";

var RK = RK || {};

RK.timer = (function () {
  var HOLD_MS = 300;

  var state = "idle";
  var startTime = 0;
  var elapsed = 0;
  var holdTimeout = null;
  var rafId = null;
  var onTick = null;
  var onChange = null;

  function fire(st) {
    state = st;
    if (typeof onChange === "function") try { onChange(state, elapsed); } catch (e) {}
  }

  function tick() {
    if (state !== "running") return;
    elapsed = performance.now() - startTime;
    if (typeof onTick === "function") try { onTick(elapsed); } catch (e) {}
    rafId = requestAnimationFrame(tick);
  }

  function down() {
    if (state === "running") {
      elapsed = performance.now() - startTime;
      cancelAnimationFrame(rafId);
      fire("stopped");
      return;
    }
    if (state === "idle" || state === "stopped") {
      fire("holding");
      holdTimeout = setTimeout(function () {
        fire("ready");
      }, HOLD_MS);
    }
  }

  function up() {
    if (state === "holding") {
      clearTimeout(holdTimeout);
      fire("idle");
      return;
    }
    if (state === "ready") {
      startTime = performance.now();
      elapsed = 0;
      fire("running");
      rafId = requestAnimationFrame(tick);
    }
  }

  function reset() {
    clearTimeout(holdTimeout);
    cancelAnimationFrame(rafId);
    elapsed = 0;
    state = "idle";
  }

  return {
    down: down,
    up: up,
    reset: reset,
    state: function () { return state; },
    elapsed: function () { return elapsed; },
    setIdle: function () { state = "idle"; },
    onTick: function (fn) { onTick = fn; },
    onChange: function (fn) { onChange = fn; }
  };
})();
