/* economy.js
 * Normal-mode budget/tax/RCI simulation. In Creative mode this module still
 * computes population/happiness/demand numbers (so the HUD and the growth
 * simulation in buildings.js keep working identically) but skips every
 * money deduction — `spend()` always succeeds and `budget` reports Infinity.
 */
(function (global) {
  "use strict";
  var util = Game.util;

  var Economy = {
    budget: 20000,
    taxRate: 0.09,
    population: 0,
    jobs: 0,
    happiness: 72,
    demand: { residential: 55, commercial: 45, industrial: 40 },
    tickAccumulator: 0,
    incomeLastTick: 0,
    expensesLastTick: 0,

    init: function (saved) {
      if (saved) Object.assign(this, saved);
      return this;
    },

    setTaxRate: function (r) { this.taxRate = util.clamp(r, 0.02, 0.25); },

    spend: function (amount, label) {
      if (Game.mode === "creative") return true;
      if (this.budget < amount) {
        if (Game.UI) Game.UI.toast("Not enough budget for " + (label || "this"));
        return false;
      }
      this.budget -= amount;
      return true;
    },

    onBuildingGrown: function () { /* hook for future land-value effects */ },

    update: function (dt) {
      var stats = Game.Buildings.getStats();
      this.population = Math.round(stats.resCap);
      this.jobs = Math.round(stats.comCap + stats.indCap);

      var jobBalance = this.jobs - this.population;
      var pollution = stats.indCap * 0.02;
      var taxDrag = (this.taxRate - 0.09) * 220;

      this.demand.residential = util.clamp(52 + jobBalance * 0.35 - taxDrag - pollution * 0.4 + Math.sin(performance.now() * 0.00005) * 4, 0, 100);
      this.demand.commercial = util.clamp(48 + this.population * 0.06 - stats.comCap * 0.08 - taxDrag * 0.7, 0, 100);
      this.demand.industrial = util.clamp(50 + stats.comCap * 0.05 - stats.indCap * 0.07 - taxDrag * 0.5, 0, 100);

      var trafficLoad = util.clamp((Game.Traffic ? Game.Traffic.activePositions.length : 0) / Math.max(6, QualityManager.settings.vehicleCount), 0, 1);
      var coverageScore = Game.Buildings.services.length ? Math.min(1, Game.Buildings.services.length / 4) : 0;
      this.happiness = util.clamp(58 + coverageScore * 22 - pollution * 0.5 - trafficLoad * 12 - taxDrag * 0.8 + (Game.Weather.rainIntensity > 0.5 ? -4 : 0), 5, 99);

      if (Game.mode === "normal") {
        this.tickAccumulator += dt * Game.timeScale;
        if (this.tickAccumulator >= 3) {
          this.tickAccumulator = 0;
          var income = this.population * this.taxRate * 0.6 + this.jobs * this.taxRate * 0.4;
          var expenses = Game.Buildings.services.length * 12 + Game.Roads.edges.length * 1.4;
          this.incomeLastTick = income; this.expensesLastTick = expenses;
          this.budget += income - expenses;
        }
      }
    },

    getSaveState: function () {
      return {
        budget: this.budget, taxRate: this.taxRate, population: this.population,
        jobs: this.jobs, happiness: this.happiness, demand: this.demand
      };
    },

    loadSaveState: function (s) {
      if (!s) return;
      this.budget = s.budget != null ? s.budget : this.budget;
      this.taxRate = s.taxRate != null ? s.taxRate : this.taxRate;
      this.happiness = s.happiness != null ? s.happiness : this.happiness;
      if (s.demand) this.demand = s.demand;
    }
  };

  Game.Economy = Economy;
})(window);
