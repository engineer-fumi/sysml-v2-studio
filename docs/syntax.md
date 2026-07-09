# Supported SysML v2 notation and limitations

> See also the evidence-backed per-area breakdown in the
> [conformance matrix](conformance.md).

## Language support

- Syntax highlighting (TextMate grammar)
- Real-time syntax diagnostics (Problems panel, squiggles)
- **Semantic validation** (SysIDE-equivalent):
  - Unresolved references (types, specializations, redefinitions, connect / flow
    ends, transition targets, accept signals, metadata, etc.)
  - Duplicate names (same scope, top-level global collisions)
  - Typing / specialization kind conformance (e.g. part must be typed by part def)
  - Inherited-member shadowing detection (suggests redefinition with `:>>`)
  - import visibility (public / private) checks
  - Diagnostic levels configurable via `sysml.validation.*` (error / warning / off)
- **Bundled minimal standard-library subset** (`ScalarValues` / `ISQ` / `SI` and
  basic defs). Resolved via import; F12 jumps into the bundled library.
  `public import` is re-exported transitively
- Completion: keywords / snippets / element names across workspace files
- Outline (hierarchical symbols, breadcrumbs)
- Go to definition (F12, cross-file) / hover (kind, qualified name, type, `doc`)

## Supported notation (subset)

`package` / `part def` / `part` / `attribute` / `port` / `item` / `action` /
`state` / `transition` / `requirement` / `constraint` / `interface` /
`connection` / `connect` / `bind` / `flow` / `import` / `alias` / `doc` /
`enum` / `use case` / `perform` / `exhibit` / `satisfy` /
`@Metadata` annotations / `#metadata` prefix / `filter` / `individual def` /
specialization (`:>`, `specializes`, `subsets`) / redefinition (`:>>`, `redefines`) /
multiplicity (`[n..m]` + `ordered` / `nonunique`) / values (`= expr`) /
direction (`in` / `out` / `inout`), and more.

Unsupported syntax is skipped with error recovery, so partially valid models still work.
The OMG spec appendix A `SimpleVehicleModel` can be parsed in full syntactically.

## Limitations

- The parser is a practical subset of the OMG SysML v2 spec (KerML foundation-layer
  constructs such as classifier / feature are not supported). Expressions (constraint /
  calc bodies) are treated as opaque text; no expression type-checking
- Name resolution is an approximation that considers scope, import, and inherited
  members. Visibility (private / protected) is not fully enforced
- The bundled standard library is a minimal subset (not the full OMG library)
- Diagram rename changes only the declaration name (references are not updated)
