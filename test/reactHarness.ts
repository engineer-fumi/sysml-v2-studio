/**
 * Minimal React hook test harness: a jsdom DOM + a `renderHook` that mounts a
 * probe component, runs the hook, and exposes its latest return value plus an
 * `act`-wrapped updater. No test framework — just esbuild + node, consistent
 * with the other test:* scripts. Run via npm run test:hooks.
 *
 * jsdom globals must be installed before react-dom evaluates, so this module
 * sets them up at import time and is imported first by the test entry.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
/** assign a global only if it is writable (node 20+ makes `navigator` read-only) */
const setGlobal = (key: string, value: unknown) => {
  try {
    g[key] = value;
  } catch {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
};
setGlobal("window", dom.window);
setGlobal("document", dom.window.document);
setGlobal("HTMLElement", dom.window.HTMLElement);
setGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
  dom.window.setTimeout(() => cb(Date.now()), 0)
);
setGlobal("cancelAnimationFrame", (id: number) => dom.window.clearTimeout(id));
setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

// react is imported AFTER the DOM globals exist (esbuild keeps import order)
import * as React from "react";
import { createRoot, Root } from "react-dom/client";

const act = (React as unknown as { act: (cb: () => void) => void }).act;

export interface HookHandle<T> {
  /** latest hook return value */
  current: T;
  /** run a callback inside act() and flush React updates */
  act(fn: () => void): void;
  unmount(): void;
}

/** mount a component that calls `hook()` and capture its return value */
export function renderHook<T>(hook: () => T): HookHandle<T> {
  const handle = { current: undefined as unknown as T } as HookHandle<T>;
  const container = document.createElement("div");
  let root: Root;

  function Probe() {
    handle.current = hook();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });

  handle.act = (fn: () => void) => act(fn);
  handle.unmount = () => act(() => root.unmount());
  return handle;
}
