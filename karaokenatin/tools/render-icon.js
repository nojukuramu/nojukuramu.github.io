/* tools/render-icon.js — rasterise icons/icon.svg to a 1024px PNG.
 *
 * The icon is drawn as SVG so it can be edited here, but PIL cannot read SVG,
 * and adding a Python SVG library for one file is more than it is worth. The
 * repository's e2e tools already drive Chromium through Playwright, so this
 * uses the same browser to render it.
 *
 * Run: node tools/render-icon.js [out.png]   (default: /tmp/kn-icon.png)
 * then: python3 tools/make-icons.py <out.png>
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const SRC = path.resolve(__dirname, "..", "icons", "icon.svg");
const OUT = process.argv[2] || "/tmp/kn-icon.png";

(async function () {
  const svg = fs.readFileSync(SRC, "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(
    '<html><body style="margin:0;background:transparent">' + svg + "</body></html>"
  );
  await page.locator("svg").screenshot({ path: OUT, omitBackground: true });
  await browser.close();
  console.log("wrote " + OUT);
})();
