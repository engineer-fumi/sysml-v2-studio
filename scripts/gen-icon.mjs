/**
 * Renders the extension icon (an SVG block-diagram motif) to a 256×256 PNG at
 * media/icon.png using headless chromium. Run via: npm run gen:icon
 */
import { chromium } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "media");
fs.mkdirSync(OUT, { recursive: true });

// A balanced block-diagram mark: a "part" definition composing a "state",
// wired to an "item" through a port — the three pillars of a SysML model.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#222438"/>
      <stop offset="1" stop-color="#0f1019"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#bg)"/>
  <rect x="3" y="3" width="250" height="250" rx="53" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>

  <!-- connectors (drawn under the blocks) -->
  <g fill="none" stroke="#89b4fa" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M84 118 L84 168 L120 168"/>
  </g>
  <!-- composition diamond at the parent end -->
  <path d="M84 118 l11 8 l-11 8 l-11 -8 z" fill="#89b4fa"/>
  <!-- port-to-port link -->
  <path d="M150 90 L176 90" stroke="#fab387" stroke-width="6" stroke-linecap="round"/>

  <g filter="url(#sh)" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-weight="700" text-anchor="middle">
    <!-- part def -->
    <rect x="40" y="62" width="92" height="50" rx="11" fill="#26385c" stroke="#89b4fa" stroke-width="3.5"/>
    <text x="86" y="94" font-size="23" fill="#dbe4ff">part</text>

    <!-- item def -->
    <rect x="176" y="64" width="74" height="46" rx="11" fill="#1d3f38" stroke="#a6e3a1" stroke-width="3.5"/>
    <text x="213" y="94" font-size="21" fill="#dffbe0">item</text>

    <!-- state (rounded) -->
    <rect x="120" y="146" width="92" height="48" rx="24" fill="#3c2542" stroke="#f5c2e7" stroke-width="3.5"/>
    <text x="166" y="176" font-size="20" fill="#fbe2f4">state</text>
  </g>

  <!-- ports -->
  <rect x="144" y="83" width="13" height="13" rx="2" fill="#fab387" stroke="#11121b" stroke-width="1.5"/>
  <rect x="170" y="83" width="13" height="13" rx="2" fill="#fab387" stroke="#11121b" stroke-width="1.5"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 2 });
await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`, {
  waitUntil: "load",
});
const out = path.join(OUT, "icon.png");
await page.locator("svg").screenshot({ path: out, omitBackground: true });
await browser.close();
console.log("wrote", path.relative(ROOT, out));
