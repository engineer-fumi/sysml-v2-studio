# Changelog

All notable changes to the **SysML v2 Studio** extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/engineer-fumi/sysml-v2-studio/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/engineer-fumi/sysml-v2-studio/releases/tag/v0.6.0
[0.5.0]: https://github.com/engineer-fumi/sysml-v2-studio/releases/tag/v0.5.0
