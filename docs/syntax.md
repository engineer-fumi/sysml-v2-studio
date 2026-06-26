# 対応する SysML v2 記法と制限事項

## 言語サポート

- シンタックスハイライト(TextMate 文法)
- リアルタイム構文診断(「問題」パネル・波線)
- **意味検証**(SysIDE 相当):
  - 未解決参照(型・特化・再定義・connect / flow の端・遷移先・accept の
    シグナル・メタデータ等)
  - 重複名(同一スコープ、トップレベルのグローバル衝突)
  - 型付け / 特化の種類整合(part は part def で型付け 等)
  - 継承メンバーの隠蔽検出(`:>>` による再定義を提案)
  - import の可視性(public / private)明示チェック
  - 診断レベルは設定 `sysml.validation.*` で error / warning / off に変更可能
- **標準ライブラリの最小サブセットを同梱**(`ScalarValues` / `ISQ` / `SI` /
  基本 def 群)。import で解決し、F12 で同梱ライブラリへジャンプ可能。
  `public import` は推移的に再エクスポートされます
- 補完: キーワード / スニペット / ワークスペース全ファイルの要素名
- アウトライン(階層シンボル・パンくず)
- 定義へ移動(F12、ファイル横断)/ ホバー(種別・限定名・型・`doc`)

## 対応している記法(サブセット)

`package` / `part def` / `part` / `attribute` / `port` / `item` / `action` /
`state` / `transition` / `requirement` / `constraint` / `interface` /
`connection` / `connect` / `bind` / `flow` / `import` / `alias` / `doc` /
`enum` / `use case` / `perform` / `exhibit` / `satisfy` /
`@Metadata` 注釈 / `#metadata` プレフィックス / `filter` / `individual def` /
特化 (`:>`, `specializes`, `subsets`) / 再定義 (`:>>`, `redefines`) /
多重度 (`[n..m]` + `ordered` / `nonunique`) / 値 (`= expr`) /
方向 (`in` / `out` / `inout`) など。

未対応の構文はエラー回復しながら読み飛ばすため、部分的なモデルでも動作します。
OMG 仕様付録 A の `SimpleVehicleModel` は構文上は全文をパースできます。

## 制限事項

- パーサは OMG SysML v2 仕様の実用的なサブセットです(KerML 固有層の
  classifier / feature 等は未対応)。式(constraint / calc の本体)は不透明
  テキストとして扱い、式の型チェックは行いません
- 名前解決はスコープ・import・継承メンバーを考慮した近似実装です。可視性
  (private / protected)は完全には強制しません
- 同梱の標準ライブラリは最小サブセットです(完全な OMG ライブラリではありません)
- 図のリネームは宣言名のみ変更します(参照箇所は追従しません)
