# トラブルシューティングガイド

## 1. アプリが起動しない
- 確認: `npm install` が成功しているか、`node_modules/` が存在するか
- 確認: `npm start` を実行して表示されるエラーを確認
- Windows: `powershell` コマンドが PATH にあるかを確認

## 2. グローバルショートカットが登録されない
- 競合: ほかのアプリが同じショートカットを使用している可能性があるため、別のキーに変更して再登録してください。
- 権限: 管理者権限が必要になるケースがあるため、管理者権限で起動/テストしてください。Windows のショートカット API 操作に必要な許可があるか確認。

## 3. スタートアップ登録が失敗する
- PowerShell 実行ポリシー制限が原因かもしれません。`Get-ExecutionPolicy` や `Set-ExecutionPolicy` を利用して制御してください（組織ポリシーに注意）。
- `process.execPath` が指す実行ファイルがアクセス可能かを確認。

## 4. ファイルが開けない / 対象の階層に移動する
- `openClipboardPath` では指定パスが見つからない場合、親ディレクトリを順に辿って最も近い既存のパスを開く実装です。
- 期待するパスと別の階層が開く場合、`basePath` 設定や `trimSpaces`、`removeList` の内容を確認してください。

## 5. ロギングや詳細のデバッグ出力を追加したい
- 既存コードにログ出力を追加: `main.js` の重要な関数に `console.log` を追加してください。
- もっと本格的なロギングが必要なら `winston` や `electron-log` などを導入して `main.js` にファイルロギングを追加することを推奨します。

## 6. ビルド時にアイコンが見つからない
- `package.json` の `build.win.icon` と `files` に指定された `icon.png` が存在するか確認してください。
- ビルドプロセスのログ（electron-builder）を参照し、エラー内容に応じて修正してください。

## 追加の診断手順
1. 開発モードで起動して `main.js` の `openClipboardPath` に `console.log` を追加して挙動を確認
2. 単体テストの実行

```pwsh
npm test
```

3. `__tests__/renderer.test.js` にあるように、DOM のセットアップや `preload` の API 呼び出しをモックしてレンダラ処理を確認できます。
