# アーキテクチャ図 (概要)

このセクションでは FilePathOpenner の高レベルなアーキテクチャを説明します。コンポーネントは主に Electron の `main`（メインプロセス）と `renderer`（レンダラ）に分かれ、`preload` が安全なブリッジを介してアクセスを提供しています。

## コンポーネント
- main.js (メインプロセス)
  - アプリケーションの起動、ウィンドウ生成、タスクトレイの管理
  - グローバルショートカットの登録/更新（`globalShortcut`）
  - クリップボード読み取り (`clipboard`) とパス探索/オープン
  - Windows スタートアップ登録（PowerShell）
  - IPC (ipcMain) でレンダラからの操作を受け付ける

- preload.js
  - `contextBridge` を使って renderer に安全な API を提供
  - `window.electronAPI` 経由で設定の読み書きやスタートアップ登録を行う

- renderer.js
  - UI のイベント処理（ボタン、チェック、テキスト入力）
  - `electronAPI` を呼び出して設定の取得・保存、スタートアップ操作を行う

- electron-store
  - ユーザー設定の永続化（`openShortcut`, `openParentShortcut`, `openAsSinglePath`, `trimSpaces`, `removeList`, `basePath`）

## データフロー
1. ユーザーがショートカットキーを押す
2. main プロセスで `globalShortcut` の登録イベントが捕捉され、`openClipboardPath` が実行
3. `openClipboardPath` が `clipboard.readText()` を使ってテキスト取得、オプションを適用し、パスや URL を特定
4. `shell.openPath` または `shell.openExternal` で実際にパスや URL を開く
5. UI からの設定操作は `ipcRenderer` → `ipcMain` 経由で `electron-store` に保存される

## 簡易図 (ASCII)

Main (main.js)
  ├─ globalShortcut
  ├─ Tray
  ├─ BrowserWindow (index.html + renderer.js)
  ├─ IPC (ipcMain) <-> Preload (ipcRenderer)
  └─ electron-store

Renderer (index.html + renderer.js)
  ├─ UI
  └─ electronAPI (exposed via preload.js)

## 備考
- ネットワーク通信はほとんど発生しません。URL を `openExternal` する際に外部ブラウザを呼び出すのみです。
- もしログや監視が必要なら、`main.js` にロギング機構を追加してください（例: `winston` や環境別にファイル出力）。
