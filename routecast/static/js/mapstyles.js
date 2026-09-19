/* ============================================================
   RouteCast — the basemaps

   Every map RouteCast can draw itself on, in one catalogue. Two kinds:

     raster   a plain {z}/{x}/{y} image layer, drawn by Leaflet. This is
              what the app shipped with, and it is still the default when
              you are planning: it is the map everybody recognises.
     gl       vector tiles drawn by MapLibre GL, which is what buys the
              things a picture of a map cannot give you — a camera that
              can tilt, buildings with height, and a palette that is ours
              rather than the tile server's.

   Why the vector styles are generated here rather than fetched
   -----------------------------------------------------------
   A MapLibre style is a JSON document, and the usual arrangement is to
   fetch somebody else's. We do not: every vector style below is built
   from ONE generator and a palette of about twenty colours. That buys
   three things worth having.

     * The style loads with the app. No style document to fetch before the
       first tile, and nothing to break offline except the tiles themselves.
     * A new look costs a palette, not a thousand-line document. The four
       game-minimap styles below are palettes; the code drawing them is the
       same code drawing the street map.
     * The layer names are ours, so the drive camera knows exactly which
       layer holds the buildings and which one holds the labels, and can
       turn either off without pattern-matching a stranger's style.

   Where the tiles come from
   -------------------------
   OpenFreeMap (https://openfreemap.org), which serves the whole planet as
   OpenMapTiles-schema vector tiles with no key, no account and no quota —
   which is the only reason this feature exists at all, since the house rule
   is that a key in a public script is a donation rather than a secret.

   The game looks
   --------------
   "City Radar", "Sunbelt", "Neon Nights" and "Blueprint" are what you get
   when you drop the labels, flatten the palette to five or six colours and
   let the road network carry the whole picture — which is the trick every
   game minimap plays. They are our colours, drawn from our own layers over
   OpenStreetMap data; nothing is copied from anybody's game.
   ============================================================ */
var RC = RC || {};

RC.mapstyles = (function () {
  "use strict";

  /* One host, named once. OpenFreeMap serves the TileJSON at /planet, and
     MapLibre asks it for the tile URLs — so the planet build can roll over
     underneath us without this file knowing about it. */
  var OFM = "https://tiles.openfreemap.org";
  var VECTOR_SOURCE = OFM + "/planet";
  var GLYPHS = OFM + "/fonts/{fontstack}/{range}.pbf";

  /* The one font stack OpenFreeMap serves for every style it publishes.
     If a stack is missing MapLibre drops the labels and draws the rest, so
     a wrong guess here costs names on the map, never the map. */
  var FONT = ["Noto Sans Regular"];
  var FONT_BOLD = ["Noto Sans Bold"];

  /* ---------------------------------------------------------
     Helpers for the layer bodies below. A road is drawn twice —
     a casing underneath and a fill on top — at widths that grow
     with zoom, which is the whole of why a vector road looks
     like a road rather than like a hairline.
     --------------------------------------------------------- */
  function zoomWidth(stops) {
    var out = ["interpolate", ["exponential", 1.25], ["zoom"]];
    for (var i = 0; i < stops.length; i++) out.push(stops[i][0], stops[i][1]);
    return out;
  }

  function classFilter(classes) {
    return ["all",
      ["==", ["geometry-type"], "LineString"],
      ["match", ["get", "class"], classes, true, false]
    ];
  }

  /* ---------------------------------------------------------
     The generator

     A palette in, a complete MapLibre style out. Layer ids are
     stable and prefixed rc- so gl.js can address them: the drive
     camera hides "rc-label-*" and shows "rc-building-3d" without
     having to know which palette is loaded.
     --------------------------------------------------------- */
  function build(p) {
    var layers = [];

    layers.push({ id: "rc-land", type: "background", paint: { "background-color": p.land } });

    if (p.green) {
      layers.push({
        id: "rc-green", type: "fill", source: "openmaptiles", "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["wood", "grass", "scrub"], true, false],
        paint: { "fill-color": p.green, "fill-opacity": p.greenOpacity == null ? 0.7 : p.greenOpacity }
      });
      layers.push({
        id: "rc-park", type: "fill", source: "openmaptiles", "source-layer": "park",
        paint: { "fill-color": p.green, "fill-opacity": 0.45 }
      });
    }

    layers.push({
      id: "rc-water", type: "fill", source: "openmaptiles", "source-layer": "water",
      paint: { "fill-color": p.water }
    });
    layers.push({
      id: "rc-waterway", type: "line", source: "openmaptiles", "source-layer": "waterway",
      paint: { "line-color": p.water, "line-width": zoomWidth([[8, 0.6], [16, 3.2]]) }
    });

    /* Buildings, flat, so a city reads as built-up before the zoom where
       paying for geometry with height is worth it. */
    if (p.building) {
      layers.push({
        id: "rc-building", type: "fill", source: "openmaptiles", "source-layer": "building",
        maxzoom: 15,
        paint: { "fill-color": p.building, "fill-opacity": 0.75 }
      });
    }

    // Roads, thinnest class first so a motorway is never painted under a lane.
    layers.push({
      id: "rc-road-minor-case", type: "line", source: "openmaptiles", "source-layer": "transportation",
      minzoom: 13, filter: classFilter(["minor", "service", "track", "path"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadCase, "line-width": zoomWidth([[13, 1.4], [18, 9]]) }
    });
    layers.push({
      id: "rc-road-minor", type: "line", source: "openmaptiles", "source-layer": "transportation",
      minzoom: 13, filter: classFilter(["minor", "service", "track", "path"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadMinor, "line-width": zoomWidth([[13, 0.6], [18, 7]]) }
    });

    layers.push({
      id: "rc-road-sec-case", type: "line", source: "openmaptiles", "source-layer": "transportation",
      minzoom: 9, filter: classFilter(["secondary", "tertiary"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadCase, "line-width": zoomWidth([[9, 1.6], [18, 13]]) }
    });
    layers.push({
      id: "rc-road-sec", type: "line", source: "openmaptiles", "source-layer": "transportation",
      minzoom: 9, filter: classFilter(["secondary", "tertiary"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadSecondary, "line-width": zoomWidth([[9, 0.8], [18, 11]]) }
    });

    layers.push({
      id: "rc-road-pri-case", type: "line", source: "openmaptiles", "source-layer": "transportation",
      minzoom: 6, filter: classFilter(["primary", "trunk"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadCase, "line-width": zoomWidth([[6, 1.8], [18, 17]]) }
    });
    layers.push({
      id: "rc-road-pri", type: "line", source: "openmaptiles", "source-layer": "transportation",
      minzoom: 6, filter: classFilter(["primary", "trunk"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadPrimary, "line-width": zoomWidth([[6, 1], [18, 14]]) }
    });

    layers.push({
      id: "rc-road-motorway-case", type: "line", source: "openmaptiles", "source-layer": "transportation",
      minzoom: 4, filter: classFilter(["motorway"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.motorwayCase || p.roadCase, "line-width": zoomWidth([[4, 2], [18, 21]]) }
    });
    layers.push({
      id: "rc-road-motorway", type: "line", source: "openmaptiles", "source-layer": "transportation",
      minzoom: 4, filter: classFilter(["motorway"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.motorway, "line-width": zoomWidth([[4, 1.1], [18, 18]]) }
    });

    if (p.rail) {
      layers.push({
        id: "rc-rail", type: "line", source: "openmaptiles", "source-layer": "transportation",
        minzoom: 11, filter: classFilter(["rail", "transit"]),
        paint: { "line-color": p.rail, "line-width": zoomWidth([[11, 0.5], [18, 2.4]]), "line-opacity": 0.8 }
      });
    }

    if (p.boundary) {
      layers.push({
        id: "rc-boundary", type: "line", source: "openmaptiles", "source-layer": "boundary",
        filter: ["<=", ["get", "admin_level"], 4],
        paint: { "line-color": p.boundary, "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.6 }
      });
    }

    /* The reason the whole thing exists. Height comes from the tiles; the
       camera decides whether it is ever seen, because at pitch 0 an
       extrusion is an expensive way to draw a flat polygon. */
    if (p.building) {
      layers.push({
        id: "rc-building-3d", type: "fill-extrusion", source: "openmaptiles",
        "source-layer": "building", minzoom: 14,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": p.building3d || p.building,
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": p.buildingOpacity == null ? 0.92 : p.buildingOpacity,
          "fill-extrusion-vertical-gradient": true
        }
      });
    }

    /* Labels are the first thing a minimap drops, so they are a palette
       decision rather than a fixed part of the picture. */
    if (p.label) {
      layers.push({
        id: "rc-label-road", type: "symbol", source: "openmaptiles",
        "source-layer": "transportation_name", minzoom: 13,
        layout: {
          "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT,
          "text-size": 11, "text-max-angle": 30
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.3 }
      });
      layers.push({
        id: "rc-label-place", type: "symbol", source: "openmaptiles",
        "source-layer": "place",
        filter: ["match", ["get", "class"], ["city", "town", "village"], true, false],
        layout: {
          "text-field": ["get", "name"], "text-font": FONT_BOLD,
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 12, 16],
          "text-anchor": "center"
        },
        paint: { "text-color": p.label, "text-halo-color": p.labelHalo, "text-halo-width": 1.6 }
      });
    }

    return {
      version: 8,
      name: p.name,
      glyphs: GLYPHS,
      sources: { openmaptiles: { type: "vector", url: VECTOR_SOURCE } },
      layers: layers
    };
  }

  /* ---------------------------------------------------------
     The catalogue

     `kind` is what draws it, not what it looks like: "raster" is a
     Leaflet tile layer, "gl" is MapLibre. `dim` says whether the
     app's dark-mode filter should be laid over it — a raster map
     has one palette for both themes and needs inverting; a vector
     style that was designed dark must be left alone.
     --------------------------------------------------------- */
  var BASES = [
    {
      id: "osm",
      kind: "raster",
      name: "Standard",
      note: "The plain OpenStreetMap map. Flat, labelled, familiar.",
      dim: true,
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxZoom: 19,
      attribution: "OpenStreetMap",
      /* A raster map has no palette to show a swatch from, so it carries the
         five colours its tiles are mostly made of. */
      preview: {
        land: "#F2EFE9", green: "#CDEBB0", water: "#AAD3DF",
        roadSecondary: "#FFFFFF", roadPrimary: "#FFFFFF", motorway: "#E892A2"
      }
    },
    {
      id: "streets",
      kind: "gl",
      name: "Streets 3D",
      note: "Daylight vector map with buildings you can look along.",
      dim: false,
      palette: {
        name: "Streets 3D",
        land: "#F2F1EC", green: "#CFE0BD", water: "#A8C9E2",
        roadCase: "#D9D6CD", roadMinor: "#FFFFFF", roadSecondary: "#FFFDF6",
        roadPrimary: "#FFF3D0", motorway: "#F6C96B", motorwayCase: "#D9A93F",
        rail: "#BDBAB1", boundary: "#9A93A8",
        building: "#DFDBD2", building3d: "#D6D1C6", buildingOpacity: 0.9,
        label: "#4A4A44", labelHalo: "#FFFFFFCC"
      }
    },
    {
      id: "midnight",
      kind: "gl",
      name: "Midnight 3D",
      note: "The same map after dark, for a night ride and a bright screen.",
      dim: false,
      palette: {
        name: "Midnight 3D",
        land: "#12161C", green: "#17241B", greenOpacity: 0.85, water: "#0C2233",
        roadCase: "#0B0E12", roadMinor: "#2C3440", roadSecondary: "#3A4453",
        roadPrimary: "#4E596B", motorway: "#C9A227", motorwayCase: "#3A3118",
        rail: "#2A313B", boundary: "#3C4656",
        building: "#1A2029", building3d: "#232C38", buildingOpacity: 0.95,
        label: "#C7CEDA", labelHalo: "#0B0E12CC"
      }
    },
    {
      id: "radar",
      kind: "gl",
      name: "City Radar",
      note: "A game minimap: no names, dark ground, roads doing all the talking.",
      dim: false,
      palette: {
        name: "City Radar",
        land: "#2B3540", green: "#2F4738", greenOpacity: 1, water: "#12405F",
        roadCase: "#1D242C", roadMinor: "#8D9BA6", roadSecondary: "#B6C3CC",
        roadPrimary: "#E2EAEF", motorway: "#F5D06B", motorwayCase: "#1D242C",
        rail: "#3A444F", boundary: null,
        building: "#222A33", building3d: "#2E3945", buildingOpacity: 1,
        label: null, labelHalo: null
      }
    },
    {
      id: "sunbelt",
      kind: "gl",
      name: "Sunbelt",
      note: "Dry country and pale highways, the way an old console map looked.",
      dim: false,
      palette: {
        name: "Sunbelt",
        land: "#D8CBA0", green: "#9FB177", greenOpacity: 1, water: "#4E90B4",
        roadCase: "#9E8F68", roadMinor: "#F2ECDC", roadSecondary: "#F7F2E4",
        roadPrimary: "#FFFBF0", motorway: "#E8C25A", motorwayCase: "#9E8F68",
        rail: "#A99A73", boundary: null,
        building: "#C4B18A", building3d: "#BFAF89", buildingOpacity: 1,
        label: null, labelHalo: null
      }
    },
    {
      id: "neon",
      kind: "gl",
      name: "Neon Nights",
      note: "Magenta and cyan on deep purple. Loud, and surprisingly readable.",
      dim: false,
      palette: {
        name: "Neon Nights",
        land: "#150E23", green: "#1C2A33", greenOpacity: 0.9, water: "#0E2340",
        roadCase: "#0B0715", roadMinor: "#5C3E86", roadSecondary: "#8B4FB0",
        roadPrimary: "#D356A8", motorway: "#2FE0D0", motorwayCase: "#0B0715",
        rail: "#37275A", boundary: null,
        building: "#1E1236", building3d: "#2A1A4A", buildingOpacity: 1,
        label: null, labelHalo: null
      }
    },
    {
      id: "blueprint",
      kind: "gl",
      name: "Blueprint",
      note: "White lines on drafting blue. Nothing on it but the geometry.",
      dim: false,
      palette: {
        name: "Blueprint",
        land: "#123A63", green: null, water: "#0E2F51",
        roadCase: "#123A63", roadMinor: "#7FA9D4", roadSecondary: "#A8C8E8",
        roadPrimary: "#D6E7F7", motorway: "#FFFFFF", motorwayCase: "#123A63",
        rail: "#6E96BF", boundary: "#9FC2E4",
        building: "#1B4A79", building3d: "#215489", buildingOpacity: 0.95,
        label: null, labelHalo: null
      }
    }
  ];

  var byId = {};
  for (var i = 0; i < BASES.length; i++) byId[BASES[i].id] = BASES[i];

  return {
    HOST: OFM,
    list: function () { return BASES.slice(); },
    get: function (id) { return byId[id] || null; },
    /** The handful of colours a chooser needs to draw a thumbnail of a map
        it has not loaded. */
    preview: function (id) {
      var b = byId[id];
      return b ? (b.palette || b.preview || null) : null;
    },
    has: function (id) { return !!byId[id]; },
    /** The MapLibre style document for a vector base, built on demand. */
    spec: function (id) {
      var b = byId[id];
      if (!b || b.kind !== "gl") return null;
      return build(b.palette);
    },
    /* Exposed for the harness, which builds every style in the catalogue and
       checks the result is a style rather than a shape that looks like one. */
    build: build
  };
})();
