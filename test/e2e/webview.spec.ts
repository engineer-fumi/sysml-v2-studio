/**
 * Webview end-to-end tests: load the built diagram bundle in a real browser,
 * inject a model, and hammer it with adversarial mouse interactions. The core
 * invariants after every gesture:
 *   - no uncaught page error / console error
 *   - no SVG attribute ever becomes NaN / Infinity / undefined
 *   - the boxes are still rendered (nothing vanished)
 */
import { expect, test, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const DIST = path.join(__dirname, "..", "..", "dist");
const webviewJs = fs.readFileSync(path.join(DIST, "webview.js"), "utf8");
const webviewCss = fs.readFileSync(path.join(DIST, "webview.css"), "utf8");
const model = JSON.parse(fs.readFileSync(path.join(DIST, "e2e-model.json"), "utf8"));

/** mount the webview bundle with a stubbed vscode API and inject the model */
async function mount(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${webviewCss}
     html,body,#root{margin:0;height:100%}</style></head>
     <body><div id="root"></div>
     <script>
       window.__sent = [];
       window.acquireVsCodeApi = () => ({
         postMessage: (m) => window.__sent.push(m),
         getState: () => undefined,
         setState: () => {},
       });
     </script>
     <script>${webviewJs}</script>
     </body></html>`,
    { waitUntil: "load" }
  );

  // the app posts {type:"ready"} once its message listener is attached
  await page.waitForFunction(() => (window as any).__sent?.some((m: any) => m.type === "ready"));
  await page.evaluate((m) => window.postMessage(m, "*"), model);
  await page.waitForSelector("svg rect", { timeout: 5000 });
  return errors;
}

/** report any SVG numeric attribute that turned non-finite */
async function findBadAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const attrs = ["x", "y", "width", "height", "cx", "cy", "rx", "ry", "x1", "y1", "x2", "y2", "d", "points", "transform"];
    for (const el of Array.from(document.querySelectorAll("svg *"))) {
      for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v && /(NaN|Infinity|undefined)/.test(v)) return `<${el.tagName} ${a}="${v}">`;
      }
    }
    return null;
  });
}

/** centre (page coords) of the smallest draggable box, i.e. a leaf node */
async function smallestMovableBox(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const rects = Array.from(document.querySelectorAll("svg rect")) as SVGRectElement[];
    const movable = rects.filter((r) => getComputedStyle(r).cursor === "move");
    movable.sort((a, b) => {
      const ba = a.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      return ba.width * ba.height - bb.width * bb.height;
    });
    const r = movable[0];
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

async function rectCount(page: Page): Promise<number> {
  return page.locator("svg rect").count();
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

test("renders the model and survives adversarial box drags", async ({ page }) => {
  const errors = await mount(page);
  const before = await rectCount(page);
  expect(before).toBeGreaterThan(0);

  const box = await smallestMovableBox(page);
  expect(box).not.toBeNull();

  // 1) drag the box far outside the viewport, then far the other way
  await drag(page, box!, { x: box!.x + 4000, y: box!.y + 3000 });
  expect(await findBadAttr(page)).toBeNull();
  let now = await smallestMovableBox(page);
  await drag(page, now!, { x: -3000, y: -2000 });
  expect(await findBadAttr(page)).toBeNull();

  // 2) a burst of rapid jittery drags
  for (let i = 0; i < 12; i++) {
    now = await smallestMovableBox(page);
    if (!now) break;
    await drag(page, now, { x: now.x + (i % 2 ? 250 : -250), y: now.y + (i % 3 ? 180 : -120) }, 2);
    expect(await findBadAttr(page)).toBeNull();
  }

  // boxes must still all be present and the page must be error-free
  expect(await rectCount(page)).toBeGreaterThanOrEqual(before);
  await page.screenshot({ path: path.join(DIST, "e2e-output", "after-box-drags.png") });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("survives line routing and endpoint drags", async ({ page }) => {
  const errors = await mount(page);

  // grab the connector path (a flow/connect line) by its midpoint and drag it
  const line = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll("svg path")).filter((p) => {
      const d = p.getAttribute("d") || "";
      return d.includes("M") && getComputedStyle(p).cursor === "move";
    }) as SVGPathElement[];
    const p = paths[0];
    if (!p) return null;
    const b = p.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });

  if (line) {
    // bend it wildly, then drag the new waypoint around
    await drag(page, line, { x: line.x + 2000, y: line.y - 1500 });
    expect(await findBadAttr(page)).toBeNull();
    await drag(page, { x: line.x + 60, y: line.y }, { x: line.x - 4000, y: line.y + 2500 }, 3);
    expect(await findBadAttr(page)).toBeNull();
  }

  await page.screenshot({ path: path.join(DIST, "e2e-output", "after-line-drags.png") });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("survives rapid pan and wheel-zoom spam", async ({ page }) => {
  const errors = await mount(page);
  const svg = page.locator("svg.diagram-svg");
  const bb = await svg.boundingBox();
  expect(bb).not.toBeNull();
  const cx = bb!.x + bb!.width / 2;
  const cy = bb!.y + bb!.height / 2;

  // zoom in and out aggressively at the cursor
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(cx + (i % 5) * 10, cy + (i % 3) * 10);
    await page.mouse.wheel(0, i % 2 ? -600 : 600);
  }
  expect(await findBadAttr(page)).toBeNull();

  // pan rapidly in several directions
  for (const [dx, dy] of [[600, 400], [-1200, -800], [900, -600]]) {
    await drag(page, { x: cx, y: cy }, { x: cx + dx, y: cy + dy }, 3);
  }
  expect(await findBadAttr(page)).toBeNull();
  expect(errors, errors.join("\n")).toEqual([]);
});
