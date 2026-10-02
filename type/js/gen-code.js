/* ============================================================
   Type — source code

   Sixteen languages, each with a handful of small, real-looking snippets. The
   snippets are templates: function names, variables, types, numbers and
   strings are filled in per challenge in the language's own naming style
   (snake_case, camelCase, PascalCase), so ten thousand challenges do not mean
   ten thousand snippets written by hand.

   Each snippet is written with the indentation its language actually uses
   (two spaces, four, or a tab for Go). It is shown but never typed: pressing Enter in the
   editor puts the cursor at the next line's first character, the way an editor
   would with auto-indent. Typing a ladder of spaces is not the skill.
   ============================================================ */

import { makeFiller } from "./fill.js";
import { IDENT, NOUNS, cap, ident } from "./words.js";

const T_SUFFIX = ["Item", "Entry", "Record", "Node", "Config", "Result", "Batch", "Stage", "Event", "Order"];

const JS = [
  "function ‹fn›(‹a›, ‹b›) {\n  if (!‹a›) return ‹b›;\n  return ‹a›.map((x) => x * ‹n›).filter(Boolean);\n}",
  "const ‹fn› = async (‹a›) => {\n  const res = await fetch(`/api/‹b›/${‹a›}`);\n  if (!res.ok) throw new Error(\"‹s› failed\");\n  return res.json();\n};",
  "class ‹T› {\n  constructor(‹a›) {\n    this.‹a› = ‹a›;\n    this.items = [];\n  }\n  add(‹b›) {\n    this.items.push(‹b›);\n    return this;\n  }\n}",
  "for (const [‹a›, ‹b›] of Object.entries(‹c›)) {\n  if (‹b› > ‹n›) {\n    console.log(`${‹a›}: ${‹b›}`);\n  }\n}",
  "export function ‹fn›(‹a›) {\n  const seen = new Set();\n  return ‹a›.filter((x) => !seen.has(x) && seen.add(x));\n}",
  "document.querySelector(\"#‹a›\").addEventListener(\"click\", (e) => {\n  e.preventDefault();\n  localStorage.setItem(\"‹b›\", String(Date.now()));\n});",
  "const ‹a› = ‹b›.reduce((sum, x) => sum + x.‹c›, 0) / ‹b›.length;",
  "setTimeout(() => ‹fn›(‹n›), ‹n2› * 100);"
];
const TS = [
  "interface ‹T› {\n  ‹a›: string;\n  ‹b›?: number;\n  readonly ‹c›: boolean;\n}",
  "export function ‹fn›<T>(‹a›: T[], ‹b›: (x: T) => boolean): T | undefined {\n  return ‹a›.find(‹b›);\n}",
  "type ‹T› = \"‹s›\" | \"‹s2›\" | \"‹s3›\";",
  "enum ‹T› {\n  ‹U1›,\n  ‹U2›,\n  ‹U3›\n}",
  "async function ‹fn›(‹a›: string): Promise<Record<string, number>> {\n  const res = await fetch(‹a›);\n  return (await res.json()) as Record<string, number>;\n}",
  "const ‹a›: Map<string, ‹T›[]> = new Map();\n‹a›.set(\"‹s›\", []);"
];
const PY = [
  "def ‹fn›(‹a›, ‹b›=‹n›):\n    if not ‹a›:\n        return ‹b›\n    return [x * ‹b› for x in ‹a› if x > 0]",
  "class ‹T›:\n    def __init__(self, ‹a›):\n        self.‹a› = ‹a›\n        self.items = []\n\n    def add(self, ‹b›):\n        self.items.append(‹b›)",
  "with open(\"‹s›.txt\") as f:\n    for line in f:\n        print(line.strip().upper())",
  "try:\n    ‹a› = int(input(\"‹s›: \"))\nexcept ValueError:\n    ‹a› = ‹n›",
  "from dataclasses import dataclass\n\n@dataclass\nclass ‹T›:\n    ‹a›: str\n    ‹b›: int = ‹n›",
  "‹a› = {k: v for k, v in zip(‹b›, range(‹n›))}",
  "print(f\"{‹a›} items, total {sum(‹b›):.2f}\")"
];
const C = [
  "int ‹fn›(int ‹a›, int ‹b›) {\n  if (‹a› > ‹b›) {\n    return ‹a› - ‹b›;\n  }\n  return ‹b› % ‹n›;\n}",
  "struct ‹T› {\n  char ‹a›[‹n2›];\n  int ‹b›;\n  double ‹c›;\n};",
  "for (int i = 0; i < ‹n›; i++) {\n  printf(\"%d: %s\\n\", i, ‹a›[i]);\n}",
  "void ‹fn›(int *‹a›, int *‹b›) {\n  int tmp = *‹a›;\n  *‹a› = *‹b›;\n  *‹b› = tmp;\n}",
  "int main(void) {\n  int ‹a› = ‹n›;\n  while (‹a›--) {\n    puts(\"‹s›\");\n  }\n  return 0;\n}",
  "#define ‹U1›_MAX ‹n2›\n#include <stdio.h>"
];
const CPP = [
  "std::vector<int> ‹fn›(const std::vector<int>& ‹a›) {\n  std::vector<int> out;\n  for (int x : ‹a›) {\n    if (x % ‹n› == 0) out.push_back(x);\n  }\n  return out;\n}",
  "class ‹T› {\n public:\n  explicit ‹T›(int ‹a›) : ‹a›_(‹a›) {}\n  int ‹b›() const { return ‹a›_; }\n private:\n  int ‹a›_;\n};",
  "auto ‹fn› = [](int ‹a›, int ‹b›) { return ‹a› * ‹b›; };",
  "std::map<std::string, int> ‹a›;\n‹a›[\"‹s›\"] += ‹n›;\nfor (const auto& [k, v] : ‹a›) std::cout << k << \"=\" << v << '\\n';",
  "std::sort(‹a›.begin(), ‹a›.end(), [](int x, int y) { return x > y; });"
];
const JAVA = [
  "public static int ‹fn›(int[] ‹a›) {\n  int total = 0;\n  for (int x : ‹a›) {\n    total += x;\n  }\n  return total;\n}",
  "public class ‹T› {\n  private final String ‹a›;\n\n  public ‹T›(String ‹a›) {\n    this.‹a› = ‹a›;\n  }\n}",
  "List<String> ‹a› = ‹b›.stream()\n    .filter(s -> s.length() > ‹n›)\n    .map(String::toUpperCase)\n    .collect(Collectors.toList());",
  "try {\n  Thread.sleep(‹n2›00);\n} catch (InterruptedException e) {\n  e.printStackTrace();\n}",
  "System.out.println(\"‹s›: \" + ‹a›.size());"
];
const CS = [
  "public int ‹fn›(int ‹a›, int ‹b›)\n{\n    if (‹a› < ‹b›) return ‹b›;\n    return ‹a› * ‹n›;\n}",
  "public class ‹T›\n{\n    public string ‹U1› { get; set; }\n    public int ‹U2› { get; init; }\n}",
  "var ‹a› = ‹b›.Where(x => x.‹U1› > ‹n›)\n              .OrderBy(x => x.‹U2›)\n              .ToList();",
  "foreach (var ‹a› in ‹b›)\n{\n    Console.WriteLine($\"{‹a›.‹U1›}: {‹a›.‹U2›}\");\n}",
  "using var ‹a› = new HttpClient();\nvar body = await ‹a›.GetStringAsync(\"https://example.com/‹s›\");"
];
const GO = [
  "func ‹fn›(‹a› int, ‹b› int) (int, error) {\n\tif ‹b› == 0 {\n\t\treturn 0, errors.New(\"‹s›\")\n\t}\n\treturn ‹a› / ‹b›, nil\n}",
  "type ‹T› struct {\n\t‹U1› string\n\t‹U2› int\n}",
  "for i, ‹a› := range ‹b› {\n\tfmt.Printf(\"%d: %v\\n\", i, ‹a›)\n}",
  "go func() {\n\tdefer wg.Done()\n\t‹a› <- ‹fn›(‹n›)\n}()",
  "‹a› := make(map[string]int)\n‹a›[\"‹s›\"]++"
];
const RS = [
  "fn ‹fn›(‹a›: &[i32]) -> i32 {\n    ‹a›.iter().filter(|x| **x > ‹n›).sum()\n}",
  "struct ‹T› {\n    ‹a›: String,\n    ‹b›: u32,\n}\n\nimpl ‹T› {\n    fn new(‹a›: &str) -> Self {\n        Self { ‹a›: ‹a›.to_string(), ‹b›: ‹n› }\n    }\n}",
  "match ‹a› {\n    Some(x) if x > ‹n› => println!(\"big {}\", x),\n    Some(x) => println!(\"small {}\", x),\n    None => println!(\"‹s›\"),\n}",
  "let ‹a›: Vec<u32> = (1..=‹n›).map(|x| x * x).collect();",
  "fn main() {\n    let mut ‹a› = ‹n›;\n    while ‹a› > 0 {\n        ‹a› -= 1;\n    }\n}"
];
const RB = [
  "def ‹fn›(‹a›, ‹b› = ‹n›)\n  ‹a›.map { |x| x * ‹b› }.select(&:positive?)\nend",
  "class ‹T›\n  attr_reader :‹a›\n\n  def initialize(‹a›)\n    @‹a› = ‹a›\n  end\nend",
  "‹a›.each_with_index do |item, i|\n  puts \"#{i}: #{item}\"\nend",
  "‹a› = { ‹b›: ‹n›, ‹c›: \"‹s›\" }\n‹a›.each { |k, v| puts \"#{k} => #{v}\" }"
];
const PHP = [
  "function ‹fn›(array $‹a›, int $‹b› = ‹n›): array {\n    return array_map(fn($x) => $x * $‹b›, $‹a›);\n}",
  "class ‹T›\n{\n    public function __construct(private string $‹a›) {}\n\n    public function ‹fn›(): string\n    {\n        return strtoupper($this->‹a›);\n    }\n}",
  "foreach ($‹a› as $key => $‹b›) {\n    echo \"$key: $‹b›\\n\";\n}",
  "$‹a› = $_GET['‹b›'] ?? '‹s›';"
];
const KT = [
  "fun ‹fn›(‹a›: Int, ‹b›: Int = ‹n›): Int {\n    return if (‹a› > ‹b›) ‹a› - ‹b› else ‹b›\n}",
  "data class ‹T›(val ‹a›: String, val ‹b›: Int = ‹n›)",
  "val ‹a› = ‹b›.filter { it > ‹n› }.map { it * 2 }",
  "when (‹a›) {\n    0 -> println(\"‹s›\")\n    in 1..‹n› -> println(\"low\")\n    else -> println(\"high\")\n}"
];
const SQL = [
  "SELECT ‹a›, COUNT(*) AS total\nFROM ‹b›\nWHERE ‹c› > ‹n›\nGROUP BY ‹a›\nORDER BY total DESC;",
  "CREATE TABLE ‹a› (\n  id INTEGER PRIMARY KEY,\n  ‹b› TEXT NOT NULL,\n  ‹c› INTEGER DEFAULT ‹n›\n);",
  "UPDATE ‹a› SET ‹b› = '‹s›' WHERE id = ‹n2›;",
  "SELECT u.‹a›, o.‹b›\nFROM ‹c› u\nJOIN orders o ON o.user_id = u.id\nLIMIT ‹n›;",
  "INSERT INTO ‹a› (‹b›, ‹c›) VALUES ('‹s›', ‹n›);"
];
const HTML = [
  "<ul class=\"‹a›\">\n  <li><a href=\"/‹b›\">‹s›</a></li>\n  <li><a href=\"/‹c›\">‹s2›</a></li>\n</ul>",
  "<form action=\"/‹a›\" method=\"post\">\n  <label for=\"‹b›\">‹s›</label>\n  <input id=\"‹b›\" name=\"‹b›\" type=\"text\" required>\n  <button type=\"submit\">Send</button>\n</form>",
  "<div id=\"‹a›\" class=\"card\">\n  <h2>‹s›</h2>\n  <p>‹s2›</p>\n</div>",
  "<img src=\"/img/‹a›.png\" alt=\"‹s›\" width=\"‹n2›0\">"
];
const CSS = [
  ".‹a› {\n  display: flex;\n  gap: ‹n›px;\n  padding: ‹n2›px;\n  background: ‹color›;\n}",
  "#‹a› > .‹b›:hover {\n  color: ‹color›;\n  transform: translateY(-2px);\n}",
  "@media (max-width: ‹n2›0px) {\n  .‹a› {\n    grid-template-columns: 1fr;\n  }\n}",
  "body {\n  margin: 0;\n  font: 16px/1.5 system-ui, sans-serif;\n}"
];
const SH = [
  "#!/bin/bash\nset -euo pipefail\n\nfor f in *.‹ext›; do\n  echo \"processing $f\"\ndone",
  "if [ -f \"‹file›\" ]; then\n  echo \"found ‹file›\"\nelse\n  touch \"‹file›\"\nfi",
  "‹fn›() {\n  local ‹a›=\"$1\"\n  echo \"${‹a›^^}\"\n}",
  "while read -r line; do\n  echo \"$line\" | cut -d: -f1\ndone < ‹file›"
];

const LANGS = {
  javascript: { label: "JavaScript", file: "app.js", style: "camel", T: JS,
    kw: "const let var function return if else for while of in new class extends async await import export from default throw try catch typeof null true false this" },
  typescript: { label: "TypeScript", file: "index.ts", style: "camel", T: TS,
    kw: "const let function return if else for interface type enum export import async await Promise Map string number boolean readonly new null undefined" },
  python: { label: "Python", file: "main.py", style: "snake", T: PY, comment: "#",
    kw: "def class return if elif else for while in not and or import from as with try except finally raise lambda None True False self print pass" },
  c: { label: "C", file: "main.c", style: "snake", T: C,
    kw: "int char double float void struct return if else for while do switch case break const static unsigned include define sizeof NULL" },
  cpp: { label: "C++", file: "main.cpp", style: "snake", T: CPP,
    kw: "int auto class public private const return if else for while struct template typename namespace using std explicit void nullptr true false" },
  java: { label: "Java", file: "Main.java", style: "camel", T: JAVA,
    kw: "public private static final class int void return if else for while new try catch throws this String List null true false import extends" },
  csharp: { label: "C#", file: "Program.cs", style: "pascal", T: CS,
    kw: "public private static class int string var new return if else foreach for while using await async get set init null true false void" },
  go: { label: "Go", file: "main.go", style: "camel", T: GO,
    kw: "func return if else for range go defer type struct map make chan var const package import nil true false error int string" },
  rust: { label: "Rust", file: "main.rs", style: "snake", T: RS,
    kw: "fn let mut struct impl match if else while for in loop return self Self pub use mod Some None Ok Err true false u32 i32 String Vec" },
  ruby: { label: "Ruby", file: "app.rb", style: "snake", T: RB, comment: "#",
    kw: "def end class module if elsif else unless do while each return self nil true false attr_reader puts require" },
  php: { label: "PHP", file: "index.php", style: "camel", T: PHP,
    kw: "function class public private return if else foreach for while new array fn echo static int string null true false" },
  kotlin: { label: "Kotlin", file: "Main.kt", style: "camel", T: KT,
    kw: "fun val var class data when if else for while in return is null true false Int String println it" },
  sql: { label: "SQL", file: "query.sql", style: "snake", T: SQL, comment: "--",
    kw: "SELECT FROM WHERE GROUP BY ORDER LIMIT JOIN ON AS INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE PRIMARY KEY NOT NULL DEFAULT COUNT DESC ASC INTEGER TEXT" },
  html: { label: "HTML", file: "index.html", style: "kebab", T: HTML, markup: true, kw: "" },
  css: { label: "CSS", file: "style.css", style: "kebab", T: CSS, css: true, kw: "" },
  bash: { label: "Bash", file: "run.sh", style: "snake", T: SH, comment: "#",
    kw: "if then else fi for in do done while read echo local set export return function cat cut touch" }
};

for (const k of Object.keys(LANGS)) LANGS[k].kwSet = new Set(LANGS[k].kw.split(/\s+/).filter(Boolean));

const COUNT = { short: 1, medium: 2, long: 4 };

function color(rng) { let s = "#"; for (let i = 0; i < 6; i++) s += "0123456789abcdef"[rng.int(0, 15)]; return s; }

export function genCode(rng, length, only) {
  const id = only && LANGS[only] ? only : rng.pick(Object.keys(LANGS));
  const lang = LANGS[id];
  // a, b and c are drawn from separate thirds of the word list, so they can
  // never collide: `this.user = user` is fine, `add(user)` beside it is not
  const third = Math.floor(IDENT.length / 3);
  const part = (lo, hi) => (r) => IDENT[r.int(lo, hi)];
  const makeFill = () => makeFiller(rng, {
    a: part(0, third - 1), b: part(third, 2 * third - 1), c: part(2 * third, IDENT.length - 1),
    fn: (r) => ident(r, lang.style),
    T: (r) => cap(r.pick(IDENT)) + r.pick(T_SUFFIX),
    U: (r) => cap(r.pick(IDENT)),
    s: (r) => r.pick(NOUNS) + " " + r.pick(["ready", "failed", "missing", "done", "found", "empty"]),
    color
  });
  // ‹U1›, ‹U2›... are distinct capitalised names (fields, enum members): kind "U" after trailing digits are stripped
  const want = COUNT[length] || COUNT.medium;
  let pool = lang.T;
  if (length === "short") {
    const small = pool.filter((t) => t.split("\n").length <= 5);
    if (small.length) pool = small;
  }
  const picked = rng.some(pool, want);
  // a fresh filler per snippet: two snippets in one challenge are two files' worth of code, not one
  const snippets = picked.map((t) => makeFill()(t));
  const lines = [];
  snippets.forEach((snip, i) => {
    if (i) lines.push({ text: "" });
    for (const raw of snip.split("\n")) {
      const m = /^( *)(.*)$/.exec(raw.replace(/^\t+/, (t) => "    ".repeat(t.length)));
      lines.push({ indent: m[1].length, text: m[2] });
    }
  });
  // a snippet that ends the file ends it: no trailing newline to type
  return { kind: "code", lang: id, label: lang.label, file: lang.file, lines, text: lines.map((l) => l.text).join("\n") };
}

export const LANG_IDS = Object.keys(LANGS);
export const LANG = LANGS;
export const CODE_TEMPLATE_COUNT = Object.values(LANGS).reduce((s, l) => s + l.T.length, 0);
