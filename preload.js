// preload.js
// レンダラープロセス(ブラウザWindow)とメインプロセスを安全にやりとりするため
// (contextIsolation: true の場合、ここで contextBridge を使う)

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // 設定を更新して同期的に応答を受け取る
    updateSettings: (settings) => ipcRenderer.sendSync("update-settings", settings),
    // スタートアップ登録実行
    registerStartup: () => ipcRenderer.sendSync("register-startup"),
    // スタートアップ登録を確認
    checkStartup: () => ipcRenderer.invoke("check-startup"),
    // スタートアップ削除実行
    unRegisterStartup: () => ipcRenderer.sendSync("unregister-startup"),
    // 現在の設定を取得
    getSettings: () => ipcRenderer.invoke("get-settings"),
});
