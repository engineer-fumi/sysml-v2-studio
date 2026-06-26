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

登録方法は 3 通り。**おすすめは npx(方法 A)** — OS・エディタ・拡張のインストール先に
依存せず、コピペ 1 行で完結します。

### 方法 A: npx(推奨・ゼロインストール)

npm に公開された [`@engineer-fumi/sysml-v2-mcp`](https://www.npmjs.com/package/@engineer-fumi/sysml-v2-mcp)
を直接起動します。事前インストール不要、パス探し不要です。

**Claude Code**(プロジェクトのルートで):

```bash
claude mcp add sysml -- npx -y @engineer-fumi/sysml-v2-mcp "$(pwd)"
```

**Claude Desktop**(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "sysml": {
      "command": "npx",
      "args": ["-y", "@engineer-fumi/sysml-v2-mcp", "<ABS_PATH_TO_YOUR_MODEL_WORKSPACE>"]
    }
  }
}
```

### 方法 B: VS Code 拡張に同梱の `dist/mcp.cjs` を指す(フォールバック)

VS Code 拡張としてインストール済みなら、同梱の `dist/mcp.cjs` を直接指せます。
ただしインストール先パスはエディタ(VS Code / Insiders / Cursor)・OS で異なり、
バージョン付きフォルダ名の glob 展開に注意が必要です:

```bash
# macOS / Linux(zsh では glob が展開されない場合 `setopt null_glob` 等が必要)
claude mcp add sysml -- node ~/.vscode/extensions/engineer-fumi.sysml-v2-studio-*/dist/mcp.cjs "$(pwd)"
```

### 方法 C: リポジトリからローカルビルド(開発・自前運用)

```bash
npm install && npm run build:mcp
claude mcp add sysml -- node "$(pwd)/dist/mcp.cjs" "$(pwd)"
```

Claude Desktop の場合は `command: "node"`, `args: ["<ABS_PATH>/dist/mcp.cjs", "<workspace>"]`。

登録後、Claude に「このモデルを検証して」「要求を一覧にして」「Vehicle の
ブロック定義図の構造を教えて」のように依頼すると、対応するツールが呼び出されます。

## 使用例

- **レビュー**: 「`validate` で全ファイルを検証し、未解決参照を修正して」
- **要求トレース**: 「`list_requirements` で satisfy されていない要求を挙げて」
- **構造理解**: 「`describe_diagram kind=ibd` で system の内部接続を説明して」
- **リファクタ**: 「`find_element` で Engine の定義箇所を探し、名前を Powerplant に変えて」

## npm パッケージの公開(メンテナ向け)

npx 経路(方法 A)用の npm パッケージ `@engineer-fumi/sysml-v2-mcp` は、拡張と同じ
ソースから**バンドル済みの `dist/mcp.cjs` 1 ファイル**として生成します。

```bash
npm run build:mcp:pkg   # dist/npm/ に publish 可能なパッケージを生成
npm run smoke:mcp       # 生成物を stdio で起動して initialize / tools/list / tools/call を検証
npm run publish:mcp     # build:mcp:pkg → smoke:mcp → npm publish dist/npm --access public
```

- **バージョン同期**: `scripts/build-mcp-package.mjs` がルート `package.json` の
  `version` をそのまま採用するため、拡張(`sysml-v2-studio`)とパッケージのバージョンは
  常に一致します。リリース時はルートの `version` を上げるだけです。
- **公開には npm トークンが必要**(vsce と同様、人手の操作)。`npm publish` は
  `dist/npm` ディレクトリに対して行い、リポジトリ全体は公開しません。
- 生成物(`dist/npm/`)はビルド成果物で、`dist/` ごと `.gitignore` 済みです。
  古いバンドルを publish しないよう、`publish:mcp` は毎回 `build:mcp` から作り直します。

## トラブルシューティング

- 出力が壊れる場合: サーバは **stdout に JSON-RPC 以外を一切書きません**。ログは
  stderr に出ます。`node dist/mcp.cjs <dir>` を手動起動し、stderr の起動メッセージ
  でワークスペースのパスを確認してください。
- ファイルが見つからない: ワークスペース引数が正しいか、対象が `.sysml` /
  `.kerml` 拡張子か、`node_modules` 等の除外ディレクトリ下に無いかを確認します。
