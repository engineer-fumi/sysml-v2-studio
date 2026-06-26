/**
 * React hook tests (jsdom). Run with: npm run test:hooks
 */
import * as assert from "node:assert";
import { renderHook } from "./reactHarness";
import { zoomAt, toDiagramCoords } from "../src/webview/diagramInteractions";
import { usePanZoom } from "../src/webview/usePanZoom";
import { DragCommit, useDiagramDrag } from "../src/webview/useDiagramDrag";

let passed = 0;
function test(title: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`PASS: ${title}`);
}

// ---- pure pan/zoom math --------------------------------------------------

test("zoomAt keeps the point under the cursor fixed on screen", () => {
  const v = { tx: 20, ty: 20, scale: 1 };
  const [mx, my] = [200, 150];
  const before = toDiagramCoords(v, mx, my);
  const z = zoomAt(v, mx, my, -1); // zoom in
  assert.ok(z.scale > v.scale, "zoom in increases scale");
  const after = toDiagramCoords(z, mx, my);
  assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, "anchor fixed");
});

test("zoomAt clamps the scale to [0.15, 4]", () => {
  let v = { tx: 0, ty: 0, scale: 4 };
  v = zoomAt(v, 0, 0, -1); // try to zoom further in
  assert.ok(v.scale <= 4, "max scale");
  let w = { tx: 0, ty: 0, scale: 0.15 };
  w = zoomAt(w, 0, 0, 1); // try to zoom further out
  assert.ok(w.scale >= 0.15, "min scale");
});

// ---- usePanZoom hook -----------------------------------------------------

test("usePanZoom starts at the default view", () => {
  const h = renderHook(() => usePanZoom());
  assert.deepStrictEqual(h.current.view, { tx: 20, ty: 20, scale: 1 });
  h.unmount();
});

test("usePanZoom wheel zooms and reset restores the default", () => {
  const h = renderHook(() => usePanZoom());
  h.act(() => h.current.onWheel(100, 100, -1));
  assert.ok(h.current.view.scale > 1, "wheel in zooms");
  h.act(() => h.current.reset());
  assert.deepStrictEqual(h.current.view, { tx: 20, ty: 20, scale: 1 }, "reset");
  h.unmount();
});

test("usePanZoom pan translates the view by the drag delta", () => {
  const h = renderHook(() => usePanZoom());
  h.act(() => h.current.beginPan(50, 50));
  h.act(() => {
    const moving = h.current.movePan(80, 70); // +30, +20
    assert.strictEqual(moving, true, "pan in progress");
  });
  assert.strictEqual(h.current.view.tx, 50, "tx translated by +30 from 20");
  assert.strictEqual(h.current.view.ty, 40, "ty translated by +20 from 20");
  h.act(() => h.current.endPan());
  h.act(() => assert.strictEqual(h.current.movePan(200, 200), false, "no pan after endPan"));
  h.unmount();
});

test("usePanZoom fit centers the content within the viewport", () => {
  const h = renderHook(() => usePanZoom());
  h.act(() => h.current.fit(1000, 500, 540, 540)); // content vs viewport
  assert.ok(h.current.view.scale > 0 && h.current.view.scale <= 1.5, "scale within bounds");
  assert.ok(Number.isFinite(h.current.view.tx) && Number.isFinite(h.current.view.ty), "centered");
  h.unmount();
});

// ---- useDiagramDrag hook -------------------------------------------------

/** a commit spy + a 1:1 toDiagram transform (client coords == diagram coords) */
function dragSetup() {
  const calls: string[] = [];
  const commit: DragCommit = {
    moveBox: (k, dx, dy) => calls.push(`moveBox ${k} ${dx} ${dy}`),
    resizeBox: (k, mw, mh, dx, dy) => calls.push(`resizeBox ${k} ${mw} ${mh} ${dx} ${dy}`),
    movePort: (k, side, t) => calls.push(`movePort ${k} ${side} ${t.toFixed(2)}`),
    anchorEdge: (k, w, side, t) => calls.push(`anchorEdge ${k} ${w} ${side}`),
    routeEdge: (k, pts) => calls.push(`routeEdge ${k} ${pts.length}`),
  };
  const deps = { toDiagram: (x: number, y: number) => ({ x, y }), scale: 1, commit };
  return { calls, deps };
}

test("useDiagramDrag box move: live preview then commit", () => {
  const { calls, deps } = dragSetup();
  const h = renderHook(() => useDiagramDrag(deps));
  assert.strictEqual(h.current.isActive(), false);

  h.act(() => h.current.start({ type: "box", key: "B", sx: 10, sy: 10 }));
  assert.strictEqual(h.current.isActive(), true);

  h.act(() => {
    const consumed = h.current.onMove(40, 30); // dx 30, dy 20
    assert.strictEqual(consumed, true, "the drag consumes the move");
  });
  assert.deepStrictEqual(h.current.live.drag, { key: "B", dx: 30, dy: 20 });

  let committed = false;
  h.act(() => {
    committed = h.current.onEnd();
  });
  assert.strictEqual(committed, true, "onEnd reports a commit (suppress the click)");
  assert.deepStrictEqual(calls, ["moveBox B 30 20"]);
  assert.strictEqual(h.current.live.drag, null, "live state cleared");
  assert.strictEqual(h.current.isActive(), false);
  h.unmount();
});

test("useDiagramDrag resize: bottom edge fixed and committed", () => {
  const { calls, deps } = dragSetup();
  const h = renderHook(() => useDiagramDrag(deps));
  h.act(() =>
    h.current.start({
      type: "resize",
      key: "R",
      sx: 0,
      sy: 0,
      fromTop: true,
      startW: 200,
      startH: 100,
      startDx: 0,
      startDy: 20,
    })
  );
  h.act(() => h.current.onMove(0, -30)); // drag up by 30
  const r = h.current.live.resize!;
  assert.strictEqual(r.mh, 130, "grows by the upward drag");
  assert.strictEqual(r.dy + r.mh, 20 + 100, "bottom edge stays fixed");
  h.act(() => h.current.onEnd());
  assert.deepStrictEqual(calls, ["resizeBox R 200 130 0 -10"]);
  h.unmount();
});

test("useDiagramDrag ignores sub-pixel moves and inactive end", () => {
  const { calls, deps } = dragSetup();
  const h = renderHook(() => useDiagramDrag(deps));
  // no active drag → onMove does not consume, onEnd commits nothing
  h.act(() => assert.strictEqual(h.current.onMove(5, 5), false));
  let committed = true;
  h.act(() => {
    committed = h.current.onEnd();
  });
  assert.strictEqual(committed, false);

  // a tiny box nudge (<1px) is treated as a click, not a move
  h.act(() => h.current.start({ type: "box", key: "B", sx: 0, sy: 0 }));
  h.act(() => h.current.onMove(0.5, 0.5));
  h.act(() => h.current.onEnd());
  assert.deepStrictEqual(calls, [], "no commit for a sub-pixel drag");
  h.unmount();
});

console.log(`ALL HOOK TESTS PASSED (${passed})`);
