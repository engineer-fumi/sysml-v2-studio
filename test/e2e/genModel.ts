/**
 * Generates the serialized diagram model that the Playwright webview test
 * posts into the page. Written to dist/e2e-model.json so the spec stays free
 * of project TS imports. Run via the test:e2e script.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { walk } from "../../src/core/ast";
import { parseSysML } from "../../src/core/parser";
import { stripParents } from "../../src/core/serialize";

const SRC = `package P {
  part def Engine { port out : Power; }
  part def Tank;
  part def Power;
  part v {
    part engine : Engine;
    part tank : Tank;
    part pump : Tank;
    connect tank to engine;
    flow of Power from engine.out to pump;
  }
}`;

const ast = parseSysML(SRC).root;
walk(ast, (el) => {
  el.fileId = 0;
});

const model = {
  type: "model",
  files: [{ uri: "file:///e2e.sysml", name: "e2e.sysml", ast: stripParents(ast) }],
  layouts: {},
  kind: "general",
};

// run from the project root (npm script), so resolve against cwd — __dirname
// points at dist/ after bundling
const out = path.join(process.cwd(), "dist", "e2e-model.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(model));
console.log("wrote", out);
