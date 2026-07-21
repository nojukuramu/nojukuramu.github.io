/* qualityManager.js
 * Detects a device tier once at boot, then keeps an eye on runtime FPS and
 * throttles effects if the frame rate sags. Every other module reads
 * QualityManager.settings instead of making its own perf decisions, so all
 * the mobile-scaling logic lives in one place.
 */
(function (global) {
  "use strict";

  var TIERS = {
    low: {
      name: "low",
      terrainSegments: 48,
      pixelRatioCap: 1.0,
      shadows: false,
      shadowMapSize: 512,
      drawDistance: 260,
      fogFar: 300,
      rainCount: 250,
      citizenCount: 40,
      vehicleCount: 20,
      streetLightEvery: 4,
      waterQuality: 0,
      treeCount: 60
    },
    mid: {
      name: "mid",
      terrainSegments: 80,
      pixelRatioCap: 1.5,
      shadows: true,
      shadowMapSize: 1024,
      drawDistance: 420,
      fogFar: 480,
      rainCount: 700,
      citizenCount: 90,
      vehicleCount: 45,
      streetLightEvery: 2,
      waterQuality: 1,
      treeCount: 140
    },
    high: {
      name: "high",
      terrainSegments: 128,
      pixelRatioCap: 2.0,
      shadows: true,
      shadowMapSize: 2048,
      drawDistance: 620,
      fogFar: 700,
      rainCount: 1600,
      citizenCount: 160,
      vehicleCount: 80,
      streetLightEvery: 1,
      waterQuality: 2,
      treeCount: 260
    }
  };

  function detectTier() {
    var cores = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || 4;
    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    var pixels = window.screen.width * window.screen.height * (window.devicePixelRatio || 1);
    var score = cores * 2 + mem;
    if (mobile) score -= 4;
    if (pixels > 3000000) score -= 2;

    if (score <= 6) return "low";
    if (score <= 12) return "mid";
    return "high";
  }

  var QualityManager = {
    tier: "mid",
    settings: null,
    userOverride: null, // 'low'|'mid'|'high'|null(auto)
    _fpsHistory: [],
    _lastStepTime: 0,
    _onChange: [],

    init: function () {
      this.tier = detectTier();
      this.settings = Object.assign({}, TIERS[this.tier]);
      return this.settings;
    },

    setOverride: function (tierOrAuto) {
      this.userOverride = tierOrAuto === "auto" ? null : tierOrAuto;
      var t = this.userOverride || detectTier();
      this.tier = t;
      this.settings = Object.assign({}, TIERS[t]);
      this._fire();
    },

    onChange: function (fn) { this._onChange.push(fn); },
    _fire: function () { this._onChange.forEach(function (fn) { fn(QualityManager.settings); }); },

    // Called once per second from main loop with the current fps.
    reportFPS: function (fps, nowMs) {
      if (this.userOverride) return; // manual quality, don't auto-adjust
      this._fpsHistory.push(fps);
      if (this._fpsHistory.length > 6) this._fpsHistory.shift();
      if (nowMs - this._lastStepTime < 4000) return;
      if (this._fpsHistory.length < 4) return;

      var avg = this._fpsHistory.reduce(function (a, b) { return a + b; }, 0) / this._fpsHistory.length;
      var order = ["low", "mid", "high"];
      var idx = order.indexOf(this.tier);

      if (avg < 24 && idx > 0) {
        this.tier = order[idx - 1];
        this.settings = Object.assign({}, TIERS[this.tier]);
        this._lastStepTime = nowMs;
        this._fpsHistory.length = 0;
        this._fire();
      } else if (avg > 55 && idx < order.length - 1) {
        this.tier = order[idx + 1];
        this.settings = Object.assign({}, TIERS[this.tier]);
        this._lastStepTime = nowMs;
        this._fpsHistory.length = 0;
        this._fire();
      }
    }
  };

  global.QualityManager = QualityManager;
})(window);
