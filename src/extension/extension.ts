import * as vscode from "vscode";
import { DIAGRAM_KINDS, DiagramKind } from "../core/layout";
import { STDLIB_FILES } from "../core/stdlib";
import { DiagramPanel } from "./diagramPanel";
import {
  registerCompletion,
  registerDefinition,
  registerDiagnostics,
  registerDocumentSymbols,
  registerHover,
} from "./languageFeatures";
import { BUILTIN_SCHEME, ModelIndex } from "./modelIndex";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // read-only provider so "go to definition" can open the bundled library
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(BUILTIN_SCHEME, {
      provideTextDocumentContent(uri) {
        return STDLIB_FILES.find((f) => uri.path.endsWith(f.name))?.source ?? "";
      },
    })
  );

  const index = new ModelIndex();
  context.subscriptions.push(index);
  await index.initialize();

  registerDiagnostics(context, index);
  registerCompletion(context, index);
  registerDocumentSymbols(context, index);
  registerDefinition(context, index);
  registerHover(context, index);

  context.subscriptions.push(
    vscode.commands.registerCommand("sysml.openDiagram", () => {
      DiagramPanel.createOrShow(context, index);
    }),
    vscode.commands.registerCommand("sysml.openDiagramAs", async () => {
      const picked = await vscode.window.showQuickPick(
        DIAGRAM_KINDS.map((k) => ({
          label: k.label,
          description: k.description,
          id: k.id as DiagramKind,
        })),
        { placeHolder: "開く図の種類を選択" }
      );
      if (picked) DiagramPanel.createOrShow(context, index, picked.id);
    })
  );
}

export function deactivate(): void {
  // disposables are handled via context.subscriptions
}
