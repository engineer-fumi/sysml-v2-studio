/**
 * Unit tests for the parser and the name resolver (no VS Code / React).
 * Run with: npm run test:parser
 */
import * as assert from "node:assert";
import { SysMLElement, createElement, walk } from "../src/core/ast";
import { parseSysML } from "../src/core/parser";
import { Resolver } from "../src/core/resolve";
import { validateFile } from "../src/core/validate";
import { Expr, parseExpression, collectExprRefs, pathAtOffset } from "../src/core/expr";

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

test("parses import filters (`import P::**[@Safety]`) without error", () => {
  const r = parseSysML(`package P {
    import Base::**[@Safety];
    import A::*[@Critical and @Approved];
    public import B::C[@Rationale] {
      doc /* filtered import with a body */
    }
  }`);
  assert.strictEqual(r.errors.length, 0, "no parse errors on import filters");
  const imports = find(r.root, "P").children.filter((c) => c.kind === "import");
  assert.strictEqual(imports.length, 3);
  assert.strictEqual(imports[0].target, "Base::**");
  assert.ok(imports[2].modifiers.includes("public"));
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

test("parses the KerML foundation layer (definitions, relationships, connectors)", () => {
  const r = parseSysML(`package P {
    classifier Bicycle specializes Vehicle;
    abstract datatype Collection;
    struct Body specializes Object;
    behavior Manufacture;
    composite feature carParts : CarPart[0..*] subsets massedThings;
    function '==' specializes DataFunctions::'==' { in x : Boolean[0..1]; }
    assoc all BinaryLink specializes Link {
      end [1] feature source : Anything[0..*];
    }
    connector c from a to b;
    binding [1] bind [0..*] base.edges = [0..*] be;
    succession first start then done;
    inv { notEmpty(x) implies isClosed }
    subtype Bicycle specializes Vehicle;
  }`);
  assert.deepStrictEqual(r.errors, [], "KerML constructs parse without error");
  assert.strictEqual(find(r.root, "Bicycle").kind, "classifier");
  assert.strictEqual(find(r.root, "Body").kind, "struct");
  assert.deepStrictEqual(find(r.root, "Bicycle").specializes, ["Vehicle"]);
  assert.strictEqual(find(r.root, "Manufacture").kind, "behavior");
  // a keyword used as a referenced name (`subsets massedThings`) still resolves;
  // and the KerML kind keyword `feature` is recognised as a definition kind
  assert.strictEqual(find(r.root, "carParts").kind, "feature");
});

test("keeps KerML keywords usable as referenced names", () => {
  // the standard library references features literally called `step` / `type`
  const r = parseSysML(`package P { feature f subsets step; feature g : type; }`);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(find(r.root, "f").specializes, ["step"]);
  assert.deepStrictEqual(find(r.root, "g").typedBy, ["type"]);
  // even control-flow keywords are valid names where the library uses them so
  const r2 = parseSysML(`package P { succession first shoot::s.shoot then decide::d.decide; }`);
  assert.deepStrictEqual(r2.errors, []);
});

test("parses KerML succession / binding / disjoining variants", () => {
  const r = parseSysML(`package P {
    succession [1] ifTest then [0..1] thenClause;
    succession redefines s : Link [1] first paint then dry;
    succession all [*] acceptable then [*] guard;
    binding ab of a = b;
    feature x from [1] self references occ;
    disjoint b.f.a from b.a;
  }`);
  assert.deepStrictEqual(r.errors, [], "succession/binding/disjoining variants parse");
});

test("parses SysML connection / flow / metadata / end forms", () => {
  const r = parseSysML(`package P {
    flow :>> publish_message : Transfers::MessageTransfer { in item x; }
    message setSpeedMessage of CallGiveItems[1];
    message :>> sm = a.b.sentMessage;
    subject : Engine[1..*] = (engine1, engine2);
    constant attribute k[0..2];
    metadata Issue1 : Issue about engineToTransmission { }
    interface producer.publicationPort to server.publicationPort;
    connection conn {
      end inCart [0..1] item cart : ShoppingCart[1];
    }
    state s { entry assign counter.count := 0; }
    occurrence o { event occurrence :>> target = msg.done; }
  }`);
  assert.deepStrictEqual(r.errors, [], "Phase 2 SysML forms parse");
  assert.strictEqual(find(r.root, "k").modifiers.includes("constant"), true);
  assert.strictEqual(find(r.root, "Issue1").kind, "metadata");
  assert.deepStrictEqual(find(r.root, "cart").multiplicity, "[1]", "end nested feature keeps its own multiplicity");
});

test("metadata about (bodyless / with body) and anonymous satisfy parse and resolve (#27 #28)", () => {
  // both forms were rejected in v0.7.1 (reported by real-world models with
  // hundreds of false errors) — pin them so they never regress again
  const src = `package Probe {
    enum def Lv { A; B; }
    metadata def M { attribute level : Lv; }
    part def T1;
    part def T2;
    metadata m1 : M about T1;
    metadata m2 : M about T2 { :>> level = Lv::A; }
    requirement def R1;
    part def P {
      satisfy requirement : R1;
    }
  }`;
  assert.deepStrictEqual(parseSysML(src).errors, [], "both repro forms parse without error");
  const root = model(src);
  // #27: metadata usage with an `about` clause, bodyless and with a body
  const m1 = find(root, "m1");
  assert.deepStrictEqual(m1.typedBy, ["M"]);
  assert.ok(m1.refs.some((x) => x.kind === "target" && x.name === "T1"), "about target recorded");
  assert.ok(find(root, "m2").refs.some((x) => x.kind === "target" && x.name === "T2"));
  // #28: anonymous satisfy typed by the requirement def
  const p = find(root, "P");
  const sat = p.children.find((c) => c.kind === "satisfy")!;
  assert.ok(sat, "anonymous satisfy is a member of P");
  assert.deepStrictEqual(sat.typedBy, ["R1"]);
  // ...and the type reference resolves to the requirement def
  const resolver = new Resolver(root);
  assert.strictEqual(resolver.resolve(p, "R1"), find(root, "R1"), "satisfy target resolves");
});

test("keywords may be used as declared feature names, but clauses are not swallowed", () => {
  // OMG models declare features literally named with reserved words
  // (`step entry`, `attribute type`, …). These parsed as errors before the
  // atDeclName fix. Pin both directions: the name is taken, and a following
  // clause keyword (subsets / redefines / accept shorthand) is NOT eaten.
  const src = `package P {
    state def S {
      state entry[1];
      state exit[1];
      state do[1];
    }
    attribute type : String;
    part p1 subsets Base;
    part p2 { attribute :>> mass = 1; }
    part p3 :> Base;
  }`;
  const r = parseSysML(src);
  assert.deepStrictEqual(r.errors, [], "keyword-named features parse cleanly");
  const root = r.root;
  assert.strictEqual(find(root, "entry").kind, "state", "`state entry` names the state 'entry'");
  assert.strictEqual(find(root, "type").kind, "attribute", "`attribute type` names it 'type'");
  // `subsets Base` is a clause, not a name: p1 keeps its name and gains a specialization
  assert.deepStrictEqual(find(root, "p1").specializes, ["Base"]);
  assert.deepStrictEqual(find(root, "p2").children[0].redefines, ["mass"], "`:>> mass` stays a redefinition");
});

test("KerML `bool` scalar-feature abbreviation parses as an attribute", () => {
  // Kernel Semantic Library declares Boolean-valued features with the `bool`
  // abbreviation (Triggers.kerml, Observation.kerml). Modeled as an attribute.
  const src = `behavior B {
    private bool :>> signalCondition {
      doc /* the condition */
    }
    in bool condition[1];
    bool guard = true;
  }`;
  const r = parseSysML(src);
  assert.deepStrictEqual(r.errors, [], "`bool` features parse cleanly");
  const guard = find(r.root, "guard");
  assert.strictEqual(guard.kind, "attribute", "`bool guard` is an attribute");
  assert.strictEqual(guard.value, "true");
});

test("low-risk KerML/SysML grammar forms from the OMG corpus parse", () => {
  const cases: [string, string][] = [
    ["references clause", "part p { perform action shot[*] ordered references takePicture; }"],
    ["$ root namespace", "package O { class E :> $::Objects::Object { feature :>> subs; } }"],
    ["standalone inverse", "package I { inverse B::g of A::f; }"],
    ["doc <shortname>", "class A { doc <a> /* documentation */ }"],
    ["keyword short name", "attribute <var> vv : PowerUnit;"],
    ["keyword alias name", "package P { alias multiplicity for degeneracy; }"],
  ];
  for (const [label, src] of cases) {
    assert.deepStrictEqual(parseSysML(src).errors, [], label);
  }
  // the $-root name is preserved on the specialization
  const e = find(parseSysML("package O { class E :> $::Objects::Object; }").root, "E");
  assert.deepStrictEqual(e.specializes, ["$::Objects::Object"]);
});

test("captures expression bodies whole (lambdas, mixed statements)", () => {
  const r = parseSysML(`package P {
    calc total {
      x = parts->collect { in p; mass(p) }->reduce '+' ?? 0.0;
    }
    expr e { 1 + 2 }
    predicate ok { x > 0 }
    attribute a = items->select { in i; i != null };
  }`);
  assert.deepStrictEqual(r.errors, [], "expression bodies with lambdas parse");
  // a feature value and its element body are not conflated
  const r2 = parseSysML(`package P { attribute x : Real = 5 { doc /* note */ } }`);
  assert.deepStrictEqual(r2.errors, []);
  assert.strictEqual(find(r2.root, "x").value, "5");
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

test("control nodes parse as named members and resolve in successions", () => {
  const root = model(`package A {
    action def Y {
      action m;
      fork forkPoint;
      first start;
      then m;
      then forkPoint;
    }
  }`);
  const fk = find(root, "forkPoint");
  assert.strictEqual(fk.kind, "action", "fork node is a named member");
  assert.ok(fk.modifiers.includes("fork"), "fork keyword kept as modifier");
  const resolver = new Resolver(root);
  assert.strictEqual(
    resolver.resolve(find(root, "Y"), "forkPoint"),
    fk,
    "succession target resolves to the fork node"
  );
});

test("implicit start/done successions produce no unresolved diagnostics", () => {
  const root = model(`package A {
    action def X {
      first start;
      then action a;
      then done;
    }
  }`);
  const resolver = new Resolver(root);
  const file = root.children[0];
  const diags = validateFile(file, resolver).filter((d) => d.rule === "unresolved");
  assert.deepStrictEqual(
    diags.map((d) => d.message),
    [],
    "start/done are implicit action end points"
  );
});

// ---- expressions ----------------------------------------------------------

/** shorthand: parse an expression string into an AST */
function expr(src: string): Expr {
  return parseExpression(src);
}

test("expression operator precedence builds the right tree", () => {
  const e = expr("1 + 2 * 3");
  assert.strictEqual(e.kind, "binary");
  assert.strictEqual((e as any).op, "+");
  const right = (e as any).right;
  assert.strictEqual(right.kind, "binary");
  assert.strictEqual(right.op, "*", "* binds tighter than +");

  // comparison is looser than arithmetic; `and` is looser than comparison
  const cmp = expr("a + b < c and d");
  assert.strictEqual((cmp as any).op, "and");
  assert.strictEqual((cmp as any).left.op, "<");
  assert.strictEqual((cmp as any).left.left.op, "+");

  // ** is right-associative
  const pow = expr("2 ** 3 ** 2");
  assert.strictEqual((pow as any).right.kind, "binary");
  assert.strictEqual((pow as any).right.op, "**");
});

test("expression navigation, invocation and indexing", () => {
  const nav = expr("engine.fuelPort.flowRate");
  assert.strictEqual(nav.kind, "nav");
  assert.strictEqual((nav as any).member, "flowRate");
  assert.strictEqual((nav as any).target.kind, "nav");

  const call = expr("sum(masses, limit)");
  assert.strictEqual(call.kind, "invoke");
  assert.strictEqual((call as any).args.length, 2);

  const collect = expr("masses->reduce { in x; in y; x + y }");
  assert.strictEqual(collect.kind, "nav");
  assert.strictEqual((collect as any).op, "->");

  // KerML sequence indexing `seq#(i)` and numeric member `.1`
  const idx = expr("vertices#(2)");
  assert.strictEqual(idx.kind, "index");
  assert.strictEqual((idx as any).args[0].value, "2");
  assert.strictEqual(expr("tuple.1").kind, "nav");
});

test("expression conditional, classification and constructor", () => {
  const cond = expr("if x > 0 ? a else b");
  assert.strictEqual(cond.kind, "cond");
  assert.strictEqual((cond as any).cond.op, ">");

  const cls = expr("x istype Vehicle");
  assert.strictEqual(cls.kind, "classify");
  assert.strictEqual((cls as any).op, "istype");
  assert.strictEqual((cls as any).type, "Vehicle");

  const ctor = expr("new Translation(p)");
  assert.strictEqual(ctor.kind, "unary");
  assert.strictEqual((ctor as any).op, "new");
  assert.strictEqual((ctor as any).operand.kind, "invoke");
});

test("value expressions are attached to elements with absolute ranges", () => {
  const src = `package P {
    attribute total = mass + fuelMass * 2;
  }`;
  const root = parseSysML(src).root;
  const total = find(root, "total");
  assert.ok(total.valueExpr, "valueExpr attached");
  assert.strictEqual(total.valueExpr!.kind, "binary");
  // a leaf name node must point back at the right source offset
  const refs = collectExprRefs(total.valueExpr!);
  const names = refs.map((r) => r.name).sort();
  assert.deepStrictEqual(names, ["fuelMass", "mass"]);
  const massRef = refs.find((r) => r.name === "mass")!;
  assert.strictEqual(src.slice(massRef.start, massRef.end), "mass", "ref range is absolute");
});

test("unparseable expressions fall back to opaque", () => {
  // a multi-statement function body is not a single expression
  const e = expr("in x: Real; in y: Real; return : Real;");
  assert.strictEqual(e.kind, "opaque");
});

test("pathAtOffset reconstructs the feature chain under the cursor", () => {
  const src = "engine.fuelPort.flowRate";
  const e = parseExpression(src);
  // cursor on each segment yields the chain up to and including it
  assert.strictEqual(pathAtOffset(e, src.indexOf("engine")), "engine");
  assert.strictEqual(pathAtOffset(e, src.indexOf("fuelPort")), "engine.fuelPort");
  assert.strictEqual(pathAtOffset(e, src.indexOf("flowRate")), "engine.fuelPort.flowRate");
  // a classification type reference resolves as the type
  const c = parseExpression("x istype Vehicle");
  assert.strictEqual(pathAtOffset(c, "x istype ".length + 2), "Vehicle");
});

test("expression feature chains resolve member-by-member through types", () => {
  const src = `package P {
    port def FuelPort { attribute flowRate; }
    part def Engine { port fuelPort : FuelPort; }
    part def Car {
      part engine : Engine;
      attribute reading = engine.fuelPort.flowRate;
    }
  }`;
  const file = parseSysML(src).root;
  file.kind = "file";
  const ns = createElement("namespace");
  file.parent = ns;
  ns.children.push(file);

  const resolver = new Resolver(ns);
  const reading = find(ns, "reading");
  const flowRate = find(ns, "flowRate");

  // the path reconstructed from the AST at the `flowRate` offset...
  assert.ok(reading.valueExpr);
  const at = src.indexOf("flowRate", src.indexOf("reading"));
  const path = pathAtOffset(reading.valueExpr!, at);
  assert.strictEqual(path, "engine.fuelPort.flowRate");
  // ...resolves member-by-member through each step's type to the right member
  assert.strictEqual(resolver.resolve(reading, path!), flowRate);
});

console.log(`ALL PARSER TESTS PASSED (${passed})`);
