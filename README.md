<div align="center">

# SysML v2 Studio

**Write, view and edit SysML v2 (`.sysml` / `.kerml`) in VS Code**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/engineer-fumi.sysml-v2-studio?label=Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=engineer-fumi.sysml-v2-studio)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/engineer-fumi.sysml-v2-studio?label=Installs)](https://marketplace.visualstudio.com/items?itemName=engineer-fumi.sysml-v2-studio)
[![MCP on npm](https://img.shields.io/npm/v/%40engineer-fumi%2Fsysml-v2-mcp?label=MCP%20npm&logo=npm)](https://www.npmjs.com/package/@engineer-fumi/sysml-v2-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**English** · [日本語](README.ja.md) · [简体中文](README.zh-Hans.md)

A SysML v2 extension with full language support (highlighting, diagnostics,
completion, go-to-definition) plus **8 kinds of editable diagrams** and
**Claude (MCP) integration**.

![Overview diagram](docs/images/diagram-general.png)

</div>

## Features

- 🎨 **8 diagram kinds** — overview / block definition (BDD) / internal block (IBD) / requirement / use case / state / activity / sequence
- ✏️ **Edit straight from the diagram** — move, resize, connect, rename and delete, all **written back to the text** (manual layout saved to a sidecar)
- 🔎 **Language support** — syntax highlighting, real-time diagnostics (syntactic + semantic), completion, outline, cross-file go-to-definition and hover
- 🔗 **Two-way sync** — click a diagram element ⇄ jump to source, editor cursor ⇄ highlight in the diagram
- 🤖 **Claude (MCP) integration** — analyze, validate and query the model **as structure** (Claude Code / Desktop / VS Code AI)
- 📦 **Multi-file / remote ready** (Remote-SSH / WSL / Dev Containers), 📚 **bundled standard library** + **official OMG samples**

## Installation

Search for **“SysML v2 Studio”** in the VS Code Marketplace and install, or:

```bash
code --install-extension engineer-fumi.sysml-v2-studio
```

> Requires VS Code **1.101 or later**. To build a `.vsix` from source, see the
> [development guide](docs/development.md).

## Quick start — preview a diagram

1. **Open a `.sysml` / `.kerml` file** (the bundled `samples/` are the easiest start)
2. Click the **diagram icon** at the top-right of the editor, or run
   **“SysML: Open Diagram”** from the Command Palette
   → the diagram previews next to the editor
3. Switch between the 8 kinds via the selector at the top of the panel, or
   **“SysML: Open Diagram by Kind”**
4. **Drag** boxes to lay them out, **right-click** to connect / change line style / delete
   → changes are **written back to the source text automatically** (layout saved to `.sysml-layout.json`)

Click an element in the diagram to jump to the matching source line; the editor
cursor position is highlighted back in the diagram.

## Claude (MCP) integration

The extension bundles a **standalone MCP server** so AI like Claude can treat
your `.sysml` model **as structure rather than text** — exposing tools for
parsing, validation, requirement listing and diagram structure.

**Depending on which client you use, do one of these two things.**

### ① Using VS Code's AI (Copilot / agent) → nothing to configure

If you have this extension installed on VS Code **1.101 or later**, there is
**nothing to do**. The extension registers the MCP server automatically. Open
**“MCP: List Servers”** from the Command Palette — if **“SysML v2 Studio”** is
listed, it's active.

### ② Using Claude Code / Claude Desktop → one line to register

For **Claude Code** (a client separate from VS Code), run this once at your
project root (`npx`, so no prior install needed):

```bash
claude mcp add sysml -- npx -y @engineer-fumi/sysml-v2-mcp "$(pwd)"
```

For **Claude Desktop**, add this to the config file:

```jsonc
{ "mcpServers": { "sysml": {
  "command": "npx",
  "args": ["-y", "@engineer-fumi/sysml-v2-mcp", "<absolute path to your model folder>"]
} } }
```

Tools provided: `list_files` / `outline` / `validate` / `find_element` /
`list_requirements` / `describe_diagram`. For registration variants (explicit
path, self-build), tool details and usage examples, see the
[Claude (MCP) integration guide](docs/mcp.md).

## Notation ↔ diagram

The same text model is rendered differently depending on the diagram kind you
choose. Below is a **minimal example for each kind and its actual rendered
result** (the hero overview image above is generated the same way).

### Block definition diagram (BDD) — structure, composition, specialization of definitions

```sysml
package Powertrain {
  part def Vehicle;
  part def Engine;
  part def Cylinder;
  part v : Vehicle { part engine : Engine; }
  part e : Engine { part cylinders : Cylinder[4]; }
}
```

![Block definition diagram](docs/images/diagram-bdd.png)

### Internal block diagram (IBD) — connections inside a part (port / connect)

```sysml
package Hydraulics {
  port def FluidPort;
  part def Pump { port outlet : FluidPort; }
  part def Tank { port inlet : FluidPort; }
  part system {
    part pump : Pump;
    part tank : Tank;
    connect pump.outlet to tank.inlet;
  }
}
```

![Internal block diagram](docs/images/diagram-ibd.png)

### Requirement diagram — requirements and satisfy relations

```sysml
package Requirements {
  requirement def MassLimit {
    doc /* 車両総質量は 1500 kg 以下であること */ // "Total vehicle mass shall be at most 1500 kg"
    attribute limit : Real = 1500.0;
  }
  requirement massReq : MassLimit;
  part vehicle;
  satisfy massReq by vehicle;
}
```

![Requirement diagram](docs/images/diagram-req.png)

### Use case diagram — use cases with actors and perform

```sysml
package Robot {
  part def Operator;
  use case def Operate { subject robot : Robot; actor operator : Operator; }
  use case def Maintain { subject robot : Robot; actor operator : Operator; }
  use case operate : Operate;
  part operator : Operator { perform operate; }
}
```

![Use case diagram](docs/images/diagram-uc.png)

### State transition diagram — states and transitions (with triggers)

```sysml
package Machine {
  state def BrewCycle {
    state off;
    state idle;
    state heating;
    state brewing;
    transition first off accept powerOn then idle;
    transition first idle accept startCmd then heating;
    transition first heating accept ready then brewing;
  }
}
```

![State transition diagram](docs/images/diagram-state.png)

### Activity diagram — actions with succession / item flow

```sysml
package Process {
  item def Order;
  action def Fulfill {
    action validate;
    action ship;
    first validate then ship;
    flow of Order from validate to ship;
  }
}
```

![Activity diagram](docs/images/diagram-action.png)

> For diagram kinds, editing operations and layout persistence, see the
> [diagram feature guide](docs/diagrams.md).

## SysML v2 conformance

This extension implements a **practical subset** of the OMG SysML v2 textual
notation (overview based on a code audit; for details and evidence see the
[conformance matrix](docs/conformance.md)).

| Language area | Level |
|---|---|
| Definitions & Usages (part / item / attribute / port / action / state …) | **Full** |
| Specialization (`:>` / `:>>` / `specializes` / `subsets` / `redefines`) | **Full** |
| Connections / Interfaces / Bindings / Flows | **Full** (structure) |
| Requirements / Constraints / satisfy・verify | **Full** (structure) / expression AST + type check |
| Use Cases / Actors / include・perform | **Full** |
| Metadata / Annotations (`@`, `#`, `metadata def`) | **Full** (parse) |
| Comments / Documentation (`//`, `/* */`, `doc`, `comment`) | **Full** |
| States & Transitions / Actions / Calc | **Partial** (trigger/guard/effect and control flow opaque) |
| Views / Viewpoints / Rendering | **Partial** (rendering not implemented) |
| Imports / Aliases / Visibility | **Partial** (private/protected not enforced) |
| Expressions (values & constraint / calc bodies) | **Partial** (structured AST + positive-knowledge type checking; no evaluation) |
| Standard Library | **minimal subset bundled** (not the full OMG library) |
| KerML foundation layer (classifier / feature / function …) | **Parse-only** |

> The level definitions (Full / Partial / Parse-only / None) and the evidence
> for each area are documented in the [conformance matrix](docs/conformance.md).

## Documentation

- [Diagram features](docs/diagrams.md) — diagram kinds, editing, layout persistence
- [Supported notation & limitations](docs/syntax.md) — the SysML v2 subset supported
- [Conformance matrix](docs/conformance.md) — detailed language area × level table
- [Claude (MCP) integration guide](docs/mcp.md) — MCP server registration, tools, usage
- [Development guide](docs/development.md) — architecture, build, test, publish

> Documentation pages are currently written in Japanese.

## License

[MIT](LICENSE). The official OMG samples under `samples/omg/` are EPL-2.0
([details](samples/omg/README.md)). Bundled third-party components (React, etc.)
are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
