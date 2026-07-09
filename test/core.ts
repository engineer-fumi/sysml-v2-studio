/**
 * Core regression tests (no VS Code required).
 *
 * Run with: npm run test:core
 *
 * - all bundled samples (hand-made + OMG official) parse and validate clean
 * - every diagram kind lays out without errors and with expected content
 * - manual layout features (inherited ports, relative edge routing,
 *   actor merging) keep working
 */
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { createElement, qualifiedName, walk, SysMLElement } from "../src/core/ast";
import { DiagramNode, DIAGRAM_KINDS, layoutDiagram, portOffsetKey } from "../src/core/layout";
import { parseSysML } from "../src/core/parser";
import { Resolver } from "../src/core/resolve";
import { STDLIB_FILES } from "../src/core/stdlib";
import { validateFile } from "../src/core/validate";
import { isIgnoredModelPath } from "../src/extension/indexFilter";

const SAMPLES_DIR = path.join(__dirname, "..", "samples");

function buildModel(): { root: SysMLElement; sampleFiles: { name: string; el: SysMLElement }[] } {
  const root = createElement("namespace");
  const add = (name: string, src: string): SysMLElement => {
    const r = parseSysML(src);
    assert.deepStrictEqual(
      r.errors.map((e) => `${name}: ${e.message}`),
      [],
      `parse errors in ${name}`
    );
    const el = r.root;
    el.kind = "file";
    el.name = name;
    el.parent = root;
    root.children.push(el);
    return el;
  };
  for (const lib of STDLIB_FILES) add(lib.name, lib.source);
  const sampleFiles: { name: string; el: SysMLElement }[] = [];
  const collect = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) collect(p);
      else if (e.name.endsWith(".sysml") || e.name.endsWith(".kerml")) {
        const name = path.relative(SAMPLES_DIR, p);
        sampleFiles.push({ name, el: add(name, fs.readFileSync(p, "utf8")) });
      }
    }
  };
  collect(SAMPLES_DIR);
  return { root, sampleFiles };
}

function find(root: SysMLElement, name: string, kind?: string): SysMLElement {
  let found: SysMLElement | undefined;
  walk(root, (el) => {
    if (!found && el.name === name && (!kind || el.kind === kind)) found = el;
  });
  assert.ok(found, `element ${name} (${kind ?? "any"}) not found`);
  return found!;
}

/** find by qualified name — sample names may collide across packages */
function findQ(root: SysMLElement, qualified: string): SysMLElement {
  let found: SysMLElement | undefined;
  walk(root, (el) => {
    if (!found && qualifiedName(el) === qualified) found = el;
  });
  assert.ok(found, `element ${qualified} not found`);
  return found!;
}

/** small standalone model (no stdlib) for layout-geometry tests */
function miniModel(src: string): SysMLElement {
  const ns = createElement("namespace");
  const f = parseSysML(src).root;
  f.kind = "file";
  f.name = "mini.sysml";
  f.parent = ns;
  ns.children.push(f);
  return ns;
}

/** locate a laid-out node by its element name (depth-first) */
function nodeByName(layout: { nodes: DiagramNode[] }, name: string): DiagramNode {
  const stack = [...layout.nodes];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.label === name) return n;
    stack.push(...n.children);
  }
  throw new Error(`node ${name} not found in layout`);
}

const keyByQName = (el: SysMLElement) => qualifiedName(el);

let passed = 0;
function test(title: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`PASS: ${title}`);
}

const { root, sampleFiles } = buildModel();

test("all samples validate clean", () => {
  const resolver = new Resolver(root);
  for (const f of sampleFiles) {
    const diags = validateFile(f.el, resolver);
    assert.deepStrictEqual(
      diags.map((d) => `${f.name}: [${d.rule}] ${d.message}`),
      [],
      `semantic diagnostics in ${f.name}`
    );
  }
  assert.ok(sampleFiles.length >= 17, `expected >= 17 sample files, got ${sampleFiles.length}`);
});

// type checking fires only on positive type knowledge
function typeDiags(src: string): string[] {
  const ns = createElement("namespace");
  const f = parseSysML(src).root;
  f.kind = "file";
  f.name = "t.sysml";
  f.parent = ns;
  ns.children.push(f);
  const resolver = new Resolver(ns);
  return validateFile(f, resolver, {
    unresolved: false, duplicates: false, conformance: false,
    shadowing: false, importVisibility: false, typeChecking: true,
  }).filter((d) => d.rule === "type").map((d) => d.message);
}

test("type checking flags non-Boolean constraint bodies and value mismatches", () => {
  // a constraint body that evaluates to a number is wrong
  assert.strictEqual(typeDiags(`part def C { attribute mass : Real; constraint x { mass + 1 } }`).length, 1);
  // a Boolean comparison body is fine
  assert.strictEqual(typeDiags(`part def C { attribute mass : Real; constraint x { mass < 1 } }`).length, 0);
  // a number value assigned to a Boolean attribute conflicts
  assert.strictEqual(typeDiags(`part def C { attribute flag : Boolean = 3; }`).length, 1);
  // matching scalar families are fine
  assert.strictEqual(typeDiags(`part def C { attribute n : Real = 5; }`).length, 0);
  assert.strictEqual(typeDiags(`part def C { attribute s : String = "hi"; }`).length, 0);
});

test("type checking never fires on unknown / unresolved expressions", () => {
  // an unresolved function call infers as unknown -> no false positive
  assert.strictEqual(typeDiags(`part def C { constraint x { mysteryPredicate(thing) } }`).length, 0);
  // a constraint over an unresolved name -> unknown -> no diagnostic
  assert.strictEqual(typeDiags(`part def C { constraint x { whatever } }`).length, 0);
  // a non-primitive declared type -> unknown declared type -> no diagnostic
  assert.strictEqual(typeDiags(`part def C { attribute a : SomeType = 3; }`).length, 0);
});

test("every diagram kind lays out the combined model", () => {
  for (const k of DIAGRAM_KINDS) {
    const l = layoutDiagram(root, { kind: k.id });
    assert.ok(l.nodes.length > 0, `${k.id}: no nodes`);
    assert.ok(Number.isFinite(l.width) && Number.isFinite(l.height), `${k.id}: bad extent`);
  }
});

test("ibd inherits ports from definitions and anchors connects on them", () => {
  const vehicle = findQ(root, "VehicleConfiguration::vehicle");
  const l = layoutDiagram(vehicle, { kind: "ibd" });
  const engine = l.nodes[0].children.find((n) => n.label === "engine");
  assert.ok(engine, "engine box");
  assert.deepStrictEqual(engine!.ports.map((p) => p.name).sort(), ["drive", "fuelIn"]);
  assert.ok(l.edges.some((e) => e.kind === "flow"), "fuel flow edge");
});

test("bdd derives composition from usage structure", () => {
  const l = layoutDiagram(root, { kind: "bdd" });
  const compose = l.edges.filter((e) => e.kind === "compose");
  const hasVehicleEngine = compose.some(
    (e) => e.a?.label === "Vehicle" && e.b?.label === "Engine"
  );
  assert.ok(hasVehicleEngine, "Vehicle ◆— Engine composition");
  // imports between rendered packages are drawn, nested pairs are not
  for (const e of l.edges.filter((x) => x.kind === "import")) {
    let nested = false;
    for (let cur = e.b!.el.parent; cur; cur = cur.parent) if (cur === e.a!.el) nested = true;
    assert.ok(!nested, "no parent->child import edges");
  }
});

test("collapsing a box hides its child boxes and re-anchors edges", () => {
  const base = layoutDiagram(root, { kind: "bdd", keyOf: keyByQName });
  // find a box that actually has visible child boxes to collapse
  let container: DiagramNode | undefined;
  const stack = [...base.nodes];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.collapsible && n.children.length > 0) { container = n; break; }
    stack.push(...n.children);
  }
  assert.ok(container, "the bdd has a collapsible container");
  // an edge whose endpoint is a descendant of the container (re-anchor target)
  const isDescendant = (el: SysMLElement) => {
    for (let c: SysMLElement | undefined = el; c; c = c.parent) if (c === container!.el) return true;
    return false;
  };
  const edgeIntoChild = base.edges.some(
    (e) => (e.a && isDescendant(e.a.el) && e.a.el !== container!.el) ||
           (e.b && isDescendant(e.b.el) && e.b.el !== container!.el)
  );

  const key = keyByQName(container!.el);
  const collapsed = layoutDiagram(root, {
    kind: "bdd",
    keyOf: keyByQName,
    offsets: { [key]: { dx: 0, dy: 0, collapsed: true } },
  });
  const node = nodeByName(collapsed, container!.label);
  assert.strictEqual(node.children.length, 0, "collapsed box hides its child boxes");
  assert.ok(node.collapsed, "collapsed flag is set");
  assert.ok(node.collapsible, "box is still marked collapsible (can expand)");
  // no edge endpoint resolves to a now-hidden descendant box
  for (const e of collapsed.edges) {
    for (const end of [e.a, e.b]) {
      if (end && isDescendant(end.el)) {
        assert.strictEqual(end.el, container!.el, "edges re-anchor to the collapsed box");
      }
    }
  }
  if (edgeIntoChild) {
    assert.ok(
      collapsed.edges.some((e) => e.a?.el === container!.el || e.b?.el === container!.el),
      "an edge that pointed into the container now anchors on it"
    );
  }
});

test("type filter hides boxes of the unchecked kind", () => {
  const boxes = (l: { nodes: DiagramNode[] }): DiagramNode[] => {
    const out: DiagramNode[] = [];
    const stack = [...l.nodes];
    while (stack.length) {
      const n = stack.shift()!;
      out.push(n);
      stack.push(...n.children);
    }
    return out;
  };
  const base = layoutDiagram(root, { kind: "bdd" });
  const baseKinds = new Set(boxes(base).map((n) => n.el.kind));
  // pick a primary leaf kind that is present (part def is the bdd's staple)
  const target = baseKinds.has("part def")
    ? "part def"
    : [...baseKinds].find((k) => k !== "package" && k !== "library package");
  assert.ok(target, "a filterable box kind is present in the bdd");

  const filtered = layoutDiagram(root, { kind: "bdd", hiddenKinds: new Set([target]) });
  assert.ok(
    !boxes(filtered).some((n) => n.el.kind === target),
    `no ${target} box survives the type filter`
  );
  assert.ok(
    boxes(filtered).length < boxes(base).length,
    "the filtered diagram has fewer boxes"
  );
  // an empty filter is a no-op (same box count as the unfiltered layout)
  const noop = layoutDiagram(root, { kind: "bdd", hiddenKinds: new Set() });
  assert.strictEqual(boxes(noop).length, boxes(base).length, "empty filter shows everything");
});

test("use case view merges same-named actors into one figure", () => {
  const pkg = find(root, "RobotUseCases", "package");
  const l = layoutDiagram(pkg, { kind: "uc" });
  const actors = l.nodes.filter((n) => n.actor);
  assert.strictEqual(actors.length, 1, "one merged actor figure");
  assert.ok(l.edges.filter((e) => e.kind === "assoc").length >= 2, "actor associations");
  assert.ok(l.edges.filter((e) => e.kind === "perform").length >= 2, "perform edges");
  const boundary = l.nodes.find((n) => n.kindLabel === "subject");
  assert.ok(boundary, "subject boundary box");
});

test("sequence view shows parts and flows only", () => {
  const l = layoutDiagram(root, { kind: "seq" });
  assert.ok(l.nodes.every((n) => n.lifelineEnd !== undefined), "all nodes are lifelines");
  assert.ok(l.nodes.every((n) => n.el.kind !== "action"), "no action lifelines");
  assert.ok(l.edges.length >= 1, "at least one message");
});

test("relative edge waypoints follow the endpoint boxes", () => {
  const keyOf = (el: SysMLElement) => qualifiedName(el);
  const pkg = find(root, "OrderProcessing", "package");
  const base = layoutDiagram(pkg, { kind: "action", keyOf });
  const flow = base.edges.find((e) => e.kind === "flow");
  assert.ok(flow?.key, "flow edge with key");

  const offsets = { [flow!.key!]: { dx: 0, dy: 0, wp: [{ x: 40, y: 60 }], rel: true } };
  const routed = layoutDiagram(pkg, { kind: "action", keyOf, offsets });
  const e1 = routed.edges.find((e) => e.key === flow!.key)!;
  assert.strictEqual(e1.points?.length, 1);

  // move the source box: the waypoint must follow (stay at base+offset)
  const srcKey = keyOf(e1.a!.el);
  const moved = layoutDiagram(pkg, {
    kind: "action",
    keyOf,
    offsets: { ...offsets, [srcKey]: { dx: 200, dy: 120 } },
  });
  const e2 = moved.edges.find((e) => e.key === flow!.key)!;
  assert.notDeepStrictEqual(
    { x: e1.points![0].x, y: e1.points![0].y },
    { x: e2.points![0].x, y: e2.points![0].y },
    "waypoint should move with the boxes"
  );
});

test("manual port placement pins a port to a side", () => {
  const keyOf = (el: SysMLElement) => qualifiedName(el);
  const vehicle = findQ(root, "VehicleConfiguration::vehicle");
  const fuelTank = findQ(root, "VehicleConfiguration::vehicle::fuelTank");
  const fuelOut = findQ(root, "VehicleDefinitions::FuelTank::fuelOut");
  const key = portOffsetKey(keyOf, fuelTank, fuelOut);
  const l = layoutDiagram(vehicle, {
    kind: "ibd",
    keyOf,
    offsets: { [key]: { dx: 0, dy: 0, side: "right", t: 0.5 } },
  });
  const tank = l.nodes[0].children.find((n) => n.label === "fuelTank")!;
  const port = tank.ports.find((p) => p.name === "fuelOut")!;
  assert.strictEqual(port.side, "right");
  assert.ok(Math.abs(port.x - (tank.x + tank.w)) < 0.01, "port on the right border");
});

// box layout geometry — the regressions behind the resize / child-drag fixes
const BOX_MODEL = `package P {
  part container {
    part c1 : Thing;
    part c2 : Thing;
  }
  part def Thing;
}`;

test("enlarged box keeps its size when a child moves within it", () => {
  const root = miniModel(BOX_MODEL);
  const container = find(root, "container", "part");
  const c1 = find(root, "c1", "part");
  const cKey = keyByQName(container);

  const natural = nodeByName(layoutDiagram(root, { kind: "general", keyOf: keyByQName }), "container");

  // enlarge the container by 120px in height (absolute minimum size)
  const enlargedOffsets = { [cKey]: { dx: 0, dy: 0, mw: natural.w, mh: natural.h + 120 } };
  const enlarged = nodeByName(
    layoutDiagram(root, { kind: "general", keyOf: keyByQName, offsets: enlargedOffsets }),
    "container"
  );
  assert.ok(Math.abs(enlarged.h - (natural.h + 120)) < 0.5, "container grows to the enlarged height");

  // move c1 down by 60px — still inside the enlarged box → size must not change
  const movedWithin = nodeByName(
    layoutDiagram(root, {
      kind: "general",
      keyOf: keyByQName,
      offsets: { ...enlargedOffsets, [keyByQName(c1)]: { dx: 0, dy: 60 } },
    }),
    "container"
  );
  assert.ok(
    Math.abs(movedWithin.h - enlarged.h) < 0.5,
    `box must not inflate when a child moves within it (was ${enlarged.h}, got ${movedWithin.h})`
  );

  // move c1 far down beyond the headroom → the box must grow to contain it
  const movedBeyond = nodeByName(
    layoutDiagram(root, {
      kind: "general",
      keyOf: keyByQName,
      offsets: { ...enlargedOffsets, [keyByQName(c1)]: { dx: 0, dy: 400 } },
    }),
    "container"
  );
  assert.ok(movedBeyond.h > enlarged.h + 1, "box grows when a child exceeds the enlarged bounds");
});

test("moving one child does not shift its siblings", () => {
  const root = miniModel(BOX_MODEL);
  const c1 = find(root, "c1", "part");
  const c2 = find(root, "c2", "part");

  const base = layoutDiagram(root, { kind: "general", keyOf: keyByQName });
  const c2Before = nodeByName(base, "c2");
  const x0 = c2Before.x;
  const y0 = c2Before.y;

  // drag c1 around (including up/left past the origin)
  const moved = layoutDiagram(root, {
    kind: "general",
    keyOf: keyByQName,
    offsets: { [keyByQName(c1)]: { dx: -120, dy: -90 } },
  });
  const c2After = nodeByName(moved, "c2");
  assert.ok(
    Math.abs(c2After.x - x0) < 0.5 && Math.abs(c2After.y - y0) < 0.5,
    `sibling c2 must stay put (was ${x0},${y0}, got ${c2After.x},${c2After.y})`
  );
});

test("workspace index ignores hidden and build directories (#42)", () => {
  // `.claude/worktrees/<branch>` holds a full repo copy on another branch —
  // indexing it makes every top-level element a false duplicate and can win
  // resolution with a stale package version
  assert.strictEqual(isIgnoredModelPath(".claude/worktrees/x/pkg/a.sysml"), true);
  assert.strictEqual(isIgnoredModelPath("sub/.git/pkg/a.sysml"), true);
  assert.strictEqual(isIgnoredModelPath("node_modules/lib/a.sysml"), true);
  assert.strictEqual(isIgnoredModelPath("dist/a.sysml"), true);
  // tmp/ holds the vendored grammar-coverage corpus (clone-corpus.mjs); indexing
  // its ~400 files buries the workspace in thousands of diagnostics
  assert.strictEqual(isIgnoredModelPath("tmp/omg-corpus/sysml/src/examples/Camera Example/Camera.sysml"), true);
  assert.strictEqual(isIgnoredModelPath(".claude\\worktrees\\x\\a.sysml"), true, "windows separators");
  // normal model files stay indexed
  assert.strictEqual(isIgnoredModelPath("phase-2/1_sysml/a.sysml"), false);
  assert.strictEqual(isIgnoredModelPath("a.sysml"), false);
  assert.strictEqual(isIgnoredModelPath("cross-phase/vocabulary.sysml"), false);
  // relative traversal segments are not hidden dirs
  assert.strictEqual(isIgnoredModelPath("../outside/a.sysml"), false);
});

console.log(`ALL CORE TESTS PASSED (${passed})`);
