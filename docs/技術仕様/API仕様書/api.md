# API 仕様書

本アプリはメイン - レンダラ間で以下の IPC ハンドラおよび `preload` 経由で提供される API を使っています。ここではそれらの API と挙動を説明します。

## contextBridge: window.electronAPI （`preload.js`）
- `updateSettings(settings)` (sync)
  - 説明: 設定オブジェクトをメインプロセスに送信し、`electron-store` に保存する。メインプロセス側でグローバルショートカットを再登録する。
  - 引数: settings (Object)
  - 戻り値: 同期応答（true を戻す実装）

- `registerStartup()` (sync)
  - 説明: Windows のスタートアップフォルダにショートカットを作成する処理をメインプロセスで実行する。
  - 引数: なし
  - 戻り値: 同期応答（true を戻す実装）

- `checkStartup()` (async)
  - 説明: Windows のスタートアップフォルダにアプリのショートカットが存在するかを確認する。
  - 引数: なし
  - 戻り値: boolean

- `unRegisterStartup()` (sync)
  - 説明: スタートアップに登録されたショートカットを削除する。
  - 引数: なし

- `getSettings()` (async)
  - 説明: 現在の設定（electron-store の中身）を返す。
  - 戻り値: 設定オブジェクト

## ipcMain ハンドラ（`main.js`）
- `ipcMain.on('update-settings', handler)`
  - 更新処理: store.set(newSettings) を呼び出し、`registerGlobalShortcuts()` を実行する。

- `ipcMain.on('register-startup', handler)`
  - 更新処理: `registerStartupShortcut()` を呼ぶ。PowerShell 経由で `.lnk` を作成する。

- `ipcMain.handle('check-startup', handler)`
  - 動作: `checkIfStartupRegistered()` を呼び出し、`boolean` を返す。

- `ipcMain.on('unregister-startup', handler)`
  - 動作: `unRegisterStartupShortcut()` を呼び出す。

## main.js の公開関数（テスト用）
- `registerStartupShortcut()`
- `checkIfStartupRegistered()`
- `unRegisterStartupShortcut()`
- `openClipboardPath(openParent)`

`openClipboardPath` は次のオプションに基づいて動作します:
- `openAsSinglePath` (true の場合は改行を連結)
- `trimSpaces` (true の場合は trim)
- `removeList` (カスタムの除去文字リスト)
- `basePath` (相対パスに前提となるパスを付与)

以上がメインで使われている API の一覧と契約（引数、戻り値）になります。必要に応じて追加の IPC チャンネルを設けることができます（ロギング、アップデートなど）。
