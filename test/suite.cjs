const vscode = require("vscode");
const assert = require("node:assert");
const path = require("node:path");

exports.run = async function run() {
  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const defsUri = vscode.Uri.file(path.join(ws, "vehicle-project", "definitions.sysml"));
  const confUri = vscode.Uri.file(path.join(ws, "vehicle-project", "configuration.sysml"));

  // open a sysml document -> language id + activation
  const doc = await vscode.workspace.openTextDocument(defsUri);
  assert.strictEqual(doc.languageId, "sysml", "language id");
  await vscode.window.showTextDocument(doc);

  // give the extension time to activate and index the workspace
  await new Promise((r) => setTimeout(r, 3000));

  // document symbols (outline)
  const symbols = await vscode.commands.executeCommand(
    "vscode.executeDocumentSymbolProvider", defsUri);
  assert.ok(symbols && symbols.length > 0, "symbols exist");
  const pkg = symbols[0];
  assert.strictEqual(pkg.name, "VehicleDefinitions", "package symbol");
  const engine = pkg.children.find((s) => s.name === "Engine");
  assert.ok(engine, "Engine symbol");
  console.log("PASS: document symbols");

  // diagnostics: valid file has none
  assert.strictEqual(vscode.languages.getDiagnostics(defsUri).length, 0, "no diagnostics");
  console.log("PASS: diagnostics clean on valid file");

  // introduce a syntax error -> diagnostic appears
  const editor = vscode.window.activeTextEditor;
  await editor.edit((eb) => eb.insert(new vscode.Position(2, 0), "part def {\n"));
  await new Promise((r) => setTimeout(r, 1500));
  const diags = vscode.languages.getDiagnostics(defsUri);
  assert.ok(diags.length > 0, "diagnostic appears after bad edit");
  console.log("PASS: diagnostics on syntax error:", diags[0].message);
  await vscode.commands.executeCommand("workbench.action.files.revert");
  await new Promise((r) => setTimeout(r, 1000));

  // semantic validation: unresolved type reference -> warning
  await editor.edit((eb) => eb.insert(new vscode.Position(2, 0), "part bad : NoSuchType;\n"));
  await new Promise((r) => setTimeout(r, 1500));
  const semDiags = vscode.languages.getDiagnostics(defsUri);
  const unresolved = semDiags.find((d) => d.message.includes("NoSuchType"));
  assert.ok(unresolved, "unresolved reference diagnostic");
  console.log("PASS: semantic validation (unresolved):", unresolved.message);
  await vscode.commands.executeCommand("workbench.action.files.revert");
  await new Promise((r) => setTimeout(r, 1000));

  // stdlib resolution: Real (via ScalarValues import) resolves with no diagnostics
  assert.strictEqual(
    vscode.languages.getDiagnostics(defsUri).length, 0,
    "stdlib types resolve cleanly"
  );
  console.log("PASS: stdlib resolution clean");

  // cross-file definition: "Engine" referenced in configuration.sysml
  const confDoc = await vscode.workspace.openTextDocument(confUri);
  const text = confDoc.getText();
  const idx = text.indexOf(": Engine") + 2;
  const pos = confDoc.positionAt(idx);
  const defs = await vscode.commands.executeCommand(
    "vscode.executeDefinitionProvider", confUri, pos);
  assert.ok(defs && defs.length > 0, "definition found");
  assert.ok(defs[0].uri.path.endsWith("definitions.sysml"), "definition in other file");
  console.log("PASS: cross-file go-to-definition");

  // completion contains model names
  const completions = await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider", confUri, pos);
  const labels = completions.items.map((i) => typeof i.label === "string" ? i.label : i.label.label);
  assert.ok(labels.includes("FuelTank"), "completion has model name FuelTank");
  assert.ok(labels.some((l) => l === "part def"), "completion has snippet");
  console.log("PASS: completion (names + snippets)");

  // hover
  const hovers = await vscode.commands.executeCommand(
    "vscode.executeHoverProvider", confUri, pos);
  assert.ok(hovers && hovers.length > 0, "hover");
  console.log("PASS: hover");

  // diagram command exists and runs
  await vscode.commands.executeCommand("sysml.openDiagram");
  await new Promise((r) => setTimeout(r, 1500));
  console.log("PASS: sysml.openDiagram executed");

  // diagram-kind picker command is registered (not executed: it opens a QuickPick)
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("sysml.openDiagramAs"), "sysml.openDiagramAs registered");
  console.log("PASS: sysml.openDiagramAs registered");

  console.log("ALL TESTS PASSED");
};
