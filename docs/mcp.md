# Claude (MCP) 連携ガイド

SysML v2 Studio は、拡張機能とは別に**スタンドアロンの MCP (Model Context
Protocol) サーバ**を同梱しています。これを Claude Desktop / Claude Code に登録
すると、Claude がワークスペースの `.sysml` / `.kerml` モデルを**ただのテキストでは
なく、解決済みのモデル構造として**扱えるようになります。

サーバは拡張機能と同じ `src/core`(パーサ・名前解決・検証・レイアウト)を再利用
しているため、診断やダイアグラム構造はエディタ上の表示と一致します。依存ライブラリ
は無く、`dist/mcp.cjs` 1 ファイルで動作します(newline-delimited JSON-RPC 2.0 over
stdio)。

## 仕組み

```
Claude Desktop / Claude Code
        │  stdio (JSON-RPC 2.0)
        ▼
   dist/mcp.cjs  ──►  src/core (parser / resolve / validate / layout)
        │
        ▼
   ワークスペースの *.sysml / *.kerml を走査・解析
```

- 起動引数の第 1 引数(または環境変数 `SYSML_WORKSPACE`、無ければカレント
  ディレクトリ)をワークスペースのルートとして再帰的に走査します。
- 各ツール呼び出しのたびにディスクを読み直すため、Claude や他のツールが行った
  編集が常に反映されます。

## 提供ツール

| ツール | 入力 | 返すもの |
|---|---|---|
| `list_files` | — | ワークスペース内の全モデルファイル(要素数・構文エラー数) |
| `outline` | `file?` | 名前付き宣言の構造ツリー(種類・型・行番号・doc) |
| `validate` | `file?` | 構文 + 意味検証の診断(未解決参照・重複名・型整合・shadowing・import 可視性、行/列付き) |
| `find_element` | `name` | 名前(短縮名)に一致する宣言の種類・型・doc・位置 |
| `list_requirements` | — | 要求/制約と doc・属性・`satisfy` 関係 |
| `describe_diagram` | `kind`, `file?` | 指定種別の図のボックス・ポート・接続を構造データで(`kind`: `general`/`bdd`/`ibd`/`req`/`uc`/`state`/`action`/`seq`) |

## 登録方法

### Claude Code

プロジェクトのルートで:

```bash
claude mcp add sysml -- node <拡張のインストール先>/dist/mcp.cjs "$(pwd)"
```

VS Code 拡張としてインストール済みなら、`dist/mcp.cjs` は次の場所にあります:

```bash
# macOS / Linux
node ~/.vscode/extensions/engineer-fumi.sysml-v2-studio-*/dist/mcp.cjs "$(pwd)"
```

リポジトリから直接使う場合は、まずビルドします:

```bash
npm install && npm run build:mcp
claude mcp add sysml -- node "$(pwd)/dist/mcp.cjs" "$(pwd)"
```

### Claude Desktop

設定ファイル(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`)
に追記します。`<ABS_PATH>` は実際の絶対パスに置き換えてください。

```jsonc
{
  "mcpServers": {
    "sysml": {
      "command": "node",
      "args": [
        "<ABS_PATH>/dist/mcp.cjs",
        "<ABS_PATH_TO_YOUR_MODEL_WORKSPACE>"
      ]
    }
  }
}
```

登録後、Claude に「このモデルを検証して」「要求を一覧にして」「Vehicle の
ブロック定義図の構造を教えて」のように依頼すると、対応するツールが呼び出されます。

## 使用例

- **レビュー**: 「`validate` で全ファイルを検証し、未解決参照を修正して」
- **要求トレース**: 「`list_requirements` で satisfy されていない要求を挙げて」
- **構造理解**: 「`describe_diagram kind=ibd` で system の内部接続を説明して」
- **リファクタ**: 「`find_element` で Engine の定義箇所を探し、名前を Powerplant に変えて」

## トラブルシューティング

- 出力が壊れる場合: サーバは **stdout に JSON-RPC 以外を一切書きません**。ログは
  stderr に出ます。`node dist/mcp.cjs <dir>` を手動起動し、stderr の起動メッセージ
  でワークスペースのパスを確認してください。
- ファイルが見つからない: ワークスペース引数が正しいか、対象が `.sysml` /
  `.kerml` 拡張子か、`node_modules` 等の除外ディレクトリ下に無いかを確認します。
