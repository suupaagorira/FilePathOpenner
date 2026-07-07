# API 仕様書

本アプリはメイン - レンダラ間で以下の IPC ハンドラおよび `preload` 経由で提供される API を使っています。ここではそれらの API と挙動を説明します。

> 補足: `preload` はサンドボックス環境では ES Modules を利用できないため、CommonJS 形式の `preload.cjs` で実装しています。

## contextBridge: window.electronAPI （`preload.cjs`）
- `updateSettings(settings)` (sync)
  - 説明: 設定オブジェクトをメインプロセスに送信し、`electron-store` に保存する。メインプロセス側でグローバルショートカットを再登録する。
  - 引数: settings (Object)
  - 戻り値: `{ ok: boolean, shortcutFailures: string[] }`。`shortcutFailures` には登録に失敗したアクセラレータ（他アプリと競合したキー等）が入る。

- `registerStartup()` (sync)
  - 説明: Windows のスタートアップフォルダにショートカットを作成する処理をメインプロセスで実行する。
  - 戻り値: 同期応答（true）

- `checkStartup()` (async)
  - 説明: Windows のスタートアップフォルダにアプリのショートカットが存在するかを確認する。
  - 戻り値: boolean

- `unRegisterStartup()` (sync)
  - 説明: スタートアップに登録されたショートカットを削除する。

- `getSettings()` (async)
  - 説明: 現在の設定（electron-store の中身）を返す。
  - 戻り値: 設定オブジェクト

- `previewPaths(text, openParent)` (async)
  - 説明: 実際には開かず、`text` を現在の設定で解析した結果（動作テスト用のドライラン）を返す。
  - 戻り値: エントリ配列。各要素は `{ input, target, isUrl, kind, openPath, levels, isDirectory }`。
    `kind` は `"url"` / `"exact"`（存在するパス）/ `"fallback"`（親へさかのぼって開く）/ `"missing"`（見つからない）のいずれか。

- `openText(text, openParent)` (async)
  - 説明: 指定した `text` を、クリップボードを開くのと同じ経路で実際に開く（動作テストパネルの「この内容で開く」）。

- `getClipboardText()` (async)
  - 説明: 現在のクリップボードのテキストを返す（動作テストパネルの読み込み用）。

- `pickFolder()` (async)
  - 説明: フォルダ選択ダイアログを開き、選択されたパスを返す（前提パスの「参照…」）。キャンセル時は `null`。

- `getAppInfo()` (async)
  - 説明: `{ version, platform, shortcutFailures }` を返す。プラットフォーム判定（スタートアップ機能の可否）や、起動時点でのショートカット登録失敗の表示に使う。

## ipcMain ハンドラ（`main.js`）
- `ipcMain.on('update-settings', handler)`
  - 更新処理: `store.set(newSettings)` を呼び出し、`registerGlobalShortcuts()` を実行して、`{ ok, shortcutFailures }` を同期返却する。

- `ipcMain.on('register-startup', handler)`
  - `registerStartupShortcut()` を呼ぶ。PowerShell 経由で `.lnk` を作成する。

- `ipcMain.handle('check-startup', handler)`
  - `checkIfStartupRegistered()` を呼び出し、`boolean` を返す。

- `ipcMain.on('unregister-startup', handler)`
  - `unRegisterStartupShortcut()` を呼び出す。

- `ipcMain.handle('get-settings', handler)`
  - `store.store` を返す。

- `ipcMain.handle('preview-paths', handler)`
  - `previewClipboardText(text, openParent)` の結果（開かずに解析したドライラン）を返す。

- `ipcMain.handle('open-text', handler)`
  - `openTextTargets(text, openParent)` を呼び、指定テキストを実際に開く。

- `ipcMain.handle('get-clipboard-text', handler)`
  - `clipboard.readText()` を返す。

- `ipcMain.handle('pick-folder', handler)`
  - フォルダ選択ダイアログを開き、選択パス（またはキャンセル時 `null`）を返す。

- `ipcMain.handle('get-app-info', handler)`
  - `{ version, platform, shortcutFailures }` を返す。

## ショートカットの登録方式（`main.js` / `doubleTap.js`）
- 通常のアクセラレータ（`Ctrl+E` など）は Electron の `globalShortcut` で登録します。
- `Alt×2` / `Shift+Alt×2` のような **修飾キー 2 連打アクセラレータ**（末尾が `×2`）は `globalShortcut` では扱えないため、
  `uiohook-napi` のグローバルキーフックに接続した検出器（`doubleTap.js`）で処理します。
  - `isDoubleTapAccelerator(accel)` — 2 連打表記かを判定。
  - `parseDoubleTapAccelerator(accel)` — `{ tapKey, mods }` に解析（無効なら `null`）。
  - `createDoubleTapDetector()` — keydown / keyup を受け取り、同じ修飾キーが 400ms 以内に
    クリーンに 2 回タップされ、押しっぱなしの修飾キーがバインドと一致したときにハンドラを呼ぶ。
  - キーフックは 2 連打バインドが 1 つ以上あるときだけ起動し、なくなれば停止します。

## main.js の公開関数（テスト用）
- `registerStartupShortcut()`
- `checkIfStartupRegistered()`
- `unRegisterStartupShortcut()`
- `registerGlobalShortcuts()` — 設定中の 3 つのショートカットを登録し直し、失敗したアクセラレータの配列を返す。
- `openClipboardPath(openParent, options)` — クリップボードを読み取って開く。`options.readOnly` で読み取り専用オープン。
- `openTextTargets(text, openParent, options)` — 任意テキストを解析して実際に開く。`options.readOnly` 対応。
- `openPathReadOnly(finalPath)` — 拡張子に応じて Excel / Word / PowerPoint を COM 経由（PowerShell、
  `Workbooks.Open(..., ReadOnly:=true)` 等）で読み取り専用起動する。対象外の拡張子や非 Windows では
  `shell.openPath` にフォールバックする。
- `resolveClipboardTargets(text, settings, openParent)` — テキストを整形・分割し、開くターゲットの配列に解決する（開く手前まで）。
- `previewClipboardText(text, openParent)` — 開かずに、各行の解析結果（`kind` 付き）を返す。
- `applyPrefixRules(text, rules)`

`resolveClipboardTargets` / `openTextTargets` は次のオプションに基づいて動作します:
- `trimSpaces` (true の場合は前後の空白を trim)
- `removeList` (先頭・末尾から除去するカスタム文字リスト)
- `openAsSinglePath` (true の場合は改行を連結して 1 本のパスにする)
- `prefixRules` (先頭パターン一致時に結合して開くルール配列)
- `basePath` (相対パスに前提となるパスを付与)

整形（trim / removeList）→ 行分割または結合 → プレフィックスルール → 前提パス付加 →（`openParent` の場合）親への変換、の順で適用されます。

`applyPrefixRules(text, rules)` は、クリップボードの 1 行 `text` を `rules`（`{ prefix, base, stripPrefix }` の配列）と先頭一致で照合します。
`http(s)://` で始まる URL や `path.isAbsolute` で絶対パスと判定される文字列にはルールを適用せず、`{ target: text, matched: false }` を返します。
最初にマッチしたルールについて、`stripPrefix` が `true` なら先頭パターンを取り除いた残りを、そうでなければ `text` 全体を `base` と連結し、`{ target, matched: true }` を返します。
どのルールにもマッチしない場合は `{ target: text, matched: false }` を返します。解析経路では `matched` のとき `basePath` の付加より優先されます。

以上がメインで使われている API の一覧と契約（引数、戻り値）になります。必要に応じて追加の IPC チャンネルを設けることができます（ロギング、アップデートなど）。
