/* ui.js
 * All DOM/HUD wiring. Game systems never touch the DOM directly — they
 * expose state (Game.Economy.budget, Game.Lighting.hours, ...) and this
 * module is the only thing that reads it into the page, and the only thing
 * that turns page interaction into calls back into the game systems.
 */
(function (global) {
  "use strict";
  var util = Game.util;

  var UI = {
    els: {},
    savePanelMode: "save",

    init: function () {
      var self = this;
      var byId = function (id) { return document.getElementById(id); };
      this.els = {
        boot: byId("boot-screen"), bootFill: byId("boot-progress-fill"), bootStatus: byId("boot-status"),
        modeSelect: byId("mode-select"), continueRow: byId("continue-row"), continueBtn: byId("continue-btn"),
        loadFromMenuBtn: byId("load-from-menu-btn"),
        hudTop: byId("hud-top"), budgetVal: byId("hud-budget-val"), popVal: byId("hud-pop-val"), happyVal: byId("hud-happy-val"),
        timeVal: byId("hud-time-val"), timeIcon: byId("hud-time-icon"), pauseBtn: byId("hud-pause-btn"), menuBtn: byId("hud-menu-btn"),
        demandMeter: byId("demand-meter"), demandRes: byId("demand-res"), demandCom: byId("demand-com"), demandInd: byId("demand-ind"),
        toolOptions: byId("tool-options"), toolbar: byId("toolbar"),
        drawer: byId("building-drawer"), drawerGrid: byId("building-drawer-grid"),
        pauseMenu: byId("pause-menu"), resumeBtn: byId("resume-btn"), saveBtn: byId("save-btn"), loadBtn: byId("load-btn"),
        settingsBtn: byId("settings-btn"), newgameBtn: byId("newgame-btn"),
        settingsPanel: byId("settings-panel"), settingsModeHint: byId("settings-mode-hint"), switchModeBtn: byId("switch-mode-btn"),
        qualitySelect: byId("quality-select"), weatherToggle: byId("weather-toggle"), daylengthRange: byId("daylength-range"),
        settingsClose: byId("settings-close-btn"),
        savePanel: byId("save-panel"), savePanelTitle: byId("save-panel-title"), saveSlots: byId("save-slots"),
        exportBtn: byId("export-save-btn"), importInput: byId("import-save-input"), savePanelClose: byId("save-panel-close-btn"),
        modeSwitchWarning: byId("mode-switch-warning"), confirmSwitch: byId("confirm-switch-btn"), cancelSwitch: byId("cancel-switch-btn"),
        toastContainer: byId("toast-container"), fps: byId("fps-counter"), body: document.body
      };

      this._wireModeSelect();
      this._wireHud();
      this._wireToolbar();
      this._wireBuildingDrawer();
      this._wirePauseMenu();
      this._wireSettings();
      this._wireSavePanel();
      this._buildToolOptionTemplates();
      return this;
    },

    setBootProgress: function (pct, status) {
      this.els.bootFill.style.width = util.clamp(pct, 0, 100) + "%";
      if (status) this.els.bootStatus.textContent = status;
    },
    hideBoot: function () { this.els.boot.classList.add("hidden"); },

    // ---------------- mode select ----------------
    _wireModeSelect: function () {
      var self = this;
      document.querySelectorAll(".mode-card").forEach(function (card) {
        card.addEventListener("click", function () { Game.startNewGame(card.dataset.mode); });
      });
      this.els.continueBtn.addEventListener("click", function () { Game.continueLatest(); });
      this.els.loadFromMenuBtn.addEventListener("click", function () { self.openSavePanel("load", true); });
    },

    async showModeSelect() {
      var slots = await Game.Save.listSlots();
      this.els.continueRow.classList.toggle("hidden", slots.length === 0);
      this._pregameSlotsAvailable = slots.length > 0;
      this.els.modeSelect.classList.remove("hidden");
      this.els.body.classList.add("pre-game");
    },
    hideModeSelect: function () {
      this.els.modeSelect.classList.add("hidden");
      this.els.body.classList.remove("pre-game");
    },

    enterGameUI: function () {
      this.els.hudTop.classList.remove("hidden");
      this.els.toolbar.classList.remove("hidden");
      this.els.demandMeter.classList.remove("hidden");
      this.setTool("select");
      this.els.settingsModeHint.textContent = Game.mode === "creative" ? "Creative — unlimited resources" : "Normal — full simulation";
      this.els.qualitySelect.value = QualityManager.userOverride || "auto";
      this.els.weatherToggle.checked = Game.Weather.enabled;
      this.els.daylengthRange.value = Game.Lighting.dayLengthMinutes;
    },

    // ---------------- HUD ----------------
    _wireHud: function () {
      var self = this;
      this.els.pauseBtn.addEventListener("click", function () {
        Game.paused = !Game.paused;
        self.els.pauseBtn.textContent = Game.paused ? "▶" : "⏸";
      });
      this.els.menuBtn.addEventListener("click", function () { self.openPauseMenu(); });
    },

    updateHud: function () {
      var econ = Game.Economy;
      if (Game.mode === "creative") this.els.budgetVal.textContent = "∞";
      else {
        this.els.budgetVal.textContent = util.formatMoney(econ.budget);
        this.els.budgetVal.classList.toggle("neg", econ.budget < 0);
      }
      this.els.popVal.textContent = econ.population.toLocaleString();
      this.els.happyVal.textContent = Math.round(econ.happiness) + "%";
      this.els.timeVal.textContent = util.formatTime(Game.Lighting.hours) + " · D" + Game.Lighting.day;
      var h = Game.Lighting.hours;
      this.els.timeIcon.textContent = (h > 6 && h < 18.5) ? "☀️" : (h > 5 && h <= 6 || h >= 18.5 && h < 19.5) ? "🌇" : "🌙";

      this.els.demandRes.style.width = econ.demand.residential + "%";
      this.els.demandCom.style.width = econ.demand.commercial + "%";
      this.els.demandInd.style.width = econ.demand.industrial + "%";
    },

    updateFps: function (fps) { this.els.fps.textContent = fps.toFixed(0) + " fps · " + QualityManager.tier; },

    // ---------------- toolbar + tool options ----------------
    _wireToolbar: function () {
      var self = this;
      document.querySelectorAll(".tool-btn").forEach(function (btn) {
        btn.addEventListener("click", function () { self.setTool(btn.dataset.tool); });
      });
    },

    setTool: function (tool) {
      Game.tool = tool;
      document.querySelectorAll(".tool-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.tool === tool); });
      Game.Input.onToolChanged();
      if (tool === "build") { this.els.drawer.classList.remove("hidden"); this.els.toolOptions.classList.add("hidden"); }
      else { this.els.drawer.classList.add("hidden"); this.renderToolOptions(tool); }
    },

    _buildToolOptionTemplates: function () {
      Game.terrainBrush = { mode: "raise", radius: 16, strength: 1 };
      Game.zoneType = "residential";
      Game.zoneBrushRadius = 10;
    },

    renderToolOptions: function (tool) {
      var el = this.els.toolOptions;
      var self = this;
      if (tool === "select" || tool === "bulldoze") {
        el.classList.add("hidden");
        el.innerHTML = "";
        return;
      }
      el.classList.remove("hidden");
      el.innerHTML = "";

      if (tool === "terrain") {
        el.appendChild(this._label("Terraform"));
        el.appendChild(this._optRow(["raise", "lower", "flatten", "smooth"], Game.terrainBrush.mode, function (v) { Game.terrainBrush.mode = v; }));
        el.appendChild(this._sliderRow("Radius", 6, 40, Game.terrainBrush.radius, function (v) { Game.terrainBrush.radius = v; }));
        el.appendChild(this._sliderRow("Strength", 0.2, 2, Game.terrainBrush.strength, function (v) { Game.terrainBrush.strength = v; }, 0.1));
      } else if (tool === "roads") {
        if (Game.Roads.curvePending) {
          el.appendChild(this._label("Adjust the curve, then confirm"));
          var row = document.createElement("div");
          var okBtn = document.createElement("button"); okBtn.className = "opt-btn active"; okBtn.textContent = "✓ Confirm";
          okBtn.addEventListener("click", function () { Game.Roads.confirmCurve(); self.renderToolOptions("roads"); });
          var cancelBtn = document.createElement("button"); cancelBtn.className = "opt-btn"; cancelBtn.textContent = "✕ Cancel";
          cancelBtn.addEventListener("click", function () { Game.Roads.cancelCurve(); self.renderToolOptions("roads"); });
          row.appendChild(okBtn); row.appendChild(cancelBtn);
          el.appendChild(row);
          return;
        }
        el.appendChild(this._label("Road type"));
        el.appendChild(this._optRow(["street", "avenue", "highway"], Game.Roads.curType, function (v) { Game.Roads.setType(v); }));
        el.appendChild(this._label("Shape"));
        el.appendChild(this._optRow(["straight", "curve"], Game.Roads.curveMode ? "curve" : "straight", function (v) { Game.Roads.setCurveMode(v === "curve"); }));
      } else if (tool === "zone") {
        el.appendChild(this._label("Zone type"));
        el.appendChild(this._optRow(["residential", "commercial", "industrial"], Game.zoneType, function (v) { Game.zoneType = v; }, { residential: "🏠 Res", commercial: "🏬 Com", industrial: "🏭 Ind" }));
        el.appendChild(this._sliderRow("Brush", 6, 24, Game.zoneBrushRadius, function (v) { Game.zoneBrushRadius = v; }));
      }
    },

    showCurveConfirm: function () { this.renderToolOptions("roads"); },

    _label: function (text) { var d = document.createElement("div"); d.className = "opt-label"; d.textContent = text; return d; },
    _optRow: function (values, active, onPick, labels) {
      var row = document.createElement("div");
      values.forEach(function (v) {
        var b = document.createElement("button");
        b.className = "opt-btn" + (v === active ? " active" : "");
        b.textContent = labels ? labels[v] : (v.charAt(0).toUpperCase() + v.slice(1));
        b.addEventListener("click", function () {
          row.querySelectorAll(".opt-btn").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          onPick(v);
        });
        row.appendChild(b);
      });
      return row;
    },
    _sliderRow: function (label, min, max, val, onChange, step) {
      var row = document.createElement("div");
      row.className = "opt-slider-row";
      var span = document.createElement("span"); span.textContent = label;
      var input = document.createElement("input");
      input.type = "range"; input.min = min; input.max = max; input.step = step || 1; input.value = val;
      input.addEventListener("input", function () { onChange(parseFloat(input.value)); });
      row.appendChild(span); row.appendChild(input);
      return row;
    },

    // ---------------- building drawer ----------------
    _wireBuildingDrawer: function () {
      var self = this;
      var grid = this.els.drawerGrid;
      Object.keys(Game.Buildings ? Game.Buildings.SERVICE_DEFS : {}).forEach(function () {});
    },
    populateBuildingDrawer: function () {
      var self = this;
      var grid = this.els.drawerGrid;
      grid.innerHTML = "";
      Object.keys(Game.Buildings.SERVICE_DEFS).forEach(function (type) {
        var def = Game.Buildings.SERVICE_DEFS[type];
        var item = document.createElement("div");
        item.className = "build-item";
        item.innerHTML = '<span class="bi-ico">' + def.ico + '</span><span class="bi-name">' + def.name + '</span><span class="bi-cost">' + (Game.mode === "creative" ? "free" : util.formatMoney(def.cost)) + '</span>';
        item.addEventListener("click", function () {
          Game.buildType = type;
          grid.querySelectorAll(".build-item").forEach(function (x) { x.classList.remove("active"); });
          item.classList.add("active");
        });
        grid.appendChild(item);
      });
    },

    // ---------------- pause menu ----------------
    _wirePauseMenu: function () {
      var self = this;
      this.els.resumeBtn.addEventListener("click", function () { self.closePauseMenu(); });
      this.els.saveBtn.addEventListener("click", function () { self.closePauseMenu(); self.openSavePanel("save", false); });
      this.els.loadBtn.addEventListener("click", function () { self.closePauseMenu(); self.openSavePanel("load", false); });
      this.els.settingsBtn.addEventListener("click", function () { self.closePauseMenu(); self.els.settingsPanel.classList.remove("hidden"); });
      this.els.newgameBtn.addEventListener("click", function () {
        if (confirm("Start a brand new city? Unsaved progress will be lost.")) { self.closePauseMenu(); Game.returnToModeSelect(); }
      });
    },
    openPauseMenu: function () { Game.paused = true; this.els.pauseMenu.classList.remove("hidden"); },
    closePauseMenu: function () { this.els.pauseMenu.classList.add("hidden"); Game.paused = false; this.els.pauseBtn.textContent = "⏸"; },

    // ---------------- settings ----------------
    _wireSettings: function () {
      var self = this;
      this.els.switchModeBtn.addEventListener("click", function () {
        if (Game.mode === "creative") { self.els.modeSwitchWarning.classList.remove("hidden"); }
        else { Game.mode = "creative"; self.els.settingsModeHint.textContent = "Creative — unlimited resources"; self.toast("Switched to Creative mode"); }
      });
      this.els.confirmSwitch.addEventListener("click", function () {
        Game.mode = "normal";
        self.els.settingsModeHint.textContent = "Normal — full simulation";
        self.els.modeSwitchWarning.classList.add("hidden");
        self.toast("Switched to Normal mode");
      });
      this.els.cancelSwitch.addEventListener("click", function () { self.els.modeSwitchWarning.classList.add("hidden"); });
      this.els.qualitySelect.addEventListener("change", function () { QualityManager.setOverride(self.els.qualitySelect.value); });
      this.els.weatherToggle.addEventListener("change", function () { Game.Weather.setEnabled(self.els.weatherToggle.checked); });
      this.els.daylengthRange.addEventListener("input", function () { Game.Lighting.setDayLength(parseFloat(self.els.daylengthRange.value)); });
      this.els.settingsClose.addEventListener("click", function () { self.els.settingsPanel.classList.add("hidden"); });
    },

    // ---------------- save panel ----------------
    _wireSavePanel: function () {
      var self = this;
      this.els.exportBtn.addEventListener("click", async function () {
        var slots = await Game.Save.listSlots();
        var best = slots[0];
        if (!best) { self.toast("Nothing to export yet"); return; }
        Game.Save.exportSlot(best);
      });
      this.els.importInput.addEventListener("change", async function () {
        var file = self.els.importInput.files[0];
        if (!file) return;
        try {
          var data = await Game.Save.importFile(file);
          Game.Save.applyCityData(data);
          self.els.savePanel.classList.add("hidden");
          self.toast("City imported");
        } catch (e) { self.toast("Import failed — invalid file"); }
        self.els.importInput.value = "";
      });
      this.els.savePanelClose.addEventListener("click", function () { self.els.savePanel.classList.add("hidden"); });
    },

    openSavePanel: async function (mode, pregame) {
      this.savePanelMode = mode;
      this.pregame = !!pregame;
      this.els.savePanelTitle.textContent = mode === "save" ? "Save City" : "Load City";
      this.els.savePanel.classList.remove("hidden");
      await this.refreshSaveSlots();
    },

    refreshSaveSlots: async function () {
      var self = this;
      var slots = await Game.Save.listSlots();
      var container = this.els.saveSlots;
      container.innerHTML = "";

      if (this.savePanelMode === "save") {
        var newRow = document.createElement("div");
        newRow.className = "save-slot";
        newRow.innerHTML = '<div class="save-slot-info"><div class="save-slot-name">+ New save</div><div class="save-slot-meta">Create a new named slot</div></div>';
        newRow.addEventListener("click", async function () {
          var name = prompt("Name this save:", "My City");
          if (!name) return;
          var thumb = Game.captureThumbnail();
          await Game.Save.saveToSlot("slot_" + Date.now(), name, thumb);
          self.toast("City saved");
          self.refreshSaveSlots();
        });
        container.appendChild(newRow);
      }

      slots.forEach(function (rec) {
        var row = document.createElement("div");
        row.className = "save-slot";
        var isAuto = rec.id === Game.Save.AUTOSAVE_ID;
        var thumb = rec.thumbnail ? '<img class="save-thumb" src="' + rec.thumbnail + '" alt="" />' : '<div class="save-thumb"></div>';
        row.innerHTML = thumb +
          '<div class="save-slot-info"><div class="save-slot-name">' + (isAuto ? "🔄 " : "") + rec.name + '</div>' +
          '<div class="save-slot-meta">' + new Date(rec.timestamp).toLocaleString() + '</div></div>' +
          (isAuto ? "" : '<button class="save-slot-del" aria-label="Delete">🗑</button>');
        row.addEventListener("click", async function (e) {
          if (e.target.classList.contains("save-slot-del")) return;
          if (self.savePanelMode === "load") {
            Game.Save.applyCityData(rec.data);
            self.els.savePanel.classList.add("hidden");
            if (self.pregame) { self.hideModeSelect(); Game.beginRunningState(); }
            self.toast("City loaded");
          } else {
            if (confirm('Overwrite "' + rec.name + '"?')) {
              var thumb2 = Game.captureThumbnail();
              await Game.Save.saveToSlot(rec.id, rec.name, thumb2);
              self.toast("City saved");
              self.refreshSaveSlots();
            }
          }
        });
        var del = row.querySelector(".save-slot-del");
        if (del) del.addEventListener("click", async function (e) {
          e.stopPropagation();
          if (confirm('Delete "' + rec.name + '"?')) { await Game.Save.deleteSlot(rec.id); self.refreshSaveSlots(); }
        });
        container.appendChild(row);
      });
    },

    // ---------------- toast ----------------
    toast: function (msg) {
      var t = document.createElement("div");
      t.className = "toast";
      t.textContent = msg;
      this.els.toastContainer.appendChild(t);
      setTimeout(function () { t.remove(); }, 2800);
    }
  };

  Game.UI = UI;
})(window);
