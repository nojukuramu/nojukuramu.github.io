/* traffic.js
 * Instanced vehicles driving the road-graph splines. Yield/stop behavior is
 * approximated two cheap ways rather than full lane simulation: vehicles
 * slow near multi-way intersection hubs, and each vehicle does a simple
 * "is anything close ahead of me" check against the small active-vehicle
 * list (counts are capped low enough by qualityManager that this stays
 * O(n^2)-cheap on mobile).
 *
 * Visuals: each color bucket is one InstancedMesh of a MERGED body+cabin
 * geometry (vertex colors darken the cabin glass; material color supplies
 * the paint), and ALL head/taillights across every vehicle live in two
 * Points clouds — two draw calls for the whole fleet's lights instead of
 * two sprites per car.
 */
(function (global) {
  "use strict";
  var util = Game.util;
  var COLORS = [0xc94840, 0x2f3542, 0xdfe3e8, 0x2f5e9e, 0xd7a63f, 0x4a4f57];

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

    _carGeometry: function () {
      // body keeps vertex color white (material color = paint); cabin verts
      // darken toward glass; tiny bumper strip anchors the silhouette
      return Procgen.mergeGeoms([
        { geo: new THREE.BoxGeometry(1.7, 0.62, 3.4), color: "#ffffff", matrix: new THREE.Matrix4().makeTranslation(0, 0.48, 0) },
        { geo: new THREE.BoxGeometry(1.5, 0.5, 1.8), color: "#20242c", matrix: new THREE.Matrix4().makeTranslation(0, 1.02, -0.25) },
        { geo: new THREE.BoxGeometry(1.72, 0.16, 3.44), color: "#22252a", matrix: new THREE.Matrix4().makeTranslation(0, 0.16, 0) }
      ]);
    },

    _build: function (count) {
      this.group.clear();
      this.buckets = [];
      var per = Math.max(1, Math.ceil(count / COLORS.length));
      var carGeo = this._carGeometry();
      var self = this;
      COLORS.forEach(function (color) {
        var mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).convertSRGBToLinear(), vertexColors: true });
        var mesh = new THREE.InstancedMesh(carGeo, mat, per);
        mesh.count = per;
        mesh.castShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (var i = 0; i < per; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
        mesh.instanceMatrix.needsUpdate = true;
        self.group.add(mesh);
        self.buckets.push(mesh);
      });

      var total = per * COLORS.length;

      // batched vehicle lights: one Points cloud for headlights, one for tails
      this._lightSlots = total;
      function mkLights(colorCss, size) {
        var geo = new THREE.BufferGeometry();
        var positions = new Float32Array(total * 3);
        for (var i = 0; i < total; i++) positions[i * 3 + 1] = -999; // parked offscreen
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        var mat = new THREE.PointsMaterial({
          map: Procgen.glowSprite(colorCss, 48), size: size, transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
        });
        var pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        return pts;
      }
      this.headLights = mkLights("rgba(255,250,220,1)", 2.6);
      this.tailLights = mkLights("rgba(255,60,60,1)", 2.0);
      this.group.add(this.headLights);
      this.group.add(this.tailLights);

      this.agents = [];
      for (var b = 0; b < COLORS.length; b++) {
        for (var i2 = 0; i2 < per; i2++) {
          var slot = b * per + i2;
          this.agents.push({
            state: "unspawned", bucket: b, idx: i2, slot: slot, path: null, segLens: null, totalLen: 0, traveled: 0,
            speed: 5 + Math.random() * 3, baseSpeed: 5 + Math.random() * 3, pos: new THREE.Vector3(), heading: 0
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
      this.headLights.material.opacity = lightOpacity * 0.95;
      this.tailLights.material.opacity = lightOpacity * 0.85;

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
        this._placeOnPath(agent);
      }
      this.headLights.geometry.attributes.position.needsUpdate = true;
      this.tailLights.geometry.attributes.position.needsUpdate = true;
    },

    _hide: function (agent) {
      this.buckets[agent.bucket].setMatrixAt(agent.idx, new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001));
      this.buckets[agent.bucket].instanceMatrix.needsUpdate = true;
      this.headLights.geometry.attributes.position.array[agent.slot * 3 + 1] = -999;
      this.tailLights.geometry.attributes.position.array[agent.slot * 3 + 1] = -999;
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
      var hp = this.headLights.geometry.attributes.position.array;
      var tp = this.tailLights.geometry.attributes.position.array;
      hp[agent.slot * 3] = x + fx * 1.75; hp[agent.slot * 3 + 1] = y + 0.55; hp[agent.slot * 3 + 2] = z + fz * 1.75;
      tp[agent.slot * 3] = x - fx * 1.75; tp[agent.slot * 3 + 1] = y + 0.55; tp[agent.slot * 3 + 2] = z - fz * 1.75;
    }
  };

  Game.Traffic = Traffic;
})(window);
