# Diagram features

Open via the diagram icon in the editor title bar, or the command **"SysML: Open Diagram"**.
The panel renders a single combined model from all `.sysml` files in the workspace;
cross-file `import` / references are resolved.

## Diagram kinds

Switch via **"SysML: Open Diagram by Kind"** or the selector in the panel.
Each kind can be opened in a separate panel side by side.

| Kind | Content |
|---|---|
| Overview | Entire model (all structure and behavior) |
| Block Definition Diagram (BDD) | Structural definitions (part def, etc.) with specialization (hollow triangle) and composition (filled diamond). Type-level composition is inferred from usage internals; `«import»` dependencies are shown |
| Internal Block Diagram (IBD) | Part composition and connect / flow / port inside blocks with internal structure. Ports are inherited from type definitions |
| Requirement Diagram | Requirements (with doc body) and satisfy / verify relationships |
| Use Case Diagram | Use cases (ellipses) and actors (stick figures; same names merged), subject boundary, perform / include |
| State Machine Diagram | State machines (states and transitions) |
| Activity Diagram | Actions and succession / flow |
| Sequence Diagram | Lifelines (parts) and messages (flow) in chronological order (spec-aligned: Lifeline=PartUsage / Message=Flow) |

## Editor integration

- **Two-way sync**: click diagram element → jump to source / move editor cursor →
  highlight element in diagram
- Diagram updates automatically when the model is edited
- Pan / zoom / Fit / **SVG export**

## Model editing from the diagram (written back to text)

- **Connect**: click two elements in order, or right-click an element → **Connect from here**
  to insert `connect a to b;` in the appropriate scope
- **Add**: choose usage / def / package via **+ Add…**, then click a container (or
  blank = diagram root) to insert
- Double-click to rename a declaration; Delete removes elements and edges
- Undo uses standard VS Code (as text edits)

## Manual layout

- **Free placement**: named blocks can be dragged regardless of nesting depth. Parent
  boxes auto-expand to contain children; connection lines follow
- **Resize**: drag bottom-right or top-right handles (top-right expands upward). Manual
  size is kept as a minimum; moving children does not unnecessarily inflate the frame
- **Port placement**: drag ports to any position on a box edge
- **Edge routing**: drag the line body to bend it; context menu to add/remove waypoints;
  drag endpoints (attachment points); switch line style (straight / orthogonal
  (right angles; arrowheads perpendicular to edges) / curve)
- **Undo/Redo**: diagram-side operations via `Cmd/Ctrl+Z` (toolbar buttons too)

### Layout file (`.sysml-layout.json`)

Position, size, port placement, and edge routing/style are auto-saved per diagram kind
in `.sysml-layout.json` (sidecar) at the workspace root.

- Stored as `fileName#qualifiedName → offset`, so **layout follows names even when
  the model changes via text edits**
- Model (`.sysml`) and layout (`.sysml-layout.json`) are separate, so they can be
  shared via git; external changes (pull, etc.) are reflected in the diagram automatically
- Together with SVG export, this can replace manual drawing tools

## Multi-file / remote

- Automatically indexes `.sysml` / `.kerml` in the workspace (watches add / change / delete)
- Remote projects work as-is with **Remote-SSH / WSL / Dev Containers**
