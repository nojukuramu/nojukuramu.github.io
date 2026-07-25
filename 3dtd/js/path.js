/* ============================================================
   VELL — flow-field pathing (Dijkstra from the Heartspore)
   ============================================================ */
(function (TD) {
  'use strict';

  var path = TD.path = {};
  var N, SIZE;
  var INF = 1e9;
  var dist, next, scratch, scratchNext;
  var heapV, heapK, heapN;

  var DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]
  ];

  function heapInit(cap) {
    heapV = new Int32Array(cap); heapK = new Float32Array(cap); heapN = 0;
  }
  function heapPush(v, k) {
    var i = heapN++;
    heapV[i] = v; heapK[i] = k;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (heapK[p] <= heapK[i]) break;
      var tv = heapV[p], tk = heapK[p];
      heapV[p] = heapV[i]; heapK[p] = heapK[i];
      heapV[i] = tv; heapK[i] = tk;
      i = p;
    }
  }
  function heapPop() {
    var top = heapV[0];
    heapN--;
    if (heapN > 0) {
      heapV[0] = heapV[heapN]; heapK[0] = heapK[heapN];
      var i = 0;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, s = i;
        if (l < heapN && heapK[l] < heapK[s]) s = l;
        if (r < heapN && heapK[r] < heapK[s]) s = r;
        if (s === i) break;
        var tv = heapV[s], tk = heapK[s];
        heapV[s] = heapV[i]; heapK[s] = heapK[i];
        heapV[i] = tv; heapK[i] = tk;
        i = s;
      }
    }
    return top;
  }

  path.init = function () {
    N = TD.GRID; SIZE = N * N;
    dist = new Float32Array(SIZE);
    next = new Int32Array(SIZE);
    scratch = new Float32Array(SIZE);
    scratchNext = new Int32Array(SIZE);
    heapInit(SIZE * 8);
    path.dist = dist; path.next = next;
  };

  /* Dijkstra outward from the base. blockIdx (optional) is treated as solid. */
  function compute(outDist, outNext, blockIdx, extraBlocked) {
    var i;
    for (i = 0; i < SIZE; i++) { outDist[i] = INF; outNext[i] = -1; }
    heapN = 0;

    var b = TD.terrain.base;
    for (var dz = -1; dz <= 1; dz++) {
      for (var dx = -1; dx <= 1; dx++) {
        var bx = b.x + dx, bz = b.z + dz;
        if (!TD.inBounds(bx, bz)) continue;
        var bi = TD.idx(bx, bz);
        outDist[bi] = 0;
        heapPush(bi, 0);
      }
    }

    while (heapN > 0) {
      var cur = heapPop();
      var cd = outDist[cur];
      var cx = cur % N, cz = (cur / N) | 0;
      for (var d = 0; d < 8; d++) {
        var nx = cx + DIRS[d][0], nz = cz + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        var ni = TD.idx(nx, nz);
        if (ni === blockIdx) continue;
        if (extraBlocked && extraBlocked[ni]) continue;
        if (!TD.isWalkable(nx, nz)) continue;
        if (DIRS[d][2] > 1.1) {
          // no cutting corners through solid geometry
          if (!TD.isWalkable(cx + DIRS[d][0], cz) || !TD.isWalkable(cx, cz + DIRS[d][1])) continue;
          var ai = TD.idx(cx + DIRS[d][0], cz), bi2 = TD.idx(cx, cz + DIRS[d][1]);
          if (ai === blockIdx || bi2 === blockIdx) continue;
          if (extraBlocked && (extraBlocked[ai] || extraBlocked[bi2])) continue;
        }
        var nd = cd + DIRS[d][2] * TD.moveCost(nx, nz);
        if (nd < outDist[ni] - 1e-4) {
          outDist[ni] = nd;
          outNext[ni] = cur;
          heapPush(ni, nd);
        }
      }
    }
  }

  path.rebuild = function () {
    compute(dist, next, -1, null);
    return path.allReachable(dist);
  };

  path.allReachable = function (d) {
    var sp = TD.terrain.spawns;
    for (var s = 0; s < sp.length; s++) {
      if (d[TD.idx(sp[s].x, sp[s].z)] >= INF) return false;
    }
    return true;
  };

  /* Would blocking these cells trap anyone? cells = array of indices */
  path.wouldBlock = function (cells, enemyCells) {
    var mask = path._mask || (path._mask = new Uint8Array(SIZE));
    mask.fill(0);
    var i;
    for (i = 0; i < cells.length; i++) mask[cells[i]] = 1;
    compute(scratch, scratchNext, -1, mask);
    if (!path.allReachable(scratch)) return true;
    if (enemyCells) {
      for (i = 0; i < enemyCells.length; i++) {
        var ci = enemyCells[i];
        if (ci < 0 || ci >= SIZE) continue;
        if (mask[ci]) return true;              // do not bury the living
        if (scratch[ci] >= INF) return true;
      }
    }
    return false;
  };

  path.distAt = function (x, z) {
    if (!TD.inBounds(x, z)) return INF;
    return dist[TD.idx(x, z)];
  };

  /* the cell an enemy standing on (x,z) should walk to next */
  path.nextCell = function (x, z) {
    if (!TD.inBounds(x, z)) return -1;
    var i = TD.idx(x, z);
    if (dist[i] >= INF) {
      // stuck: fall back to the best walkable neighbour
      var best = -1, bd = INF;
      for (var d = 0; d < 8; d++) {
        var nx = x + DIRS[d][0], nz = z + DIRS[d][1];
        if (!TD.inBounds(nx, nz)) continue;
        var ni = TD.idx(nx, nz);
        if (dist[ni] < bd) { bd = dist[ni]; best = ni; }
      }
      return best;
    }
    return next[i];
  };

  /* A* used once at world-gen to reserve prop-free corridors */
  path.reserveCorridors = function () {
    var reserved = new Uint8Array(SIZE);
    var b = TD.terrain.base;
    var sp = TD.terrain.spawns;
    compute(dist, next, -1, null); // props not placed yet
    for (var s = 0; s < sp.length; s++) {
      var cur = TD.idx(sp[s].x, sp[s].z);
      var guard = 0;
      while (cur >= 0 && guard++ < SIZE) {
        var cx = cur % N, cz = (cur / N) | 0;
        for (var dz = -1; dz <= 1; dz++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (TD.inBounds(cx + dx, cz + dz)) reserved[TD.idx(cx + dx, cz + dz)] = 1;
          }
        }
        if (cx === b.x && cz === b.z) break;
        cur = next[cur];
      }
    }
    // keep the heart's clearing open
    for (var z = 0; z < N; z++) {
      for (var x = 0; x < N; x++) {
        var ddx = x - b.x, ddz = z - b.z;
        if (ddx * ddx + ddz * ddz < 36) reserved[TD.idx(x, z)] = 1;
      }
    }
    path.reserved = reserved;
    return reserved;
  };

})(window.TD);
