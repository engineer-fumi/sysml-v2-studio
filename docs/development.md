# Development guide

## Architecture

```
syntaxes/sysml.tmLanguage.json   # TextMate grammar (highlighting)
language-configuration.json      # Comments, brackets, indentation
src/
├── core/                  # Editor-independent core (no VS Code dependency; easy to test)
│   ├── lexer.ts           #   Tokenizer
│   ├── parser.ts          #   Recursive-descent parser (with error recovery)
│   ├── ast.ts             #   Lightweight AST
│   ├── resolve.ts         #   Name resolution (scope / import / inheritance)
│   ├── validate.ts        #   Semantic validation
│   ├── stdlib.ts          #   Bundled standard library (minimal subset)
│   ├── viewSpecs.ts       #   Per-diagram-kind view config (VIEW_SPECS)
│   ├── layout.ts          #   Diagram layout
│   └── serialize.ts       #   AST handoff to webview
├── extension/             # Extension host side
│   ├── extension.ts       #   Entry point
│   ├── modelIndex.ts      #   Workspace-wide model index
│   ├── languageFeatures.ts  # Diagnostics, completion, symbols, definition, hover
│   └── diagramPanel.ts    #   Diagram webview panel
├── mcp/                   # Claude (MCP) server (no VS Code/SDK dependency)
│   ├── modelStore.ts     #   fs-based model index (Node version of ModelIndex)
│   ├── tools.ts          #   Tool definitions + implementation (depends on core only; unit-testable)
│   └── server.ts         #   Thin JSON-RPC 2.0 over stdio wiring
└── webview/               # Webview (React + SVG)
    ├── DiagramApp.tsx     #   Messaging, root selection
    ├── DiagramView.tsx    #   SVG rendering
    ├── diagramGeometry.ts #   Pure geometry (path generation, bounds)
    ├── diagramInteractions.ts # Pure interaction math (resize, etc.)
    ├── usePanZoom.ts       #   View (pan/zoom) hook
    └── useDiagramDrag.ts   #   Drag delivery hook
samples/                   # Sample models (including multi-file examples)
samples/omg/               # Official OMG samples (from SysML-v2-Release, EPL-2.0)
test/                      # Automated tests per layer
scripts/                   # Demo image / icon generation scripts
```

The core does not depend on VS Code, so parser, resolver, and layout run in the browser
or Node alone; `webview/` renders core output over postMessage.
For the same reason, the `mcp/` server reuses `core/` directly, so diagnostics and
diagram structure match the editor (→ [Claude (MCP) integration guide](mcp.md)).

## Build

```bash
npm install
npm run check     # Type-check (tsc --noEmit)
npm run build     # Type-check + esbuild bundle (dist/extension.js, dist/webview.js)
npm run build:mcp # Bundle MCP server into a single file (dist/mcp.cjs)
npm run watch     # esbuild watch
```

During development, open this repo in VS Code and press **F5** (extension development
host launches with `samples/` open).

## Tests (5 layers · CI: GitHub Actions)

```bash
npm run test:unit   # Unit: parser/resolver, layout, geometry, React hooks,
                    #        fuzz (no crash/hang on invalid input)
npm run test:e2e    # Webview E2E: real browser rendering; hostile ops like
                    #              off-bounds drag must not break (Playwright)
npm run test:vscode # Integration: language features in real VS Code extension host
npm run test:ui     # UI E2E: real VS Code driven by Selenium (vscode-extension-tester)
```

Individual targets: `test:core` / `test:geometry` / `test:parser` / `test:hooks` /
`test:fuzz` / `test:mcp` (MCP tool layer). Fuzz iteration count is adjustable via
`FUZZ_ITERS`.
`test:e2e` / `test:ui` download a browser or VS Code on first run.

## Regenerating demo images / icon

```bash
npm run gen:screenshots   # Regenerate docs/images/diagram-*.png (Playwright)
npm run gen:icon          # Regenerate media/icon.png
```

## Packaging / publishing

### Release (automated · recommended)

Bump `version` in `package.json` and push a `v<version>` tag; GitHub Actions publishes
**all three**:

1. Update `CHANGELOG.md`, bump `package.json` `version`, merge to main
2. `git tag v<version> && git push origin v<version>` (e.g. `v0.8.0`)
3. Automated publish:
   - **VS Code Marketplace** + **Open VSX** (`publish-extension.yml`, after `release` environment approval)
   - **npm `@engineer-fumi/sysml-v2-mcp`** (`publish-mcp.yml`, OIDC tokenless)
   - **GitHub Release** (`github-release.yml`, notes from the matching `CHANGELOG.md` section.
     No secrets · no approval gate)

One-time setup (repo → Settings → Environments → `release`):
- Secret `VSCE_PAT` (Azure DevOps PAT, scope *Marketplace > Manage*, with expiry)
- Optional: Secret `OVSX_PAT` (for Open VSX; skipped if absent)
- Set required reviewers to gate long-lived PATs

For npm Trusted Publisher setup, see [docs/mcp.md](mcp.md).

### Local packaging / manual publish

```bash
npm run package           # Generate sysml-v2-studio-<version>.vsix (MCP server bundled)
code --install-extension sysml-v2-studio-<version>.vsix   # Local install

# Manual Marketplace publish (publisher Personal Access Token required)
npx @vscode/vsce login engineer-fumi
npx @vscode/vsce publish        # Publish at package.json version
```
