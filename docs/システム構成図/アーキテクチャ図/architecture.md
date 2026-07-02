# アーキテクチャ図 (概要)

このセクションでは FilePathOpenner の高レベルなアーキテクチャを説明します。コンポーネントは主に Electron の `main`（メインプロセス）と `renderer`（レンダラ）に分かれ、`preload` が安全なブリッジを介してアクセスを提供しています。

## コンポーネント
- main.js (メインプロセス)
  - アプリケーションの起動、ウィンドウ生成、タスクトレイの管理
  - グローバルショートカットの登録/更新（`globalShortcut`）
  - クリップボード読み取り (`clipboard`) とパス探索/オープン
  - Windows スタートアップ登録（PowerShell）
  - IPC (ipcMain) でレンダラからの操作を受け付ける

- preload.cjs
  - `contextBridge` を使って renderer に安全な API を提供
  - `window.electronAPI` 経由で設定の読み書き、スタートアップ登録、動作テスト（preview/open）、クリップボード読取、フォルダ選択、アプリ情報取得を行う
  - サンドボックス preload は ES Modules を使えないため、CommonJS 形式（`.cjs`）で実装している

- renderer.js
  - UI のイベント処理（サイドバーのパネル切り替え、トグルスイッチ、ショートカットレコーダー、変換ルール編集、動作テスト、テキスト入力）
  - `electronAPI` を呼び出して設定の取得・自動保存、スタートアップ操作、ドライラン解析を行う
  - Electron 外（プレーンなブラウザ）で開いた場合はプレビュー用のモック API にフォールバックする

- electron-store
  - ユーザー設定の永続化（`openShortcut`, `openParentShortcut`, `openAsSinglePath`, `trimSpaces`, `removeList`, `basePath`, `prefixRules`, `trayNoticeShown`）

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

Renderer (index.html + styles.css + renderer.js)
  ├─ UI (サイドバーナビゲーション + 6 パネル)
  └─ electronAPI (exposed via preload.cjs)

## 備考
- ネットワーク通信はほとんど発生しません。URL を `openExternal` する際に外部ブラウザを呼び出すのみです。
- もしログや監視が必要なら、`main.js` にロギング機構を追加してください（例: `winston` や環境別にファイル出力）。
