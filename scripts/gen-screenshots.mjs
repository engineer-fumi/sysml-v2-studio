/**
 * Generates demo screenshots of each diagram kind by mounting the built
 * webview bundle in headless chromium, posting a rich model, switching kinds
 * and capturing PNGs into docs/images/. Run via: npm run gen:screenshots
 * (the script builds the webview and the demo model first).
 */
import { chromium } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "docs", "images");
fs.mkdirSync(OUT, { recursive: true });

const webviewJs = fs.readFileSync(path.join(DIST, "webview.js"), "utf8");
const webviewCss = fs.readFileSync(path.join(DIST, "webview.css"), "utf8");
const models = JSON.parse(fs.readFileSync(path.join(DIST, "demo-models.json"), "utf8"));

const KINDS = [
  { id: "general", file: "diagram-general" },
  { id: "bdd", file: "diagram-bdd" },
  { id: "ibd", file: "diagram-ibd" },
  { id: "req", file: "diagram-req" },
  { id: "uc", file: "diagram-uc" },
  { id: "state", file: "diagram-state" },
  { id: "action", file: "diagram-action" },
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${webviewCss}
  html,body,#root{margin:0;height:100%;background:#14141f}</style></head>
  <body><div id="root"></div>
  <script>
    window.__sent = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => window.__sent.push(m), getState: () => undefined, setState: () => {},
    });
  </script>
  <script>${webviewJs}</script>
  </body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1.5 });

for (const k of KINDS) {
  // remount fresh per kind — the webview only honours `kind` on the first model
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => window.__sent?.some((m) => m.type === "ready"));
  await page.evaluate(
    (msg) => window.postMessage(msg, "*"),
    { type: "model", files: models[k.id].files, layouts: models[k.id].layouts ?? {}, kind: k.id }
  );
  await page.waitForSelector("svg.diagram-svg rect", { timeout: 8000 });
  await page.waitForTimeout(400);
  // Fit, then clip tightly to the rendered diagram content (drop the toolbar
  // and the empty canvas) for a clean, consistent demo image
  await page.locator(".diagram-toolbar button").first().click();
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const g = document.querySelector("svg.diagram-svg g[data-viewport]");
    const b = g.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const pad = 22;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(1100 - Math.max(0, box.x - pad), box.width + pad * 2),
    height: Math.min(760 - Math.max(0, box.y - pad), box.height + pad * 2),
  };
  const out = path.join(OUT, `${k.file}.png`);
  await page.screenshot({ path: out, clip });
  console.log("wrote", path.relative(ROOT, out), `${Math.round(clip.width)}x${Math.round(clip.height)}`);
}

await browser.close();
