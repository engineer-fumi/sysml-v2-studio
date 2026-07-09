import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SysMLElement, createElement, qualifiedName, walk } from "../core/ast";
import { DIAGRAM_KINDS, DiagramKind, EdgeStyle, LayoutOffsets, PortSide } from "../core/layout";
import { SerializedModelFile, restoreParents } from "../core/serialize";
import { DiagramView, EditMode } from "./DiagramView";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type Layouts = Record<string, LayoutOffsets>;

interface ModelMessage {
  type: "model";
  files: SerializedModelFile[];
  layouts?: Layouts;
  /** initial diagram kind (sent only with the first model message) */
  kind?: DiagramKind;
  /** editor cursor at open time — scope the diagram to the element there */
  scopeAt?: { fileId: number; offset: number };
}

interface HighlightMessage {
  type: "highlight";
  fileId: number;
  offset: number;
}

type FromExtension = ModelMessage | HighlightMessage;

/** deepest element whose range contains the offset */
function elementAt(root: SysMLElement, offset: number): SysMLElement | undefined {
  let best: SysMLElement | undefined;
  walk(root, (el) => {
    if (el === root) return;
    if (el.start <= offset && offset <= el.end) {
      if (!best || el.end - el.start <= best.end - best.start) best = el;
    }
  });
  return best;
}

function diagramRootCandidates(root: SysMLElement): SysMLElement[] {
  const out: SysMLElement[] = [];
  walk(root, (el) => {
    if (el === root) return;
    if (
      (el.kind === "package" || el.kind === "library package" || el.kind === "namespace" ||
        el.kind === "part" || el.kind === "part def" ||
        el.kind === "action def" || el.kind === "state def" ||
        el.kind === "use case def") &&
      el.name &&
      el.children.length > 0
    ) {
      out.push(el);
    }
  });
  return out;
}

function ancestorsOf(el: SysMLElement): SysMLElement[] {
  const out: SysMLElement[] = [];
  let cur = el.parent;
  while (cur) {
    out.push(cur);
    cur = cur.parent;
  }
  return out;
}

/** dotted path from `scope` (exclusive) down to `el` */
function pathFrom(scope: SysMLElement, el: SysMLElement): string {
  const parts: string[] = [];
  let cur: SysMLElement | undefined = el;
  while (cur && cur !== scope) {
    if (cur.name) parts.unshift(cur.name);
    cur = cur.parent;
  }
  return parts.join(".");
}

const ADD_USAGE_KINDS = ["part", "port", "attribute", "item", "action", "state", "requirement", "constraint"];
const ADD_DEF_KINDS = [
  "package", "part def", "port def", "attribute def", "item def",
  "action def", "state def", "requirement def", "enum def", "use case def",
];

export function DiagramApp() {
  const [files, setFiles] = useState<SerializedModelFile[]>([]);
  const [layouts, setLayouts] = useState<Layouts>({});
  const [rootKey, setRootKey] = useState<string>("");
  const [kind, setKind] = useState<DiagramKind>("general");
  const kindInitialized = useRef(false);
  const [selected, setSelected] = useState<SysMLElement | undefined>(undefined);
  const [mode, setMode] = useState<EditMode>("select");
  // type filter: element kinds hidden from the diagram (ephemeral view state)
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  // engine-default orthogonal wire routing (ephemeral view state)
  const [autoRoute, setAutoRoute] = useState(true);
  const [connectSource, setConnectSource] = useState<SysMLElement | undefined>(undefined);
  const [pendingHighlight, setPendingHighlight] = useState<
    { fileId: number; offset: number } | undefined
  >(undefined);
  // initial cursor scope from the extension, applied once after the model loads
  const [pendingScope, setPendingScope] = useState<
    { fileId: number; offset: number } | undefined
  >(undefined);
  const scopeInitialized = useRef(false);
  // layout undo / redo: snapshots of a root's offsets before each mutation
  const undoRef = useRef<{ layoutKey: string; offsets: LayoutOffsets }[]>([]);
  const redoRef = useRef<{ layoutKey: string; offsets: LayoutOffsets }[]>([]);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  /** latest layouts, readable from stable event handlers */
  const layoutsRef = useRef<Layouts>({});
  layoutsRef.current = layouts;
  /** latest undo / redo functions for the global keydown listener */
  const historyFnRef = useRef<{ undo: () => void; redo: () => void }>({
    undo: () => {},
    redo: () => {},
  });

  // combined model from all files
  const { combinedRoot, fileNameById } = useMemo(() => {
    const root = createElement("namespace");
    const names = new Map<number, string>();
    for (const f of files) {
      const ast = restoreParents(f.ast);
      ast.kind = "file";
      ast.name = f.name;
      ast.parent = root;
      root.children.push(ast);
      if (ast.fileId !== undefined) names.set(ast.fileId, f.name);
    }
    return { combinedRoot: root, fileNameById: names };
  }, [files]);

  /** stable element key: fileName#qualifiedName (survives reloads) */
  const keyOf = useCallback(
    (el: SysMLElement) =>
      `${el.fileId !== undefined ? fileNameById.get(el.fileId) ?? el.fileId : ""}#${qualifiedName(el)}`,
    [fileNameById]
  );

  const rootCandidates = useMemo(() => diagramRootCandidates(combinedRoot), [combinedRoot]);

  const diagramRoot = useMemo(() => {
    if (rootKey) {
      const found = rootCandidates.find((el) => keyOf(el) === rootKey);
      if (found) return found;
    }
    return combinedRoot;
  }, [combinedRoot, rootCandidates, rootKey, keyOf]);

  // breadcrumb path from whole-model down to the current scope: the diagramRoot
  // plus its ancestors that are themselves valid scope roots (top-down)
  const scopeCrumbs = useMemo(() => {
    if (diagramRoot === combinedRoot) return [] as SysMLElement[];
    const cands = new Set(rootCandidates);
    const anc = ancestorsOf(diagramRoot).filter((a) => cands.has(a)).reverse();
    return [...anc, diagramRoot];
  }, [diagramRoot, combinedRoot, rootCandidates]);

  // manual layouts are stored per (diagram kind, root); the general view keeps
  // the plain rootKey for backward compatibility with existing sidecar files
  const layoutKey = kind === "general" ? rootKey : `${kind}|${rootKey}`;
  const offsets = layouts[layoutKey] ?? {};

  useEffect(() => {
    const onMessage = (e: MessageEvent<FromExtension>) => {
      const msg = e.data;
      if (msg.type === "model") {
        setFiles(msg.files);
        if (msg.layouts) setLayouts(msg.layouts);
        if (msg.kind && !kindInitialized.current) {
          kindInitialized.current = true;
          setKind(msg.kind);
        }
        if (msg.scopeAt && !scopeInitialized.current) setPendingScope(msg.scopeAt);
      } else if (msg.type === "highlight") {
        setPendingHighlight({ fileId: msg.fileId, offset: msg.offset });
      }
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!pendingHighlight) return;
    const fileEl = combinedRoot.children.find((c) => c.fileId === pendingHighlight.fileId);
    if (fileEl) {
      const el = elementAt(fileEl, pendingHighlight.offset);
      if (el) setSelected(el);
    }
    setPendingHighlight(undefined);
  }, [pendingHighlight, combinedRoot]);

  // apply the initial cursor scope once: scope the diagram to the nearest
  // diagrammable ancestor (package / def / part) of the element under the cursor
  useEffect(() => {
    if (!pendingScope || scopeInitialized.current || files.length === 0) return;
    const fileEl = combinedRoot.children.find((c) => c.fileId === pendingScope.fileId);
    if (fileEl) {
      const cursorEl = elementAt(fileEl, pendingScope.offset);
      const candidates = new Set(rootCandidates);
      let cur: SysMLElement | undefined = cursorEl;
      while (cur && !candidates.has(cur)) cur = cur.parent;
      if (cur) setRootKey(keyOf(cur));
    }
    scopeInitialized.current = true;
    setPendingScope(undefined);
  }, [pendingScope, combinedRoot, rootCandidates, keyOf, files.length]);

  // ESC resets the edit mode; Delete removes the selected element
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) historyFnRef.current.redo();
        else historyFnRef.current.undo();
        return;
      }
      if (e.key === "Escape") {
        setMode("select");
        setConnectSource(undefined);
      }
      if (e.key === "Delete" && selected) deleteElement(selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // ---- element interactions ------------------------------------------------

  const requestConnect = (src: SysMLElement, tgt: SysMLElement) => {
    if (src === tgt || src.fileId === undefined || tgt.fileId === undefined) return;
    const srcAncestors = new Set<SysMLElement>(ancestorsOf(src));
    let scope: SysMLElement | undefined;
    for (let cur = tgt.parent; cur; cur = cur.parent) {
      if (srcAncestors.has(cur)) {
        scope = cur;
        break;
      }
    }
    if (!scope || scope === combinedRoot) {
      // different files: insert at the end of the source file, qualified target
      const fileEl = combinedRoot.children.find((c) => c.fileId === src.fileId);
      if (!fileEl) return;
      vscode.postMessage({
        type: "edit",
        action: "addConnect",
        fileId: src.fileId,
        scopeStart: -1,
        source: qualifiedName(src),
        target: qualifiedName(tgt),
      });
      return;
    }
    const insertAtFile = scope.kind === "file";
    vscode.postMessage({
      type: "edit",
      action: "addConnect",
      fileId: scope.fileId ?? src.fileId,
      scopeStart: insertAtFile ? -1 : scope.start,
      source: pathFrom(scope, src),
      target: pathFrom(scope, tgt),
    });
  };

  /** remove the statement behind an element (box or line) from the model */
  const deleteElement = (el: SysMLElement) => {
    if (el.kind === "file" || el.fileId === undefined) return;
    vscode.postMessage({
      type: "edit",
      action: "delete",
      fileId: el.fileId,
      start: el.start,
      end: el.end,
      label: el.name ?? el.kind,
    });
    setSelected(undefined);
  };

  /** enter connect mode with a pre-selected source (context menu) */
  const startConnect = (el: SysMLElement) => {
    setMode("connect");
    setConnectSource(el);
    setSelected(el);
  };

  const handleElementClick = (el: SysMLElement) => {
    if (mode === "connect") {
      if (!connectSource) {
        setConnectSource(el);
        setSelected(el);
      } else {
        requestConnect(connectSource, el);
        setConnectSource(undefined);
        setMode("select");
      }
      return;
    }
    if (mode.startsWith("add:")) {
      const kind = mode.slice(4);
      if (el.fileId !== undefined) {
        vscode.postMessage({
          type: "edit",
          action: "addElement",
          kind,
          fileId: el.fileId,
          containerStart: el.kind === "file" ? -1 : el.start,
        });
      }
      setMode("select");
      return;
    }
    // select mode: sync to editor
    setSelected(el);
    if (el.fileId === undefined || el.kind === "file") return;
    vscode.postMessage({
      type: "select",
      fileId: el.fileId,
      start: el.nameStart ?? el.start,
      end: el.nameEnd ?? Math.min(el.end, el.start + 1),
    });
  };

  const handleElementDoubleClick = (el: SysMLElement) => {
    if (el.fileId === undefined || el.nameStart === undefined || !el.name) return;
    vscode.postMessage({
      type: "edit",
      action: "rename",
      fileId: el.fileId,
      nameStart: el.nameStart,
      nameEnd: el.nameEnd ?? el.nameStart + el.name.length,
      oldName: el.name,
    });
  };

  /** add-mode click on the empty canvas: insert at the diagram root scope */
  const handleBackgroundClick = () => {
    if (!mode.startsWith("add:")) return;
    const kind = mode.slice(4);
    if (diagramRoot === combinedRoot) {
      // no specific root: let the extension ask which file to extend
      vscode.postMessage({ type: "edit", action: "addElement", kind, fileId: -1, containerStart: -1 });
    } else if (diagramRoot.kind === "file") {
      vscode.postMessage({
        type: "edit",
        action: "addElement",
        kind,
        fileId: diagramRoot.fileId ?? -1,
        containerStart: -1,
      });
    } else if (diagramRoot.fileId !== undefined) {
      vscode.postMessage({
        type: "edit",
        action: "addElement",
        kind,
        fileId: diagramRoot.fileId,
        containerStart: diagramRoot.start,
      });
    }
    setMode("select");
  };

  const syncHistorySize = () => {
    setHistorySize({ undo: undoRef.current.length, redo: redoRef.current.length });
  };

  /** snapshot the current offsets before a layout mutation */
  const pushUndo = () => {
    undoRef.current.push({ layoutKey, offsets: JSON.parse(JSON.stringify(offsets)) });
    if (undoRef.current.length > 50) undoRef.current.shift();
    redoRef.current = [];
    syncHistorySize();
  };

  const applySnapshot = (snap: { layoutKey: string; offsets: LayoutOffsets }) => {
    setLayouts((prev) => ({ ...prev, [snap.layoutKey]: snap.offsets }));
    vscode.postMessage({ type: "saveLayout", rootKey: snap.layoutKey, offsets: snap.offsets });
  };

  const undoLayout = () => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    redoRef.current.push({
      layoutKey: snap.layoutKey,
      offsets: JSON.parse(JSON.stringify(layoutsRef.current[snap.layoutKey] ?? {})),
    });
    applySnapshot(snap);
    syncHistorySize();
  };

  const redoLayout = () => {
    const snap = redoRef.current.pop();
    if (!snap) return;
    undoRef.current.push({
      layoutKey: snap.layoutKey,
      offsets: JSON.parse(JSON.stringify(layoutsRef.current[snap.layoutKey] ?? {})),
    });
    applySnapshot(snap);
    syncHistorySize();
  };

  historyFnRef.current = { undo: undoLayout, redo: redoLayout };

  const handleMoveBox = (key: string, ddx: number, ddy: number) => {
    pushUndo();
    const cur = offsets[key] ?? { dx: 0, dy: 0 };
    const next = { ...offsets, [key]: { ...cur, dx: cur.dx + ddx, dy: cur.dy + ddy } };
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const handleResizeBox = (key: string, mw: number, mh: number, dx: number, dy: number) => {
    pushUndo();
    const cur = offsets[key] ?? { dx: 0, dy: 0 };
    // store an absolute minimum size (mw/mh); drop the legacy additive deltas
    const { dw: _dw, dh: _dh, ...rest } = cur;
    const next = {
      ...offsets,
      [key]: { ...rest, dx, dy, mw: Math.round(mw), mh: Math.round(mh) },
    };
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const resetLayout = () => {
    pushUndo();
    setLayouts((prev) => ({ ...prev, [layoutKey]: {} }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: {} });
  };

  const handleMovePort = (key: string, side: PortSide, t: number) => {
    pushUndo();
    const next = { ...offsets, [key]: { dx: 0, dy: 0, side, t } };
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const handleRouteEdge = (key: string, points: { x: number; y: number }[]) => {
    pushUndo();
    const cur = offsets[key];
    const next = { ...offsets };
    if (points.length) {
      next[key] = {
        ...(cur ?? { dx: 0, dy: 0 }),
        wp: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
        rel: true, // relative to the endpoint boxes (follows box moves)
      };
    } else if (cur?.style && cur.style !== "straight") {
      // keep the line-style override even when the waypoints are cleared
      next[key] = { dx: 0, dy: 0, style: cur.style };
    } else {
      delete next[key];
    }
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const handleToggleCollapse = (key: string) => {
    pushUndo();
    const cur = offsets[key] ?? { dx: 0, dy: 0 };
    const next = { ...offsets, [key]: { ...cur, collapsed: !cur.collapsed } };
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const handleCollapseAll = (keys: string[]) => {
    if (!keys.length) return;
    pushUndo();
    const next = { ...offsets };
    for (const key of keys) next[key] = { ...(next[key] ?? { dx: 0, dy: 0 }), collapsed: true };
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const handleExpandAll = () => {
    const entries = Object.entries(offsets);
    if (!entries.some(([, v]) => v.collapsed)) return;
    pushUndo();
    const next: LayoutOffsets = {};
    for (const [k, v] of entries) {
      const { collapsed: _c, ...rest } = v;
      next[k] = rest;
    }
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const handleAnchorEdge = (
    key: string,
    which: "a" | "b" | null,
    side?: PortSide,
    t?: number
  ) => {
    pushUndo();
    const cur = offsets[key] ?? { dx: 0, dy: 0 };
    const next = { ...offsets };
    if (which === null) {
      // clear both pins
      const { anchorA: _a, anchorB: _b, ...rest } = cur;
      next[key] = rest;
    } else if (side !== undefined && t !== undefined) {
      next[key] = {
        ...cur,
        [which === "a" ? "anchorA" : "anchorB"]: { side, t: Math.round(t * 1000) / 1000 },
      };
    }
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const handleEdgeStyle = (key: string, style: EdgeStyle) => {
    pushUndo();
    const cur = offsets[key] ?? { dx: 0, dy: 0 };
    const next = { ...offsets };
    if (style === "straight" && !cur.wp?.length) {
      delete next[key]; // straight without waypoints is the default
    } else {
      next[key] = { ...cur, style: style === "straight" ? undefined : style };
    }
    setLayouts((prev) => ({ ...prev, [layoutKey]: next }));
    vscode.postMessage({ type: "saveLayout", rootKey: layoutKey, offsets: next });
  };

  const toggleKind = (k: string) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const clearKindFilter = () => setHiddenKinds(new Set());

  const changeKind = (k: DiagramKind) => {
    kindInitialized.current = true;
    setKind(k);
    vscode.postMessage({ type: "kindChanged", kind: k });
  };

  const modeButton = (m: EditMode, label: string, title: string) => (
    <button
      className={mode === m ? "mode-btn active" : "mode-btn"}
      onClick={() => {
        setMode(mode === m ? "select" : m);
        setConnectSource(undefined);
      }}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className="app">
      <div className="header">
        <span className="title">SysML Diagram</span>
        <select
          className="root-select kind-select"
          value={kind}
          onChange={(e) => changeKind(e.target.value as DiagramKind)}
          title="Diagram kind"
        >
          {DIAGRAM_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <nav className="scope-breadcrumbs" aria-label="Diagram scope">
          <button
            className="crumb"
            disabled={diagramRoot === combinedRoot}
            onClick={() => setRootKey("")}
            title="Show the entire model"
          >
            ⌂ Entire model
          </button>
          {scopeCrumbs.map((el, i) => {
            const isCurrent = i === scopeCrumbs.length - 1;
            return (
              <span key={keyOf(el)} className="crumb-group">
                <span className="crumb-sep">›</span>
                <button
                  className={isCurrent ? "crumb crumb-current" : "crumb"}
                  disabled={isCurrent}
                  onClick={() => setRootKey(keyOf(el))}
                  title={qualifiedName(el)}
                >
                  {el.name ?? el.kind}
                </button>
              </span>
            );
          })}
        </nav>
        <span className="file-count">{files.length} files</span>
      </div>
      <div className="edit-toolbar">
        {modeButton("select", "⬚ Select", "Click to select; drag named blocks to reposition")}
        {modeButton("connect", "⌁ Connect", "Click two elements in order to insert a connect statement")}
        <select
          className="add-select"
          value={mode.startsWith("add:") ? mode.slice(4) : ""}
          onChange={(e) => {
            setConnectSource(undefined);
            setMode(e.target.value ? (`add:${e.target.value}` as EditMode) : "select");
          }}
          title="Choose element kind to add, then click a container or blank area (diagram root)"
        >
          <option value="">+ Add…</option>
          <optgroup label="Usage">
            {ADD_USAGE_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </optgroup>
          <optgroup label="Definition">
            {ADD_DEF_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </optgroup>
        </select>
        <button
          className="mode-btn"
          onClick={() => historyFnRef.current.undo()}
          disabled={historySize.undo === 0}
          title="Undo layout, size, and edge edits (Cmd/Ctrl+Z)"
        >
          ↩ Undo
        </button>
        <button
          className="mode-btn"
          onClick={() => historyFnRef.current.redo()}
          disabled={historySize.redo === 0}
          title="Redo (Shift+Cmd/Ctrl+Z)"
        >
          ↪ Redo
        </button>
        <button className="mode-btn" onClick={resetLayout} title="Reset manual layout for this diagram">
          ⟲ Reset layout
        </button>
        <span className="mode-hint">
          {mode === "connect"
            ? connectSource
              ? `Source: ${connectSource.name ?? connectSource.kind} → click target`
              : "Click connection source"
            : mode.startsWith("add:")
              ? `Click where to add ${mode.slice(4)} — container or blank (diagram root) / Esc to cancel`
              : "Drag to reposition / right-click for menu (connect, waypoints, line style, delete) / bottom-right and top-right handles to resize / Delete removes selection / Cmd+Z to undo"}
        </span>
      </div>
      <DiagramView
        root={diagramRoot}
        kind={kind}
        selected={selected}
        marked={connectSource}
        mode={mode}
        offsets={offsets}
        keyOf={keyOf}
        onElementClick={handleElementClick}
        onElementDoubleClick={handleElementDoubleClick}
        onMoveBox={handleMoveBox}
        onResizeBox={handleResizeBox}
        onMovePort={handleMovePort}
        onRouteEdge={handleRouteEdge}
        onEdgeStyle={handleEdgeStyle}
        onAnchorEdge={handleAnchorEdge}
        onDeleteElement={deleteElement}
        onStartConnect={startConnect}
        onBackgroundClick={handleBackgroundClick}
        onToggleCollapse={handleToggleCollapse}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
        hiddenKinds={hiddenKinds}
        onToggleKind={toggleKind}
        onClearKindFilter={clearKindFilter}
        autoRoute={autoRoute}
        onToggleAutoRoute={() => setAutoRoute((v) => !v)}
      />
    </div>
  );
}
