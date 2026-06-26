import { runTests } from "@vscode/test-electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "test", "suite.cjs"),
    launchArgs: [
      path.join(root, "samples"),
      "--disable-workspace-trust",
      "--disable-gpu",
      "--no-sandbox",
    ],
  });
} catch (err) {
  console.error("Failed to run tests:", err);
  process.exit(1);
}
