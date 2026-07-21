/* citizens.js
 * A small animated sample of pedestrians that walk the road network between
 * residential and workplace buildings — a *visual* population sample, not
 * the actual population count (that's `resCap` from buildings.js, since a
 * real city's population vastly outnumbers what's cheap to render). Agents
 * are pooled: every slot in the InstancedMesh buckets always exists, and
 * "despawned" agents are just scaled to zero — no per-frame allocation, no
 * dynamic buffer resizing while walking.
 */
(function (global) {
  "use strict";
  var util = Game.util;
  var COLORS = [0xd94f4f, 0x4f8ad9, 0xe0b23a, 0x6fcf7a, 0xaf6fd9];

  var Citizens = {
    buckets: [],
    agents: [],
    spawnAccumulator: 0,
    _m4: new THREE.Matrix4(),
    _q: new THREE.Quaternion(),
    _v3: new THREE.Vector3(),
    _up: new THREE.Vector3(0, 1, 0),
    _zeroScale: new THREE.Vector3(0.0001, 0.0001, 0.0001),

    init: function (scene) {
      this.group = new THREE.Group();
      this.group.name = "citizens";
      scene.add(this.group);
      this._build(QualityManager.settings.citizenCount);
      return this;
    },

    _build: function (count) {
      this.group.clear();
      this.buckets = [];
      var per = Math.max(1, Math.ceil(count / COLORS.length));
      var geo = new THREE.BoxGeometry(0.5, 1.5, 0.32);
      geo.translate(0, 0.75, 0);
      var self = this;
      COLORS.forEach(function (color) {
        var mat = new THREE.MeshLambertMaterial({ color: color });
        var mesh = new THREE.InstancedMesh(geo, mat, per);
        mesh.count = per;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (var i = 0; i < per; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
        mesh.instanceMatrix.needsUpdate = true;
        self.group.add(mesh);
        self.buckets.push(mesh);
      });

      this.agents = [];
      for (var b = 0; b < this.buckets.length; b++) {
        for (var i2 = 0; i2 < per; i2++) {
          this.agents.push({ state: "unspawned", bucket: b, idx: i2, path: null, segLens: null, totalLen: 0, traveled: 0, speed: 1.6 + Math.random() * 0.8, dwell: Math.random() * 6, side: Math.random() < 0.5 ? 1 : -1, goingToWork: true });
        }
      }
    },

    onQualityChange: function (settings) { this._build(settings.citizenCount); },

    _buildPath: function (fromXZ, toXZ) {
      var Roads = Game.Roads;
      var n1 = Roads.nearestNodeId(fromXZ.x, fromXZ.z);
      var n2 = Roads.nearestNodeId(toXZ.x, toXZ.z);
      if (n1 == null || n2 == null) return null;
      var pts = Roads.findPath(n1, n2);
      if (!pts || pts.length < 2) return null;
      return pts;
    },

    _computeSegLens: function (path) {
      var lens = [0], total = 0;
      for (var i = 1; i < path.length; i++) {
        total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
        lens.push(total);
      }
      return { lens: lens, total: total };
    },

    _trySpawn: function (agent) {
      var resList = Game.Buildings.getResidentialBuildings();
      var workList = Game.Buildings.getWorkplaceBuildings();
      if (!resList.length || !workList.length) return false;
      var home = resList[Math.floor(Math.random() * resList.length)];
      var work = workList[Math.floor(Math.random() * workList.length)];
      var path = this._buildPath(home, work);
      if (!path) return false;
      var sl = this._computeSegLens(path);
      agent.path = path; agent.segLens = sl.lens; agent.totalLen = sl.total;
      agent.traveled = 0; agent.homeXZ = home; agent.workXZ = work;
      agent.goingToWork = true;
      agent.state = "walking";
      return true;
    },

    update: function (dt) {
      var hours = Game.Lighting.hours;
      var morningBias = util.smoothstep(5.5, 8.5, hours) * (1 - util.smoothstep(10, 12, hours));
      var eveningBias = util.smoothstep(15.5, 18, hours) * (1 - util.smoothstep(19.5, 22, hours));
      var baseChance = 0.02 + morningBias * 0.5 + eveningBias * 0.5;

      this.spawnAccumulator += dt * Game.timeScale;
      var doSpawnPass = this.spawnAccumulator > 0.4;
      if (doSpawnPass) this.spawnAccumulator = 0;

      for (var i = 0; i < this.agents.length; i++) {
        var agent = this.agents[i];
        if (agent.state === "unspawned") {
          if (doSpawnPass && Math.random() < baseChance) this._trySpawn(agent);
          continue;
        }
        if (agent.state === "dwelling") {
          agent.dwell -= dt * Game.timeScale;
          if (agent.dwell <= 0) {
            var dest = agent.goingToWork ? agent.workXZ : agent.homeXZ;
            var back = agent.goingToWork ? agent.homeXZ : agent.workXZ;
            var path = this._buildPath(dest, back);
            if (path) {
              var sl = this._computeSegLens(path);
              agent.path = path; agent.segLens = sl.lens; agent.totalLen = sl.total; agent.traveled = 0;
              agent.goingToWork = !agent.goingToWork;
              agent.state = "walking";
            } else { agent.state = "unspawned"; this._hide(agent); }
          }
          continue;
        }
        if (agent.state === "walking") {
          agent.traveled += agent.speed * dt * Game.timeScale;
          if (agent.traveled >= agent.totalLen) {
            agent.state = "dwelling";
            agent.dwell = 8 + Math.random() * 30;
            this._hide(agent);
            continue;
          }
          this._placeOnPath(agent);
        }
      }
    },

    _hide: function (agent) {
      this.buckets[agent.bucket].setMatrixAt(agent.idx, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
      this.buckets[agent.bucket].instanceMatrix.needsUpdate = true;
    },

    _placeOnPath: function (agent) {
      var lens = agent.segLens, path = agent.path;
      var t = agent.traveled;
      var segIdx = 0;
      for (var i = 0; i < lens.length - 1; i++) { if (lens[i + 1] >= t) { segIdx = i; break; } segIdx = i; }
      var segLen = lens[segIdx + 1] - lens[segIdx] || 1;
      var localT = util.clamp((t - lens[segIdx]) / segLen, 0, 1);
      var a = path[segIdx], b = path[segIdx + 1] || a;
      var x = util.lerp(a.x, b.x, localT), z = util.lerp(a.z, b.z, localT), y = util.lerp(a.y, b.y, localT);
      var dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz) || 1;
      var nx = -dz / dl, nz = dx / dl;
      var offset = 2.2 * agent.side;
      x += nx * offset; z += nz * offset;
      var heading = Math.atan2(dx, dz);
      this._q.setFromAxisAngle(this._up, heading);
      this._v3.set(x, y, z);
      this._m4.compose(this._v3, this._q, new THREE.Vector3(1, 1, 1));
      this.buckets[agent.bucket].setMatrixAt(agent.idx, this._m4);
      this.buckets[agent.bucket].instanceMatrix.needsUpdate = true;
    }
  };

  Game.Citizens = Citizens;
})(window);
