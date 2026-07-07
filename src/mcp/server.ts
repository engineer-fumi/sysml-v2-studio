/**
 * SysML v2 Studio — MCP server (stdio transport).
 *
 * A dependency-free implementation of the Model Context Protocol over
 * newline-delimited JSON-RPC 2.0, exposing the shared SysML core (parse /
 * validate / resolve / layout) as tools an MCP client such as Claude Desktop or
 * Claude Code can call. The protocol surface we need is small — initialize,
 * tools/list, tools/call, ping — so we hand-roll it rather than pull in the SDK,
 * matching this project's bundle-everything, minimal-deps approach.
 *
 * Workspace root: argv[2] || $SYSML_WORKSPACE || process.cwd().
 * Never write anything but JSON-RPC messages to stdout — logs go to stderr.
 */
import { ModelStore } from "./modelStore";
import { TOOLS, runTool } from "./tools";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "sysml-v2-studio", version: "0.8.0" };

const workspace = process.argv[2] || process.env.SYSML_WORKSPACE || process.cwd();
const store = new ModelStore(workspace);

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

function send(msg: RpcMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id: RpcMessage["id"], result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id: RpcMessage["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(msg: RpcMessage): void {
  const { id, method, params } = msg;
  // notifications (no id) never get a response
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize": {
      const clientVersion = (params?.protocolVersion as string) || PROTOCOL_VERSION;
      reply(id, {
        protocolVersion: clientVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return; // nothing to do
    case "ping":
      if (isRequest) reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = params?.name as string;
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      try {
        const text = runTool(store, name, args);
        reply(id, { content: [{ type: "text", text }], isError: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // tool-level errors are reported in-band so the model can react
        reply(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
      }
      return;
    }
    default:
      if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
  }
}

// ---- newline-delimited JSON-RPC reader over stdin -------------------------
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // ignore malformed lines
    }
    try {
      handle(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (msg.id !== undefined && msg.id !== null) replyError(msg.id, -32603, message);
      process.stderr.write(`[sysml-mcp] internal error: ${message}\n`);
    }
  }
});
process.stdin.on("end", () => process.exit(0));

process.stderr.write(`[sysml-mcp] SysML v2 Studio MCP server — workspace: ${workspace}\n`);
