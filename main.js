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
import { execFile } from "child_process";
import Store from "electron-store";

// electron-storeで設定を永続化
const store = new Store({
    defaults: {
        openShortcut: "Ctrl+E",
        openParentShortcut: "Ctrl+Shift+E",
        openAsSinglePath: false,
        trimSpaces: false,
        removeList: "\"",
        basePath: ""
    },
});

let mainWindow = null;
let tray = null;

/**
 * Create a shortcut in the Windows startup folder so the app launches on login.
 *
 * This function has no effect on platforms other than Windows.
 *
 * @returns {void}
 * @throws No exceptions are thrown; failures are shown in an error dialog.
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
 * Determine whether a startup shortcut already exists.
 *
 * On platforms other than Windows this always returns `false`.
 *
 * @returns {boolean} `true` when the shortcut file exists.
 * @throws No exceptions are thrown.
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
 * Remove the startup shortcut from the Windows startup folder.
 *
 * This function does nothing on non-Windows platforms.
 *
 * @returns {void}
 * @throws No exceptions are thrown; failures are shown in an error dialog.
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
 * Find the nearest existing directory by traversing upwards.
 *
 * @param {string} targetPath - Path to validate.
 * @returns {{path: string, levels: number}|null} Existing path and distance or null.
 */
function findExistingPath(targetPath) {
    let current = targetPath;
    let levels = 0;
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
        levels += 1;
    }
    return { path: current, levels };
}

/**
 * Parse clipboard text and open the referenced file paths or URLs.
 * When a base path is configured, it is prefixed to relative paths before lookup.
 *
 * @param {boolean} openParent - If `true`, open the parent directory or URL instead.
 * @returns {void}
 * @throws No exceptions are thrown; invalid paths trigger error dialogs.
 */
function openClipboardPath(openParent) {
    let text = clipboard.readText();

    // 設定取得
    const openAsSinglePath = store.get("openAsSinglePath");
    const trimSpaces = store.get("trimSpaces");
    const removeList = store.get("removeList");
    const basePath = store.get("basePath");

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

        if (basePath && !/^https?:\/\//i.test(targetPath) && !path.isAbsolute(targetPath)) {
            targetPath = path.join(basePath, targetPath);
        }

        let isHttpUrl = /^https?:\/\//i.test(targetPath);

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
                targetPath = targetPath.replace(/[\\\\/][^\\\\/]*$/, "");
            }
        }

        if (!targetPath) return;

        if (isHttpUrl) {
            shell.openExternal(targetPath);
            return;
        }

        const result = findExistingPath(targetPath);
        if (!result) {
            dialog.showErrorBox("存在しないパス", `\"${targetPath}\" は存在しないパスです。`);
            return;
        }

        const { path: finalPath, levels } = result;
        if (levels > 0) {
            dialog.showMessageBox({
                type: "info",
                message: `"${targetPath}" は存在しません。${levels} 階層上の "${finalPath}" を開きます。`,
                buttons: ["OK"],
            });
        }
        shell.openPath(finalPath);
    });
}

if (process.env.NODE_ENV !== "test") {
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

    app.on("window-all-closed", (e) => {
        e.preventDefault();
    });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            mainWindow.show();
            mainWindow.setSkipTaskbar(false);
        }
    });
}


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

// テスト用に一部関数を公開
export {
    registerStartupShortcut,
    checkIfStartupRegistered,
    unRegisterStartupShortcut,
    openClipboardPath,
};
