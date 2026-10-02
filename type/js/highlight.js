/* ============================================================
   Type — a very small syntax colourer

   Not a parser: it sorts each character of a line into comment, string,
   number, keyword or plain, which is all a typing editor needs to look like
   one. Strings and comments are the only things that span characters; a
   line is classified on its own, because every snippet is written so that
   none of them runs past the end of a line.
   ============================================================ */

/** @returns {string[]} one class name per character: "", "k", "s", "n", "c", "t" (tag) or "p" (property) */
export function classify(line, lang) {
  const out = new Array(line.length).fill("");
  if (lang.markup) return markup(line, out);
  if (lang.css) return css(line, out);
  let i = 0;
  const comment = lang.comment || "//";
  while (i < line.length) {
    const ch = line[i];
    if (line.startsWith(comment, i) && !(comment === "#" && i === 0 && line[1] === "!") ) { for (let j = i; j < line.length; j++) out[j] = "c"; break; }
    if (comment === "#" && i === 0 && line[1] === "!") { for (let j = 0; j < line.length; j++) out[j] = "c"; break; }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) { if (line[j] === "\\") j++; j++; }
      // a lone apostrophe (a lifetime, a contraction) is not a string
      if (j >= line.length && ch === "'") { i++; continue; }
      for (let k = i; k <= Math.min(j, line.length - 1); k++) out[k] = "s";
      i = j + 1; continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z_]/.test(line[i - 1] || "")) {
      let j = i; while (j < line.length && /[0-9._]/.test(line[j])) j++;
      for (let k = i; k < j; k++) out[k] = "n"; i = j; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i; while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
      if (lang.kwSet.has(line.slice(i, j))) for (let k = i; k < j; k++) out[k] = "k";
      i = j; continue;
    }
    i++;
  }
  return out;
}

function markup(line, out) {
  const re = /<\/?[A-Za-z][^>\s]*|\/?>|"[^"]*"/g;
  let m;
  while ((m = re.exec(line))) {
    const cls = m[0][0] === '"' ? "s" : "t";
    for (let k = 0; k < m[0].length; k++) out[m.index + k] = cls;
  }
  return out;
}

function css(line, out) {
  const prop = /^\s*([a-z-]+)(?=\s*:)/.exec(line);
  if (prop) for (let k = 0; k < prop[1].length; k++) out[line.indexOf(prop[1]) + k] = "p";
  const sel = /^[.#@]?[A-Za-z][^{:]*(?=\{)|^[.#@][^{]*(?=\{)/.exec(line);
  if (sel) for (let k = 0; k < sel[0].length; k++) out[k] = "t";
  const re = /#[0-9a-f]{3,6}\b|\b\d+(\.\d+)?(px|rem|em|%|vh|vw)?/gi;
  let m;
  while ((m = re.exec(line))) if (!out[m.index]) for (let k = 0; k < m[0].length; k++) out[m.index + k] = "n";
  return out;
}
