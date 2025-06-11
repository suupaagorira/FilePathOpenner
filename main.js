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
        removeList: "\"",
        basePath: ""
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
 * Remove specified characters from the start and end of a string.
 *
 * @param {string} str - Target string.
 * @param {string} chars - Characters to remove.
 * @returns {string} Trimmed string.
 */
function trimChars(str, chars) {
    let start = 0;
    while (start < str.length && chars.includes(str[start])) {
        start++;
    }
    let end = str.length - 1;
    while (end >= start && chars.includes(str[end])) {
        end--;
    }
    return str.substring(start, end + 1);
}

/**
 * Format clipboard text into an array of paths.
 *
 * @param {string} text - Raw clipboard text.
 * @param {boolean} asSingle - Treat text as a single path when true.
 * @param {boolean} trimSpaces - Trim surrounding spaces.
 * @param {string} removeList - Characters to strip from the ends.
 * @returns {string[]} Sanitized paths.
 */
function formatClipboardText(text, asSingle, trimSpaces, removeList) {
    if (trimSpaces) {
        text = text.trim();
    }
    if (removeList) {
        text = trimChars(text, removeList);
    }
    if (asSingle) {
        return [text.replace(/\s*\r\s*/g, '').replace(/\s*\n\s*/g, '')];
    }
    return text.replace(/\r/g, '').split('\n');
}

/**
 * Resolve and open a given path or URL.
 *
 * @param {string} inputPath - Path or URL to open.
 * @param {boolean} openParent - Open the parent when true.
 * @param {string} basePath - Prefix for relative paths.
 */
function openTargetPath(inputPath, openParent, basePath) {
    let targetPath = inputPath;

    if (basePath && !/^https?:\/\//i.test(targetPath) && !path.isAbsolute(targetPath)) {
        targetPath = path.join(basePath, targetPath);
    }

    const isHttpUrl = /^https?:\/\//i.test(targetPath);

    if (openParent) {
        if (isHttpUrl) {
            try {
                const u = new URL(targetPath);
                u.pathname = u.pathname.replace(/\/[^/]*$/, '');
                targetPath = u.toString();
            } catch {
                // ignore
            }
        } else {
            targetPath = targetPath.replace(/[\\/][^\\/]*$/, '');
        }
    }

    if (!targetPath) return;

    if (isHttpUrl) {
        shell.openExternal(targetPath);
        return;
    }

    const result = findExistingPath(targetPath);
    if (!result) {
        dialog.showErrorBox('存在しないパス', `"${targetPath}" は存在しないパスです。`);
        return;
    }

    const { path: finalPath, levels } = result;
    if (levels > 0) {
        dialog.showMessageBox({
            type: 'info',
            message: `"${targetPath}" は存在しません。${levels} 階層上の "${finalPath}" を開きます。`,
            buttons: ['OK'],
        });
    }
    if (process.platform === 'win32') {
        exec(`start \"\" \"${finalPath}\"`);
    } else {
        shell.openPath(finalPath);
    }
}

/**
 * Parse clipboard paths and open them. When a base path is configured, it will
 * be prefixed to relative paths before lookup.
 *
 * @param {boolean} openParent - Open the parent directory or URL when true.
 */
function openClipboardPath(openParent) {
    const text = clipboard.readText();

    const openAsSinglePath = store.get("openAsSinglePath");
    const trimSpaces = store.get("trimSpaces");
    const removeList = store.get("removeList");
    const basePath = store.get("basePath");

    const paths = formatClipboardText(text, openAsSinglePath, trimSpaces, removeList);

    paths.forEach((p) => {
        if (!p) return;
        openTargetPath(p, openParent, basePath);
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
