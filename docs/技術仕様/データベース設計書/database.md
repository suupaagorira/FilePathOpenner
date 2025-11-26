# データベース設計書（代替: 設定ストア）

このアプリは RDB などのデータベースを使用していません。代わりに、`electron-store` を利用してユーザー設定を JSON 形式でローカルに保存しています。ここではそのスキーマと保存位置、運用上の留意点を記載します。

## 保存される設定項目（`defaults`）
- `openShortcut`: string. 例 `Ctrl+E`。
- `openParentShortcut`: string. 例 `Ctrl+Shift+E`。
- `openAsSinglePath`: boolean. 改行を1行にするか。
- `trimSpaces`: boolean. トリムするか。
- `removeList`: string. 前後除去する文字のリスト。
- `basePath`: string. 相対パスに付与するベースパス。

## 保存場所
- `electron-store` のデフォルトに準拠し、Windows の場合は `C:\Users\<ユーザー>\AppData\Roaming\<アプリ名>\config.json` のようなユーザー用ストアに保存されます。

## 運用・管理上の注意
- 企業等で設定の一括配布を行う際、ユーザー単位の設定ファイルをサンプルとして提供できます（ただし、パス、ポリシー等は環境に合わせてカスタマイズしてください）。
- バックアップおよび移行手順: `electron-store` の設定 JSON をエクスポート/インポートするスクリプトを作ると便利です。
- 設定の変更は renderer 経由で `ipcRenderer.sendSync('update-settings', settings)` より適用され、即時グローバルショートカットにも反映されます。
