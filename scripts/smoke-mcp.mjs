/**
 * Smoke test for the packaged MCP server: spawn the built binary exactly the way
 * `npx @engineer-fumi/sysml-v2-mcp <dir>` would, drive it over stdio with raw
 * JSON-RPC, and assert that initialize / tools/list / tools/call all respond.
 *
 * This is transport-level (it launches a real child process), complementary to
 * test/mcp.ts which tests the tool layer in-process. Used in CI after building
 * the npm package, and runnable locally via `npm run smoke:mcp`.
 *
 * Usage: node scripts/smoke-mcp.mjs [path/to/mcp.cjs]
 *        defaults to dist/npm/mcp.cjs, falling back to dist/mcp.cjs.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pickServer() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  const packaged = path.join(root, "dist", "npm", "mcp.cjs");
  if (fs.existsSync(packaged)) return packaged;
  return path.join(root, "dist", "mcp.cjs");
}

const server = pickServer();
if (!fs.existsSync(server)) {
  console.error(`[smoke] server not found: ${server}\n` +
    "         run `npm run build:mcp:pkg` (or build:mcp) first.");
  process.exit(1);
}

// throwaway workspace with one valid model
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sysml-mcp-smoke-"));
fs.writeFileSync(path.join(dir, "model.sysml"), `package Demo {
  part def Vehicle { part engine : Engine; }
  part def Engine;
  requirement def MassLimit { doc /* total mass <= 1500 kg */ }
}`);

const child = spawn("node", [server, dir], { stdio: ["pipe", "pipe", "pipe"] });

let stdout = "";
const pending = new Map(); // id -> { resolve, reject }
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  let nl;
  while ((nl = stdout.indexOf("\n")) >= 0) {
    const line = stdout.slice(0, nl).trim();
    stdout = stdout.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

let nextId = 1;
function request(method, params, timeoutMs = 5000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method} (id ${id})`));
    }, timeoutMs);
    pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); }, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

let failed = false;
try {
  // 1. initialize
  const init = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
  assert(init.result?.serverInfo?.name === "sysml-v2-studio", "initialize returns serverInfo.name");
  assert(init.result?.capabilities?.tools, "initialize advertises tools capability");
  console.log(`PASS: initialize (server ${init.result.serverInfo.name}@${init.result.serverInfo.version})`);
  notify("notifications/initialized", {});

  // 2. tools/list
  const list = await request("tools/list", {});
  const tools = list.result?.tools ?? [];
  assert(tools.length >= 6, `tools/list returns >=6 tools (got ${tools.length})`);
  const names = tools.map((t) => t.name);
  for (const expected of ["list_files", "outline", "validate", "find_element", "list_requirements", "describe_diagram"]) {
    assert(names.includes(expected), `tools/list includes ${expected}`);
  }
  console.log(`PASS: tools/list (${tools.length} tools: ${names.join(", ")})`);

  // 3. tools/call — validate the throwaway workspace
  const call = await request("tools/call", { name: "validate", arguments: {} });
  assert(call.result && !call.result.isError, "tools/call validate is not an error");
  const text = call.result.content?.[0]?.text ?? "";
  assert(text.length > 0, "tools/call validate returns text content");
  console.log("PASS: tools/call validate");

  // 4. tools/call — list_files sees the model
  const files = await request("tools/call", { name: "list_files", arguments: {} });
  const filesText = files.result?.content?.[0]?.text ?? "";
  assert(filesText.includes("model.sysml"), "list_files sees model.sysml");
  console.log("PASS: tools/call list_files");

  console.log("\n[smoke] all checks passed");
} catch (err) {
  failed = true;
  console.error(`\n[smoke] FAILED: ${err.message}`);
} finally {
  child.stdin.end();
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
