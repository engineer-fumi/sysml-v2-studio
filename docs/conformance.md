# OMG SysML v2 conformance matrix

> Target version: **v0.8.0** / 最終更新: **2026-07-07**

This extension implements a **practical subset** of OMG SysML v2 text notation. This
page inventories which language areas are supported and to what degree, based on the
code. Source evidence is cited directly to avoid overclaiming. Ambiguous areas are
marked Partial / Parse-only / None explicitly.

## Conformance levels

| Level | Meaning |
|---|---|
| **Full** | Parsed, semantically validated (type conformance, resolution, etc.), and visualized in diagrams |
| **Partial** | Parsed and partly validated/visualized; internals (expressions, effects, control-flow bodies) are opaque text |
| **Parse-only** | Accepted syntactically (not an error) but not validated or visualized |
| **None** | Not supported (skipped via error recovery) |

> ⚠️ "Supported" here means only what can actually be **parsed / validated / visualized**.
> Unsupported syntax is skipped by the parser's error recovery (`recover()` in
> `src/core/parser.ts`), so partially valid models still work overall.

## Summary

| Language area | Level | Evidence (code) |
|---|---|---|
| Definitions & Usages (part / item / attribute / port / action / state / …) | **Full** | `parser.ts` `DEF_KINDS`, `validate.ts` `TYPE_CONFORMANCE`, `viewSpecs.ts` `BOX_KINDS`/`TEXT_KINDS` |
| Specialization (`:>` subsets / `:>>` redefines / `specializes` / `subsets` / `redefines` / `::>` references) | **Full** | `parser.ts` `parseDeclarationTail`, `validate.ts` `KIND_GROUP` + shadowing detection |
| Connections / Interfaces / Bindings / Flows | **Full** (structure) | `parser.ts` `parseConnectBody`/`parseBind`/`parseFlow`, `viewSpecs.ts` `isEdgeElement` |
| States & Transitions (trigger / guard / effect) | **Partial** | `parser.ts` `parseTransition` (trigger/guard as text; `do` effects discarded) |
| Actions / Calc / Successions | **Partial** | `parser.ts` (control-flow statements opaque via `parseOpaqueStatement`) |
| Requirements / Constraints / satisfy / verify | **Full** (structure) / expressions opaque | `parser.ts` `parseReferenceUsage`, `viewSpecs.ts` `req` `refEdges` |
| Use Cases / Actors / include / perform | **Full** | `parser.ts` `parseReferenceUsage`, `viewSpecs.ts` `uc` (`hoistActors`) |
| Views / Viewpoints / Rendering / expose | **Partial** | `viewSpecs.ts` boxes `view`/`viewpoint`/`rendering`; `expose`/`render` rendering not implemented |
| Metadata / Annotations (`@`, `#`, `metadata def`) | **Full** (parse) | `parser.ts` `@`/`#` handling, `validate.ts` metadata ref check |
| Expressions (constraint / calc bodies, values, guards, etc.) | **Parse-only (opaque)** | `parser.ts` `captureBracedBody`/`captureUntil` (no type-checking) |
| Imports / Aliases / Visibility (public / private) | **Partial** (visibility approximate) | `parser.ts` `parseImport`/`parseAlias`, `resolve.ts` (private/protected not enforced) |
| Comments / Documentation (`//`, `/* */`, `doc`, `comment`) | **Full** | `lexer.ts`, `parser.ts` `parseDoc`/`parseComment` |
| Standard Library | **Minimal bundled subset** | `stdlib.ts` `STDLIB_FILES` (not the full OMG library) |
| KerML foundation layer (classifier / feature / datatype / function / predicate …) | **Parse-only** | `lexer.ts` `KEYWORDS` (KerML vocabulary), `parser.ts` `KERML_KINDS` + relationship clauses / connectors. No semantic validation or visualization |

---

## Details

### Definitions & Usages — Full

Each `def` and usage for `part` / `attribute` / `port` / `item` / `action` / `state` /
`requirement` / `constraint` / `interface` / `connection` / `allocation` / `analysis` /
`verification` / `concern` / `view` / `viewpoint` / `rendering` / `enum` /
`occurrence` / `metadata` / `calc` / `case` / `flow` (`DEF_KINDS` in `parser.ts`).
`use case [def]` is a compound keyword; `individual def` is treated as `occurrence def`.
`objective` is treated as `requirement`.

- **Validation**: `TYPE_CONFORMANCE` (`validate.ts`) checks usage typing against the
  correct def kind (e.g. `part` typed by `part def` / `occurrence def`).
- **Visualization**: `BOX_KINDS` render as nested boxes; `TEXT_KINDS` as text lines inside
  parent boxes (`viewSpecs.ts`).
- Each usage may have direction (`in` / `out` / `inout`), multiplicity (`[n..m]`), and
  modifiers (`abstract` / `variation` / `readonly` / `derived` / `ordered` / `nonunique` …).

### Specialization — Full

`:` / `defined by` (typing), `:>` / `specializes` / `subsets` (specialization),
`:>>` / `redefines` (redefinition), `::>` / `references` (reference specialization).
Parsed in `parser.ts` `parseDeclarationTail`; specialization between defs is validated
for **kind-group match** via `KIND_GROUP` (`validate.ts`) (e.g. structure to structure only).
Shadowing of inherited members is detected and `:>>` is suggested.

### Connections / Interfaces / Bindings / Flows — Full (structure)

- `connect a.b to c.d` / `connect (a, b, c)`, `connection [name] [: T] connect …`
- `bind x = y` / `binding b bind x = y`
- `flow [name] [of Item] from a.b to c.d`, `message`, `succession flow`
- `interface` / `allocation` treated as connections; those with 2+ ends become edges (`isEdgeElement`).
- **Validation**: approximate check that flow ends should use dot notation for features
  inside elements (`validate.ts` `flow` branch).
- End paths (`engine.fuelPort`) are added as references for resolution.

### States & Transitions — Partial

`state def` / `state`, `transition` / `succession` / `first … then …`, `entry` / `exit` /
`do` actions inside states. `transition` retains source / target / trigger (`accept …`) /
guard (`if …`).

- **Limits**: trigger / guard are **kept as text only**; no type-checking. Transition
  effects (`do send … via …`) are opaque text, not structured.
- **Visualization**: `state` diagram shows states as boxes, `transition` as edges (`viewSpecs.ts` `state`).

### Actions / Calc / Successions — Partial

`action def` / `action`, `calc def` / `calc`, `succession`, steps inside state/action bodies.

- **Limits**: control-flow statements — `accept` / `send` / `assign` / `if` / `while` /
  `loop` / `for` / `merge` / `decide` / `fork` / `join` / `return` / `else` / `until` /
  `terminate` / `assert` / `assume` / `require` — are skipped as **opaque text** via
  `parseOpaqueStatement` (`parser.ts`); data/control-flow semantics are not built. `calc`
  bodies are opaque expressions.
- **Visualization**: `action` diagram shows actions as boxes; `succession` / `flow` /
  `transition` as edges.

### Requirements / Constraints / satisfy / verify — Full (structure) / expressions opaque

`requirement [def]` / `constraint [def]` / `concern [def]`, `satisfy` / `verify`
(internally `satisfy` kind), `assert constraint`, `objective`.

- **Limits**: `{ … }` bodies of `constraint` / `calc` are **opaque expressions**
  (`captureBracedBody`). `require` / `assume` / `assert` statements are opaque.
- **Visualization**: `req` diagram boxes requirements, `satisfy` as reference edges (`refEdges`),
  `doc` as body lines.

### Use Cases / Actors / include / perform — Full

`use case [def]` / `case [def]`, `perform` / `include` (`perform` kind), `actor` modifier.
In `uc` diagram, use cases are ellipses; actors are hoisted outside boxes and linked
(`hoistActors`). `exhibit state` is also supported.

### Views / Viewpoints / Rendering — Partial

`view [def]` / `viewpoint [def]` / `rendering [def]` are parsed and drawn as boxes.
`expose` (import-like reference) is parsed.

- **Limits**: **actual view rendering** (`expose … ; render as …;` view computation) is
  not implemented. `render` / `rep` / `frame` etc. are opaque statements.

### Metadata / Annotations — Full (parse)

- `@Metadata` (metadata annotation usage, with `about` target)
- `#metadata` (prefix annotation on the next element)
- `metadata def`
- **Validation**: metadata annotations must refer to `metadata def` (`validate.ts`).

### Expressions — Partial (AST + type check, no evaluation)

The value of `= expr` and the `constraint` / `calc` body of a single expression are structured into an AST (`valueExpr`) by a **priority parser** (`expr.ts`) that follows the KerML `OwnedExpression`. The raw text (`value`) is also preserved. **91.9%** of value expressions in the OMG official corpus are AST-generated (the remainder are complex sentence bodies like `in x:T; … return …;`, which are not single expressions and are therefore intentionally obscured).
odies of `constraint` / `calc`, `= expr` values, transition trigger / guard, `return`
expressions, etc. are **kept as raw text** (`captureBracedBody` / `captureUntil`). No
expression AST, evaluation, or type-checking. This is an intentional design trade-off.

- **Navigation**: The feature chain (`a.b.c`) reconstructs the path in the AST from the cursor position
(`pathAtOffset`), traversing the type of each step and defining jump/hover resolution member by member.
- **Type Checking** (`types.ts` `inferType` + `validate.ts` `type` rule): **Positive knowledge only** — Reports types only if they can be derived from operators (`<` → Boolean, `+` → number), literals, and the declared scalar type of resolved features. Anything uncertain is treated as `unknown` and **no diagnosis is issued**.
(Zero false positives confirmed across all 311 files in the OMG corpus). Checked for: ① The constraint body must evaluate to Boolean,
② The value must conform to the declared scalar type of the feature. Settings:
`sysml.validation.typeChecking` (default: warning). Displays inferred types on hover.
- **Limitations**: Expression **evaluation** (calculation of values) is not performed. Return type inference for calls / calc is `unknown`.
(Intentionally conservative). Transition triggers / guards and compound statement action bodies are text as before.

### Imports / Aliases / Visibility — Partial (visibility approximate)

- `import P::*` / `import P::**` (recursive) / `import all` / `import P::X`, `alias A for B`.
- `public import` is **transitively re-exported** in name resolution (`resolve.ts` `lookupExported`).
- **Limits**: visibility (`private` / `protected`) is **not enforced** in resolution
  (see `resolve.ts` header comment). Only private import not being re-exported is reflected.
- Lint warning when import lacks explicit visibility (`importVisibility`, `validate.ts`).

### Comments / Documentation — Full

`//` line comments, `/* … */` block comments, `doc /* … */`, `comment … about …`.
`doc` attaches to elements and appears in hover and requirement diagram bodies.

### Standard Library — minimal bundled subset

Three files bundled as `STDLIB_FILES` in `stdlib.ts`:

- **ScalarValues** — `ScalarValue` / `Boolean` / `String` / `Number` / `Real` /
  `Integer` / `Natural` / `Positive`, etc.
- **Base packages** — `Base` / `Items` / `Parts` / `Ports` / `Actions` / `States` /
  `Connections` / `Interfaces` / `Allocations` / `Constraints` / `Requirements` /
  `Calculations` / `Cases` / `AnalysisCases` / `VerificationCases` / `UseCases` /
  `Views` / `Metaobjects` / `Flows` / `Occurrences`
- **Quantities** — `Quantities` / `ISQ` (value types and usages for mass, length, time, …) /
  `SI` (kg / m / s / A / K …) / `Time` / `MeasurementReferences` / `SIPrefixes` /
  `ModelingMetadata` (`StatusInfo` / `Risk` / `Rationale` …) / `RequirementDerivation`

Resolved via import; F12 jumps into the bundled library. **This is not the full OMG
standard library** — function packages (`BaseFunctions` / `NumericalFunctions`, etc.)
exist only as empty packages for import resolution.

### KerML foundation layer — Parse-only

KerML definition keywords such as `classifier` / `feature` / `datatype` / `class` /
`struct` / `function` / `predicate` / `metaclass` / `behavior` / `assoc[iation]` /
`connector` / `interaction` / `expr` / `step` / `multiplicity` / `type`
(`lexer.ts` `KEYWORDS` / `parser.ts` `KERML_KINDS`), their relationship clauses
(`specializes` / `subsets` / `redefines` / `conjugates` / `typed by` / `chains` /
`crosses` / `disjoint from` / `unions` / `intersects` …), connectors
(`binding`/`connector`/`succession` `from … to …` / `first … then …` / multiplicity),
`inv` invariants, and standalone relationship elements (`subtype` / `specialization` /
`redefinition` …) are **parsed**.

- **Limits**: **syntax acceptance only**; no KerML-level semantic validation, type
  inference, or visualization. Measured against the OMG official corpus, but expression-level
  (`->` / `?` operators, etc.) and some connector-end notations remain **unsupported**.
- KerML vocabulary is reserved, so standard-library elements with KerML keyword names
  like `step` / `feature` / `type` are resolved **as identifiers when used as reference names**
  (`parser.ts` `atNameToken`).

---

## Known limitations (summary)

- **Expressions are not evaluated** — Values ​​and single expression bodies are AST-generated + positive-knowledge type checking.
(The return type of a call is `unknown`). Guards/triggers and compound statement bodies remain as text.
- **Visibility is approximate** — private/protected is not enforced, only re-exports of `public import` are reflected.
- **Control flow is opaque** — `if`/`loop`/`accept`/`send` etc. within action/state are read as text and skipped.
- **Standard library is a minimal subset** — Not the complete OMG library.
- **Diagram renaming is only done by declaration name** — References are not followed.
- **KerML base layer is parse-only** — Syntax accepts definitions, relations, connectors, and `inv`, but
semantic verification and visualization are not supported. Syntax remains unsupported at the expression level and for some notations.

## Related

- [Supported notation and limitations](syntax.md) — subset overview
- [Diagram features](diagrams.md) — what each diagram kind visualizes
