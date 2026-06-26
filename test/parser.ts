/**
 * Unit tests for the parser and the name resolver (no VS Code / React).
 * Run with: npm run test:parser
 */
import * as assert from "node:assert";
import { SysMLElement, createElement, walk } from "../src/core/ast";
import { parseSysML } from "../src/core/parser";
import { Resolver } from "../src/core/resolve";

let passed = 0;
function test(title: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`PASS: ${title}`);
}

/** first element of a given name anywhere in the tree */
function find(root: SysMLElement, name: string): SysMLElement {
  let hit: SysMLElement | undefined;
  walk(root, (el) => {
    if (!hit && el.name === name) hit = el;
  });
  assert.ok(hit, `element ${name} not found`);
  return hit!;
}

/** wrap parsed sources as files under one namespace (for the resolver) */
function model(...sources: string[]): SysMLElement {
  const ns = createElement("namespace");
  sources.forEach((src, i) => {
    const f = parseSysML(src).root;
    f.kind = "file";
    f.name = `f${i}.sysml`;
    f.parent = ns;
    ns.children.push(f);
  });
  return ns;
}

// ---- parser ---------------------------------------------------------------

test("parses definitions, typing and nested members", () => {
  const r = parseSysML(`package P {
    part def Engine {
      attribute power : Real;
      port fuelIn : ~FuelPort;
    }
  }`);
  assert.deepStrictEqual(r.errors, []);
  const engine = find(r.root, "Engine");
  assert.strictEqual(engine.kind, "part def");
  const power = find(r.root, "power");
  assert.deepStrictEqual(power.typedBy, ["Real"]);
  const port = find(r.root, "fuelIn");
  assert.strictEqual(port.kind, "port");
  assert.deepStrictEqual(port.typedBy, ["~FuelPort"], "conjugated port keeps the ~ prefix");
});

test("parses specialization, redefinition and multiplicity", () => {
  const r = parseSysML(`package P {
    part def V :> Base;
    part wheels : Wheel[4];
    part v : V { attribute :>> mass = 1200.0; }
  }`);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(find(r.root, "V").specializes, ["Base"]);
  assert.strictEqual(find(r.root, "wheels").multiplicity, "[4]");
  // a `:>> mass` redefinition is an anonymous attribute whose redefines target is `mass`
  const redef = parseSysML(`part v { attribute :>> mass = 1; }`);
  const attr = find(redef.root, "v").children.find((c) => c.kind === "attribute")!;
  assert.deepStrictEqual(attr.redefines, ["mass"]);
  assert.strictEqual(attr.value, "1");
});

test("parses connect, flow and transition", () => {
  const r = parseSysML(`part v {
    connect a.b to c.d;
    flow of Fuel from tank.outlet to engine.intake;
    transition t1 first s1 accept sig then s2;
  }`);
  assert.deepStrictEqual(r.errors, []);
  const connect = find(r.root, "v").children.find((c) => c.kind === "connect")!;
  assert.deepStrictEqual(connect.ends?.map((e) => e.path), ["a.b", "c.d"]);
  const flow = find(r.root, "v").children.find((c) => c.kind === "flow")!;
  assert.deepStrictEqual(flow.typedBy, ["Fuel"]);
  assert.strictEqual(flow.ends?.length, 2);
  const t = find(r.root, "t1");
  assert.strictEqual(t.transition?.source, "s1");
  assert.strictEqual(t.transition?.target, "s2");
  assert.ok(t.transition?.trigger?.includes("sig"), "trigger captured");
});

test("import visibility is recorded on the modifiers", () => {
  const r = parseSysML(`package P {
    private import A::*;
    public import B::C;
  }`);
  const imports = find(r.root, "P").children.filter((c) => c.kind === "import");
  assert.ok(imports[0].modifiers.includes("private"));
  assert.ok(imports[1].modifiers.includes("public"));
  assert.strictEqual(imports[0].target, "A::*");
});

test("recovers from a syntax error and keeps later members", () => {
  const r = parseSysML(`package P {
    part def {;
    part def Good { attribute x : Real; }
  }`);
  assert.ok(r.errors.length > 0, "the malformed member reports an error");
  assert.ok(r.errors[0].end >= r.errors[0].start, "error range is well-formed");
  find(r.root, "Good"); // later, valid member still parsed
});

// ---- resolver -------------------------------------------------------------

test("resolves qualified names and scope-local references", () => {
  const root = model(`package P {
    part def A;
    part def B { part a : A; }
  }`);
  const resolver = new Resolver(root);
  const p = find(root, "P");
  assert.strictEqual(resolver.resolve(p, "A"), find(root, "A"));
  assert.strictEqual(resolver.resolve(root, "P::A"), find(root, "A"));
  // resolve the type from the usage's own scope
  const a = find(root, "a");
  assert.strictEqual(resolver.resolve(a.parent!, "A"), find(root, "A"));
});

test("public import re-exports transitively, private does not", () => {
  const root = model(`
    package Lib { part def Widget; }
    package App { public import Lib::*; }
    package Sealed { private import Lib::*; }
    package User { private import App::*; }
  `);
  const resolver = new Resolver(root);
  const widget = find(root, "Widget");
  // App re-exports Lib publicly → User (importing App) can see Widget
  assert.strictEqual(resolver.resolve(find(root, "User"), "Widget"), widget, "transitive via public");
  // Sealed imports Lib privately → from outside Sealed, Widget is not re-exported
  const outside = find(root, "App");
  const viaSealed = resolver.resolve(outside, "Sealed::Widget");
  assert.strictEqual(viaSealed, undefined, "private import is not re-exported");
});

test("resolves inherited members and conjugated ports", () => {
  const root = model(`package P {
    port def FuelPort;
    part def Base { port p : FuelPort; }
    part def Sub :> Base;
  }`);
  const resolver = new Resolver(root);
  const sub = find(root, "Sub");
  assert.strictEqual(
    resolver.lookupMember(sub, "p", new Set()),
    find(root, "p"),
    "member inherited via specialization"
  );
  assert.strictEqual(
    resolver.resolve(find(root, "P"), "~FuelPort"),
    find(root, "FuelPort"),
    "conjugated reference resolves to the base type"
  );
});

console.log(`ALL PARSER TESTS PASSED (${passed})`);
