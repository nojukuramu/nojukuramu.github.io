/* Pinoy Word Games — Firebase (front-end only)
 * Uses the same Firebase project as mysite (jeepneyroutesnoju), but talks to
 * Firestore straight from the browser via the web SDK — no backend, no admin SDK.
 * Clues and answers live in the `pwg_levels` collection (doc id: level-001 …).
 * Seeding/editing is done from mysite/static/pwg/seed.html.
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA1sMXM3I9oNoRQUGUVlZilO_MOaDj3ibY",
  authDomain: "jeepneyroutesnoju.firebaseapp.com",
  databaseURL: "https://jeepneyroutesnoju-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "jeepneyroutesnoju",
  storageBucket: "jeepneyroutesnoju.firebasestorage.app",
  messagingSenderId: "933436707482",
  appId: "1:933436707482:web:5a9db4b63751b0cfc70523",
  measurementId: "G-S8M3Q81EYD"
};

export const PWG_COLLECTION = "pwg_levels";

const CACHE_KEY = "pwg:v1:bank";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // refresh from cloud every 6h

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items) || !data.items.length) return null;
    return data;
  } catch (e) { return null; }
}

function writeCache(items) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items }));
  } catch (e) { /* storage full/blocked — fine, cache is optional */ }
}

async function fetchFromFirestore() {
  const [{ initializeApp }, fs] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
  ]);
  const app = initializeApp(FIREBASE_CONFIG, "pwg");
  const db = fs.getFirestore(app);
  const snap = await fs.getDocs(
    fs.query(fs.collection(db, PWG_COLLECTION), fs.orderBy("level"))
  );
  const items = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d && typeof d.level === "number" && d.q && d.a && d.type) {
      items.push({ level: d.level, type: d.type, q: d.q, a: d.a });
    }
  });
  return items;
}

/* Returns { items, source } where source is "cloud" | "cache" | "local".
 * Cloud items override local ones per level; local bank fills any gaps,
 * so the game always has 100 playable levels even offline. */
export async function loadBank(localItems) {
  const merge = (cloudItems) => {
    const byLevel = new Map(localItems.map((it) => [it.level, it]));
    for (const it of cloudItems) byLevel.set(it.level, it);
    return [...byLevel.values()].sort((a, b) => a.level - b.level);
  };

  const cached = readCache();
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { items: merge(cached.items), source: "cache" };
  }

  try {
    const cloudItems = await fetchFromFirestore();
    if (cloudItems.length) {
      writeCache(cloudItems);
      return { items: merge(cloudItems), source: "cloud" };
    }
  } catch (e) {
    // offline / rules / quota — fall through to whatever we have
    if (cached) return { items: merge(cached.items), source: "cache" };
  }
  return { items: localItems.slice(), source: "local" };
}
