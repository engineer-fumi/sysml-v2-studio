---
description: GitHub Issue キューから loop:ready を1件拾い、実装→検証→PR→CI緑まで自動で回す（ローカル実行ループの1イテレーション）
argument-hint: "[issue番号 (省略時はキューから自動選択)]"
allowed-tools: Bash(gh *), Bash(git *), Bash(npm *), Bash(node *), Read, Edit, Write, Grep, Glob
---

あなたは **ローカル実行の自律エンジニアリングループの1イテレーション**を実行します。
GitHub は「バックログ・状態・監査」の層です。あなた（ローカルの Claude Code）が実装を担い、
`gh` CLI で GitHub と連携します。**GitHub Actions 側で Claude を回すことはしません**（API キー課金を避けるため）。

運用仕様の全体像は @docs/loop-engineering.md を参照。以下の手順を**厳密に**守ること。

## 安全レール（絶対に破らない）

- **1イテレーション = 1 Issue**。複数を並行着手しない。
- **main に直接 push / 直接コミットしない**。必ずブランチ + PR。
- **自動マージしない**。CI が緑になったら人間のレビュー待ち（`loop:needs-review`）で止める。
- **force push しない**（自分が今作った feature ブランチへの通常 push のみ）。
- **キューが空なら仕事を捏造しない**。素直に「キュー空」と報告して終了。
- 開始時に **working tree が dirty なら中断**して報告（他の作業を壊さない）。

## 手順

### 0. 前提チェック
- `git status --porcelain` が空でなければ **中断**（「未コミットの変更があるので停止しました」と報告）。
- `git fetch origin` 済ませ、`main` を最新化しておく（まだブランチは切らない）。

### 1. 対象 Issue の選択
- 引数で issue 番号が渡されていればそれを使う。
- 無ければ:
  `gh issue list --label "loop:ready" --state open --json number,title,labels,body`
  から選ぶ。優先度は **loop:p1 > loop:p2 > loop:p3 > ラベル無し**、同順位は **issue番号が小さい方**。
- **Depends-on チェック**: body の「依存 (Depends-on)」に挙がった Issue/PR が未クローズ/未マージなら**その Issue はスキップ**して次点へ。
- 着手可能な Issue が1件も無ければ、**「🟢 loop:ready キューは空です」と報告して終了**。

### 2. 排他ロック（claim）
- `gh issue edit <N> --remove-label "loop:ready" --add-label "loop:in-progress"`
- `gh issue comment <N> --body "🤖 loop が着手しました（ローカル実行）。ブランチ: <branch>"`
- ブランチ作成: `git checkout main && git pull --ff-only && git checkout -b <type>/<slug>-<N>`
  - `<type>` は変更種別（`feat`/`fix`/`docs`/`refactor`）、`<slug>` は内容の短い英小文字ケバブ。
  - 例: `feat/import-filter-atname-42`

### 3. 仕様の把握
- Issue body の **ゴール / 完了条件 / 検証コマンド / 実装の手がかり** を読む。
- 完了条件（Done-when）を、このイテレーションの合格基準として頭に置く。

### 4. 実装
- リポジトリ規約に従う: パーサは手書き再帰下降（`src/core/parser.ts`）。周辺コードの命名・粒度・コメント密度に合わせる。
- **完了条件に回帰テスト追加が含まれるなら必ず追加**（`test/parser.ts` 等）。

### 5. 検証（PR を出す前の必須ゲート）
- Issue の「検証コマンド」を順に実行し、**すべて緑**にする。
- 文法カバレッジ系の Issue なら計測 harness も走らせ、**parse error 数を悪化させない**こと。
- どうしても通らない / 設計判断が要る場合 → **`loop:blocked` に遷移**:
  `gh issue edit <N> --remove-label "loop:in-progress" --add-label "loop:blocked"`
  理由と、試したこと・必要な判断を Issue にコメントして**このイテレーションを終了**（main は汚さない）。

### 6. コミット & PR
- コミットメッセージ規約: `type(scope): 要約` 形式（本リポジトリ準拠、例 `feat(parser): ...`）。
  末尾に:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- `git push -u origin <branch>`
- `gh pr create` — タイトルはコミット要約、本文に:
  - `Closes #<N>`
  - 変更内容（What）と理由（Why）
  - 検証結果（実行したコマンドと結果の要約）
  - 末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

### 7. CI 監視と自己修復
- `gh pr checks <pr番号> --watch` で CI を待つ。
- **赤なら**: `gh run view <run-id> --log-failed` 等で失敗ログを読み、原因を直し、同じブランチに push、再度 watch。
  - 数回試しても直らない / 環境起因で手に負えない → **`loop:blocked`** にして人間へエスカレーション。
- **緑になったら**: Issue を `loop:in-progress` → `loop:needs-review` に遷移:
  `gh issue edit <N> --remove-label "loop:in-progress" --add-label "loop:needs-review"`
  `gh issue comment <N> --body "✅ CI 緑。PR #<pr> をマージレビュー待ちにしました。"`

### 8. 報告
- 最後に**1イテレーションの結果サマリ**を出す: 拾った Issue、作った PR、CI 状態、次にキューに残っている件数
  （`gh issue list --label "loop:ready" --state open` の件数）。
- **マージはしない**。人間がマージ後に Issue は `Closes #N` で自動クローズされる。

## `/loop` で回すときの注意
`/loop 20m /loop-task` のように recurring 実行する場合、各回はこの手順を丸ごと1回実行する。
キューが空・全て blocked のときは何も作らず短く報告して待機すること（暴走・空回りをしない）。
