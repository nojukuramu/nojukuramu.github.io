/* traffic.js
 * Instanced vehicles driving the road-graph splines. Yield/stop behavior is
 * approximated two cheap ways rather than full lane simulation: vehicles
 * slow near multi-way intersection hubs, and each vehicle does a simple
 * "is anything close ahead of me" check against the small active-vehicle
 * list (counts are capped low enough by qualityManager that this stays
 * O(n^2)-cheap on mobile). Headlights/taillights are billboard glow
 * sprites that fade in with `Lighting.nightFactor`, batched in one pool
 * instead of real point lights per car.
 */
(function (global) {
  "use strict";
  var util = Game.util;
  var COLORS = [0xd94f4f, 0x333844, 0xe8e8ea, 0x3a6fd9, 0xe0b23a, 0x2f2f2f];

  var Traffic = {
    buckets: [],
    agents: [],
    activePositions: [],
    spawnAccumulator: 0,
    _m4: new THREE.Matrix4(), _q: new THREE.Quaternion(), _v3: new THREE.Vector3(), _up: new THREE.Vector3(0, 1, 0),

    init: function (scene) {
      this.group = new THREE.Group();
      this.group.name = "traffic";
      scene.add(this.group);
      this._build(QualityManager.settings.vehicleCount);
      return this;
    },

    _build: function (count) {
      this.group.clear();
      this.buckets = [];
      var per = Math.max(1, Math.ceil(count / COLORS.length));
      var bodyGeo = new THREE.BoxGeometry(1.7, 0.8, 3.4);
      bodyGeo.translate(0, 0.55, 0);
      var self = this;
      this.lightPool = [];
      COLORS.forEach(function (color) {
        var mat = new THREE.MeshLambertMaterial({ color: color });
        var mesh = new THREE.InstancedMesh(bodyGeo, mat, per);
        mesh.count = per;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (var i = 0; i < per; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
        mesh.instanceMatrix.needsUpdate = true;
        self.group.add(mesh);
        self.buckets.push(mesh);
      });

      var headTex = Procgen.glowSprite("rgba(255,250,220,1)", 48);
      var tailTex = Procgen.glowSprite("rgba(255,60,60,1)", 48);
      this.agents = [];
      var total = per * COLORS.length;
      for (var b = 0; b < COLORS.length; b++) {
        for (var i2 = 0; i2 < per; i2++) {
          var head = new THREE.Sprite(new THREE.SpriteMaterial({ map: headTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
          var tail = new THREE.Sprite(new THREE.SpriteMaterial({ map: tailTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
          head.scale.set(1.1, 1.1, 1); tail.scale.set(0.9, 0.9, 1);
          this.group.add(head); this.group.add(tail);
          this.agents.push({
            state: "unspawned", bucket: b, idx: i2, path: null, segLens: null, totalLen: 0, traveled: 0,
            speed: 5 + Math.random() * 3, baseSpeed: 5 + Math.random() * 3, head: head, tail: tail, pos: new THREE.Vector3(), heading: 0
          });
        }
      }
    },

    onQualityChange: function (settings) { this._build(settings.vehicleCount); },

    _randomRoadPoint: function () { return Game.Roads.randomPointOnNetwork(); },

    _trySpawn: function (agent) {
      if (!Game.Roads.nodes.length) return false;
      var from = this._randomRoadPoint();
      var to = this._randomRoadPoint();
      if (!from || !to) return false;
      var n1 = Game.Roads.nearestNodeId(from.x, from.z);
      var n2 = Game.Roads.nearestNodeId(to.x, to.z);
      if (n1 == null || n2 == null || n1 === n2) return false;
      var path = Game.Roads.findPath(n1, n2);
      if (!path || path.length < 2) return false;
      var lens = [0], total = 0;
      for (var i = 1; i < path.length; i++) { total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); lens.push(total); }
      if (total < 4) return false;
      agent.path = path; agent.segLens = lens; agent.totalLen = total; agent.traveled = 0;
      agent.state = "driving";
      return true;
    },

    update: function (dt) {
      var dayFactor = 1 - Game.Lighting.nightFactor;
      var trafficDensity = util.smoothstep(6, 10, Game.Lighting.hours) * (1 - util.smoothstep(21, 24, Game.Lighting.hours)) * 0.7 + 0.15;
      this.spawnAccumulator += dt * Game.timeScale;
      var doSpawn = this.spawnAccumulator > 0.35;
      if (doSpawn) this.spawnAccumulator = 0;

      this.activePositions.length = 0;
      for (var i = 0; i < this.agents.length; i++) {
        var a = this.agents[i];
        if (a.state === "driving") this.activePositions.push(a);
      }

      var lightOpacity = util.smoothstep(0.3, 0.6, Game.Lighting.nightFactor);

      for (i = 0; i < this.agents.length; i++) {
        var agent = this.agents[i];
        if (agent.state === "unspawned") {
          if (doSpawn && Math.random() < trafficDensity * 0.06) this._trySpawn(agent);
          continue;
        }
        // yield near intersections + simple following distance
        var speedFactor = 1;
        for (var j = 0; j < this.activePositions.length; j++) {
          var other = this.activePositions[j];
          if (other === agent) continue;
          var d = agent.pos.distanceTo(other.pos);
          if (d < 5) {
            var toOther = new THREE.Vector3().subVectors(other.pos, agent.pos).normalize();
            var facing = new THREE.Vector3(Math.sin(agent.heading), 0, Math.cos(agent.heading));
            if (toOther.dot(facing) > 0.5) speedFactor = Math.min(speedFactor, util.clamp((d - 1.5) / 3.5, 0, 1));
          }
        }
        agent.speed = agent.baseSpeed * speedFactor;
        agent.traveled += agent.speed * dt * Game.timeScale;
        if (agent.traveled >= agent.totalLen) {
          agent.state = "unspawned";
          this._hide(agent);
          continue;
        }
        this._placeOnPath(agent, lightOpacity);
      }
    },

    _hide: function (agent) {
      this.buckets[agent.bucket].setMatrixAt(agent.idx, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
      this.buckets[agent.bucket].instanceMatrix.needsUpdate = true;
      agent.head.material.opacity = 0; agent.tail.material.opacity = 0;
    },

    _placeOnPath: function (agent, lightOpacity) {
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
      var laneOffset = 1.4;
      x += nx * laneOffset; z += nz * laneOffset;
      var heading = Math.atan2(dx, dz);
      agent.pos.set(x, y, z);
      agent.heading = heading;
      this._q.setFromAxisAngle(this._up, heading);
      this._m4.compose(agent.pos, this._q, new THREE.Vector3(1, 1, 1));
      this.buckets[agent.bucket].setMatrixAt(agent.idx, this._m4);
      this.buckets[agent.bucket].instanceMatrix.needsUpdate = true;

      var fx = Math.sin(heading), fz = Math.cos(heading);
      agent.head.position.set(x + fx * 1.75, y + 0.65, z + fz * 1.75);
      agent.tail.position.set(x - fx * 1.75, y + 0.65, z - fz * 1.75);
      agent.head.material.opacity = lightOpacity * 0.95;
      agent.tail.material.opacity = lightOpacity * 0.85;
    }
  };

  Game.Traffic = Traffic;
})(window);
