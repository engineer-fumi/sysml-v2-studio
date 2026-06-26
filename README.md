<div align="center">

# SysML v2 Studio

**SysML v2 (`.sysml` / `.kerml`) を VS Code でオーサリング・可視化・編集**

言語サポート(ハイライト・診断・補完・定義ジャンプ)に加え、**8 種類の編集可能な
ダイアグラム**、さらに **Claude (MCP) 連携**を備えた SysML v2 拡張です。
エディタ・ファイル管理・リモート開発は VS Code 本体の機能をそのまま活用します。

![ブロック定義図](docs/images/diagram-general.png)

</div>

## 特長

- 🎨 **8 種類のダイアグラム** — 全体図 / ブロック定義図 / 内部ブロック図 /
  要求図 / ユースケース図 / 状態遷移図 / アクティビティ図 / シーケンス図
- ✏️ **図から直接モデルを編集** — ブロックの移動・リサイズ、接続の作成、
  リネーム・削除をテキストへ書き戻し。手動レイアウトはサイドカーに保存
- 🔎 **言語サポート** — シンタックスハイライト、リアルタイム診断(構文 + 意味)、
  補完、アウトライン、ファイル横断の定義ジャンプ・ホバー
- 🔗 **エディタと双方向同期** — 図クリック ⇄ ソースジャンプ、カーソル ⇄ ハイライト
- 📦 **マルチファイル / リモート対応** — ワークスペースを自動インデックス、
  Remote-SSH / WSL / Dev Containers でそのまま動作
- 🤖 **Claude (MCP) 連携** — モデルの解析・検証・要求一覧・図構造の取得を
  ツールとして公開。Claude Desktop / Claude Code が `.sysml` を**意味を理解して**
  読み書きできます([連携ガイド](docs/mcp.md))
- 📚 **標準ライブラリ同梱**(最小サブセット)と **OMG 公式サンプル**(`samples/omg/`)

## ダイアグラムの種類

| ブロック定義図 (BDD) | 内部ブロック図 (IBD) |
|:---:|:---:|
| ![BDD](docs/images/diagram-bdd.png) | ![IBD](docs/images/diagram-ibd.png) |
| **要求図** | **ユースケース図** |
| ![要求図](docs/images/diagram-req.png) | ![ユースケース図](docs/images/diagram-uc.png) |
| **状態遷移図** | **アクティビティ図** |
| ![状態遷移図](docs/images/diagram-state.png) | ![アクティビティ図](docs/images/diagram-action.png) |

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
| KerML 基盤層 (classifier / feature / function …) | **None** |

> レベルの定義(Full / Partial / Parse-only / None)と各領域の根拠は
> [conformance matrix](docs/conformance.md) に記載しています。

## インストール

VS Code Marketplace で **「SysML v2 Studio」** を検索してインストール、または:

```bash
code --install-extension engineer-fumi.sysml-v2-studio
```

ソースから `.vsix` を作る場合は [開発ガイド](docs/development.md) を参照。

## 使い方

1. `.sysml` または `.kerml` ファイルを開く(言語サポートが有効になります)
2. エディタ右上の図アイコン、またはコマンドパレットで
   **「SysML: ダイアグラムを開く」** を実行
3. パネル上部のセレクタ、または **「SysML: 図の種類を選んで開く」** で図の種類を切替
4. ブロックをドラッグして配置、右クリックで接続・線種・削除などを操作
   (配置は `.sysml-layout.json` に自動保存)

はじめての方は同梱の `samples/`(車両プロジェクト・コーヒーメーカー状態機械・
アクションフロー等)を開いて試せます。

## Claude (MCP) 連携

拡張に**スタンドアロンの MCP サーバ**を同梱しています。登録すると、Claude がモデルを
**テキストとしてではなく構造として**扱えます — 解析・検証・要求一覧・ダイアグラム構造の
取得をツールとして提供します。

**VS Code 1.101 以上で本拡張を使っている場合は設定ゼロ** — 拡張が VS Code のネイティブ
MCP API で同梱サーバを自動登録します(コマンドパレットの **「MCP: List Servers」** で確認)。

Claude Desktop / Claude Code など **VS Code 以外**のクライアントは、OS・エディタ非依存で
パス探し不要の **npx** 一行で登録できます(プロジェクト直下で実行):

```bash
claude mcp add sysml -- npx -y @engineer-fumi/sysml-v2-mcp "$(pwd)"
```

公開ツール: `list_files` / `outline` / `validate` / `find_element` /
`list_requirements` / `describe_diagram`。設定例と詳細は
[Claude (MCP) 連携ガイド](docs/mcp.md) を参照してください。

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
