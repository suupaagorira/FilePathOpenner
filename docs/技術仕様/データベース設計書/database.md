# データベース設計書（代替: 設定ストア）

このアプリは RDB などのデータベースを使用していません。代わりに、`electron-store` を利用してユーザー設定を JSON 形式でローカルに保存しています。ここではそのスキーマと保存位置、運用上の留意点を記載します。

## 保存される設定項目（`defaults`）
- `openShortcut`: string. 既定 `Ctrl+E`。
- `openParentShortcut`: string. 既定 `Ctrl+Shift+E`。
- `openAsSinglePath`: boolean. 改行を 1 行に結合するか。既定 `true`。
- `trimSpaces`: boolean. 前後の空白をトリムするか。既定 `true`。
- `removeList`: string. 前後から除去する文字のリスト。既定 `<>＜＞()（）[]「」{}｛｝"”'’`。
- `basePath`: string. 相対パスに付与するベースパス。既定は空文字。
- `prefixRules`: Array. 先頭パターン一致で結合して開くルール（`{ prefix, base, stripPrefix }` の配列）。既定は空配列。
- `trayNoticeShown`: boolean. 「閉じるとトレイに常駐する」旨を初回通知済みかどうかの内部フラグ。既定 `false`。

> 注: `electron-store` の `defaults` は「設定ファイルにまだ存在しないキー」にのみ適用されます。旧バージョンから既に `config.json` を持つユーザーは、新しい既定値では上書きされず、既存の値が維持されます。

## 保存場所
- `electron-store` のデフォルトに準拠し、Windows の場合は `C:\Users\<ユーザー>\AppData\Roaming\<アプリ名>\config.json` のようなユーザー用ストアに保存されます。

## 運用・管理上の注意
- 企業等で設定の一括配布を行う際、ユーザー単位の設定ファイルをサンプルとして提供できます（ただし、パス、ポリシー等は環境に合わせてカスタマイズしてください）。
- バックアップおよび移行手順: `electron-store` の設定 JSON をエクスポート/インポートするスクリプトを作ると便利です。
- 設定の変更は renderer 経由で `ipcRenderer.sendSync('update-settings', settings)` より適用され、即時グローバルショートカットにも反映されます。
