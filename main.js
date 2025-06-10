// main.js
// アプリのメインプロセス。ショートカット登録やタスクトレイ、ウィンドウ生成などを担当。

"use strict";

import {
    app,
    BrowserWindow,
    globalShortcut,
    Menu,
    Tray,
    nativeImage,
    ipcMain,
    dialog,
    clipboard,
    shell
} from "electron";
import path from "path";
import fs from "fs";
import { exec, execFile } from "child_process";
import Store from "electron-store";

// electron-storeで設定を永続化
const store = new Store({
    defaults: {
        openShortcut: "Ctrl+E",
        openParentShortcut: "Ctrl+Shift+E",
        openAsSinglePath: false,
        trimSpaces: false,
        removeList: "\""
    },
});

let mainWindow = null;
let tray = null;

/**
 * Windowsスタートアップフォルダにショートカットを作成
 * (Windows以外では動作しません)
 */
function registerStartupShortcut() {
    if (process.platform !== "win32") return;

    try {
        // Windowsのスタートアップフォルダを取得
        const startupFolder = path.join(
            process.env.APPDATA,
            "Microsoft",
            "Windows",
            "Start Menu",
            "Programs",
            "Startup"
        );

        // Electronの実行ファイルパス (node.exeなど) 
        const exePath = process.execPath;

        // lnkファイルの配置先を作成
        const shortcutPath = path.join(startupFolder, "FilePathOpenner.lnk");

        // PowerShellを使ったショートカット作成
        // execFile 第2引数に配列で渡すと、文字列エスケープトラブルが減ります
        execFile(
            "powershell",
            [
                "-Command",
                `$s = (New-Object -COM WScript.Shell).CreateShortcut('${shortcutPath}');
                $s.TargetPath = '${exePath}';
                $s.Save();`
            ],
            (error) => {
                if (error) {
                    dialog.showErrorBox("スタートアップ登録エラー", error.message);
                }
            }
        );
    } catch (err) {
        dialog.showErrorBox("スタートアップ登録エラー", err.toString());
    }
}

/**
 * スタートアップにショートカットが存在するかチェック
 * (Windows以外では常に false)
 */
function checkIfStartupRegistered() {
    if (process.platform !== "win32") return false;

    const startupFolder = path.join(
        process.env.APPDATA,
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Startup"
    );
    const shortcutPath = path.join(startupFolder, "FilePathOpenner.lnk");

    return fs.existsSync(shortcutPath);
}

/**
 * スタートアップフォルダのショートカットを削除
 * (Windows以外では何もしない)
 */
function unRegisterStartupShortcut() {
    if (process.platform !== "win32") return;

    try {
        const startupFolder = path.join(
            process.env.APPDATA,
            "Microsoft",
            "Windows",
            "Start Menu",
            "Programs",
            "Startup"
        );
        const shortcutPath = path.join(startupFolder, "FilePathOpenner.lnk");

        if (fs.existsSync(shortcutPath)) {
            fs.unlink(shortcutPath, (err) => {
                if (err) {
                    dialog.showErrorBox("スタートアップ削除エラー", err.message);
                } else {
                    // 削除成功時の処理があればここに書く
                }
            });
        }
    } catch (err) {
        dialog.showErrorBox("スタートアップ削除エラー", err.toString());
    }
}

/**
 * メインウィンドウ生成
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 880,
        height: 700,
        webPreferences: {
            preload: path.join(app.getAppPath(), "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
        menu: null,
    });
    mainWindow.setMenuBarVisibility(false);

    mainWindow.loadFile(path.join(app.getAppPath(), "index.html"));

    // xボタン等でウィンドウが閉じられそうになったら、実際には閉じずにタスクトレイへ
    mainWindow.on("close", (event) => {
        event.preventDefault();
        mainWindow.hide();
        mainWindow.setSkipTaskbar(true);

        // タスクトレイへ隠す旨をユーザーへ通知
        dialog.showMessageBox({
            type: "info",
            message: "FilePathOpennerが実行中です。タスクトレイから操作してください。",
            buttons: ["OK"],
        });
    });
}

/**
 * グローバルショートカットの登録を行う
 */
function registerGlobalShortcuts() {
    globalShortcut.unregisterAll();

    // クリップボードのパスを開く
    const openShortcut = store.get("openShortcut");
    if (openShortcut) {
        globalShortcut.register(openShortcut, () => {
            openClipboardPath(false);
        });
    }

    // 1階層上ディレクトリを開く
    const openParentShortcut = store.get("openParentShortcut");
    if (openParentShortcut) {
        globalShortcut.register(openParentShortcut, () => {
            openClipboardPath(true);
        });
    }
}

/**
 * クリップボード上のパスを解析し、(openParent=trueの場合)末尾ディレクトリを削除して開く
 */
function openClipboardPath(openParent) {
    let text = clipboard.readText();

    // 設定取得
    const openAsSinglePath = store.get("openAsSinglePath");
    const trimSpaces = store.get("trimSpaces");
    const removeList = store.get("removeList");

    // 前後の空白をトリム
    if (trimSpaces) {
        text = text.trim();
    }

    // ユーザーが指定した文字(removeList)を先頭・末尾から除去
    function trimSpecial(str, chars) {
        let startIdx = 0;
        while (startIdx < str.length && chars.includes(str[startIdx])) {
            startIdx++;
        }
        let endIdx = str.length - 1;
        while (endIdx >= 0 && chars.includes(str[endIdx])) {
            endIdx--;
        }
        return str.substring(startIdx, endIdx + 1);
    }
    if (removeList) {
        text = trimSpecial(text, removeList);
    }

    // 1つのパスとして開く or 改行区切りで複数開く
    let paths = [];
    if (openAsSinglePath) {
        const singleLine = text.replace(/\s*\r\s*/g, "").replace(/\s*\n\s*/g, "");
        paths = [singleLine];
    } else {
        const splitted = text.replace(/\r/g, "").split("\n");
        paths = splitted.map((line) => line);
    }

    // 実際にパスを開く
    paths.forEach((p) => {
        if (!p) return; // 空文字はスキップ

        let targetPath = p;

        const isHttpUrl = /^https?:\/\//i.test(targetPath);

        if (openParent) {
            if (isHttpUrl) {
                try {
                    const u = new URL(targetPath);
                    u.pathname = u.pathname.replace(/\/[^/]*$/, "");
                    targetPath = u.toString();
                } catch (err) {
                    // URL parsing failed, fall back to original
                }
            } else {
                // スラッシュ/バックスラッシュの最後から後ろを切り落とし
                targetPath = p.replace(/[\\\\/][^\\\\/]*$/, "");
            }
        }

        if (!targetPath) return;

        if (isHttpUrl) {
            shell.openExternal(targetPath);
            return;
        }

        // 存在確認
        if (!fs.existsSync(targetPath)) {
            dialog.showErrorBox("存在しないパス", `\"${targetPath}\" は存在しないパスです。`);
            return;
        }

        // Windowsならexplorer.exe、Mac/Linuxならshell.openPathなど
        if (process.platform === "win32") {
            exec(`start \"\" \"${targetPath}\"`);
        } else {
            shell.openPath(targetPath);
        }
    });
}

app.whenReady().then(() => {
    createWindow();

    // タスクトレイアイコンの設定
    const iconPath = path.join(app.getAppPath(), "icon.png"); // 任意のアイコンを用意
    let trayImage = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(trayImage);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: "設定画面を開く",
            click: () => {
                mainWindow.show();
                mainWindow.setSkipTaskbar(false);
            },
        },
        {
            label: "ソフトを終了する",
            click: () => {
                app.exit(0);
            },
        },
    ]);
    tray.setToolTip("FilePathOpenner");
    tray.setContextMenu(contextMenu);

    // グローバルショートカット登録
    registerGlobalShortcuts();
});

// 全ウィンドウが閉じてもアプリ自体は終了させずタスクトレイに隠し続ける
app.on("window-all-closed", (e) => {
    e.preventDefault();
});

// アプリがアクティブになったらウィンドウを表示
app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else {
        mainWindow.show();
        mainWindow.setSkipTaskbar(false);
    }
});

// レンダラからのIPCハンドラ
ipcMain.on("update-settings", (event, newSettings) => {
    store.set(newSettings);
    registerGlobalShortcuts();
    event.returnValue = true;
});

ipcMain.on("register-startup", (event) => {
    registerStartupShortcut();
    event.returnValue = true;
});

ipcMain.handle("check-startup", () => {
    return checkIfStartupRegistered();
});

ipcMain.on("unregister-startup", (event) => {
    unRegisterStartupShortcut();
    event.returnValue = true;
});

// ここで現在の設定を返すIPCハンドラを追加する(レンダラで読み取り用)
ipcMain.handle("get-settings", () => {
    return store.store;
});
