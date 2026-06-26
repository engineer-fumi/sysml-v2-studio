# OMG 公式 SysML v2 サンプルモデル

このフォルダのモデルは OMG の **SysML v2 Release** リポジトリに含まれる
公式サンプルをそのまま取り込んだものです（内容は無改変）。

- 出典: https://github.com/Systems-Modeling/SysML-v2-Release
  （`sysml/src/examples/` 以下、コミット `9baca5908ca2` / 2026-05-14 時点）
- ライセンス: **Eclipse Public License v2.0**
  （https://github.com/Systems-Modeling/SysML-v2-Release/blob/master/LICENSE）
- このフォルダ以外の本リポジトリのコードは MIT ライセンスです

## 収録ファイル

| ファイル | 出典フォルダ | 題材 |
|---|---|---|
| Camera.sysml / PictureTaking.sysml | Camera Example | カメラ: perform によるアクション参照 |
| Flashlight Example.sysml | Flashlight Example | 懐中電灯: port / interface / succession flow |
| Packets.sysml / PacketUsage.sysml | Packet Example | パケット: attribute def / 特化 |
| RoomModel.sysml | Room Model | 部屋: port 定義・共役 port・interface 接続 |
| MassRollup.sysml / Vehicles.sysml / MassConstraintExample.sysml | Mass Roll-up Example | 質量集計: 抽象 def・再定義・制約 |
| RequirementDerivationExample.sysml / VehicleRequirementDerivation.sysml | Requirements Examples | 要求導出: satisfy / #derivation メタデータ |

## 取り込み基準

公式例のうち、本拡張のパーサ・意味検証で**診断ゼロ**になるものを選んでいます。
以下は今後の対応課題として未収録です:

- `SysML v2 Spec Annex A SimpleVehicleModel.sysml` — 仕様付録 A の包括モデル
  (構文は全文パース可能になったが、深いフィーチャチェーン等の
  意味解決に未解決警告が残るため)
- `VehicleDefinitions/Usages/Individuals.sysml` (Vehicle Example) —
  既存サンプル `vehicle-project` とパッケージ名が衝突するため
- `HSUVRequirements.sysml` — 別ライブラリの要求種別定義に依存するため
