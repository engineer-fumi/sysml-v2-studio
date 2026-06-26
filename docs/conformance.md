# OMG SysML v2 対応範囲 (conformance matrix)

> 対象バージョン: **v0.7.1** / 最終更新: **2026-06-27**

本拡張は OMG SysML v2 テキスト記法の**実用サブセット**を実装しています。この
ページは「どの言語領域を、どこまで扱えるか」をコードに基づいて棚卸ししたものです。
各レベルの根拠となるソースをそのまま示しているので、過大申告はありません。曖昧な
領域は Partial / Parse-only / None を明示しています。

## 対応レベルの定義

| レベル | 意味 |
|---|---|
| **Full** | パースし、意味検証(型整合・解決など)を行い、図に可視化する |
| **Partial** | パースし一部を検証/可視化するが、内部(式・効果・制御フロー本体)は不透明テキストとして扱う |
| **Parse-only** | 構文として受理する(エラーにしない)が、検証・可視化はしない |
| **None** | 未対応(エラー回復で読み飛ばす) |

> ⚠️ ここで「対応」と書けるのは、実際に**パース / 検証 / 可視化できる**ものだけです。
> 未対応の構文はパーサのエラー回復(`src/core/parser.ts` の `recover()`)で読み飛ばす
> ため、部分的なモデルでも全体は動作します。

## 要約

| 言語領域 | 対応レベル | 根拠 (コード) |
|---|---|---|
| Definitions & Usages (part / item / attribute / port / action / state / …) | **Full** | `parser.ts` `DEF_KINDS`、`validate.ts` `TYPE_CONFORMANCE`、`viewSpecs.ts` `BOX_KINDS`/`TEXT_KINDS` |
| Specialization (`:>` subsets / `:>>` redefines / `specializes` / `subsets` / `redefines` / `::>` references) | **Full** | `parser.ts` `parseDeclarationTail`、`validate.ts` `KIND_GROUP` + shadowing 検出 |
| Connections / Interfaces / Bindings / Flows | **Full**(構造) | `parser.ts` `parseConnectBody`/`parseBind`/`parseFlow`、`viewSpecs.ts` `isEdgeElement` |
| States & Transitions (trigger / guard / effect) | **Partial** | `parser.ts` `parseTransition`(trigger/guard はテキスト、`do` 効果は破棄) |
| Actions / Calc / Successions | **Partial** | `parser.ts`(制御フロー文は `parseOpaqueStatement` で不透明) |
| Requirements / Constraints / satisfy・verify | **Full**(構造)/ 式は不透明 | `parser.ts` `parseReferenceUsage`、`viewSpecs.ts` `req` の `refEdges` |
| Use Cases / Actors / include・perform | **Full** | `parser.ts` `parseReferenceUsage`、`viewSpecs.ts` `uc`(`hoistActors`) |
| Views / Viewpoints / Rendering / expose | **Partial** | `viewSpecs.ts` `view`/`viewpoint`/`rendering` は box 化、`expose`/`render` はレンダリング非実装 |
| Metadata / Annotations (`@`, `#`, `metadata def`) | **Full**(パース) | `parser.ts` `@`/`#` 処理、`validate.ts` metadata ref チェック |
| Expressions(constraint / calc 本体・値・guard など) | **Parse-only(不透明)** | `parser.ts` `captureBracedBody`/`captureUntil`(型チェックなし) |
| Imports / Aliases / Visibility (public / private) | **Partial**(可視性は近似) | `parser.ts` `parseImport`/`parseAlias`、`resolve.ts`(private/protected 非強制) |
| Comments / Documentation (`//`, `/* */`, `doc`, `comment`) | **Full** | `lexer.ts`、`parser.ts` `parseDoc`/`parseComment` |
| Standard Library | **最小サブセット同梱** | `stdlib.ts` `STDLIB_FILES`(完全な OMG ライブラリではない) |
| KerML 基盤層 (classifier / feature / datatype / function / predicate …) | **Parse-only** | `lexer.ts` `KEYWORDS`(KerML 語彙)、`parser.ts` `KERML_KINDS` + 関係節・コネクタ。意味検証・可視化は未対応 |

---

## 詳細

### Definitions & Usages — Full

`part` / `attribute` / `port` / `item` / `action` / `state` / `requirement` /
`constraint` / `interface` / `connection` / `allocation` / `analysis` /
`verification` / `concern` / `view` / `viewpoint` / `rendering` / `enum` /
`occurrence` / `metadata` / `calc` / `case` / `flow` の各 `def` とその usage
(`parser.ts` の `DEF_KINDS`)。`use case [def]` は複合キーワード、`individual def`
は `occurrence def` として扱われます。`objective` は `requirement` 扱い。

- **検証**: usage の型付けが正しい def 種別かを `TYPE_CONFORMANCE`(`validate.ts`)で
  チェック(例: `part` は `part def` / `occurrence def` で型付け)。
- **可視化**: `BOX_KINDS` のものはネストした箱、`TEXT_KINDS` のものは親箱内のテキスト行
  (`viewSpecs.ts`)。
- 各 usage には方向(`in` / `out` / `inout`)・多重度(`[n..m]`)・修飾子
  (`abstract` / `variation` / `readonly` / `derived` / `ordered` / `nonunique` …)が付与可能。

### Specialization — Full

`:` / `defined by`(型付け)、`:>` / `specializes` / `subsets`(特化)、
`:>>` / `redefines`(再定義)、`::>` / `references`(参照特化)。
`parser.ts` `parseDeclarationTail` でパースし、`def` 同士の特化は `KIND_GROUP`
(`validate.ts`)で**種類グループの一致**を検証します(例: structure 系は structure 系のみ)。
継承メンバーを同名で隠している場合は shadowing として検出し `:>>` を提案します。

### Connections / Interfaces / Bindings / Flows — Full(構造)

- `connect a.b to c.d` / `connect (a, b, c)`、`connection [name] [: T] connect …`
- `bind x = y` / `binding b bind x = y`
- `flow [name] [of Item] from a.b to c.d`、`message`、`succession flow`
- `interface` / `allocation` も接続として扱い、2 端以上を持つものはエッジ化(`isEdgeElement`)。
- **検証**: フローの端はドット記法で要素内のフィーチャを指すべき、という近似チェックあり
  (`validate.ts` の `flow` 分岐)。
- 端のパス(`engine.fuelPort`)は解決対象として参照に追加されます。

### States & Transitions — Partial

`state def` / `state`、`transition` / `succession` / `first … then …`、状態内の
`entry` / `exit` / `do` アクション。`transition` は source / target / trigger
(`accept …`) / guard(`if …`)を保持します。

- **限界**: trigger / guard は**テキストとして保持**するだけで型チェックしません。
  遷移の効果(`do send … via …`)は不透明テキストとして取り込み、構造化しません。
- **可視化**: `state` 図で状態を箱、`transition` をエッジとして描画(`viewSpecs.ts` `state`)。

### Actions / Calc / Successions — Partial

`action def` / `action`、`calc def` / `calc`、`succession`、状態/アクション本体の
ステップ。

- **限界**: 制御フロー文 — `accept` / `send` / `assign` / `if` / `while` / `loop` /
  `for` / `merge` / `decide` / `fork` / `join` / `return` / `else` / `until` /
  `terminate` / `assert` / `assume` / `require` — は `parseOpaqueStatement`
  (`parser.ts`)で**不透明テキスト**として読み飛ばし、データ/制御フローのセマンティクスは
  構築しません。`calc` 本体も式として不透明です。
- **可視化**: `action` 図でアクションを箱、`succession` / `flow` / `transition` を
  エッジとして描画。

### Requirements / Constraints / satisfy・verify — Full(構造)/ 式は不透明

`requirement [def]` / `constraint [def]` / `concern [def]`、`satisfy` / `verify`
(内部的には `satisfy` 種別)、`assert constraint`、`objective`。

- **限界**: `constraint` / `calc` の `{ … }` 本体は**式として不透明**(`captureBracedBody`)。
  `require` / `assume` / `assert` 文も不透明。
- **可視化**: `req` 図で要求を箱、`satisfy` を参照エッジ(`refEdges`)、`doc` を本文行として描画。

### Use Cases / Actors / include・perform — Full

`use case [def]` / `case [def]`、`perform` / `include`(`perform` 種別)、
`actor` 修飾子。`uc` 図ではユースケースを楕円、actor をボックス外へ引き出して
関連線で結びます(`hoistActors`)。`exhibit state`(状態の提示)も対応。

### Views / Viewpoints / Rendering — Partial

`view [def]` / `viewpoint [def]` / `rendering [def]` は宣言としてパースし箱に
描画します。`expose`(import 類似の参照)もパースします。

- **限界**: ビューの**実レンダリング**(`expose … ; render as …;` によるビュー計算)は
  実装していません。`render` / `rep` / `frame` などは不透明文として扱います。

### Metadata / Annotations — Full(パース)

- `@Metadata`(メタデータ注釈 usage、`about` 対象付き)
- `#metadata`(プレフィックス注釈、次の要素に付与)
- `metadata def`
- **検証**: メタデータ注釈が `metadata def` を参照しているかをチェック(`validate.ts`)。

### Expressions — Parse-only(不透明)

`constraint` / `calc` の本体、`= expr` の値、遷移の trigger / guard、`return` などの
式は**生のテキストとして保持**するだけです(`captureBracedBody` / `captureUntil`)。
式の構文木構築・評価・型チェックは行いません。これは設計上の割り切りです。

### Imports / Aliases / Visibility — Partial(可視性は近似)

- `import P::*` / `import P::**`(再帰)/ `import all` / `import P::X`、`alias A for B`。
- `public import` は名前解決で**推移的に再エクスポート**されます(`resolve.ts` `lookupExported`)。
- **限界**: 可視性(`private` / `protected`)は名前解決で**強制されません**
  (`resolve.ts` 冒頭コメント参照)。private import は再エクスポートされない、という点のみ反映。
- import に可視性が明示されていない場合は lint 警告(`importVisibility`、`validate.ts`)。

### Comments / Documentation — Full

`//` 行コメント、`/* … */` ブロックコメント、`doc /* … */`、`comment … about …`。
`doc` は要素に添付され、ホバー・要求図の本文に表示されます。

### Standard Library — 最小サブセット同梱

`stdlib.ts` の `STDLIB_FILES` として 3 ファイルを同梱:

- **ScalarValues** — `ScalarValue` / `Boolean` / `String` / `Number` / `Real` /
  `Integer` / `Natural` / `Positive` ほか
- **Base 系** — `Base` / `Items` / `Parts` / `Ports` / `Actions` / `States` /
  `Connections` / `Interfaces` / `Allocations` / `Constraints` / `Requirements` /
  `Calculations` / `Cases` / `AnalysisCases` / `VerificationCases` / `UseCases` /
  `Views` / `Metaobjects` / `Flows` / `Occurrences`
- **Quantities 系** — `Quantities` / `ISQ`(質量・長さ・時間 … の値型と usage)/
  `SI`(kg / m / s / A / K …)/ `Time` / `MeasurementReferences` / `SIPrefixes` /
  `ModelingMetadata`(`StatusInfo` / `Risk` / `Rationale` …)/ `RequirementDerivation`

import で解決し、F12 で同梱ライブラリへジャンプできます。**これは完全な OMG 標準
ライブラリではありません** — 関数パッケージ(`BaseFunctions` / `NumericalFunctions`
等)は import 解決用の空パッケージとして存在するだけです。

### KerML 基盤層 — Parse-only

`classifier` / `feature` / `datatype` / `class` / `struct` / `function` /
`predicate` / `metaclass` / `behavior` / `assoc[iation]` / `connector` /
`interaction` / `expr` / `step` / `multiplicity` / `type` などの KerML 定義キーワード
(`lexer.ts` `KEYWORDS` / `parser.ts` `KERML_KINDS`)と、その関係節
(`specializes` / `subsets` / `redefines` / `conjugates` / `typed by` /
`chains` / `crosses` / `disjoint from` / `unions` / `intersects` …)、コネクタ
(`binding`/`connector`/`succession` の `from … to …` / `first … then …` / 多重度)、
`inv` 不変条件、スタンドアロン関係要素(`subtype` / `specialization` / `redefinition` …)
を**パース**します。

- **限界**: ここは**構文受理(parse-only)**で、KerML 固有レベルの意味検証・型推論・
  可視化は行いません。また OMG 公式コーパスでカバレッジを実測していますが、式レベル
  (`->` / `?` 等の演算子)や一部のコネクタ端記法など**未対応の構文も残っています**。
- KerML 語彙を予約語化したため、`step` / `feature` / `type` のように KerML キーワードと
  同名の標準ライブラリ要素も**参照名としては識別子扱い**で解決します
  (`parser.ts` `atNameToken`)。

---

## 既知の限界(まとめ)

- **式は不透明** — constraint / calc 本体、値、guard / trigger は型チェックなしのテキスト。
- **可視性は近似** — private / protected は強制せず、`public import` の再エクスポートのみ反映。
- **制御フローは不透明** — action / state 内の `if` / `loop` / `accept` / `send` などは
  テキストとして読み飛ばす。
- **標準ライブラリは最小サブセット** — 完全な OMG ライブラリではない。
- **図のリネームは宣言名のみ** — 参照箇所は追従しない。
- **KerML 基盤層は parse-only** — 定義・関係・コネクタ・`inv` を構文受理するが、
  意味検証・可視化は未対応。式レベルや一部記法に未対応の構文が残る。

## 関連

- [対応記法と制限事項](syntax.md) — サブセットの概要
- [ダイアグラム機能](diagrams.md) — 図種別ごとの可視化対象
