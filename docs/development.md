# 開発ガイド

## アーキテクチャ

```
syntaxes/sysml.tmLanguage.json   # TextMate 文法 (ハイライト)
language-configuration.json      # コメント・括弧・インデント設定
src/
├── core/                  # エディタ非依存のコア (VS Code 非依存・テスト容易)
│   ├── lexer.ts           #   トークナイザ
│   ├── parser.ts          #   再帰下降パーサ (エラー回復付き)
│   ├── ast.ts             #   簡易 AST
│   ├── resolve.ts         #   名前解決 (スコープ / import / 継承)
│   ├── validate.ts        #   意味検証
│   ├── stdlib.ts          #   同梱標準ライブラリ (最小サブセット)
│   ├── viewSpecs.ts       #   図種別ごとの表示設定 (VIEW_SPECS)
│   ├── layout.ts          #   ダイアグラムレイアウト
│   └── serialize.ts       #   webview への AST 受け渡し
├── extension/             # 拡張ホスト側
│   ├── extension.ts       #   エントリポイント
│   ├── modelIndex.ts      #   ワークスペース全体のモデルインデックス
│   ├── languageFeatures.ts  # 診断・補完・シンボル・定義・ホバー
│   └── diagramPanel.ts    #   ダイアグラム Webview パネル
├── mcp/                   # Claude (MCP) サーバ (VS Code/SDK 非依存)
│   ├── modelStore.ts     #   fs ベースのモデルインデックス (ModelIndex の Node 版)
│   ├── tools.ts          #   ツール定義 + 実装 (core のみに依存・単体試験可)
│   └── server.ts         #   JSON-RPC 2.0 over stdio の薄い配線
└── webview/               # Webview (React + SVG)
    ├── DiagramApp.tsx     #   メッセージング・ルート選択
    ├── DiagramView.tsx    #   SVG 描画
    ├── diagramGeometry.ts #   純粋幾何 (パス生成・境界計算)
    ├── diagramInteractions.ts # 純粋な操作計算 (リサイズ等)
    ├── usePanZoom.ts       #   ビュー (パン/ズーム) フック
    └── useDiagramDrag.ts   #   ドラッグ配送フック
samples/                   # サンプルモデル (複数ファイル構成の例を含む)
samples/omg/               # OMG 公式サンプル (SysML-v2-Release より, EPL-2.0)
test/                      # 各層の自動試験
scripts/                   # デモ画像・アイコン生成スクリプト
```

コアは VS Code に依存しないため、パーサ・リゾルバ・レイアウトはブラウザや
Node 単体でも動き、`webview/` は postMessage 越しにコアの出力を描画します。
同じ理由で `mcp/` の MCP サーバも `core/` をそのまま再利用でき、診断や図構造は
エディタ表示と一致します(→ [Claude (MCP) 連携ガイド](mcp.md))。

## ビルド

```bash
npm install
npm run check     # 型チェック (tsc --noEmit)
npm run build     # 型チェック + esbuild バンドル (dist/extension.js, dist/webview.js)
npm run build:mcp # MCP サーバを単一ファイルにバンドル (dist/mcp.cjs)
npm run watch     # esbuild ウォッチ
```

開発時は VS Code でこのリポジトリを開いて **F5**(`samples/` を開いた拡張開発
ホストが起動します)。

## テスト (5層・CI: GitHub Actions)

```bash
npm run test:unit   # ユニット: パーサ/リゾルバ・レイアウト・幾何・React フック・
                    #           ファズ (不正入力でクラッシュ/ハングしない)
npm run test:e2e    # Webview E2E: 実ブラウザで描画し境界外ドラッグ等の
                    #              敵対操作で壊れないか (Playwright)
npm run test:vscode # 統合: 本物の VS Code 拡張ホストで言語機能を検証
npm run test:ui     # UI E2E: 実 VS Code を Selenium で操作 (vscode-extension-tester)
```

個別ターゲット: `test:core` / `test:geometry` / `test:parser` / `test:hooks` /
`test:fuzz` / `test:mcp`(MCP ツール層)。ファズの反復数は環境変数 `FUZZ_ITERS`
で調整できます。
`test:e2e` / `test:ui` は初回にブラウザや VS Code を取得します。

## デモ画像 / アイコンの再生成

```bash
npm run gen:screenshots   # docs/images/diagram-*.png を再生成 (Playwright)
npm run gen:icon          # media/icon.png を再生成
```

## パッケージング / 公開

### リリース(自動・推奨)

`package.json` の `version` を上げて `v<version>` タグを push するだけで、
GitHub Actions が **3 つすべて**を公開します:

1. `CHANGELOG.md` を更新し、`package.json` の `version` を上げて main にマージ
2. `git tag v<version> && git push origin v<version>`(例 `v0.8.0`)
3. 自動公開:
   - **VS Code Marketplace** + **Open VSX**(`publish-extension.yml`、`release` 環境の承認後)
   - **npm `@engineer-fumi/sysml-v2-mcp`**(`publish-mcp.yml`、OIDC トークンレス)

初回のみ必要な設定(リポジトリ → Settings → Environments → `release`):
- Secret `VSCE_PAT`(Azure DevOps PAT、スコープ *Marketplace > Manage*、有効期限つき)
- 任意: Secret `OVSX_PAT`(Open VSX 公開も行う場合。無ければ Open VSX はスキップ)
- 承認制にするため required reviewers を設定(長期 PAT をレビューでゲート)

npm 側の Trusted Publisher 設定は [docs/mcp.md](mcp.md) を参照。

### ローカルでパッケージング / 手動公開

```bash
npm run package           # sysml-v2-studio-<version>.vsix を生成 (MCP サーバ同梱)
code --install-extension sysml-v2-studio-<version>.vsix   # ローカル導入

# Marketplace へ手動公開 (発行者の Personal Access Token が必要)
npx @vscode/vsce login engineer-fumi
npx @vscode/vsce publish        # package.json の version で公開
```
