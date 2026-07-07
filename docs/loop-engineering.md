# ループエンジニアリング × GitHub 連携

> 最終更新: 2026-07-07

GitHub を「バックログ・状態・監査」の層として使い、**ローカルの Claude Code が
自律的にエンジニアリングループを回す**ための仕組み。1件の作業を Issue にし、
ループがそれを拾って実装 → 検証 → PR → CI 緑まで進め、人間はマージだけを判断する。

## なぜこの構成か（実行モデル）

Claude を **GitHub Actions 側で回す**（Claude Code GitHub App）方式もあるが、それには
別途 API キーの Secret 登録と従量課金が要る。本リポジトリでは**それを避け**、次の
**ローカル主導ハイブリッド**を採用する:

- **実装エンジン = ローカルの Claude Code**（`/loop-task` コマンド）。フルツールが使える。
- **GitHub = 調整層**。Issue = 作業キュー、ラベル = 状態機械、PR = 成果物、CI = 品質ゲート。
- **GitHub Actions = 既存 CI のまま**（API キー不要）。ループは `gh` CLI で連携する。

```
 GitHub Issue (loop:ready)                        人間
        │  ①拾う(優先度順・排他)                   ▲ ⑦マージ判断
        ▼                                          │
   ブランチ作成 ─②─▶ 実装 ─③─▶ 検証(npm/harness) ─④─▶ PR (Closes #N)
        ▲                                          │
        │           ⑥ loop:needs-review ◀─⑤─ CI緑 (gh pr checks --watch)
        └──────────────── 次の Issue へ ───────────┘
                         （ローカルの /loop-task を繰り返す）
```

## 状態機械（ラベル）

Issue のライフサイクルはラベルで表現する。遷移はループ（`/loop-task`）が自動で行う。

| ラベル | 意味 | 誰が付ける |
|---|---|---|
| `loop:ready` | キュー投入済み・着手可能 | 人間（Issue 作成時、テンプレが自動付与） |
| `loop:in-progress` | ループが着手中（**排他ロック**） | ループ（claim 時） |
| `loop:needs-review` | PR 作成済み・CI 緑・**人間のマージ待ち** | ループ（CI 緑時） |
| `loop:blocked` | 判断/依存待ちで停止 | ループ（詰まった時）または人間 |
| `loop:p1` / `p2` / `p3` | 優先度（拾う順） | 人間 |
| `area:grammar` | 領域タグ（文法/パーサ） | 人間 |

```
ready ──claim──▶ in-progress ──CI緑──▶ needs-review ──人間マージ──▶ (closed by "Closes #N")
                     │
                     └──詰まった──▶ blocked ──人間が解消──▶ ready
```

## 作業の入れ方（キューイング）

1. **Issue を作る**: GitHub の New issue → 「🤖 Loop task」テンプレート
   （`.github/ISSUE_TEMPLATE/loop-task.yml`）。以下を必ず埋める:
   - **ゴール**（Why/What）
   - **完了条件**（Done-when、客観的にチェックできる箇条書き）
   - **検証コマンド**（ループが PR 前に必ず通す `npm run ...`）
   - 任意: **依存**（Depends-on `#NN`）、**優先度**、**実装の手がかり**
2. 作成すると `loop:ready` が自動で付く。優先度に応じて `loop:p1/p2/p3` を付ける。
3. 良い作業単位の目安: **1 PR で閉じられる粒度**・完了条件が機械的に検証できること。

## ループの回し方（ローカル）

前提: このリポジトリで Claude Code を起動していること。`gh auth status` が通っていること。

- **1件だけ処理**:
  ```
  /loop-task            # キューの先頭（優先度順）を1件
  /loop-task 42         # Issue #42 を指定
  ```
- **継続的に回す**（recurring）:
  ```
  /loop 20m /loop-task  # 20分ごとに1イテレーション
  /loop /loop-task      # モデルが自己ペースで回す
  ```
  キューが空/全て blocked のときは何も作らず短く報告して待機する（空回りしない）。

`/loop-task` の1イテレーションが行うこと（詳細は `.claude/commands/loop-task.md`）:
`loop:ready` を1件 claim → ブランチ作成 → 実装 → 検証コマンド緑化 → PR (`Closes #N`) →
`gh pr checks --watch` で CI 監視・赤なら自己修復 → 緑で `loop:needs-review` に遷移して停止。

## 安全レール

- **1イテレーション = 1 Issue**、並行着手しない。
- **main へ直接 push / 直接コミットしない**。必ずブランチ + PR。
- **自動マージしない**。マージは人間の判断（`loop:needs-review` で止まる）。
- **force push しない**、開始時に working tree が dirty なら中断。
- **キューが空なら仕事を捏造しない**。
- Depends-on が未解決の Issue はスキップ（stacked PR の順序を尊重）。

## 規約（このリポジトリ）

- ブランチ: `feat|fix|docs|refactor/<slug>-<issue番号>`（例 `feat/import-filter-42`）。
- コミット: `type(scope): 要約`。末尾に
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- PR 本文: `Closes #N` + What/Why + 検証結果 + `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。
- 文法カバレッジ系タスクは計測 harness（`grammar-alignment-initiative` 参照）で
  **parse error 数を悪化させない**ことを検証に含める。

## 品質ゲート（main のブランチ保護）

main は **PR 必須 + 必須ステータスチェック（strict）** で保護されている。必須チェック:

| チェック | 内容 |
|---|---|
| `core` | 型チェック + ビルド + unit（layout/geometry/parser/hooks/fuzz） |
| `mcp-package` | MCP npm パッケージのビルド + stdio smoke |
| `webview-e2e` | Playwright による webview E2E（可視化の担保） |
| `vscode-integration` | VS Code 拡張ホストでの統合テスト |
| `vscode-ui` | 実 VS Code ウィンドウでの UI E2E |

`grammar-coverage`（文法カバレッジ回帰ガード）はネットワーク依存（コーパス clone）の
ため必須にはしない（clone 失敗時は SKIP で緑になる設計だが、外部要因をゲートに
入れない方針）。

e2e/UI 系を必須へ昇格する前の**安定性の根拠**は `.github/workflows/flake-check.yml`
（各スイートを 10 回並列実行）で測る。昇格時の実測: 通常 CI 60 run 連続グリーン +
バースト 10×3 全グリーン（2026-07-07, #33）。不安定化したら再計測して原因を潰すか、
根拠を添えて必須から一時降格する。

## 監査（あとから追える）

- **キューの状態**: `gh issue list --label loop:ready`（着手待ち）/ `loop:in-progress`（作業中）
  / `loop:needs-review`（マージ待ち）/ `loop:blocked`（要対応）。
- **成果物**: 各 Issue に紐づく PR（`Closes #N`）と、その CI（GitHub Actions の run）。
- ループの各遷移は Issue コメントに残る（claim / blocked 理由 / CI 緑）。

## 今後の拡張余地

- GitHub Actions（API キー不要の範囲）で **キュー衛生**を自動化: 例）`loop:in-progress` が
  長時間動いていない Issue を検出して通知、`needs-review` の滞留を集計。
- 予算連動: `/loop` を予算ディレクティブ（`+500k` 等）と組み合わせ、残予算に応じて件数を調整。
- どうしてもクラウド常駐が要るなら、別途 API キーを用意して Claude Code GitHub App へ移行
  （本ドキュメントの状態機械・ラベル・テンプレはそのまま流用できる）。
