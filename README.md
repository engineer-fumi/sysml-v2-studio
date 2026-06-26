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

拡張に**スタンドアロンの MCP サーバ**を同梱しています。Claude Desktop /
Claude Code に登録すると、Claude がモデルを**テキストとしてではなく構造として**
扱えます — 解析・検証・要求一覧・ダイアグラム構造の取得をツールとして提供します。

Claude Code の場合(プロジェクト直下で実行):

```bash
claude mcp add sysml -- node ~/.vscode/extensions/engineer-fumi.sysml-v2-studio-*/dist/mcp.cjs "$(pwd)"
```

公開ツール: `list_files` / `outline` / `validate` / `find_element` /
`list_requirements` / `describe_diagram`。設定例と詳細は
[Claude (MCP) 連携ガイド](docs/mcp.md) を参照してください。

## ドキュメント

- [ダイアグラム機能の詳細](docs/diagrams.md) — 図の種類・編集操作・レイアウト保存
- [対応記法と制限事項](docs/syntax.md) — サポートする SysML v2 サブセット
- [Claude (MCP) 連携ガイド](docs/mcp.md) — MCP サーバの登録・ツール・活用例
- [開発ガイド](docs/development.md) — アーキテクチャ・ビルド・テスト・公開

## ライセンス

[MIT](LICENSE)。`samples/omg/` の OMG 公式サンプルは EPL-2.0
([詳細](samples/omg/README.md))。同梱する第三者コンポーネント(React 等)は
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) を参照。
