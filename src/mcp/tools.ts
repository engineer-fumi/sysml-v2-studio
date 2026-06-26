/**
 * MCP tool definitions and their implementations, expressed purely in terms of
 * `ModelStore` + `src/core`. This layer has no dependency on the MCP protocol or
 * transport, so every tool can be unit-tested directly (see test/mcp.ts). The
 * thin server in server.ts only wires these into JSON-RPC over stdio.
 */
import { SysMLElement, elementLabel, qualifiedName, walk } from "../core/ast";
import { layoutDiagram, DiagramKind, DIAGRAM_KINDS, diagramKindLabel } from "../core/layout";
import { validateFile } from "../core/validate";
import { ModelStore, positionAt } from "./modelStore";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const KIND_VALUES = DIAGRAM_KINDS.map((k) => k.id);

export const TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description:
      "List every SysML v2 (.sysml/.kerml) file in the workspace with its element and parse-error counts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "outline",
    description:
      "Return the structural outline (named declarations, their kinds and types, nested) of one file or the whole model.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Workspace-relative path; omit for the whole model." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "validate",
    description:
      "Run syntax + semantic validation (unresolved references, duplicate names, type conformance, shadowing, import visibility) and return diagnostics with line/column.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Workspace-relative path; omit to validate every file." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "find_element",
    description:
      "Find declarations by name (or short name) across the model and return their kind, type, documentation and location.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Element name to look up." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "list_requirements",
    description:
      "List every requirement / requirement def with its documentation text, attributes, and the parts that satisfy it.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "describe_diagram",
    description:
      "Compute one of the diagram views (general/bdd/ibd/req/uc/state/action/seq) for a file or the whole model and return its boxes, ports and connections as structured data — lets you 'see' the model's structure without rendering.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: KIND_VALUES, description: "Diagram kind." },
        file: { type: "string", description: "Workspace-relative path; omit for the whole model." },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
];

/** the file node (kind==="file") an element belongs to, for path reporting. */
function fileOf(el: SysMLElement): string | undefined {
  for (let cur: SysMLElement | undefined = el; cur; cur = cur.parent) {
    if (cur.kind === "file") return cur.name;
  }
  return undefined;
}

function typeOf(el: SysMLElement): string | undefined {
  const parts = [
    ...el.typedBy.map((t) => `: ${t}`),
    ...el.specializes.map((s) => `:> ${s}`),
    ...el.redefines.map((r) => `:>> ${r}`),
  ];
  return parts.length ? parts.join(" ") : undefined;
}

const SKIP_OUTLINE = new Set(["comment", "file"]);

interface OutlineNode {
  label: string;
  kind: string;
  type?: string;
  line: number;
  doc?: string;
  children?: OutlineNode[];
}

function outlineOf(el: SysMLElement, source: string): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const c of el.children) {
    if (SKIP_OUTLINE.has(c.kind)) continue;
    if (c.kind === "doc") continue; // surfaced as the parent's `doc`
    const kids = outlineOf(c, source);
    const node: OutlineNode = {
      label: elementLabel(c),
      kind: c.kind,
      type: typeOf(c),
      line: positionAt(source, c.start).line,
    };
    if (c.doc) node.doc = c.doc.trim();
    if (kids.length) node.children = kids;
    out.push(node);
  }
  return out;
}

const RULE_SEVERITY: Record<string, "error" | "warning"> = {
  unresolved: "warning",
  duplicate: "error",
  conformance: "warning",
  shadowing: "warning",
  importVisibility: "warning",
};

function validateOne(store: ModelStore, file: ReturnType<ModelStore["files"]>[number], resolver = store.resolver()) {
  const diags: { line: number; col: number; severity: string; rule: string; message: string }[] = [];
  for (const e of file.result.errors) {
    const p = positionAt(file.source, e.start);
    diags.push({ line: p.line, col: p.col, severity: "error", rule: "syntax", message: e.message });
  }
  for (const d of validateFile(file.result.root, resolver)) {
    const p = positionAt(file.source, d.start);
    diags.push({
      line: p.line,
      col: p.col,
      severity: RULE_SEVERITY[d.rule] ?? "warning",
      rule: d.rule,
      message: d.message,
    });
  }
  diags.sort((a, b) => a.line - b.line || a.col - b.col);
  return diags;
}

const REQUIREMENT_KINDS = new Set(["requirement", "requirement def", "constraint", "constraint def"]);

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Run a tool by name. `args` is the validated JSON object. Returns text. */
export function runTool(store: ModelStore, name: string, args: Record<string, unknown>): string {
  store.refresh();

  switch (name) {
    case "list_files": {
      const files = store.files().map((f) => {
        let elements = 0;
        walk(f.result.root, () => elements++);
        return { path: f.path, elements: elements - 1, parseErrors: f.result.errors.length };
      });
      return asJson({ root: store.files().length ? undefined : "(no .sysml/.kerml files found)", files });
    }

    case "outline": {
      const fileArg = args.file as string | undefined;
      if (fileArg) {
        const f = store.file(fileArg);
        if (!f) throw new Error(`file not found: ${fileArg}`);
        return asJson({ file: f.path, outline: outlineOf(f.result.root, f.source) });
      }
      return asJson({
        files: store.files().map((f) => ({ file: f.path, outline: outlineOf(f.result.root, f.source) })),
      });
    }

    case "validate": {
      const fileArg = args.file as string | undefined;
      const resolver = store.resolver();
      const targets = fileArg ? [store.file(fileArg)] : store.files();
      if (fileArg && !targets[0]) throw new Error(`file not found: ${fileArg}`);
      const report = targets.filter(Boolean).map((f) => ({
        file: f!.path,
        diagnostics: validateOne(store, f!, resolver),
      }));
      const total = report.reduce((n, r) => n + r.diagnostics.length, 0);
      return asJson({ ok: total === 0, total, files: report });
    }

    case "find_element": {
      const target = (args.name as string)?.trim();
      if (!target) throw new Error("`name` is required");
      const root = store.combinedRoot(false);
      const hits: unknown[] = [];
      walk(root, (el) => {
        if (el.kind === "file" || el === root) return;
        if (el.name === target || el.shortName === target) {
          const file = fileOf(el);
          const src = store.files().find((f) => f.path === file)?.source ?? "";
          const p = positionAt(src, el.nameStart ?? el.start);
          hits.push({
            qualifiedName: qualifiedName(el),
            kind: el.kind,
            type: typeOf(el),
            doc: el.doc?.trim(),
            file,
            line: p.line,
            col: p.col,
          });
        }
      });
      return asJson({ name: target, count: hits.length, declarations: hits });
    }

    case "list_requirements": {
      const root = store.combinedRoot(false);
      const reqs: Record<string, unknown>[] = [];
      const byName = new Map<string, Record<string, unknown>>();
      walk(root, (el) => {
        if (!REQUIREMENT_KINDS.has(el.kind)) return;
        const entry: Record<string, unknown> = {
          name: qualifiedName(el),
          kind: el.kind,
          doc: el.doc?.trim(),
          file: fileOf(el),
          attributes: el.children
            .filter((c) => c.kind === "attribute")
            .map((c) => ({ name: c.name, type: typeOf(c), value: c.value })),
          satisfiedBy: [] as string[],
        };
        reqs.push(entry);
        if (el.name) byName.set(el.name, entry);
      });
      // wire up `satisfy <req> by <part>` relations
      walk(root, (el) => {
        if (el.kind !== "satisfy") return;
        const reqRef = el.name ?? el.refs.find((r) => r.kind === "type")?.name;
        const by = (el.ends ?? []).map((e) => e.path).join(", ") || el.target;
        const entry = reqRef ? byName.get(reqRef) : undefined;
        if (entry && by) (entry.satisfiedBy as string[]).push(by);
      });
      return asJson({ count: reqs.length, requirements: reqs });
    }

    case "describe_diagram": {
      const kind = args.kind as DiagramKind;
      if (!KIND_VALUES.includes(kind)) throw new Error(`unknown diagram kind: ${kind}`);
      const fileArg = args.file as string | undefined;
      let root: SysMLElement;
      if (fileArg) {
        const f = store.file(fileArg);
        if (!f) throw new Error(`file not found: ${fileArg}`);
        root = f.result.root;
      } else {
        root = store.combinedRoot(false);
      }
      const keyOf = (el: SysMLElement) => `${fileOf(el) ?? ""}#${qualifiedName(el)}`;
      const layout = layoutDiagram(root, { kind, keyOf });

      const boxes: unknown[] = [];
      const collect = (n: ReturnType<typeof layoutDiagram>["nodes"][number], parent?: string) => {
        const label = n.label || elementLabel(n.el);
        boxes.push({
          label,
          kind: n.kindLabel || n.el.kind,
          type: n.typeLabel,
          parent,
          ports: n.ports.map((p) => p.name),
        });
        n.children.forEach((c) => collect(c, label));
      };
      layout.nodes.forEach((n) => collect(n));

      const labelFor = (nd?: { label?: string; el?: SysMLElement }) =>
        nd?.label || (nd?.el ? elementLabel(nd.el) : undefined);
      const edges = layout.edges.map((e) => ({
        kind: e.kind,
        from: labelFor(e.a),
        to: labelFor(e.b),
        label: e.label,
      }));

      return asJson({
        kind,
        view: diagramKindLabel(kind),
        scope: fileArg ?? "(whole model)",
        boxCount: boxes.length,
        edgeCount: edges.length,
        boxes,
        edges,
      });
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
