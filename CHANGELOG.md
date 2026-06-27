# Changelog

All notable changes to the **SysML v2 Studio** extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Expression bodies parse cleanly** — values and statements that mix balanced
  bodies with trailing operators (`a = parts->reduce { in s; in t; s + t } ?? 0;`,
  `return a + (xs->collect { … });`) are captured whole instead of breaking at the
  first `{`, while a feature's own `{ body }` is still kept separate from its value.
  KerML `expr` / `predicate` bodies are treated as opaque expressions (like `calc` /
  `constraint`). With this, the parser handles **~96% of the official OMG corpus**
  without errors (1197→49 parse errors across the KerML/SysML examples and the full
  standard library); expressions remain opaque text by design.

- **Wider SysML connection / flow / metadata grammar** — the parser now accepts
  flow & message usages with redefinition, typing and bodies (`flow :>> m : T {…}`,
  `message m of T[n]`, `message :>> m = a.b`), anonymous typed features after a
  modifier (`subject : Engine[1..*] = (…)`), nested connection ends
  (`end inCart [0..1] item cart : T`), metadata `about` targets, anonymous path
  connections (`interface a.b to c.d`), `entry assign …` effects, anonymous
  reference-usage targets (`event occurrence :>> x = …`) and the `constant`
  modifier. Measured against the official OMG corpus, SysML example parse errors
  dropped 101→21 (with knock-on gains: KerML 49→36, standard library 79→46).

- **KerML foundation layer now parses** — the parser recognises KerML definition
  keywords (`classifier` / `feature` / `function` / `predicate` / `datatype` /
  `struct` / `class` / `metaclass` / `behavior` / `assoc[iation]` / `connector` /
  `interaction` / `expr` / `step` / `multiplicity` / `type`), their relationship
  clauses (`conjugates` / `typed by` / `chains` / `crosses` / `disjoint from` /
  `unions` / `intersects` …), KerML connectors (`binding`/`connector`/`succession`
  with multiplicities and `from … to …` / `first … then …`), `inv` invariants and
  standalone relationship elements. Reserved KerML keywords stay usable as
  *referenced* element names (the standard library names features `step` / `type` /
  `decide` / `merge` / `member` and references them bare). Measured against the
  official OMG corpus, parse errors dropped ~88% on the KerML examples (417→49) and
  the full standard library (679→79). KerML moves from **None** to **Parse-only** in
  the [conformance matrix](docs/conformance.md). First step of an initiative to track
  the official OMG grammar; semantic validation / visualization of the KerML layer,
  expression bodies (`->` lambdas) and a few connector forms remain future work.

- **GitHub Releases are automated** — pushing a `v<version>` tag now also creates
  (or updates) a GitHub Release, using the matching `CHANGELOG.md` section as the
  notes (`github-release.yml`). Needs no secrets and no approval gate.

## [0.7.1] — 2026-06-26

Documentation and release-infrastructure release; no change to extension behavior.

### Added

- **Multilingual README** — the README is now available in English (default
  `README.md`), Japanese (`README.ja.md`) and Simplified Chinese
  (`README.zh-Hans.md`), with a language switcher at the top of each. English is
  the Marketplace/GitHub default.
- **Automated releases** — pushing a `v<version>` tag now publishes the extension
  to the VS Code Marketplace and Open VSX (`publish-extension.yml`, gated behind a
  protected `release` environment) and the npm MCP package via OIDC
  (`publish-mcp.yml`). One version bump + one tag ships everything.

### Changed

- **README overhaul** — installation, the diagram preview quick-start and the
  Claude (MCP) setup are now near the top, and a new "記法と図の対応" gallery shows
  each diagram kind beside the exact source snippet that renders it (taken from
  the screenshot generator, so code and image always match). Added Marketplace /
  npm / license badges.

## [0.7.0] — 2026-06-26

### Added

- **Zero-config MCP for VS Code users** — on VS Code 1.101+ the extension
  registers the bundled MCP server automatically via the native
  `lm.registerMcpServerDefinitionProvider` API (one server per workspace folder).
  No manual config needed; see it under *MCP: List Servers*.
- **Standalone MCP npm package** — `@engineer-fumi/sysml-v2-mcp` so non–VS Code
  clients register with one line: `npx -y @engineer-fumi/sysml-v2-mcp <dir>`.
  Built from the bundled server via `npm run build:mcp:pkg` (version synced from
  the extension), with a stdio smoke test (`npm run smoke:mcp`) wired into CI.
- **SysML v2 conformance matrix** ([docs/conformance.md](docs/conformance.md))
  documenting, with code-level evidence, which language areas are Full / Partial /
  Parse-only / None. Summary table added to the README.

### Changed

- **Minimum VS Code raised to 1.101** (`engines.vscode ^1.101.0`) — required by
  the finalized native MCP server definition provider API.
- MCP registration docs ([docs/mcp.md](docs/mcp.md)) reorganized around
  auto-registration (VS Code) / npx (other clients) / path / local-build.
- **Clearer MCP setup in the README** — the integration section is now split into
  two unambiguous cases (① VS Code AI → nothing to do, ② Claude Code / Desktop →
  one line) so users immediately see which step applies to them.

## [0.6.0] — 2026-06-25

### Added

- **Claude (MCP) integration** — a bundled, dependency-free MCP server
  (`dist/mcp.cjs`, newline-delimited JSON-RPC 2.0 over stdio) exposing the shared
  model core to Claude Desktop / Claude Code. Tools: `list_files`, `outline`,
  `validate`, `find_element`, `list_requirements`, `describe_diagram`. See
  [docs/mcp.md](docs/mcp.md).

### Changed

- **Renamed** the extension from *SysML v2 Viewer* to **SysML v2 Studio**
  (Marketplace id `engineer-fumi.sysml-v2-studio`) to reflect that it now
  authors, edits and validates models — not just views them.
- Port labels now sit just outside the box boundary (top→above, bottom→below),
  so they no longer collide with the box header or inner content.
- Refreshed the extension icon and the internal block diagram (IBD) demo image
  (facing ports across a roomy gap).

## [0.5.0] — 2026-06-19

First Marketplace-ready release. The extension provides SysML v2 authoring
support plus an interactive, editable diagram view.

### Added

- **Language support** for `.sysml` / `.kerml`: syntax highlighting, real-time
  syntax + semantic diagnostics (name resolution, type conformance, duplicate
  names), keyword/snippet/workspace-name completion, document outline,
  cross-file go-to-definition and hover.
- **Bundled minimal standard library** (`ScalarValues`, `ISQ`, `SI`, …) so
  imports resolve and F12 jumps into the library; transitive re-export through
  `public import`.
- **Diagram views by kind** — general, block definition (BDD), internal block
  (IBD), requirement, use case, state, activity and sequence — switchable from
  the panel or via the *“SysML: 図の種類を選んで開く”* command, each in its own
  panel.
- **Diagram editing**: move/resize boxes, drag ports along borders, route lines
  (waypoints, endpoints, straight/orthogonal/curved styles), right-click
  context menu, undo/redo, and write-back to the source text. Manual layout is
  saved to a `.sysml-layout.json` sidecar per diagram kind.
- **OMG official examples** bundled under `samples/omg/` (EPL-2.0) as a
  conformance reference.
- **Automated test suite** (CI on GitHub Actions): unit, fuzz, webview E2E
  (Playwright), VS Code integration and VS Code UI E2E (vscode-extension-tester).

### Notes

- The parser implements a pragmatic subset of the SysML v2 textual notation;
  expression bodies are treated as opaque text and not type-checked.
- Name resolution is an approximation (visibility is not fully enforced).

[Unreleased]: https://github.com/engineer-fumi/sysml-v2-studio/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/engineer-fumi/sysml-v2-studio/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/engineer-fumi/sysml-v2-studio/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/engineer-fumi/sysml-v2-studio/releases/tag/v0.6.0
[0.5.0]: https://github.com/engineer-fumi/sysml-v2-studio/releases/tag/v0.5.0
