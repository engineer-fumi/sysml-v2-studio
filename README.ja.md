<div align="center">

# SysML v2 Studio

**SysML v2 (`.sysml` / `.kerml`) を VS Code で書く・見る・編集する**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/engineer-fumi.sysml-v2-studio?label=Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=engineer-fumi.sysml-v2-studio)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/engineer-fumi.sysml-v2-studio?label=Installs)](https://marketplace.visualstudio.com/items?itemName=engineer-fumi.sysml-v2-studio)
[![MCP on npm](https://img.shields.io/npm/v/%40engineer-fumi%2Fsysml-v2-mcp?label=MCP%20npm&logo=npm)](https://www.npmjs.com/package/@engineer-fumi/sysml-v2-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) · **日本語** · [简体中文](README.zh-Hans.md)

言語サポート(ハイライト・診断・補完・定義ジャンプ)に加え、**8 種類の編集可能な
ダイアグラム**と **Claude (MCP) 連携**を備えた SysML v2 拡張です。

![全体図](docs/images/diagram-general.png)

</div>

## 特長

- 🎨 **8 種類のダイアグラム** — 全体図 / ブロック定義図 / 内部ブロック図 / 要求図 / ユースケース図 / 状態遷移図 / アクティビティ図 / シーケンス図
- ✏️ **図から直接編集** — 移動・リサイズ・接続作成・リネーム・削除を**テキストへ書き戻し**(手動レイアウトはサイドカーに保存)
- 🔎 **言語サポート** — シンタックスハイライト、リアルタイム診断(構文 + 意味)、補完、アウトライン、ファイル横断の定義ジャンプ・ホバー
- 🔗 **双方向同期** — 図クリック ⇄ ソースジャンプ、カーソル ⇄ ハイライト
- 🤖 **Claude (MCP) 連携** — モデルを**構造として**解析・検証・取得(Claude Code / Desktop / VS Code の AI)
- 📦 **マルチファイル / リモート対応**(Remote-SSH / WSL / Dev Containers)、📚 **標準ライブラリ同梱** + **OMG 公式サンプル**

## インストール

VS Code Marketplace で **「SysML v2 Studio」** を検索してインストール、または:

```bash
code --install-extension engineer-fumi.sysml-v2-studio
```

> 要件: VS Code **1.101 以上**。ソースから `.vsix` を作る場合は [開発ガイド](docs/development.md) を参照。

## クイックスタート — 図をプレビューする

1. **`.sysml` / `.kerml` ファイルを開く**(まずは同梱の `samples/` を開くのが手軽です)
2. エディタ右上の **図アイコン**、またはコマンドパレットの **「SysML: ダイアグラムを開く」** を実行
   → ダイアグラムがエディタの隣にプレビュー表示されます
3. パネル上部のセレクタ、または **「SysML: 図の種類を選んで開く」** で 8 種類を切り替え
4. ブロックを**ドラッグ**して配置、**右クリック**で接続・線種・削除などを操作
   → 変更は**ソーステキストに自動で書き戻し**(配置は `.sysml-layout.json` に保存)

図の要素をクリックすると対応するソース行へジャンプし、エディタのカーソル位置は図側でハイライトされます。

## Claude (MCP) 連携

拡張に**スタンドアロンの MCP サーバ**を同梱しています。Claude などの AI が `.sysml`
モデルを**テキストとしてではなく構造として**扱えるようになります — 解析・検証・要求
一覧・ダイアグラム構造の取得をツールとして提供します。

**使う相手によって、やることは次の 2 つのどちらかです。**

### ① VS Code の AI(Copilot / agent)から使う → 設定不要

VS Code **1.101 以上**で本拡張をインストールしていれば、**何もする必要はありません**。
拡張が MCP サーバを自動登録します。コマンドパレットで **「MCP: List Servers」** を開き、
**「SysML v2 Studio」** が一覧にあれば有効です。

### ② Claude Code / Claude Desktop から使う → 1 行で登録

**Claude Code**(VS Code とは別のクライアント)の場合、プロジェクトのルートで次を 1 回
実行するだけです(`npx` なので事前インストール不要):

```bash
claude mcp add sysml -- npx -y @engineer-fumi/sysml-v2-mcp "$(pwd)"
```

**Claude Desktop** の場合は設定ファイルに次を追加します:

```jsonc
{ "mcpServers": { "sysml": {
  "command": "npx",
  "args": ["-y", "@engineer-fumi/sysml-v2-mcp", "<モデルのフォルダの絶対パス>"]
} } }
```

提供ツール: `list_files` / `outline` / `validate` / `find_element` /
`list_requirements` / `describe_diagram`。登録方法のバリエーション(パス指定・自前
ビルド)・ツールの詳細・活用例は [Claude (MCP) 連携ガイド](docs/mcp.md) を参照。

## 記法と図の対応

同じテキストモデルが、選んだ図の種類に応じて描き分けられます。以下は各図の**最小例と、
その実際の描画結果**です(下の全体図ヒーロー画像も同じ仕組みで生成しています)。

### ブロック定義図 (BDD) — 定義の構造・コンポジション・特化

```sysml
package Powertrain {
  part def Vehicle;
  part def Engine;
  part def Cylinder;
  part v : Vehicle { part engine : Engine; }
  part e : Engine { part cylinders : Cylinder[4]; }
}
```

![ブロック定義図](docs/images/diagram-bdd.png)

### 内部ブロック図 (IBD) — part 内部の接続(port / connect)

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

![内部ブロック図](docs/images/diagram-ibd.png)

### 要求図 — 要求と satisfy 関係

```sysml
package Requirements {
  requirement def MassLimit {
    doc /* 車両総質量は 1500 kg 以下であること */
    attribute limit : Real = 1500.0;
  }
  requirement massReq : MassLimit;
  part vehicle;
  satisfy massReq by vehicle;
}
```

![要求図](docs/images/diagram-req.png)

### ユースケース図 — ユースケースとアクター・perform

```sysml
package Robot {
  part def Operator;
  use case def Operate { subject robot : Robot; actor operator : Operator; }
  use case def Maintain { subject robot : Robot; actor operator : Operator; }
  use case operate : Operate;
  part operator : Operator { perform operate; }
}
```

![ユースケース図](docs/images/diagram-uc.png)

### 状態遷移図 — 状態と transition(trigger 付き)

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

![状態遷移図](docs/images/diagram-state.png)

### アクティビティ図 — アクションと succession / item flow

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

![アクティビティ図](docs/images/diagram-action.png)

> 図の種類・編集操作・レイアウト保存の詳細は [ダイアグラム機能ガイド](docs/diagrams.md) を参照。

## SysML v2 対応範囲

本拡張は OMG SysML v2 テキスト記法の**実用サブセット**を実装しています(コード監査に
基づく概要。詳細・根拠は [対応範囲 (conformance matrix)](docs/conformance.md) を参照)。

| 言語領域 | 対応レベル |
|---|---|
| Definitions & Usages (part / item / attribute / port / action / state …) | **Full** |
| Specialization (`:>` / `:>>` / `specializes` / `subsets` / `redefines`) | **Full** |
| Connections / Interfaces / Bindings / Flows | **Full**(構造) |
| Requirements / Constraints / satisfy・verify | **Full**(構造)/ 式は不透明 |
| Use Cases / Actors / include・perform | **Full** |
| Metadata / Annotations (`@`, `#`, `metadata def`) | **Full**(パース) |
| Comments / Documentation (`//`, `/* */`, `doc`, `comment`) | **Full** |
| States & Transitions / Actions / Calc | **Partial**(trigger/guard/効果・制御フローは不透明) |
| Views / Viewpoints / Rendering | **Partial**(レンダリング非実装) |
| Imports / Aliases / Visibility | **Partial**(private/protected は非強制) |
| Expressions(constraint / calc 本体・値) | **Parse-only**(不透明テキスト・型チェックなし) |
| Standard Library | **最小サブセット同梱**(完全な OMG ライブラリではない) |
| KerML 基盤層 (classifier / feature / function …) | **Parse-only** |

> レベルの定義(Full / Partial / Parse-only / None)と各領域の根拠は
> [conformance matrix](docs/conformance.md) に記載しています。

## ドキュメント

- [ダイアグラム機能の詳細](docs/diagrams.md) — 図の種類・編集操作・レイアウト保存
- [対応記法と制限事項](docs/syntax.md) — サポートする SysML v2 サブセット
- [対応範囲 (conformance matrix)](docs/conformance.md) — 言語領域 × 対応レベルの詳細表
- [Claude (MCP) 連携ガイド](docs/mcp.md) — MCP サーバの登録・ツール・活用例
- [開発ガイド](docs/development.md) — アーキテクチャ・ビルド・テスト・公開

## ライセンス

[MIT](LICENSE)。`samples/omg/` の OMG 公式サンプルは EPL-2.0
([詳細](samples/omg/README.md))。同梱する第三者コンポーネント(React 等)は
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) を参照。
