/* ============================================================
   Type — word pools shared by the generators

   Plain lowercase ASCII only: every character a challenge can ask for has to
   be one a standard keyboard has, and tools/validate.js checks that over every
   challenge it generates.
   ============================================================ */

export const NOUNS = ["river", "lantern", "window", "garden", "engine", "market", "bridge", "kettle", "harbor", "pencil", "orchard", "signal", "ladder", "meadow", "compass", "blanket", "station", "canvas", "ribbon", "cellar", "thunder", "pebble", "harvest", "mirror", "anchor", "bakery", "chimney", "journal", "tunnel", "feather", "valley", "lighthouse", "puzzle", "carpet", "island", "workshop", "garage", "dragon", "planet", "sketch", "castle", "forest", "kitchen", "library", "camera", "button", "theory", "recipe", "balcony", "network"];
export const VERBS = ["build", "carry", "follow", "mend", "gather", "measure", "borrow", "polish", "finish", "answer", "collect", "shape", "repair", "deliver", "arrange", "inspect", "rescue", "balance", "sharpen", "remember", "decode", "stitch", "launch", "unfold", "trace", "wander", "whisper", "bundle", "refine", "document"];
export const ADJS = ["quiet", "stubborn", "curious", "clever", "patient", "restless", "gentle", "ancient", "careful", "cheerful", "sleepy", "brave", "crooked", "silver", "hidden", "humble", "tangled", "steady", "distant", "golden", "rusty", "nimble", "lonely", "bright", "wooden", "hollow", "tiny", "windy", "misty", "plain"];
export const NAMES = ["Ada", "Ben", "Cleo", "Dara", "Eli", "Faye", "Gus", "Hana", "Ivo", "Juno", "Kai", "Lena", "Milo", "Nora", "Otis", "Pia", "Quin", "Rhea", "Sol", "Tess", "Uma", "Vic", "Wren", "Xavi", "Yara", "Zed"];

/** Words used to build identifiers, hostnames and file names. */
export const IDENT = ["user", "item", "order", "token", "cache", "queue", "event", "route", "frame", "score", "count", "index", "value", "total", "limit", "level", "state", "entry", "chunk", "batch", "price", "label", "owner", "stage", "range", "input", "output", "buffer", "result", "config", "client", "server", "worker", "record", "string", "margin", "weight", "height", "length", "offset", "cursor", "target", "source", "parent", "child", "alpha", "delta", "sigma", "pixel", "vector", "matrix", "socket", "packet", "header", "branch", "commit", "module", "plugin", "handle", "stream", "signal"];
export const ACTIONS = ["get", "set", "find", "load", "save", "parse", "build", "check", "merge", "split", "clamp", "scale", "flush", "reset", "fetch", "apply", "count", "sum", "make", "read", "write", "sort", "pick", "trim", "join", "swap", "scan", "walk", "mix", "fold"];
export const FILES = ["notes", "report", "backup", "draft", "photos", "invoice", "readme", "config", "data", "output", "archive", "script", "todo", "log", "build", "release", "resume", "budget", "ideas", "export", "summary", "inventory", "metrics", "schedule", "contacts", "changelog", "sample", "results", "roster", "mapping"];
export const EXT = ["txt", "md", "log", "csv", "json", "yml", "sh", "py", "js", "conf", "bak", "xml"];
export const DIRS = ["projects", "downloads", "documents", "backups", "src", "assets", "tmp", "logs", "web", "scripts", "photos", "workspace", "data", "release", "demo", "tools", "notes", "lab", "reports", "images", "vendor", "staging", "archive", "drafts", "exports", "media"];
export const HOSTS = ["alpha", "bravo", "delta", "falcon", "harbor", "juniper", "kestrel", "lumen", "maple", "nimbus", "orbit", "pine", "quartz", "raven", "summit", "tundra", "vertex", "willow"];
export const USERS = ["ana", "bob", "cris", "dev", "emil", "fran", "gio", "hugo", "iris", "jun", "kim", "leo", "mara", "nico", "ola", "pat"];
export const DOMAINS = ["example.com", "example.org", "example.net", "test.local", "demo.internal", "localhost", "api.example.com", "docs.example.org", "mail.example.net", "staging.test.local", "git.demo.internal", "cdn.example.com"];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export { cap };

/** An identifier in the given style from two words. */
export function ident(rng, style, a, b) {
  const x = a || rng.pick(ACTIONS), y = b || rng.pick(IDENT);
  if (style === "snake") return x + "_" + y;
  if (style === "pascal") return cap(x) + cap(y);
  if (style === "kebab") return x + "-" + y;
  return x + cap(y);
}
