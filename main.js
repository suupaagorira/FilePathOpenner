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
import uiohook from "uiohook-napi";
import {
    createDoubleTapDetector,
    isDoubleTapAccelerator,
    parseDoubleTapAccelerator,
} from "./doubleTap.js";

const { uIOhook, UiohookKey } = uiohook;

// electron-storeで設定を永続化
const store = new Store({
    defaults: {
        openShortcut: "Ctrl+E",
        openParentShortcut: "Ctrl+Shift+E",
        openReadOnlyShortcut: "",
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

// ---- 修飾キー2連打ショートカット（グローバルキーフック） ----

// uiohook のキーコード → 正規化した修飾キー名（左右のキーは同一視する）
const MODIFIER_KEYCODES = new Map([
    [UiohookKey.Ctrl, "Ctrl"], [UiohookKey.CtrlRight, "Ctrl"],
    [UiohookKey.Alt, "Alt"], [UiohookKey.AltRight, "Alt"],
    [UiohookKey.Shift, "Shift"], [UiohookKey.ShiftRight, "Shift"],
    [UiohookKey.Meta, "Super"], [UiohookKey.MetaRight, "Super"],
]);

const doubleTapDetector = createDoubleTapDetector();
let keyHookRunning = false;

uIOhook.on("keydown", (event) => {
    doubleTapDetector.keydown(MODIFIER_KEYCODES.get(event.keycode) ?? null, Date.now());
});
uIOhook.on("keyup", (event) => {
    doubleTapDetector.keyup(MODIFIER_KEYCODES.get(event.keycode) ?? null, Date.now());
});

/**
 * Start or stop the global keyboard hook used for double-tap shortcuts.
 * The hook only runs while at least one double-tap binding is configured.
 *
 * @param {boolean} active - Desired hook state.
 * @returns {boolean} `true` when the hook is in the desired state.
 */
function ensureKeyHook(active) {
    if (active === keyHookRunning) return true;
    try {
        if (active) {
            uIOhook.start();
        } else {
            uIOhook.stop();
        }
        keyHookRunning = active;
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Register the configured global shortcuts, replacing previous registrations.
 * Ordinary accelerators go through Electron's globalShortcut; double-tap
 * accelerators ("Alt×2" など) are routed to the global key hook instead.
 *
 * @returns {string[]} Accelerators that could not be registered.
 */
function registerGlobalShortcuts() {
    globalShortcut.unregisterAll();
    const failures = [];
    const doubleTapBindings = [];

    const tryRegister = (accelerator, handler) => {
        if (!accelerator) return;
        if (isDoubleTapAccelerator(accelerator)) {
            const parsed = parseDoubleTapAccelerator(accelerator);
            if (parsed) {
                doubleTapBindings.push({ ...parsed, accelerator, handler });
            } else {
                failures.push(accelerator);
            }
            return;
        }
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
    tryRegister(store.get("openReadOnlyShortcut"), () => openClipboardPath(false, { readOnly: true }));

    doubleTapDetector.setBindings(doubleTapBindings);
    if (!ensureKeyHook(doubleTapBindings.length > 0)) {
        failures.push(...doubleTapBindings.map((binding) => binding.accelerator));
    }

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

// ---- 読み取り専用オープン（Office 系アプリ） ----

// 拡張子ごとに、読み取り専用で開ける Office アプリの COM 情報を対応付ける
const OFFICE_READONLY_APPS = [
    {
        progId: "Excel.Application",
        extensions: [".xls", ".xlsx", ".xlsm", ".xlsb"],
        // Workbooks.Open(Filename, UpdateLinks, ReadOnly)
        openCall: "[void]$app.Workbooks.Open($path, 0, $true)",
        showCall: "$app.Visible = $true",
    },
    {
        progId: "Word.Application",
        extensions: [".doc", ".docx", ".docm"],
        // Documents.Open(FileName, ConfirmConversions, ReadOnly)
        openCall: "[void]$app.Documents.Open($path, $false, $true)",
        showCall: "$app.Visible = $true",
    },
    {
        progId: "PowerPoint.Application",
        extensions: [".ppt", ".pptx", ".pptm"],
        // Presentations.Open(FileName, ReadOnly, Untitled, WithWindow) — msoTrue = -1
        openCall: "[void]$app.Presentations.Open($path, -1, 0, -1)",
        showCall: "",
    },
];

/**
 * Build the PowerShell script that opens a file read-only via COM automation.
 * A running instance is reused when possible; a newly created one is closed
 * again if opening fails so no orphan process is left behind.
 *
 * @param {{progId: string, openCall: string, showCall: string}} officeApp - COM target.
 * @param {string} filePath - Absolute path of the file to open.
 * @returns {string} Single-line PowerShell script.
 */
function buildReadOnlyPsScript(officeApp, filePath) {
    const escapedPath = filePath.replace(/'/g, "''");
    const openBody = (officeApp.showCall ? `${officeApp.showCall}; ` : "") + officeApp.openCall;
    return [
        "$ErrorActionPreference = 'Stop'",
        `$path = '${escapedPath}'`,
        "$created = $false",
        `try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject('${officeApp.progId}') } `
        + `catch { $app = New-Object -ComObject '${officeApp.progId}'; $created = $true }`,
        `try { ${openBody} } catch { if ($created) { try { $app.Quit() } catch { } }; exit 1 }`,
    ].join("; ");
}

/**
 * Open a file in read-only mode when a matching Office application exists.
 * Other file types (and non-Windows platforms) fall back to a normal open.
 *
 * @param {string} finalPath - Existing path to open.
 * @returns {void}
 * @throws No exceptions are thrown; failures are shown in an error dialog.
 */
function openPathReadOnly(finalPath) {
    const ext = path.extname(finalPath).toLowerCase();
    const officeApp = OFFICE_READONLY_APPS.find((entry) => entry.extensions.includes(ext));
    if (!officeApp || process.platform !== "win32") {
        shell.openPath(finalPath);
        return;
    }
    const script = buildReadOnlyPsScript(officeApp, finalPath);
    execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true },
        (error) => {
            if (error) {
                dialog.showErrorBox(
                    "読み取り専用で開けませんでした",
                    `"${finalPath}" を読み取り専用モードで開けませんでした。`
                    + "対応する Office アプリがインストールされているか確認してください。");
            }
        }
    );
}

/**
 * Open every target resolved from the given text.
 * URLs open in the default browser; file paths fall back to the nearest existing
 * parent directory with a notification, or show an error when nothing exists.
 *
 * @param {string} text - Raw clipboard-like text.
 * @param {boolean} openParent - If `true`, open the parent directory or URL instead.
 * @param {{readOnly?: boolean}} [options] - Set `readOnly` to open files read-only.
 * @returns {void}
 * @throws No exceptions are thrown; invalid paths trigger error dialogs.
 */
function openTextTargets(text, openParent, options = {}) {
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
        if (options.readOnly) {
            openPathReadOnly(finalPath);
        } else {
            shell.openPath(finalPath);
        }
    });
}

/**
 * Parse clipboard text and open the referenced file paths or URLs.
 *
 * @param {boolean} openParent - If `true`, open the parent directory or URL instead.
 * @param {{readOnly?: boolean}} [options] - Set `readOnly` to open files read-only.
 * @returns {void}
 * @throws No exceptions are thrown; invalid paths trigger error dialogs.
 */
function openClipboardPath(openParent, options = {}) {
    openTextTargets(clipboard.readText(), openParent, options);
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
            ensureKeyHook(false);
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
    registerGlobalShortcuts,
    openClipboardPath,
    openTextTargets,
    openPathReadOnly,
    applyPrefixRules,
    resolveClipboardTargets,
    previewClipboardText,
};
