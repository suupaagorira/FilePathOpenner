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
        openAsSinglePath: true,
        trimSpaces: true,
        removeList: "<>＜＞()（）[]「」{}｛｝\"”'’",
        basePath: "",
        prefixRules: [],
        trayNoticeShown: false
    },
});

let mainWindow = null;
let tray = null;
let lastShortcutFailures = [];

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
                }
            });
        }
    } catch (err) {
        dialog.showErrorBox("スタートアップ削除エラー", err.toString());
    }
}

/**
 * Show and focus the settings window.
 *
 * @returns {void}
 */
function showMainWindow() {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.setSkipTaskbar(false);
    mainWindow.focus();
}

/**
 * Notify the user (once) that closing the window keeps the app in the tray.
 * Windows ではバルーン通知、その他 OS ではダイアログで知らせる。
 *
 * @returns {void}
 */
function notifyTrayResidenceOnce() {
    if (store.get("trayNoticeShown")) return;
    store.set({ trayNoticeShown: true });
    const title = "FilePathOpenner は動作中です";
    const content = "タスクトレイに常駐しています。終了するにはトレイアイコンを右クリックして「終了」を選んでください。";
    if (tray && process.platform === "win32") {
        tray.displayBalloon({ iconType: "info", title, content });
    } else {
        dialog.showMessageBox({ type: "info", message: `${title}\n${content}`, buttons: ["OK"] });
    }
}

/**
 * メインウィンドウ生成
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 960,
        height: 720,
        minWidth: 760,
        minHeight: 560,
        backgroundColor: "#101318",
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(app.getAppPath(), "preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(app.getAppPath(), "index.html"));
    mainWindow.once("ready-to-show", () => mainWindow.show());

    // xボタン等でウィンドウが閉じられそうになったら、実際には閉じずにタスクトレイへ
    mainWindow.on("close", (event) => {
        event.preventDefault();
        mainWindow.hide();
        mainWindow.setSkipTaskbar(true);
        notifyTrayResidenceOnce();
    });
}

/**
 * タスクトレイアイコンとメニューを作成する
 */
function createTray() {
    const iconPath = path.join(app.getAppPath(), "icon.png");
    const trayImage = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(trayImage);

    const contextMenu = Menu.buildFromTemplate([
        { label: "設定画面を開く", click: showMainWindow },
        { type: "separator" },
        { label: "終了", click: () => app.exit(0) },
    ]);
    tray.setToolTip("FilePathOpenner — コピーしたパスをショートカットで開く");
    tray.setContextMenu(contextMenu);
    tray.on("double-click", showMainWindow);
}

/**
 * Register the configured global shortcuts, replacing previous registrations.
 *
 * @returns {string[]} Accelerators that could not be registered.
 */
function registerGlobalShortcuts() {
    globalShortcut.unregisterAll();
    const failures = [];

    const tryRegister = (accelerator, handler) => {
        if (!accelerator) return;
        try {
            if (!globalShortcut.register(accelerator, handler)) {
                failures.push(accelerator);
            }
        } catch (err) {
            failures.push(accelerator);
        }
    };

    tryRegister(store.get("openShortcut"), () => openClipboardPath(false));
    tryRegister(store.get("openParentShortcut"), () => openClipboardPath(true));

    lastShortcutFailures = failures;
    return failures;
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
 * Remove characters contained in `chars` from both ends of a string.
 *
 * @param {string} str - Input string.
 * @param {string} chars - Characters to strip.
 * @returns {string} Trimmed string.
 */
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

/**
 * Match clipboard text against configured prefix rules and build the access target.
 *
 * Rules are evaluated in order; the first rule whose `prefix` matches the start of
 * `text` is applied. Already absolute paths and `http(s)://` URLs are left unchanged.
 * The rule's `base` string is concatenated with the text to form the URL or shared-folder
 * target. When `stripPrefix` is `true` the matched prefix is removed from the text before
 * concatenation, so only the discriminating part remains.
 *
 * @param {string} text - A cleaned clipboard line.
 * @param {Array<{prefix: string, base: string, stripPrefix?: boolean}>} rules - Configured rules.
 * @returns {{target: string, matched: boolean}} The combined target and whether a rule matched.
 * @throws No exceptions are thrown.
 */
function applyPrefixRules(text, rules) {
    if (!Array.isArray(rules)) {
        return { target: text, matched: false };
    }
    if (/^https?:\/\//i.test(text) || path.isAbsolute(text)) {
        return { target: text, matched: false };
    }
    for (const rule of rules) {
        if (!rule || !rule.prefix) continue;
        if (text.startsWith(rule.prefix)) {
            const body = rule.stripPrefix ? text.slice(rule.prefix.length) : text;
            return { target: (rule.base || "") + body, matched: true };
        }
    }
    return { target: text, matched: false };
}

/**
 * Read the settings used by the open/preview pipeline.
 *
 * @returns {object} Snapshot of the relevant settings.
 */
function readOpenSettings() {
    return {
        openAsSinglePath: store.get("openAsSinglePath"),
        trimSpaces: store.get("trimSpaces"),
        removeList: store.get("removeList"),
        basePath: store.get("basePath"),
        prefixRules: store.get("prefixRules"),
    };
}

/**
 * Resolve raw clipboard text into a list of open targets.
 * Cleanup (trim / removeList), line splitting or joining, prefix rules, base path
 * prefixing and the optional parent transformation are applied in this order.
 *
 * @param {string} text - Raw clipboard text.
 * @param {object} settings - Settings snapshot from readOpenSettings().
 * @param {boolean} openParent - If `true`, targets are rewritten to their parent.
 * @returns {Array<{input: string, target: string, isUrl: boolean}>} Resolved entries.
 */
function resolveClipboardTargets(text, settings, openParent) {
    let cleaned = text;
    if (settings.trimSpaces) {
        cleaned = cleaned.trim();
    }
    if (settings.removeList) {
        cleaned = trimSpecial(cleaned, settings.removeList);
    }

    let lines;
    if (settings.openAsSinglePath) {
        lines = [cleaned.replace(/\s*\r\s*/g, "").replace(/\s*\n\s*/g, "")];
    } else {
        lines = cleaned.replace(/\r/g, "").split("\n");
    }

    const entries = [];
    for (const line of lines) {
        if (!line) continue;

        let targetPath = line;
        const ruleResult = applyPrefixRules(line, settings.prefixRules);
        if (ruleResult.matched) {
            targetPath = ruleResult.target;
        } else if (settings.basePath && !/^https?:\/\//i.test(targetPath) && !path.isAbsolute(targetPath)) {
            targetPath = path.join(settings.basePath, targetPath);
        }

        const isUrl = /^https?:\/\//i.test(targetPath);
        if (openParent) {
            if (isUrl) {
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
        if (!targetPath) continue;

        entries.push({ input: line, target: targetPath, isUrl });
    }
    return entries;
}

/**
 * Open every target resolved from the given text.
 * URLs open in the default browser; file paths fall back to the nearest existing
 * parent directory with a notification, or show an error when nothing exists.
 *
 * @param {string} text - Raw clipboard-like text.
 * @param {boolean} openParent - If `true`, open the parent directory or URL instead.
 * @returns {void}
 * @throws No exceptions are thrown; invalid paths trigger error dialogs.
 */
function openTextTargets(text, openParent) {
    const settings = readOpenSettings();
    const entries = resolveClipboardTargets(text, settings, openParent);

    entries.forEach(({ target, isUrl }) => {
        if (isUrl) {
            shell.openExternal(target);
            return;
        }

        const result = findExistingPath(target);
        if (!result) {
            dialog.showErrorBox("存在しないパス", `"${target}" は存在しないパスです。`);
            return;
        }

        const { path: finalPath, levels } = result;
        if (levels > 0) {
            dialog.showMessageBox({
                type: "info",
                message: `"${target}" は存在しません。${levels} 階層上の "${finalPath}" を開きます。`,
                buttons: ["OK"],
            });
        }
        shell.openPath(finalPath);
    });
}

/**
 * Parse clipboard text and open the referenced file paths or URLs.
 *
 * @param {boolean} openParent - If `true`, open the parent directory or URL instead.
 * @returns {void}
 * @throws No exceptions are thrown; invalid paths trigger error dialogs.
 */
function openClipboardPath(openParent) {
    openTextTargets(clipboard.readText(), openParent);
}

/**
 * Build a dry-run report of how the given text would be opened, without opening it.
 * Used by the settings screen's "動作テスト" panel.
 *
 * @param {string} text - Raw clipboard-like text.
 * @param {boolean} openParent - If `true`, preview the parent-opening behavior.
 * @returns {Array<object>} Entries with kind: "url" | "exact" | "fallback" | "missing".
 */
function previewClipboardText(text, openParent) {
    const settings = readOpenSettings();
    return resolveClipboardTargets(text, settings, openParent).map((entry) => {
        if (entry.isUrl) {
            return { ...entry, kind: "url", openPath: entry.target, levels: 0, isDirectory: false };
        }
        const found = findExistingPath(entry.target);
        if (!found) {
            return { ...entry, kind: "missing", openPath: null, levels: 0, isDirectory: false };
        }
        let isDirectory = false;
        try {
            isDirectory = fs.statSync(found.path).isDirectory();
        } catch (err) {
            isDirectory = false;
        }
        return {
            ...entry,
            kind: found.levels > 0 ? "fallback" : "exact",
            openPath: found.path,
            levels: found.levels,
            isDirectory,
        };
    });
}

if (process.env.NODE_ENV !== "test") {
    const gotSingleInstanceLock = app.requestSingleInstanceLock();
    if (!gotSingleInstanceLock) {
        // 既に起動済みの場合は多重起動しない（既存ウィンドウ側にフォーカスが移る）
        app.quit();
    } else {
        app.on("second-instance", showMainWindow);

        app.whenReady().then(() => {
            Menu.setApplicationMenu(null);
            createWindow();
            createTray();
            registerGlobalShortcuts();
        });

        app.on("window-all-closed", (e) => {
            e.preventDefault();
        });

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            } else {
                showMainWindow();
            }
        });

        app.on("will-quit", () => {
            globalShortcut.unregisterAll();
        });
    }
}

// レンダラからのIPCハンドラ
ipcMain.on("update-settings", (event, newSettings) => {
    store.set(newSettings);
    const shortcutFailures = registerGlobalShortcuts();
    event.returnValue = { ok: true, shortcutFailures };
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

// 現在の設定を返すIPCハンドラ(レンダラで読み取り用)
ipcMain.handle("get-settings", () => {
    return store.store;
});

// 動作テスト: 開かずに解析結果だけ返す
ipcMain.handle("preview-paths", (event, text, openParent) => {
    return previewClipboardText(String(text ?? ""), !!openParent);
});

// 動作テスト: 指定テキストを実際に開く
ipcMain.handle("open-text", (event, text, openParent) => {
    openTextTargets(String(text ?? ""), !!openParent);
    return true;
});

// クリップボードのテキストを返す（動作テスト用）
ipcMain.handle("get-clipboard-text", () => {
    return clipboard.readText();
});

// 前提パス用のフォルダ選択ダイアログ
ipcMain.handle("pick-folder", async () => {
    const options = {
        title: "前提パスにするフォルダを選択",
        properties: ["openDirectory"],
    };
    const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

// バージョン・プラットフォーム・直近のショートカット登録失敗を返す
ipcMain.handle("get-app-info", () => {
    return {
        version: typeof app.getVersion === "function" ? app.getVersion() : "",
        platform: process.platform,
        shortcutFailures: lastShortcutFailures,
    };
});

// テスト用に一部関数を公開
export {
    registerStartupShortcut,
    checkIfStartupRegistered,
    unRegisterStartupShortcut,
    openClipboardPath,
    openTextTargets,
    applyPrefixRules,
    resolveClipboardTargets,
    previewClipboardText,
};
