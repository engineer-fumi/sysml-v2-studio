/**
 * Unit tests for the pure diagram geometry helpers (no VS Code / React).
 * Run with: npm run test:geometry
 */
import * as assert from "node:assert";
import {
  clampToBorder,
  distToSegment,
  orthoSegment,
  pathFor,
  sideAxis,
} from "../src/webview/diagramGeometry";
import { computeResize, translatePoints } from "../src/webview/diagramInteractions";

const box = { x: 100, y: 100, w: 200, h: 100 }; // borders: x∈[100,300], y∈[100,200]

let passed = 0;
function test(title: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`PASS: ${title}`);
}

test("sideAxis detects the border a point sits on", () => {
  assert.strictEqual(sideAxis(box, { x: 100, y: 150 }), "h", "left border → horizontal exit");
  assert.strictEqual(sideAxis(box, { x: 300, y: 150 }), "h", "right border → horizontal exit");
  assert.strictEqual(sideAxis(box, { x: 200, y: 100 }), "v", "top border → vertical exit");
  assert.strictEqual(sideAxis(box, { x: 200, y: 200 }), "v", "bottom border → vertical exit");
});

test("clampToBorder snaps to the nearest side with a 0..1 position", () => {
  const right = clampToBorder(box, 305, 150);
  assert.strictEqual(right.side, "right");
  assert.ok(Math.abs(right.x - 300) < 1e-9, "x on right border");
  assert.ok(Math.abs(right.t - 0.5) < 1e-9, "midway down");

  const top = clampToBorder(box, 200, 95);
  assert.strictEqual(top.side, "top");
  assert.ok(Math.abs(top.y - 100) < 1e-9, "y on top border");

  // position is clamped to [0.05, 0.95]
  const corner = clampToBorder(box, 100, 100);
  assert.ok(corner.t >= 0.05 && corner.t <= 0.95, "t stays within margins");
});

test("distToSegment measures perpendicular and endpoint distances", () => {
  const d = distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(Math.abs(d - 5) < 1e-9, "perpendicular distance");
  const beyond = distToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(Math.abs(beyond - 10) < 1e-9, "clamps to the nearest endpoint");
});

test("pathFor straight draws a polyline through all points", () => {
  const d = pathFor([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }], "straight");
  assert.strictEqual(d, "M 0 0 L 10 5 L 20 0");
});

test("pathFor curve emits a smooth bezier for two points", () => {
  const d = pathFor([{ x: 0, y: 0 }, { x: 100, y: 0 }], "curve");
  assert.ok(d.startsWith("M 0 0 C"), "starts with a cubic bezier");
});

test("orthoSegment exits and arrives perpendicular to borders", () => {
  // leave horizontally, arrive horizontally → mid vertical jog (h..h)
  const hh = orthoSegment({ x: 0, y: 0 }, { x: 100, y: 40 }, "h", "h");
  assert.ok(hh.includes("L 50 0") && hh.includes("L 50 40"), `h→h jogs at the midpoint: ${hh}`);
  // leave vertically, arrive horizontally → single corner
  const vh = orthoSegment({ x: 0, y: 0 }, { x: 100, y: 40 }, "v", "h");
  assert.strictEqual(vh, " L 0 40 L 100 40");
});

test("pathFor ortho makes the final segment hit the end axis perpendicular", () => {
  // end on a left/right border (endAxis 'h') → last move is horizontal into it
  const d = pathFor([{ x: 0, y: 0 }, { x: 100, y: 40 }], "ortho", "h", "h");
  assert.ok(d.endsWith("L 100 40"), "arrives at the endpoint");
  assert.ok(d.includes(" 50 "), "jogs midway for a clean right angle");
});

test("computeResize bottom-right keeps the top-left anchor and grows", () => {
  const start = { startW: 200, startH: 100, startDx: 10, startDy: 20, fromTop: false };
  const r = computeResize(start, 50, 40);
  assert.deepStrictEqual(r, { mw: 250, mh: 140, dx: 10, dy: 20 }, "grows down/right, dx/dy unchanged");
});

test("computeResize top-right keeps the BOTTOM edge fixed (no jump)", () => {
  const start = { startW: 200, startH: 100, startDx: 10, startDy: 20, fromTop: true };
  // drag up by 30 (ddh negative) → box grows by 30 upward
  const r = computeResize(start, 0, -30);
  assert.strictEqual(r.mh, 130, "height grows by the upward drag");
  // invariant: dy + mh stays equal to startDy + startH so the bottom never moves
  assert.strictEqual(r.dy + r.mh, start.startDy + start.startH, "bottom edge fixed");
});

test("computeResize clamps to the minimum size", () => {
  const start = { startW: 200, startH: 100, startDx: 0, startDy: 0, fromTop: false };
  const r = computeResize(start, -1000, -1000);
  assert.ok(r.mw >= 40 && r.mh >= 30, "never shrinks below the minimum");
});

test("translatePoints shifts every waypoint by the delta", () => {
  const moved = translatePoints([{ x: 0, y: 0 }, { x: 10, y: 5 }], 3, -2);
  assert.deepStrictEqual(moved, [{ x: 3, y: -2 }, { x: 13, y: 3 }]);
});

console.log(`ALL GEOMETRY TESTS PASSED (${passed})`);
