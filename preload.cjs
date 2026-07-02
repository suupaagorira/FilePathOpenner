// preload.cjs
// レンダラープロセス(ブラウザWindow)とメインプロセスを安全にやりとりするため
// (contextIsolation: true の場合、ここで contextBridge を使う)
// NOTE: サンドボックス化された preload では ESM (import/export) が使えないため、
//       このファイルのみ CommonJS 構文 (.cjs) で記述する。

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // 設定を更新して同期的に応答を受け取る（ショートカット登録失敗の一覧を含む）
    updateSettings: (settings) => ipcRenderer.sendSync("update-settings", settings),
    // スタートアップ登録実行
    registerStartup: () => ipcRenderer.sendSync("register-startup"),
    // スタートアップ登録を確認
    checkStartup: () => ipcRenderer.invoke("check-startup"),
    // スタートアップ削除実行
    unRegisterStartup: () => ipcRenderer.sendSync("unregister-startup"),
    // 現在の設定を取得
    getSettings: () => ipcRenderer.invoke("get-settings"),
    // 動作テスト: 開かずに解析結果だけ取得
    previewPaths: (text, openParent) => ipcRenderer.invoke("preview-paths", text, openParent),
    // 動作テスト: 指定テキストを実際に開く
    openText: (text, openParent) => ipcRenderer.invoke("open-text", text, openParent),
    // クリップボードのテキストを取得
    getClipboardText: () => ipcRenderer.invoke("get-clipboard-text"),
    // フォルダ選択ダイアログを開く
    pickFolder: () => ipcRenderer.invoke("pick-folder"),
    // アプリ情報（バージョン・プラットフォーム等）を取得
    getAppInfo: () => ipcRenderer.invoke("get-app-info"),
});
