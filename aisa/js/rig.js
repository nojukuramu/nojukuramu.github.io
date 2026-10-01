/* ============================================================
   Aisa — the rig engine

   A Live2D-style puppet, built the way Cubism builds one but without
   Cubism. The artwork is cut into parts (art/atlas.png + art/parts.json,
   made by tools/cut.py), every part is a mesh over its piece of the atlas,
   and every frame each vertex is pushed through a chain of deformers that
   named parameters drive. Nothing in this file knows it is drawing Aisa:
   model.js says what the parameters are and what they do to which part.

   Why not Cubism itself: a .moc3 only comes out of the Cubism Editor, and
   the Cubism Core runtime is proprietary - not ours to vendor. What we keep
   from it is the vocabulary. The parameter ids are Cubism's standard set
   (ParamAngleX, ParamEyeLOpen, ParamMouthOpenY ...), so anything that
   already drives a Live2D model - a face tracker, a lip-sync meter - can
   drive this one with the same numbers.

   Why WebGL and not a 2D canvas: a mesh deformer needs a texture stretched
   across triangles that are not rectangles, which a 2D context cannot do
   without cutting every triangle out by hand.
   ============================================================ */
var AISA = AISA || {};

AISA.Rig = (function () {
  "use strict";

  var VS =
    "attribute vec2 aPos;" +
    "attribute vec2 aUV;" +
    "uniform vec4 uView;" +
    "uniform vec2 uOrigin;" +
    "varying vec2 vUV;" +
    "varying vec2 vPos;" +
    "void main() {" +
    "  vUV = aUV;" +
    "  vPos = aPos - uOrigin;" +
    "  gl_Position = vec4(aPos.x * uView.x + uView.z, aPos.y * uView.y + uView.w, 0.0, 1.0);" +
    "}";

  /* The clip is how an eye closes: the eyeball is cut away above the
     eyelid's lower edge (and, for a smile, below a rising lower edge), so
     the iris goes under the lash instead of being squashed. Edges are eight
     points each, x increasing, relative to uOrigin - small numbers, so
     mediump is enough on the phones that only have mediump. */
  var FS =
    "precision mediump float;" +
    "uniform sampler2D uTex;" +
    "uniform float uAlpha;" +
    "uniform float uClip;" +
    "uniform vec2 uTop[8];" +
    "uniform vec2 uBot[8];" +
    "varying vec2 vUV;" +
    "varying vec2 vPos;" +
    "float edge(float x, vec2 a, vec2 b, float cur) {" +
    "  if (x >= a.x && x <= b.x && b.x > a.x) return mix(a.y, b.y, (x - a.x) / (b.x - a.x));" +
    "  return cur;" +
    "}" +
    "void main() {" +
    "  vec4 c = texture2D(uTex, vUV) * uAlpha;" +
    "  if (uClip > 0.5) {" +
    "    float top = -1000.0, bot = 1000.0;" +
    "    for (int i = 0; i < 7; i++) {" +
    "      top = edge(vPos.x, uTop[i], uTop[i + 1], top);" +
    "      bot = edge(vPos.x, uBot[i], uBot[i + 1], bot);" +
    "    }" +
    "    c *= smoothstep(top - 0.25, top + 0.25, vPos.y) * (1.0 - smoothstep(bot - 0.25, bot + 0.25, vPos.y));" +
    "  }" +
    "  gl_FragColor = c;" +
    "}";

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function texture(gl, source) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    // premultiplied on upload, so bilinear filtering never drags the
    // colour of a transparent texel into an edge
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /* Which cells of a part's grid have anything in them, read once from the
     atlas: the hair mesh is a rectangle around a shape that is mostly air,
     and triangles over air are fill rate spent on nothing. */
  function coverage(img) {
    var c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    var g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    var data = g.getImageData(0, 0, c.width, c.height).data;
    return function (x0, y0, x1, y1) {
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(c.width, Math.ceil(x1)); y1 = Math.min(c.height, Math.ceil(y1));
      for (var y = y0; y < y1; y += 2)
        for (var x = x0; x < x1; x += 2)
          if (data[(y * c.width + x) * 4 + 3] > 2) return true;
      return false;
    };
  }

  /* A grid over [x, y, w, h] in model units, mapped onto [u0, v0, u1, v1]
     of a texture. `keep(i, j)` says whether cell (i, j) is drawn. */
  function grid(x, y, w, h, cell, uv, keep) {
    var nx = Math.max(1, Math.ceil(w / cell)), ny = Math.max(1, Math.ceil(h / cell));
    var pos = new Float32Array((nx + 1) * (ny + 1) * 2), tex = new Float32Array(pos.length);
    var k = 0;
    for (var j = 0; j <= ny; j++) {
      for (var i = 0; i <= nx; i++) {
        pos[k] = x + w * i / nx; pos[k + 1] = y + h * j / ny;
        tex[k] = uv[0] + (uv[2] - uv[0]) * i / nx; tex[k + 1] = uv[1] + (uv[3] - uv[1]) * j / ny;
        k += 2;
      }
    }
    var idx = [];
    for (j = 0; j < ny; j++) {
      for (i = 0; i < nx; i++) {
        if (keep && !keep(i, j, nx, ny)) continue;
        var a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    return { rest: pos, uv: tex, index: idx };
  }

  function Rig(canvas, model, atlas, meta) {
    var gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true }) ||
             canvas.getContext("experimental-webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;
    this.canvas = canvas;
    this.model = model;

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.loc = {
      pos: gl.getAttribLocation(prog, "aPos"), uv: gl.getAttribLocation(prog, "aUV"),
      view: gl.getUniformLocation(prog, "uView"), origin: gl.getUniformLocation(prog, "uOrigin"),
      alpha: gl.getUniformLocation(prog, "uAlpha"), clip: gl.getUniformLocation(prog, "uClip"),
      top: gl.getUniformLocation(prog, "uTop"), bot: gl.getUniformLocation(prog, "uBot"),
      tex: gl.getUniformLocation(prog, "uTex")
    };
    gl.uniform1i(this.loc.tex, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    var atlasTex = texture(gl, atlas);
    var covered = coverage(atlas);
    var parts = [], byId = {};
    var S = meta.scale, AW = meta.width, AH = meta.height;

    // ---- textured parts, cut from the atlas
    meta.order.forEach(function (id) {
      var m = meta.parts[id], cfg = model.parts[id] || {};
      var cell = cfg.cell || 5;
      var g = grid(m.x, m.y, m.w, m.h, cell,
        [m.u / AW, m.v / AH, (m.u + m.tw) / AW, (m.v + m.th) / AH],
        function (i, j, nx, ny) {
          var cw = m.tw / nx, ch = m.th / ny;
          return covered(m.u + i * cw - 2, m.v + j * ch - 2, m.u + (i + 1) * cw + 2, m.v + (j + 1) * ch + 2);
        });
      var p = { id: id, tex: atlasTex, rest: g.rest, uv: g.uv, index: g.index };
      parts.push(p); byId[id] = p;
    });

    // ---- drawn parts: textures the model paints itself (the mouth, a
    // blush), placed in model units and deformed like any other part
    var sprites = model.sprites || [];
    sprites.forEach(function (sp) {
      var c = document.createElement("canvas");
      c.width = Math.round(sp.w * sp.res); c.height = Math.round(sp.h * sp.res);
      var p = { id: sp.id, sprite: sp, canvas: c, ctx: c.getContext("2d"), tex: null, key: null };
      var g = grid(sp.x, sp.y, sp.w, sp.h, sp.cell || 4, [0, 0, 1, 1], null);
      p.rest = g.rest; p.uv = g.uv; p.index = g.index;
      parts.push(p); byId[sp.id] = p;
    });

    // ---- one buffer for every vertex; each part points into it
    var vcount = 0, icount = 0;
    parts.forEach(function (p) {
      p.vstart = vcount; p.vcount = p.rest.length / 2; vcount += p.vcount;
      p.istart = icount; p.icount = p.index.length; icount += p.icount;
    });
    var uvAll = new Float32Array(vcount * 2), idxAll = new Uint16Array(icount);
    this.pos = new Float32Array(vcount * 2);
    parts.forEach(function (p) {
      uvAll.set(p.uv, p.vstart * 2);
      idxAll.set(p.index, p.istart);
      p.out = this.pos.subarray(p.vstart * 2, (p.vstart + p.vcount) * 2);
    }, this);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos.byteLength, gl.DYNAMIC_DRAW);
    this.uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvAll, gl.STATIC_DRAW);
    this.idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxAll, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.loc.pos);
    gl.enableVertexAttribArray(this.loc.uv);

    this.parts = parts;
    this.byId = byId;
    this.view = { cx: model.frame.cx, cy: model.frame.cy, h: model.frame.h, zoom: 1, dx: 0, dy: 0 };
    this.background = null;
    this.stats = { vertices: vcount, triangles: icount / 3 };
  }

  Rig.prototype.resize = function () {
    var c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  };

  /* Model units to clip space: the model's frame fits the canvas height
     (or width, on a very narrow screen), centred, then zoomed and nudged
     by whoever embeds it. */
  Rig.prototype.viewUniform = function () {
    var c = this.canvas, v = this.view, f = this.model.frame;
    var s = Math.min(c.height / v.h, c.width / f.w) * v.zoom;
    var sx = 2 * s / c.width, sy = -2 * s / c.height;
    return [sx, sy, -(v.cx - v.dx) * sx, -(v.cy - v.dy) * sy];
  };

  /* Model coordinates of a point on the page, for look-at and hit tests. */
  Rig.prototype.toModel = function (clientX, clientY) {
    var r = this.canvas.getBoundingClientRect(), u = this.viewUniform();
    var nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    return { x: (nx - u[2]) / u[0], y: (ny - u[3]) / u[1] };
  };

  Rig.prototype.render = function (values) {
    var gl = this.gl, model = this.model, loc = this.loc;
    this.resize();
    var st = model.prepare(values);

    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      model.deform(p.id, p.rest, p.out, st);
      if (p.sprite) {
        var key = p.sprite.key ? p.sprite.key(values) : "static";
        if (key !== p.key) {
          p.ctx.setTransform(1, 0, 0, 1, 0, 0);
          p.ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
          p.ctx.setTransform(p.sprite.res, 0, 0, p.sprite.res, -p.sprite.x * p.sprite.res, -p.sprite.y * p.sprite.res);
          p.sprite.draw(p.ctx, values);
          if (!p.tex) p.tex = texture(gl, p.canvas);
          else {
            gl.bindTexture(gl.TEXTURE_2D, p.tex);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p.canvas);
          }
          p.key = key;
        }
      }
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    var bg = this.background;
    if (bg) gl.clearColor(bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]);
    else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.uniform4fv(loc.view, this.viewUniform());
    gl.activeTexture(gl.TEXTURE0);

    var order = model.order(st);
    for (i = 0; i < order.length; i++) {
      p = this.byId[order[i]];
      if (!p || !p.icount || !p.tex) continue;
      var a = model.alpha(p.id, st);
      if (a <= 0.002) continue;
      var clip = model.clip(p.id, st);
      gl.uniform1f(loc.alpha, a);
      if (clip) {
        gl.uniform1f(loc.clip, 1);
        gl.uniform2f(loc.origin, clip.origin[0], clip.origin[1]);
        gl.uniform2fv(loc.top, clip.top);
        gl.uniform2fv(loc.bot, clip.bot);
      } else {
        gl.uniform1f(loc.clip, 0);
        gl.uniform2f(loc.origin, 0, 0);
      }
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, p.vstart * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
      gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, p.vstart * 8);
      gl.drawElements(gl.TRIANGLES, p.icount, gl.UNSIGNED_SHORT, p.istart * 2);
    }
    return st;
  };

  return Rig;
})();
