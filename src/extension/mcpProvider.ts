import * as vscode from "vscode";

/**
 * Zero-config MCP registration for extension users.
 *
 * VS Code 1.101 finalized the MCP server definition provider API
 * (`lm.registerMcpServerDefinitionProvider` / `McpStdioServerDefinition`), so an
 * extension can publish its bundled MCP server to Copilot / agent clients without
 * the user editing any config. We point each workspace folder at the bundled
 * `dist/mcp.cjs`, passing the folder as the workspace root the server scans.
 *
 * Non–VS Code clients (Claude Desktop etc.) use the npx path instead — see
 * docs/mcp.md.
 */
const PROVIDER_ID = "sysml-v2-studio.mcp";

export function registerMcpServerProvider(context: vscode.ExtensionContext): void {
  // Finalized in 1.101; engines.vscode is ^1.101.0, but guard anyway so a
  // host without the API (e.g. an older fork) degrades gracefully.
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") return;

  const serverPath = vscode.Uri.joinPath(context.extensionUri, "dist", "mcp.cjs").fsPath;
  const version = (context.extension.packageJSON as { version?: string }).version;

  const didChange = new vscode.EventEmitter<void>();
  context.subscriptions.push(didChange);
  // workspace folders changing means a different set of servers to advertise
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => didChange.fire())
  );

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: didChange.event,
      provideMcpServerDefinitions: () => {
        const folders = vscode.workspace.workspaceFolders ?? [];
        // one server per workspace folder so each model root is scanned on its own;
        // the server reads argv[2] as the workspace root (see src/mcp/server.ts)
        return folders.map((folder) => {
          // process.execPath = the editor's Node.js, so no reliance on `node` being on PATH
          const def = new vscode.McpStdioServerDefinition(
            folders.length > 1 ? `SysML v2 (${folder.name})` : "SysML v2 Studio",
            process.execPath,
            [serverPath, folder.uri.fsPath],
            { SYSML_WORKSPACE: folder.uri.fsPath },
            version
          );
          def.cwd = folder.uri;
          return def;
        });
      },
    })
  );
}
