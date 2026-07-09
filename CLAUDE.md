# Guidance for AI coding agents

## Diagram layout is human/machine-owned — do not hand-edit it

`.sysml-layout.json` (workspace-root sidecar) persists **diagram geometry**:
manual node offsets, port sides, and edge routing **waypoints**. It is written
by the extension when a user drags a box/port or routes an edge, and read back
to restore that layout.

**Do not edit `.sysml-layout.json` (or otherwise emit diagram coordinates /
edge waypoints) by hand.** Placement and especially edge routing are geometry
the layout engine and the human own; an LLM authoring waypoints produces
unreadable wiring. Change the **model** (`.sysml` / `.kerml`) — the diagram is a
projection of it. The MCP server is intentionally read-only for this reason;
raw file editing is the only way to violate it, so don't.

## Build & test

- `npm run check` — typecheck (extension + webview)
- `npm run test:unit` — core / geometry / parser / hooks / fuzz / mcp suites
- `npm run test:parser` — parser + resolver unit tests
- `npm run coverage:grammar [-- --check]` — parse the vendored OMG corpus
  (`tmp/omg-corpus`, cloned by `scripts/clone-corpus.mjs`); `--check` enforces
  the `MAX_ERRORS` regression thresholds. Ratchet those down as coverage grows.
- `npm run build` — typecheck + bundle the extension

The OMG corpus under `tmp/` is a scratch clone for the grammar harness; it is
gitignored and excluded from the workspace model index (see `indexFilter.ts`).
