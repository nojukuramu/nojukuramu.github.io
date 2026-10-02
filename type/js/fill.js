/* ============================================================
   Type — filling a template

   Terminal sessions and code snippets are templates with ‹holes›. A hole's
   kind is its name without trailing digits, so ‹file› and ‹file2› are both
   file names, and the second is never the same as the first. Within one
   challenge a hole keeps its value: ‹dir› in `mkdir ‹dir›` is the same ‹dir› in
   the `cd ‹dir›` two lines later, which is what makes it read as a session
   and not as a shuffled deck.

   The brackets are U+2039 / U+203A on purpose. They are not on a keyboard, so
   they can never be part of something the player has to type, and no shell or
   language uses them, so they never clash with ${}, <<EOF or %PATH%.
   ============================================================ */

import { FILES, EXT, DIRS, HOSTS, USERS, DOMAINS, IDENT, ACTIONS, NOUNS, ident, cap } from "./words.js";

const MSGS = ["fix typo", "add tests", "update readme", "tidy imports", "bump version", "handle empty input", "speed up build", "remove dead code", "first draft", "rename helpers", "cache the lookup", "wire up the form"];
const PKGS = ["express", "lodash", "axios", "vite", "jest", "chalk", "zod", "dayjs", "requests", "numpy", "pandas", "flask", "pytest", "rich", "click", "serde", "tokio"];
const IMGS = ["nginx:alpine", "redis:7", "postgres:16", "node:20-slim", "python:3.12-slim", "httpd:2.4", "busybox:latest", "memcached:1.6", "alpine:3.19", "mongo:7"];

const KINDS = {
  file: (r) => r.pick(FILES) + "." + r.pick(EXT),
  name: (r) => r.pick(FILES),
  dir: (r) => r.pick(DIRS),
  ext: (r) => r.pick(EXT),
  host: (r) => r.pick(HOSTS),
  user: (r) => r.pick(USERS),
  domain: (r) => r.pick(DOMAINS),
  port: (r) => String(r.int(3000, 9999)),
  n: (r) => String(r.int(2, 40)),
  big: (r) => String(r.int(100, 9999)),
  pid: (r) => String(r.int(1000, 48000)),
  ip: (r) => "10.0." + r.int(0, 254) + "." + r.int(2, 254),
  word: (r) => r.pick(NOUNS),
  idc: (r) => ident(r, "camel"),
  ids: (r) => ident(r, "snake"),
  idp: (r) => ident(r, "pascal"),
  idk: (r) => ident(r, "kebab"),
  upper: (r) => r.pick(IDENT).toUpperCase(),
  ver: (r) => r.int(0, 3) + "." + r.int(0, 20) + "." + r.int(0, 9),
  branch: (r) => r.pick(["feature", "fix", "chore", "docs"]) + "/" + r.pick(IDENT) + "-" + r.pick(NOUNS),
  msg: (r) => r.pick(MSGS),
  pkg: (r) => r.pick(PKGS),
  img: (r) => r.pick(IMGS),
  sha: (r) => { let s = ""; for (let i = 0; i < 7; i++) s += "0123456789abcdef"[r.int(0, 15)]; return s; },
  sentence: (r) => cap(r.pick(ADJ_PHRASES))
};
const ADJ_PHRASES = ["the build is green", "all tests passed", "nothing to commit", "done in a moment", "ready to ship", "hello from the other side", "it works on my machine"];

/** @param extra  kinds a caller adds or overrides (code uses a, b, fn, T ...) */
export function makeFiller(rng, extra) {
  const kinds = Object.assign({}, KINDS, extra || {});
  const memo = new Map(), usedByKind = new Map();
  function resolve(name) {
    if (memo.has(name)) return memo.get(name);
    const kind = name.replace(/\d+$/, "");
    const make = kinds[kind];
    if (!make) throw new Error("no kind for hole ‹" + name + "›");
    const used = usedByKind.get(kind) || new Set();
    let v = make(rng, name);
    for (let i = 0; i < 12 && used.has(v); i++) v = make(rng, name);
    used.add(v); usedByKind.set(kind, used); memo.set(name, v);
    return v;
  }
  return (tpl) => tpl.replace(/\u2039(\w+)\u203A/g, (_, name) => resolve(name));
}

export { ACTIONS };
