# Claude (MCP) integration guide

SysML v2 Studio ships a **standalone MCP (Model Context Protocol) server** separate
from the extension. Register it with Claude Desktop / Claude Code so Claude can treat
workspace `.sysml` / `.kerml` models as **resolved model structure**, not plain text.

The server reuses the same `src/core` as the extension (parser, resolution, validation,
layout), so diagnostics and diagram structure match what you see in the editor. It has
no runtime dependencies and runs as a single `dist/mcp.cjs` file (newline-delimited
JSON-RPC 2.0 over stdio).

## How it works

```
Claude Desktop / Claude Code
        │  stdio (JSON-RPC 2.0)
        ▼
   dist/mcp.cjs  ──►  src/core (parser / resolve / validate / layout)
        │
        ▼
   Scan and parse *.sysml / *.kerml in the workspace
```

- The first launch argument (or `SYSML_WORKSPACE` env var, else current directory)
  is the workspace root, scanned recursively.
- Each tool call re-reads from disk, so edits by Claude or other tools are always reflected.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `list_files` | — | All model files in the workspace (element count, syntax error count) |
| `outline` | `file?` | Structure tree of named declarations (kind, type, line number, doc) |
| `validate` | `file?` | Syntax + semantic diagnostics (unresolved refs, duplicates, type conformance, shadowing, import visibility; with line/column) |
| `find_element` | `name` | Kind, type, doc, and location of declarations matching the name (short name) |
| `list_requirements` | — | Requirements/constraints with doc, attributes, and `satisfy` relationships |
| `describe_diagram` | `kind`, `file?` | Boxes, ports, and connections for the given diagram kind as structured data (`kind`: `general`/`bdd`/`ibd`/`req`/`uc`/`state`/`action`/`seq`) |

## Registration

| Use case | Recommended method |
|---|---|
| **VS Code extension installed** (1.101+) | **Method 0: auto-registration (zero config)** |
| Claude Desktop / Claude Code outside VS Code | Method A: npx (recommended) |
| Extension installed · point at local `dist/mcp.cjs` | Method B: path (fallback) |
| Build from repository | Method C: local build |

### Method 0: VS Code extension users — auto-registration (zero config)

With **VS Code 1.101+** and this extension installed, no extra setup is needed. The
extension uses VS Code's native MCP API (`lm.registerMcpServerDefinitionProvider`, finalized
in 1.101) to **auto-register** the bundled `dist/mcp.cjs` as an MCP server.

- One server per workspace folder, scanning that folder as the workspace root (multi-root
  supported). The server starts with VS Code's bundled Node.js (`process.execPath`), so
  it works even if `node` is not on PATH.
- Copilot / agent (MCP client) in VS Code sees the `sysml` tools directly. List servers via
  **Command Palette → "MCP: List Servers"**.
- **Requirement**: `engines.vscode` is `^1.101.0`. On VS Code 1.100 or below the extension
  cannot be installed; use npx / path below instead.
- Non-VS Code clients (Claude Desktop, etc.) are not covered by auto-registration; use
  Method A (npx).

### Method A: npx (recommended outside VS Code · zero install)

Run the published [`@engineer-fumi/sysml-v2-mcp`](https://www.npmjs.com/package/@engineer-fumi/sysml-v2-mcp)
directly. No prior install or path hunting.

**Claude Code** (at project root):

```bash
claude mcp add sysml -- npx -y @engineer-fumi/sysml-v2-mcp "$(pwd)"
```

**Claude Desktop** (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "sysml": {
      "command": "npx",
      "args": ["-y", "@engineer-fumi/sysml-v2-mcp", "<ABS_PATH_TO_YOUR_MODEL_WORKSPACE>"]
    }
  }
}
```

### Method B: point at bundled `dist/mcp.cjs` (fallback)

If the VS Code extension is installed, you can point directly at bundled `dist/mcp.cjs`.
Install paths differ by editor (VS Code / Insiders / Cursor) and OS; watch glob expansion
for versioned folder names:

```bash
# macOS / Linux (zsh may need `setopt null_glob` if glob does not expand)
claude mcp add sysml -- node ~/.vscode/extensions/engineer-fumi.sysml-v2-studio-*/dist/mcp.cjs "$(pwd)"
```

### Method C: local build from repository (development · self-hosted)

```bash
npm install && npm run build:mcp
claude mcp add sysml -- node "$(pwd)/dist/mcp.cjs" "$(pwd)"
```

For Claude Desktop: `command: "node"`, `args: ["<ABS_PATH>/dist/mcp.cjs", "<workspace>"]`.

After registration, ask Claude to "validate this model", "list requirements", or "describe
the block definition diagram structure for Vehicle" — the matching tools will be invoked.

## Usage examples

- **Review**: "Run `validate` on all files and fix unresolved references"
- **Requirements trace**: "Use `list_requirements` to list unsatisfied requirements"
- **Structure**: "Use `describe_diagram kind=ibd` to explain internal connections in system"
- **Refactor**: "Use `find_element` to locate Engine's definition and rename it to Powerplant"

## Publishing the npm package (maintainers)

The npx path (Method A) package `@engineer-fumi/sysml-v2-mcp` is built from the same
source as a **single bundled `dist/mcp.cjs` file**.

```bash
npm run build:mcp:pkg   # Generate publishable package in dist/npm/
npm run smoke:mcp       # Start via stdio; verify initialize / tools/list / tools/call
npm run publish:mcp     # build:mcp:pkg → smoke:mcp → npm publish ./dist/npm --access public
```

- **Version sync**: `scripts/build-mcp-package.mjs` takes `version` from root `package.json`,
  so extension (`sysml-v2-studio`) and package versions always match. Bump root `version` on release.
- Output (`dist/npm/`) is a build artifact; `dist/` is `.gitignore`d. `publish:mcp` rebuilds
  from `build:mcp` each time to avoid publishing stale bundles.
- `npm publish` path must be **`./dist/npm`** (leading `./` required). `dist/npm` alone is
  mistaken by npm for GitHub shorthand `owner/repo`.

### Release flow (OIDC tokenless from second release onward)

Initial `0.6.0` was published manually with a short-lived token. Subsequent releases use
**GitHub Actions Trusted Publishing (OIDC)**; no npm token is stored
(`.github/workflows/publish-mcp.yml`).

1. Bump root `package.json` `version` and merge to main.
2. Push tag `v<version>` (e.g. `v0.7.1`) or run Actions manually. Same tag triggers
   extension publish (`publish-extension.yml`) and npm in one workflow.
3. Workflow runs build → smoke → `npm publish ./dist/npm --access public --provenance`
   with OIDC (short-lived signed token; `--provenance` attaches provenance).

**One-time setup**: npmjs.com package settings → *Trusted Publisher* → add GitHub Actions
(repo `engineer-fumi/sysml-v2-studio`, workflow `publish-mcp.yml`). Removes need for
long-lived tokens and 2FA bypass. For manual publish only, use a short-lived (1-day)
token and revoke immediately after use.

## Troubleshooting

- Broken output: the server **never writes anything but JSON-RPC to stdout**. Logs go to
  stderr. Run `node dist/mcp.cjs <dir>` manually and check the startup message on stderr
  for the workspace path.
- Files not found: verify the workspace argument, `.sysml` / `.kerml` extensions, and that
  files are not under excluded directories such as `node_modules`.
