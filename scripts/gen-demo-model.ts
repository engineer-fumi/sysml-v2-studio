/**
 * Builds clean, per-diagram-kind demo models for the screenshot generator
 * (scripts/gen-screenshots.mjs). For the kinds whose auto-layout looks cramped
 * or overlapping, it runs the real layout, then computes manual offsets that
 * stack the key boxes into a roomy vertical column — exactly what a user would
 * do by hand. Writes dist/demo-models.json keyed by diagram kind.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DiagramNode, portOffsetKey } from "../src/core/layout";
import { SysMLElement, qualifiedName, walk } from "../src/core/ast";
import { layoutDiagram } from "../src/core/layout";
import { parseSysML } from "../src/core/parser";
import { stripParents } from "../src/core/serialize";

const FILE_NAME = "demo.sysml";

/** one focused snippet per diagram kind */
const SOURCES: Record<string, string> = {
  general: `package CoffeeSystem {
  part def CoffeeMaker;
  part def Boiler;
  item def Water;
  part machine : CoffeeMaker {
    part boiler : Boiler;
    part pump : Boiler;
    connect pump to boiler;
  }
  requirement def BrewTemp { doc /* 92°C before brewing */ }
  state def BrewCycle { state idle; state heating; transition first idle then heating; }
}`,

  // BDD: a composition chain so every diamond links two adjacent boxes
  bdd: `package Powertrain {
  part def Vehicle;
  part def Engine;
  part def Cylinder;
  part v : Vehicle { part engine : Engine; }
  part e : Engine { part cylinders : Cylinder[4]; }
}`,

  // IBD: two sibling parts connected port-to-port (not box-to-box)
  ibd: `package Hydraulics {
  port def FluidPort;
  part def Pump { port outlet : FluidPort; }
  part def Tank { port inlet : FluidPort; }
  part system {
    part pump : Pump;
    part tank : Tank;
    connect pump.outlet to tank.inlet;
  }
}`,

  // Requirement: the satisfying part sits next to the requirement it satisfies
  req: `package Requirements {
  requirement def MassLimit {
    doc /* 車両総質量は 1500 kg 以下であること */
    attribute limit : Real = 1500.0;
  }
  requirement massReq : MassLimit;
  part vehicle;
  satisfy massReq by vehicle;
}`,

  // Use case: use cases in a column, the actor on the side
  uc: `package Robot {
  part def Operator;
  use case def Operate { subject robot : Robot; actor operator : Operator; }
  use case def Maintain { subject robot : Robot; actor operator : Operator; }
  use case operate : Operate;
  part operator : Operator { perform operate; }
}`,

  // State: a forward-only chain
  state: `package Machine {
  state def BrewCycle {
    state off;
    state idle;
    state heating;
    state brewing;
    transition first off accept powerOn then idle;
    transition first idle accept startCmd then heating;
    transition first heating accept ready then brewing;
  }
}`,

  // Activity: a short action pipeline with a succession + item flow
  action: `package Process {
  item def Order;
  action def Fulfill {
    action validate;
    action ship;
    first validate then ship;
    flow of Order from validate to ship;
  }
}`,
};

/** which boxes to stack into a roomy column, per kind (top→bottom order) */
const COLUMNS: Record<string, { names: string[]; gap: number }> = {
  bdd: { names: ["Vehicle", "Engine", "Cylinder"], gap: 54 },
  action: { names: ["validate", "ship"], gap: 50 },
  state: { names: ["off", "idle", "heating", "brewing"], gap: 42 },
  uc: { names: ["Operate", "Maintain", "operate"], gap: 40 },
  // wide gap so the facing port labels (outlet/inlet) sit clear in between
  ibd: { names: ["pump", "tank"], gap: 72 },
};

const keyOf = (el: SysMLElement) => `${FILE_NAME}#${qualifiedName(el)}`;

/** map element name → laid-out node */
function nodesByName(root: SysMLElement, kind: string): Record<string, DiagramNode> {
  const layout = layoutDiagram(root, { kind: kind as never, keyOf });
  const out: Record<string, DiagramNode> = {};
  const visit = (n: DiagramNode) => {
    if (n.el.name && !(n.el.name in out)) out[n.el.name] = n;
    n.children.forEach(visit);
  };
  layout.nodes.forEach(visit);
  return out;
}

/** offsets that re-stack the named boxes into a vertical column with `gap` */
function columnOffsets(root: SysMLElement, kind: string): Record<string, unknown> {
  const col = COLUMNS[kind];
  if (!col) return {};
  const nodes = nodesByName(root, kind);
  const picked = col.names.map((n) => nodes[n]).filter(Boolean) as DiagramNode[];
  if (picked.length < 2) return {};
  const x0 = Math.min(...picked.map((n) => n.x));
  let y = picked[0].y;
  const offsets: Record<string, { dx: number; dy: number }> = {};
  for (const n of picked) {
    offsets[keyOf(n.el)] = { dx: Math.round(x0 - n.x), dy: Math.round(y - n.y) };
    y += n.h + col.gap;
  }
  // saved layouts are keyed by the diagram root (empty root = whole model)
  const layoutKey = kind === "general" ? "" : `${kind}|`;
  return { [layoutKey]: offsets };
}

/** which ports to pin to a facing border, per kind: [owner, port, side] */
const PORTS: Record<string, [string, string, "left" | "right" | "top" | "bottom"][]> = {
  // IBD: face the two ports across the gap so the connection reads clearly
  ibd: [
    ["pump", "outlet", "bottom"],
    ["tank", "inlet", "top"],
  ],
};

/** offsets that pin the named ports to a chosen side (t = 0.5, centred) */
function portOffsets(root: SysMLElement, kind: string): Record<string, unknown> {
  const pins = PORTS[kind];
  if (!pins) return {};
  const nodes = nodesByName(root, kind);
  const offsets: Record<string, { side: string; t: number }> = {};
  for (const [ownerName, portName, side] of pins) {
    const owner = nodes[ownerName];
    const port = owner?.ports.find((p) => p.name === portName);
    if (!owner || !port) continue;
    offsets[portOffsetKey(keyOf, owner.el, port.el)] = { side, t: 0.5 };
  }
  if (!Object.keys(offsets).length) return {};
  const layoutKey = kind === "general" ? "" : `${kind}|`;
  return { [layoutKey]: offsets };
}

const models: Record<string, unknown> = {};
for (const [kind, src] of Object.entries(SOURCES)) {
  const ast = parseSysML(src).root;
  walk(ast, (el) => {
    el.fileId = 0;
  });
  // compute layout offsets before stripping parents (columns + port pins);
  // both may target the same `${kind}|` root, so merge their inner maps
  const cols = columnOffsets(ast, kind) as Record<string, object>;
  const ports = portOffsets(ast, kind) as Record<string, object>;
  const layouts: Record<string, object> = { ...cols };
  for (const k of Object.keys(ports)) layouts[k] = { ...(layouts[k] ?? {}), ...ports[k] };
  models[kind] = {
    files: [{ uri: `file:///demo-${kind}.sysml`, name: FILE_NAME, ast: stripParents(ast) }],
    layouts,
  };
}

const out = path.join(process.cwd(), "dist", "demo-models.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(models));
console.log("wrote", out, `(${Object.keys(models).length} kinds)`);
