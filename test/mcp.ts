/**
 * MCP tool-layer tests (no MCP SDK, no VS Code, no transport).
 *
 * Run with: npm run test:mcp
 *
 * Builds a tiny on-disk workspace, points a ModelStore at it and exercises every
 * tool through runTool() exactly as the stdio server does — verifying the tools
 * reuse the shared core to parse, validate, query and lay out the model.
 */
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelStore } from "../src/mcp/modelStore";
import { TOOLS, runTool } from "../src/mcp/tools";

let passed = 0;
function test(title: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`PASS: ${title}`);
}

const GOOD = `package Demo {
  part def Vehicle {
    part engine : Engine;
  }
  part def Engine;
  requirement def MassLimit {
    doc /* 車両総質量は 1500 kg 以下 */
  }
  requirement massReq : MassLimit;
  part vehicle : Vehicle;
  satisfy massReq by vehicle;
}`;

const BAD = `package Bad {
  part p : NonExistentType;
}`;

// lay down a throwaway workspace with a nested folder (tests the recursive scan)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sysml-mcp-"));
fs.writeFileSync(path.join(dir, "model.sysml"), GOOD);
fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
fs.writeFileSync(path.join(dir, "sub", "bad.sysml"), BAD);

const store = new ModelStore(dir);
const call = (name: string, args: Record<string, unknown> = {}) => JSON.parse(runTool(store, name, args));

test("every tool advertises a valid name + object input schema", () => {
  assert.ok(TOOLS.length >= 6, "expected at least 6 tools");
  for (const t of TOOLS) {
    assert.ok(t.name && typeof t.description === "string" && t.description.length > 0);
    assert.strictEqual((t.inputSchema as { type: string }).type, "object");
  }
});

test("list_files finds both files and counts elements", () => {
  const r = call("list_files");
  assert.strictEqual(r.files.length, 2, "should index model.sysml + sub/bad.sysml");
  const model = r.files.find((f: { path: string }) => f.path === "model.sysml");
  assert.ok(model && model.elements > 3, "model has several elements");
  assert.strictEqual(model.parseErrors, 0, "good file parses clean");
});

interface ONode { label: string; children?: ONode[] }
function findNode(nodes: ONode[], label: string): ONode | undefined {
  for (const n of nodes) {
    if (n.label === label) return n;
    const hit = n.children && findNode(n.children, label);
    if (hit) return hit;
  }
  return undefined;
}

test("outline reflects the structural tree of a file", () => {
  const r = call("outline", { file: "model.sysml" });
  const labels = JSON.stringify(r.outline);
  assert.ok(labels.includes("Vehicle") && labels.includes("Engine") && labels.includes("MassLimit"));
  // Demo package wraps the declarations; the engine usage is nested under Vehicle
  assert.ok(findNode(r.outline, "Demo"), "top level is the package");
  const vehicle = findNode(r.outline, "Vehicle");
  assert.ok(vehicle?.children?.some((c) => c.label.includes("engine")), "engine nested under Vehicle");
});

test("validate reports clean for the good file", () => {
  const r = call("validate", { file: "model.sysml" });
  assert.strictEqual(r.ok, true, `expected clean, got ${JSON.stringify(r.files)}`);
});

test("validate flags the unresolved reference in the bad file", () => {
  const r = call("validate", { file: "sub/bad.sysml" });
  assert.strictEqual(r.ok, false);
  const diags = r.files[0].diagnostics;
  assert.ok(
    diags.some((d: { rule: string; message: string }) => d.rule === "unresolved"),
    `expected an unresolved diagnostic, got ${JSON.stringify(diags)}`
  );
  assert.ok(diags[0].line >= 1 && diags[0].col >= 1, "diagnostics carry line/col");
});

test("find_element locates a definition with kind, type and doc", () => {
  const r = call("find_element", { name: "MassLimit" });
  assert.strictEqual(r.count, 1);
  const d = r.declarations[0];
  assert.strictEqual(d.kind, "requirement def");
  assert.strictEqual(d.file, "model.sysml");
  assert.ok(d.doc.includes("1500"), "doc text is surfaced");
});

test("list_requirements returns docs and satisfiedBy relations", () => {
  const r = call("list_requirements");
  assert.ok(r.count >= 1);
  const massLimit = r.requirements.find((q: { name: string }) => q.name.endsWith("MassLimit"));
  assert.ok(massLimit?.doc.includes("1500"), "requirement doc surfaced");
  // `satisfy massReq by vehicle` links to the requirement usage massReq
  const flat = JSON.stringify(r.requirements);
  assert.ok(flat.includes("vehicle"), "a satisfying part is recorded");
});

test("describe_diagram lays out a BDD with boxes and a composition edge", () => {
  const r = call("describe_diagram", { kind: "bdd", file: "model.sysml" });
  assert.strictEqual(r.kind, "bdd");
  assert.ok(r.boxCount >= 2, "at least Vehicle + Engine");
  const labels = r.boxes.map((b: { label: string }) => b.label).join(",");
  assert.ok(labels.includes("Vehicle") && labels.includes("Engine"));
});

test("invalid input throws (server reports it in-band as isError)", () => {
  assert.throws(() => runTool(store, "describe_diagram", { kind: "nope" }), /unknown diagram kind/);
  assert.throws(() => runTool(store, "find_element", {}), /name.*required/i);
  assert.throws(() => runTool(store, "no_such_tool", {}), /unknown tool/);
});

// cleanup
fs.rmSync(dir, { recursive: true, force: true });

console.log(`ALL MCP TESTS PASSED (${passed})`);
