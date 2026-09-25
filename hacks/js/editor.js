/* editor.js — a small code editor: a textarea with colour behind it.
 *
 * Nothing in this repository edits code, so this is new. It is the oldest
 * trick for a light editor: the text you type goes into an ordinary
 * <textarea> (so selection, undo, paste, spell-off and phone keyboards all
 * work the way the browser already makes them work), with transparent text,
 * laid exactly over a <pre> that shows the same text coloured. A gutter
 * numbers the lines and marks the one an error came from.
 *
 * On top of the textarea: Tab and Shift+Tab indent, Enter keeps the
 * indentation (and adds a level after an opening bracket), Ctrl+/ comments
 * lines, Ctrl+S / Ctrl+Enter runs. The highlighter knows JavaScript's words
 * and this game's globals, so `me`, `enemies` and `draw` stand out as the
 * things a hack can reach. */

import { escHtml } from "./util.js";

const KEYWORDS = new Set("break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await static get set".split(" "));
const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);
const GLOBALS = new Set(["me", "players", "enemies", "allies", "projectiles", "world", "input", "draw", "screen", "view", "keys", "vec", "physics", "match", "time", "dt", "on", "ui", "log", "print", "hack", "BONES", "LINKS", "deg", "rad", "wrap", "clamp", "lerp", "Math"]);

/** JavaScript to coloured HTML. Tolerant: an unfinished string or comment runs to the end. */
export function highlight(src) {
  let out = "", i = 0;
  const n = src.length;
  const span = (cls, s) => '<span class="' + cls + '">' + escHtml(s) + "</span>";
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { let j = src.indexOf("\n", i); if (j < 0) j = n; out += span("c", src.slice(i, j)); i = j; continue; }
    if (c === "/" && d === "*") { let j = src.indexOf("*/", i + 2); j = j < 0 ? n : j + 2; out += span("c", src.slice(i, j)); i = j; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; else if (src[j] === "\n" && c !== "`") break; j++; }
      j = Math.min(n, j + 1);
      out += span("s", src.slice(i, j)); i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(d || ""))) {
      const m = /^(0x[0-9a-fA-F]+|[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?)/.exec(src.slice(i));
      out += span("n", m[0]); i += m[0].length; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      const w = m[0];
      const next = src.slice(i + w.length).match(/^\s*\(/);
      const prev = out.endsWith(".") || out.endsWith('.</span>');
      const cls = KEYWORDS.has(w) ? "k" : LITERALS.has(w) ? "n" : GLOBALS.has(w) && !prev ? "g" : next ? "f" : prev ? "p" : "";
      out += cls ? span(cls, w) : escHtml(w);
      i += w.length; continue;
    }
    if ("{}()[]".includes(c)) { out += span("b", c); i++; continue; }
    if ("=+-*/%<>!&|?:".includes(c)) { out += span("o", c); i++; continue; }
    out += escHtml(c); i++;
  }
  return out + "\n";
}

export function createEditor(host, opts) {
  opts = opts || {};
  host.classList.add("ed");
  host.innerHTML = '<div class="ed-gutter" aria-hidden="true"></div><div class="ed-scroll"><pre class="ed-pre" aria-hidden="true"></pre><textarea class="ed-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Hack code"></textarea></div>';
  const gutter = host.querySelector(".ed-gutter"), pre = host.querySelector(".ed-pre"), ta = host.querySelector(".ed-ta"), scroll = host.querySelector(".ed-scroll");
  let errLine = 0, lines = 0;

  function paint() {
    pre.innerHTML = highlight(ta.value);
    const n = ta.value.split("\n").length;
    if (n !== lines || gutter.dataset.err !== String(errLine)) {
      lines = n;
      gutter.dataset.err = String(errLine);
      let g = "";
      for (let k = 1; k <= n; k++) g += '<div class="' + (k === errLine ? "err" : "") + '">' + k + "</div>";
      gutter.innerHTML = g;
    }
    [...pre.querySelectorAll(".errline")].forEach((e) => e.remove());
    if (errLine) {
      const mark = document.createElement("div");
      mark.className = "errline";
      mark.style.top = "calc(" + (errLine - 1) + " * var(--lh) + var(--pad))";
      pre.appendChild(mark);
    }
  }
  function syncScroll() { gutter.scrollTop = scroll.scrollTop; }

  /* Replace the selection, keeping undo working where the browser allows it. */
  function insert(text, selStart, selEnd) {
    ta.focus();
    if (selStart != null) ta.setSelectionRange(selStart, selEnd);
    const ok = document.execCommand && document.execCommand("insertText", false, text);
    if (!ok) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end"); }
    changed();
  }
  function lineRange() {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const a = v.lastIndexOf("\n", s - 1) + 1;
    let b = v.indexOf("\n", e - (e > s && v[e - 1] === "\n" ? 1 : 0));
    if (b < 0) b = v.length;
    return [a, b];
  }
  function mapLines(fn) {
    const [a, b] = lineRange();
    const block = ta.value.slice(a, b);
    const next = block.split("\n").map(fn).join("\n");
    insert(next, a, b);
    ta.setSelectionRange(a, a + next.length);
  }

  ta.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "s" || e.key === "Enter")) { e.preventDefault(); if (opts.onRun) opts.onRun(); return; }
    if (mod && e.key === "/") {
      e.preventDefault();
      const [a, b] = lineRange();
      const all = ta.value.slice(a, b).split("\n").every((l) => /^\s*\/\//.test(l) || !l.trim());
      mapLines((l) => (all ? l.replace(/^(\s*)\/\/ ?/, "$1") : l.trim() ? l.replace(/^(\s*)/, "$1// ") : l));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      if (s !== en && ta.value.slice(s, en).includes("\n")) mapLines((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : "  " + l));
      else if (e.shiftKey) mapLines((l) => l.replace(/^ {1,2}/, ""));
      else insert("  ");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      e.preventDefault();
      const v = ta.value, s = ta.selectionStart;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const indent = /^\s*/.exec(v.slice(lineStart, s))[0];
      const before = v.slice(lineStart, s).trimEnd();
      const after = v[ta.selectionEnd] || "";
      const open = /[{[(]$/.test(before);
      if (open && /[}\])]/.test(after)) { insert("\n" + indent + "  \n" + indent); ta.setSelectionRange(s + indent.length + 3, s + indent.length + 3); }
      else insert("\n" + indent + (open ? "  " : ""));
      return;
    }
    if (e.key === "}" && !mod) {
      // a closing brace on an otherwise empty line goes back one level
      const v = ta.value, s = ta.selectionStart;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      if (/^\s+$/.test(v.slice(lineStart, s)) && s === ta.selectionEnd) { e.preventDefault(); insert(v.slice(lineStart, s).replace(/ {1,2}$/, "") + "}", lineStart, s); }
    }
  });
  function changed() { paint(); if (opts.onChange) opts.onChange(ta.value); }
  ta.addEventListener("input", changed);
  scroll.addEventListener("scroll", syncScroll);

  return {
    get value() { return ta.value; },
    set value(v) { ta.value = v; errLine = 0; paint(); scroll.scrollTop = 0; scroll.scrollLeft = 0; syncScroll(); },
    setError(line) { errLine = line | 0; paint(); if (errLine) { const lh = parseFloat(getComputedStyle(host).getPropertyValue("--lh")) || 18; scroll.scrollTop = Math.max(0, (errLine - 4) * lh); syncScroll(); } },
    focus() { ta.focus(); },
    textarea: ta,
    readOnly(v) { ta.readOnly = !!v; }
  };
}
