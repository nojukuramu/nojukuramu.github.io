/* ============================================================
   BURST//DUMP — getting photos in

   The first version's decoder, kept: it was already the careful part.
   Photos are downscaled on load to fit a memory budget scaled to the
   device, decoded a few at a time, retried once smaller when a phone runs
   short, and EXIF orientation is honoured on every path.
   ============================================================ */
import { mulberry32 } from "./timeline.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

export const state = { files: [], photos: [], fails: [], maxDim: 0, decoding: false, gen: 0 };

/* Folder drops arrive as entries; walk them for files. */
export async function filesFromDrop(dt) {
  const entries = [...dt.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const files = [];
  const walk = (entry) => new Promise((res) => {
    if (entry.isFile) entry.file((f) => { files.push(f); res(); }, res);
    else if (entry.isDirectory) {
      const rd = entry.createReader();
      const all = () => rd.readEntries(async (ents) => { if (!ents.length) return res(); await Promise.all(ents.map(walk)); all(); }, res);
      all();
    } else res();
  });
  await Promise.all(entries.map(walk));
  return files;
}

export function images(files) {
  const imgs = files.filter((f) => IMG_RE.test(f.name) || (f.type && f.type.startsWith("image/")));
  return { imgs, skipped: files.length - imgs.length };
}

function select(cfg) {
  let list = [...state.files];
  const rng = mulberry32(cfg.seed ^ 0x9e37);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const byDate = (a, b) => a.lastModified - b.lastModified;
  const shuffle = (l) => { for (let i = l.length - 1; i > 0; i--) { const j = rng() * (i + 1) | 0; [l[i], l[j]] = [l[j], l[i]]; } };
  if (cfg.order === "name") list.sort(byName); else if (cfg.order === "date") list.sort(byDate); else shuffle(list);
  const cap = clamp(cfg.cap, 1, 1000);
  if (list.length > cap) {
    if (cfg.sample === "first") list = list.slice(0, cap);
    else if (cfg.sample === "even") { const out = []; for (let i = 0; i < cap; i++) out.push(list[Math.floor(i * list.length / cap)]); list = out; }
    else { shuffle(list); list = list.slice(0, cap); if (cfg.order === "name") list.sort(byName); if (cfg.order === "date") list.sort(byDate); }
  }
  return list;
}

/* navigator.deviceMemory is Chromium-only and capped at 8; elsewhere assume
   a mid-range phone. Mobile browsers kill a tab well before JS sees an
   allocation fail, so stay far under the ceiling. */
const memGB = () => navigator.deviceMemory || 4;
export const budgetBytes = () => clamp(memGB(), 2, 8) * 0.18 * 1e9;
export function maxDimFor(n, quality) {
  if (quality === "low") return 560;
  if (quality === "med") return 900;
  if (quality === "high") return 1400;
  return clamp(Math.round(Math.sqrt(budgetBytes() / Math.max(1, n) / (4 * 0.75))), 480, 1400);
}
const concurrency = (d) => (d > 1100 ? 2 : d > 800 ? 3 : 4);

function fit(src, sw, sh, maxDim) {
  let w = sw || src.width, h = sh || src.height; const m = Math.max(w, h);
  if (m > maxDim) { const s = maxDim / m; w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s)); }
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, w, h);
  c.close = function () { try { this.width = this.height = 0; } catch (e) {} };
  return c;
}
function viaImg(f, maxDim) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f), img = new Image();
    img.decoding = "async";
    img.onload = () => { const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height; URL.revokeObjectURL(url); if (!w || !h) return reject(new Error("empty image")); try { resolve(fit(img, w, h, maxDim)); } catch (e) { reject(e); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img load failed")); };
    img.src = url;
  });
}
/* createImageBitmap with progressively fewer options (resize together with
   from-image orientation throws on many EXIF JPEGs), then <img>. */
async function onePass(f, maxDim) {
  if (typeof createImageBitmap === "function") {
    for (const opt of [{ resizeWidth: maxDim, resizeQuality: "medium", imageOrientation: "from-image" }, { resizeWidth: maxDim, resizeQuality: "medium" }, { imageOrientation: "from-image" }, null]) {
      try {
        const b = opt ? await createImageBitmap(f, opt) : await createImageBitmap(f);
        if (b.width > maxDim || b.height > maxDim) { const c = fit(b, b.width, b.height, maxDim); b.close(); return c; }
        return b;
      } catch (e) { /* the next, less strict set */ }
    }
  }
  return viaImg(f, maxDim);
}
async function decodeOne(f, maxDim) {
  try { return await onePass(f, maxDim); }
  catch (e) { if (maxDim > 480) { try { return await onePass(f, 480); } catch (e2) {} } throw e; }
}

/* Decodes the selection. onProgress(done, total). Resolves false when a
   newer decode superseded this one. */
export async function decodeAll(cfg, onProgress) {
  const gen = ++state.gen;
  state.decoding = true;
  try {
    const list = select(cfg);
    const maxDim = maxDimFor(list.length, cfg.quality);
    for (const p of state.photos) { try { p.bmp.close(); } catch (e) {} }
    state.photos = [];
    // a beat for the browser to reclaim what was just closed before the next batch
    await new Promise((r) => setTimeout(r, 0));
    if (gen !== state.gen) return false;
    const out = new Array(list.length).fill(null), fails = [];
    let idx = 0, done = 0;
    const worker = async () => {
      while (idx < list.length) {
        const my = idx++; if (gen !== state.gen) return;
        const f = list[my];
        try { const bmp = await decodeOne(f, maxDim); if (gen !== state.gen) { try { bmp.close(); } catch (e) {} return; } out[my] = { bmp, name: f.name, ar: bmp.width / bmp.height }; }
        catch (e) { fails.push(f.name); }
        done++;
        if (done % 8 === 0 || done === list.length) { onProgress && onProgress(done, list.length); await new Promise((r) => setTimeout(r, 0)); }
      }
    };
    await Promise.all(Array.from({ length: concurrency(maxDim) }, worker));
    if (gen !== state.gen) return false;
    state.photos = out.filter(Boolean); state.fails = fails; state.maxDim = maxDim;
    return true;
  } finally { if (gen === state.gen) state.decoding = false; }
}

export async function retryFailed() {
  if (!state.fails.length || state.decoding) return;
  const names = new Set(state.fails);
  const targets = state.files.filter((f) => names.has(f.name));
  state.decoding = true;
  try {
    const maxDim = state.maxDim || maxDimFor(state.files.length, "auto"), still = [];
    for (const f of targets) { try { const bmp = await decodeOne(f, maxDim); state.photos.push({ bmp, name: f.name, ar: bmp.width / bmp.height }); } catch (e) { still.push(f.name); } }
    state.fails = still;
  } finally { state.decoding = false; }
}

export function remove(i) {
  const p = state.photos[i]; if (!p) return;
  try { p.bmp.close(); } catch (e) {}
  state.photos.splice(i, 1);
  const fi = state.files.findIndex((f) => f.name === p.name);
  if (fi >= 0) state.files.splice(fi, 1);
}

export function bytes() { let b = 0; for (const p of state.photos) b += p.bmp.width * p.bmp.height * 4; return b; }
