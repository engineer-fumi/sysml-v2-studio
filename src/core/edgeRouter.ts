/**
 * Orthogonal, obstacle-avoiding edge router (pure — no DOM, unit-tested directly
 * like diagramGeometry.ts).
 *
 * Approach (validated by a routing-only de-risk spike: the worst real bdd model,
 * 901×2849px / 69 boxes / 39 wires, went from 62 box-crossings straight → 0):
 * A* over the **Hanan grid** of box borders + midlines (± a small gutter margin),
 * with a turn penalty so routes stay straight-biased. A box that is an ancestor,
 * self, or descendant of either endpoint is NOT an obstacle — a container the
 * edge legitimately sits inside must not block it (missing that exclusion made
 * the spike look 2× worse than it is).
 *
 * `makeRouter` builds the grid and a per-cell obstacle cover list ONCE; `route`
 * then runs a heap-based A* per edge, so the whole diagram routes in one pass.
 * The router only ever returns geometry — it never persists anything, and the
 * caller applies it only to edges without manual routing (manual always wins).
 */
import { SysMLElement } from "./ast";

export interface Pt {
  x: number;
  y: number;
}

/** an obstacle / endpoint rectangle tagged with its model element */
export interface RouteBox {
  x: number;
  y: number;
  w: number;
  h: number;
  el: SysMLElement;
}

export interface RouteOptions {
  /** gutter grid lines are added this far outside each box (default 8) */
  margin?: number;
  /** A* cost added per right-angle turn — higher = straighter (default 40) */
  turnPenalty?: number;
  /** safety cap: above this many grid cells the router disables itself and the
   *  caller falls back to straight lines (default 250_000) */
  maxCells?: number;
}

export interface Router {
  /** orthogonal border-to-border path, or null if unroutable / disabled */
  route(a: RouteBox, b: RouteBox): Pt[] | null;
  /** true when the grid exceeded maxCells and routing is disabled */
  readonly disabled: boolean;
}

// ---- element relationship (obstacle exclusion) ----------------------------

function isAncestorOrSelf(el: SysMLElement, target: SysMLElement): boolean {
  for (let c: SysMLElement | undefined = target; c; c = c.parent) if (c === el) return true;
  return false;
}

/** a box related to an endpoint (its container OR its own content) never obstructs it */
function relatedToEndpoint(boxEl: SysMLElement, ep: SysMLElement): boolean {
  return isAncestorOrSelf(boxEl, ep) || isAncestorOrSelf(ep, boxEl);
}

// ---- min-heap keyed by f-score --------------------------------------------

/** binary min-heap of cell indices, ordered by an external `f` array. Uses lazy
 *  insertion (a cell may be pushed more than once; stale pops are skipped by the
 *  caller via the g-score check). */
class Heap {
  private a: number[] = [];
  constructor(private f: Float64Array) {}
  get size(): number {
    return this.a.length;
  }
  push(i: number): void {
    const a = this.a;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.f[a[p]] <= this.f[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let p = 0;
      const n = a.length;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let s = p;
        if (l < n && this.f[a[l]] < this.f[a[s]]) s = l;
        if (r < n && this.f[a[r]] < this.f[a[s]]) s = r;
        if (s === p) break;
        [a[p], a[s]] = [a[s], a[p]];
        p = s;
      }
    }
    return top;
  }
}

// ---- grid helpers ---------------------------------------------------------

function sortedUnique(vals: number[]): number[] {
  const s = [...new Set(vals)].sort((a, b) => a - b);
  return s;
}

function nearestIndex(arr: number[], v: number): number {
  // binary search for the closest coordinate
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(arr[lo - 1] - v) <= Math.abs(arr[lo] - v)) return lo - 1;
  return lo;
}

const EPS = 0.5;
function strictlyInside(px: number, py: number, r: RouteBox): boolean {
  return px > r.x + EPS && px < r.x + r.w - EPS && py > r.y + EPS && py < r.y + r.h - EPS;
}

// ---- router ---------------------------------------------------------------

export function makeRouter(boxes: RouteBox[], opts: RouteOptions = {}): Router {
  const margin = opts.margin ?? 8;
  const turn = opts.turnPenalty ?? 40;
  const maxCells = opts.maxCells ?? 250_000;

  const xs = sortedUnique(
    boxes.flatMap((r) => [r.x - margin, r.x, r.x + r.w / 2, r.x + r.w, r.x + r.w + margin])
  );
  const ys = sortedUnique(
    boxes.flatMap((r) => [r.y - margin, r.y, r.y + r.h / 2, r.y + r.h, r.y + r.h + margin])
  );
  const nx = xs.length;
  const ny = ys.length;
  const N = nx * ny;

  if (N === 0 || N > maxCells) {
    return { route: () => null, disabled: N > maxCells };
  }

  // per-cell obstacle cover: indices of boxes whose interior contains the cell.
  // Most cells are covered by 0–2 boxes (containers nest, they don't overlap).
  const cover: number[][] = new Array(N);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const px = xs[ix];
      const py = ys[iy];
      let list: number[] | undefined;
      for (let bi = 0; bi < boxes.length; bi++) {
        if (strictlyInside(px, py, boxes[bi])) (list ??= []).push(bi);
      }
      cover[iy * nx + ix] = list ?? EMPTY;
    }
  }

  // reusable A* scratch buffers (reset per route via a generation stamp)
  const g = new Float64Array(N);
  const f = new Float64Array(N);
  const came = new Int32Array(N);
  const dir = new Int8Array(N); // 0 = horizontal move, 1 = vertical, -1 = none
  const gen = new Int32Array(N); // generation each cell's g/came belongs to
  let generation = 0;

  function route(a: RouteBox, b: RouteBox): Pt[] | null {
    // boxes related to either endpoint are passable for this edge
    const skip = new Set<number>();
    for (let bi = 0; bi < boxes.length; bi++) {
      if (relatedToEndpoint(boxes[bi].el, a.el) || relatedToEndpoint(boxes[bi].el, b.el)) skip.add(bi);
    }
    const blocked = (cell: number): boolean => {
      const cov = cover[cell];
      for (let k = 0; k < cov.length; k++) if (!skip.has(cov[k])) return true;
      return false;
    };

    const sx = nearestIndex(xs, a.x + a.w / 2);
    const sy = nearestIndex(ys, a.y + a.h / 2);
    const tx = nearestIndex(xs, b.x + b.w / 2);
    const ty = nearestIndex(ys, b.y + b.h / 2);
    const start = sy * nx + sx;
    const goal = ty * nx + tx;
    if (start === goal) return null;

    const gg = ++generation;
    const heap = new Heap(f);
    g[start] = 0;
    f[start] = Math.abs(xs[sx] - xs[tx]) + Math.abs(ys[sy] - ys[ty]);
    came[start] = -1;
    dir[start] = -1;
    gen[start] = gg;
    heap.push(start);

    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      const cix = cur % nx;
      const ciy = (cur / nx) | 0;
      const cg = g[cur];
      // neighbours: [dix, diy, moveDir]
      for (let k = 0; k < 4; k++) {
        const nix = cix + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const niy = ciy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nix < 0 || niy < 0 || nix >= nx || niy >= ny) continue;
        const ni = niy * nx + nix;
        if (ni !== goal && blocked(ni)) continue;
        const md = k < 2 ? 0 : 1;
        const step = Math.abs(xs[nix] - xs[cix]) + Math.abs(ys[niy] - ys[ciy]);
        const ng = cg + step + (dir[cur] !== -1 && dir[cur] !== md ? turn : 0);
        if (gen[ni] !== gg || ng < g[ni]) {
          gen[ni] = gg;
          g[ni] = ng;
          came[ni] = cur;
          dir[ni] = md;
          f[ni] = ng + Math.abs(xs[nix] - xs[tx]) + Math.abs(ys[niy] - ys[ty]);
          heap.push(ni);
        }
      }
    }

    if (gen[goal] !== gg || came[goal] === -1) return null;

    // reconstruct grid path (start → goal)
    const raw: Pt[] = [];
    for (let cur = goal; cur !== -1; cur = came[cur]) {
      raw.push({ x: xs[cur % nx], y: ys[(cur / nx) | 0] });
    }
    raw.reverse();

    return finishPath(raw, a, b);
  }

  return { route, disabled: false };
}

const EMPTY: number[] = [];

/** trim the interior-of-endpoint prefix/suffix so the path runs border-to-border,
 *  then drop collinear vertices. */
function finishPath(raw: Pt[], a: RouteBox, b: RouteBox): Pt[] | null {
  let s = 0;
  while (s < raw.length - 1 && strictlyInside(raw[s].x, raw[s].y, a)) s++;
  let e = raw.length - 1;
  while (e > s && strictlyInside(raw[e].x, raw[e].y, b)) e--;
  if (e - s < 1) return null;

  const out: Pt[] = [];
  for (let i = s; i <= e; i++) {
    const p = raw[i];
    const n = out.length;
    if (
      n >= 2 &&
      ((out[n - 1].x === out[n - 2].x && out[n - 1].x === p.x) ||
        (out[n - 1].y === out[n - 2].y && out[n - 1].y === p.y))
    ) {
      out[n - 1] = p; // extend the collinear run
    } else if (n >= 1 && out[n - 1].x === p.x && out[n - 1].y === p.y) {
      // skip exact duplicate
    } else {
      out.push(p);
    }
  }
  return out.length >= 2 ? out : null;
}
