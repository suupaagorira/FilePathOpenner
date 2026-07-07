// renderer.js
// index.html 上で動作するフロントエンド処理。
// 設定の読み書き（自動保存）、ショートカットレコーダー、プレフィックスルール編集、
// 動作テスト（ドライラン）、スタートアップ切り替え、パネルナビゲーションを担当する。

(async () => {
    "use strict";

    const $ = (id) => document.getElementById(id);

    /**
     * Attach an event listener only when the element exists.
     *
     * @param {Element|null} el - Target element (may be null in tests).
     * @param {string} eventName - DOM event name.
     * @param {Function} handler - Event handler.
     * @returns {void}
     */
    const on = (el, eventName, handler) => {
        if (el) el.addEventListener(eventName, handler);
    };

    /**
     * Create a debounced wrapper for a function.
     *
     * @param {Function} fn - Function to debounce.
     * @param {number} ms - Delay in milliseconds.
     * @returns {Function} Debounced function with a `cancel()` method.
     */
    const debounce = (fn, ms) => {
        let timer = null;
        const wrapped = (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
        wrapped.cancel = () => clearTimeout(timer);
        return wrapped;
    };

    /**
     * Build an in-memory API stub so the page can be previewed in a plain browser.
     * 実アプリでは preload.cjs が window.electronAPI を提供するため使われない。
     *
     * @returns {object} A mock implementation of the electronAPI surface.
     */
    const makePreviewApi = () => {
        const settings = {
            openShortcut: "Ctrl+E",
            openParentShortcut: "Ctrl+Shift+E",
            openReadOnlyShortcut: "",
            openAsSinglePath: true,
            trimSpaces: true,
            removeList: "<>＜＞()（）[]「」{}｛｝\"”'’",
            basePath: "C:\\Projects",
            prefixRules: [
                { prefix: "DOC-", base: "https://intra.example.com/docs/", stripPrefix: false },
                { prefix: "案件", base: "\\\\fileserver\\projects\\", stripPrefix: false },
            ],
        };
        return {
            __preview: true,
            getSettings: async () => JSON.parse(JSON.stringify(settings)),
            updateSettings: (next) => {
                Object.assign(settings, next);
                return { ok: true, shortcutFailures: [] };
            },
            registerStartup: () => true,
            unRegisterStartup: () => true,
            checkStartup: async () => false,
            getAppInfo: async () => ({ version: "1.1.1", platform: "win32", shortcutFailures: [] }),
            getClipboardText: async () => "",
            pickFolder: async () => null,
            openText: async () => true,
            previewPaths: async (text, openParent) => {
                return String(text)
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                        const isUrl = /^https?:\/\//i.test(line);
                        const target = openParent ? line.replace(/[\\/][^\\/]*$/, "") : line;
                        if (isUrl) {
                            return { input: line, target, isUrl, kind: "url", openPath: target, levels: 0, isDirectory: false };
                        }
                        const looksFile = /\.[A-Za-z0-9]{1,5}$/.test(target);
                        return {
                            input: line, target, isUrl, kind: "exact",
                            openPath: target, levels: 0, isDirectory: !looksFile,
                        };
                    });
            },
        };
    };

    const api = window.electronAPI || makePreviewApi();
    if (!window.electronAPI) {
        const banner = $("previewBanner");
        if (banner) banner.hidden = false;
    }

    // ---- 設定の読み込み ----
    let loaded = {};
    try {
        loaded = (await api.getSettings()) || {};
    } catch (err) {
        console.error("設定読み込みエラー:", err);
    }
    const currentSettings = Object.assign({
        openShortcut: "Ctrl+E",
        openParentShortcut: "Ctrl+Shift+E",
        openReadOnlyShortcut: "",
        openAsSinglePath: true,
        trimSpaces: true,
        removeList: "<>＜＞()（）[]「」{}｛｝\"”'’",
        basePath: "",
        prefixRules: [],
    }, loaded);

    // ---- トースト通知 ----
    const toastHost = $("toastHost");
    let savedToastTimer = null;

    /**
     * Show a transient toast message.
     *
     * @param {string} message - Text to display.
     * @param {string} [type] - "success" or "error".
     * @returns {void}
     */
    const toast = (message, type = "success") => {
        if (!toastHost) return;
        const el = document.createElement("div");
        el.className = type === "error" ? "toast toast-error" : "toast";
        el.textContent = message;
        toastHost.appendChild(el);
        const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
        raf(() => el.classList.add("show"));
        setTimeout(() => {
            el.classList.remove("show");
            setTimeout(() => el.remove(), 300);
        }, 2400);
    };

    /** Debounced "saved" toast so rapid consecutive saves show a single message. */
    const toastSaved = () => {
        clearTimeout(savedToastTimer);
        savedToastTimer = setTimeout(() => toast("設定を保存しました"), 250);
    };

    // ---- 設定の永続化 ----

    /**
     * Merge a partial settings object and persist everything to the main process.
     *
     * @param {object} partial - Settings keys to update.
     * @param {{silent?: boolean}} [options] - Set `silent` to suppress the saved toast.
     * @returns {{shortcutFailures: string[]}} Registration failures reported by the main process.
     */
    const persist = (partial, options = {}) => {
        Object.assign(currentSettings, partial);
        let result = null;
        try {
            result = api.updateSettings(currentSettings);
        } catch (err) {
            console.error("設定保存エラー:", err);
            toast("設定の保存に失敗しました", "error");
            return { shortcutFailures: [] };
        }
        const shortcutFailures = result && Array.isArray(result.shortcutFailures)
            ? result.shortcutFailures
            : [];
        updateShortcutStatuses(shortcutFailures);
        if (!options.silent) toastSaved();
        return { shortcutFailures };
    };

    // ---- パネルナビゲーション ----
    const content = $("content");
    const navButtons = Array.from(document.querySelectorAll(".nav-item"));

    /**
     * Switch the visible settings panel.
     *
     * @param {string} panelId - DOM id of the panel to activate.
     * @returns {void}
     */
    const activatePanel = (panelId) => {
        const target = document.getElementById(panelId) ? panelId : "panelHome";
        document.querySelectorAll(".panel").forEach((panel) => {
            panel.classList.toggle("active", panel.id === target);
        });
        navButtons.forEach((btn) => {
            const active = btn.dataset.panel === target;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (content && typeof content.scrollTo === "function") content.scrollTo(0, 0);
        try {
            localStorage.setItem("fpo.activePanel", target);
        } catch (err) { /* localStorage が使えない環境では記憶しない */ }
    };

    navButtons.forEach((btn) => on(btn, "click", () => activatePanel(btn.dataset.panel)));
    document.querySelectorAll("[data-jump]").forEach((btn) => {
        on(btn, "click", () => activatePanel(btn.dataset.jump));
    });
    try {
        const storedPanel = localStorage.getItem("fpo.activePanel");
        if (storedPanel && document.getElementById(storedPanel)) activatePanel(storedPanel);
    } catch (err) { /* ignore */ }

    // ---- ショートカットレコーダー ----
    const txtOpenShortcut = $("txtOpenShortcut");
    const txtOpenParentShortcut = $("txtOpenParentShortcut");
    const txtOpenReadOnlyShortcut = $("txtOpenReadOnlyShortcut");
    const statusOpenShortcut = $("statusOpenShortcut");
    const statusOpenParentShortcut = $("statusOpenParentShortcut");
    const statusOpenReadOnlyShortcut = $("statusOpenReadOnlyShortcut");

    const SHORTCUT_LABELS = {
        openShortcut: "「パスを開く」",
        openParentShortcut: "「親フォルダを開く」",
        openReadOnlyShortcut: "「読み取り専用で開く」",
    };
    // 2連打ショートカット表記（main プロセス側 doubleTap.js と揃える）
    const DOUBLE_TAP_SUFFIX = "×2";
    const DOUBLE_TAP_INTERVAL_MS = 400;
    const MODIFIER_KEY_NAMES = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Super" };
    const KEY_ALIASES = {
        " ": "Space",
        "Spacebar": "Space",
        "ArrowUp": "Up",
        "ArrowDown": "Down",
        "ArrowLeft": "Left",
        "ArrowRight": "Right",
        "Enter": "Enter",
        "Tab": "Tab",
        "Backspace": "Backspace",
        "Delete": "Delete",
        "Insert": "Insert",
        "Home": "Home",
        "End": "End",
        "PageUp": "PageUp",
        "PageDown": "PageDown",
        "PrintScreen": "PrintScreen",
    };
    const F_KEY_PATTERN = /^F([1-9]|1\d|2[0-4])$/;

    const isModifierKey = (key) => key === "Control" || key === "Shift" || key === "Alt" || key === "Meta";

    /**
     * Collect pressed modifier names from a keyboard event.
     *
     * @param {KeyboardEvent} event - Source event.
     * @returns {string[]} Modifiers in Electron accelerator order.
     */
    const modifiersOf = (event) => {
        const mods = [];
        if (event.ctrlKey) mods.push("Ctrl");
        if (event.altKey) mods.push("Alt");
        if (event.shiftKey) mods.push("Shift");
        if (event.metaKey) mods.push("Super");
        return mods;
    };

    /**
     * Convert a keyboard event into an Electron accelerator key name.
     *
     * @param {KeyboardEvent} event - Source event.
     * @returns {string|null} Key name, or null when the key cannot be used.
     */
    const normalizeEventKey = (event) => {
        const { key, code } = event;
        if (F_KEY_PATTERN.test(key)) return key;
        if (/^Key[A-Z]$/.test(code || "")) return code.slice(3);
        if (/^Digit\d$/.test(code || "")) return code.slice(5);
        if (/^Numpad\d$/.test(code || "")) return "num" + code.slice(6);
        if (Object.prototype.hasOwnProperty.call(KEY_ALIASES, key)) return KEY_ALIASES[key];
        if (typeof key === "string" && key.length === 1 && /^[!-~]$/.test(key)) {
            return key === "+" ? "Plus" : key.toUpperCase();
        }
        return null;
    };

    const shortcutFields = [];
    let knownShortcutFailures = [];

    /**
     * Refresh the inline status text under each shortcut recorder.
     *
     * @param {string[]} [failures] - Accelerators that failed to register.
     * @returns {void}
     */
    function updateShortcutStatuses(failures) {
        if (Array.isArray(failures)) knownShortcutFailures = failures;
        shortcutFields.forEach(({ input, statusEl }) => {
            if (!input || input.classList.contains("recording")) return;
            const accel = input.value;
            if (statusEl) {
                if (!accel) {
                    statusEl.textContent = "未設定（無効）";
                    statusEl.className = "field-status muted";
                } else if (knownShortcutFailures.includes(accel)) {
                    statusEl.textContent = "登録に失敗しました（他のアプリと競合の可能性）";
                    statusEl.className = "field-status error";
                } else {
                    statusEl.textContent = "有効";
                    statusEl.className = "field-status ok";
                }
            }
            input.classList.toggle("error", !!accel && knownShortcutFailures.includes(accel));
        });
        renderHomeShortcuts();
    }

    /**
     * Render an accelerator string as keyboard chips.
     *
     * @param {Element|null} host - Container element.
     * @param {string} accel - Accelerator such as "Ctrl+Shift+E".
     * @returns {void}
     */
    const renderKbdCombo = (host, accel) => {
        if (!host) return;
        host.innerHTML = "";
        if (!accel) {
            const none = document.createElement("span");
            none.className = "kbd-none";
            none.textContent = "未設定";
            host.appendChild(none);
            return;
        }
        accel.split("+").forEach((part, index) => {
            if (index > 0) {
                const plus = document.createElement("span");
                plus.className = "kbd-plus";
                plus.textContent = "+";
                host.appendChild(plus);
            }
            const kbd = document.createElement("kbd");
            kbd.textContent = part;
            host.appendChild(kbd);
        });
    };

    /** Refresh the shortcut chips shown on the home panel. */
    function renderHomeShortcuts() {
        renderKbdCombo($("homeShortcutDisplay"), currentSettings.openShortcut);
        renderKbdCombo($("homeParentShortcutDisplay"), currentSettings.openParentShortcut);
        renderKbdCombo($("homeReadOnlyShortcutDisplay"), currentSettings.openReadOnlyShortcut);
    }

    /**
     * Collect the accelerators currently assigned to every other shortcut action.
     *
     * @param {string} excludeKey - Settings key of the action being edited.
     * @returns {string[]} Non-empty accelerators of the other actions.
     */
    const otherShortcutAccels = (excludeKey) => Object.keys(SHORTCUT_LABELS)
        .filter((key) => key !== excludeKey)
        .map((key) => currentSettings[key] || "")
        .filter(Boolean);

    /**
     * Wire a shortcut input as a key recorder: click, press keys, auto-save.
     * 修飾キーをすばやく 2 回押すと "Alt×2" / "Shift+Alt×2" 形式で記録される。
     *
     * @param {HTMLInputElement|null} input - Readonly text input.
     * @param {Element|null} statusEl - Inline status element.
     * @param {string} settingKey - Settings key to persist.
     * @returns {void}
     */
    const setupShortcutRecorder = (input, statusEl, settingKey) => {
        if (!input) return;
        shortcutFields.push({ input, statusEl, settingKey });
        input.value = currentSettings[settingKey] || "";
        let previousValue = "";
        let recording = false;
        let pendingTap = null; // 押下中の修飾キー（2連打の候補）
        let lastTap = null;    // 直前に完了した修飾キー単独タップ

        const stopRecording = (nextValue) => {
            recording = false;
            input.classList.remove("recording");
            input.value = nextValue;
            updateShortcutStatuses();
        };

        const startRecording = () => {
            if (recording) return;
            recording = true;
            previousValue = input.value;
            pendingTap = null;
            lastTap = null;
            input.classList.add("recording");
            input.value = "キーを入力…";
            if (statusEl) {
                statusEl.textContent = "Esc: キャンセル ／ Backspace: 無効化 ／ 修飾キー2連打も可";
                statusEl.className = "field-status recording";
            }
            input.focus();
        };

        const commit = (accel) => {
            if (accel && otherShortcutAccels(settingKey).includes(accel)) {
                stopRecording(previousValue);
                toast("他のショートカットと同じキーは設定できません", "error");
                return;
            }
            stopRecording(accel);
            const { shortcutFailures } = persist({ [settingKey]: accel }, { silent: true });
            if (accel && shortcutFailures.includes(accel)) {
                toast(`「${accel}」を登録できませんでした`, "error");
            } else if (accel) {
                toast(`${SHORTCUT_LABELS[settingKey]}を ${accel} に変更しました`);
            } else {
                toast(`${SHORTCUT_LABELS[settingKey]}を無効にしました`);
            }
        };

        on(input, "click", startRecording);
        on(input, "keydown", (event) => {
            if (!recording) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    startRecording();
                }
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") {
                stopRecording(previousValue);
                return;
            }
            const mods = modifiersOf(event);
            if ((event.key === "Backspace" || event.key === "Delete") && mods.length === 0) {
                commit("");
                return;
            }
            if (isModifierKey(event.key)) {
                const keyName = MODIFIER_KEY_NAMES[event.key];
                if (keyName && !event.repeat) {
                    pendingTap = {
                        key: keyName,
                        mods: mods.filter((mod) => mod !== keyName),
                        downTime: Date.now(),
                    };
                }
                input.value = mods.length ? `${mods.join("+")}+…` : "キーを入力…";
                return;
            }
            // 修飾キー以外が押されたら 2連打の判定はやり直し
            pendingTap = null;
            lastTap = null;
            const keyName = normalizeEventKey(event);
            if (!keyName) return;
            if (!F_KEY_PATTERN.test(keyName) && mods.length === 0) {
                input.value = "修飾キーと組み合わせてください…";
                return;
            }
            commit([...mods, keyName].join("+"));
        });
        on(input, "keyup", (event) => {
            if (!recording || !isModifierKey(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const keyName = MODIFIER_KEY_NAMES[event.key];
            if (!pendingTap || pendingTap.key !== keyName) {
                pendingTap = null;
                return;
            }
            const tap = pendingTap;
            pendingTap = null;
            const candidate = [...tap.mods, keyName + DOUBLE_TAP_SUFFIX].join("+");
            const paired = lastTap
                && lastTap.key === tap.key
                && lastTap.mods.join("+") === tap.mods.join("+")
                && tap.downTime - lastTap.downTime <= DOUBLE_TAP_INTERVAL_MS;
            if (paired) {
                lastTap = null;
                commit(candidate);
                return;
            }
            lastTap = tap;
            input.value = `もう一度押すと ${candidate}`;
        });
        on(input, "blur", () => {
            if (recording) stopRecording(previousValue);
        });
    };

    setupShortcutRecorder(txtOpenShortcut, statusOpenShortcut, "openShortcut");
    setupShortcutRecorder(txtOpenParentShortcut, statusOpenParentShortcut, "openParentShortcut");
    setupShortcutRecorder(txtOpenReadOnlyShortcut, statusOpenReadOnlyShortcut, "openReadOnlyShortcut");
    updateShortcutStatuses([]);

    // ---- パスの整形 ----
    const chkSinglePath = $("chkSinglePath");
    const chkTrimSpaces = $("chkTrimSpaces");
    const txtRemoveList = $("txtRemoveList");

    if (chkSinglePath) chkSinglePath.checked = !!currentSettings.openAsSinglePath;
    if (chkTrimSpaces) chkTrimSpaces.checked = !!currentSettings.trimSpaces;
    if (txtRemoveList) txtRemoveList.value = currentSettings.removeList || "";

    on(chkSinglePath, "change", () => persist({ openAsSinglePath: chkSinglePath.checked }));
    on(chkTrimSpaces, "change", () => persist({ trimSpaces: chkTrimSpaces.checked }));
    on(txtRemoveList, "blur", () => {
        if (txtRemoveList.value === currentSettings.removeList) return;
        persist({ removeList: txtRemoveList.value });
    });

    // ---- 前提パス ----
    const txtBasePath = $("txtBasePath");
    const btnPickBasePath = $("btnPickBasePath");
    const basePathPreview = $("basePathPreview");

    /** Update the sample line showing how the base path joins a relative path. */
    const updateBasePathPreview = () => {
        if (!basePathPreview) return;
        const base = (txtBasePath ? txtBasePath.value : "").trim();
        const sample = "docs\\仕様書.xlsx";
        if (!base) {
            basePathPreview.textContent = "未設定: 相対パスはそのままの場所で検索されます。";
            return;
        }
        const joined = base.replace(/[\\/]+$/, "") + "\\" + sample;
        basePathPreview.textContent = `例: 「${sample}」 → 「${joined}」`;
    };

    if (txtBasePath) txtBasePath.value = currentSettings.basePath || "";
    updateBasePathPreview();

    on(txtBasePath, "input", updateBasePathPreview);
    on(txtBasePath, "blur", () => {
        if (txtBasePath.value === currentSettings.basePath) return;
        persist({ basePath: txtBasePath.value });
    });
    on(btnPickBasePath, "click", async () => {
        try {
            const dir = api.pickFolder ? await api.pickFolder() : null;
            if (dir) {
                if (txtBasePath) txtBasePath.value = dir;
                persist({ basePath: dir });
                updateBasePathPreview();
            }
        } catch (err) {
            console.error("フォルダ選択エラー:", err);
        }
    });

    // ---- プレフィックスルール ----
    const prefixRulesContainer = $("prefixRulesContainer");
    const btnAddPrefixRule = $("btnAddPrefixRule");
    const prefixRules = Array.isArray(currentSettings.prefixRules) ? currentSettings.prefixRules : [];
    currentSettings.prefixRules = prefixRules;
    let prefixRulesSaveTimer = null;

    /** Persist the current prefix rule list immediately. */
    const savePrefixRules = (options) => {
        clearTimeout(prefixRulesSaveTimer);
        persist({ prefixRules }, options);
    };

    /** Schedule a debounced, silent save for prefix rule text edits. */
    const scheduleSavePrefixRules = () => {
        clearTimeout(prefixRulesSaveTimer);
        prefixRulesSaveTimer = setTimeout(() => savePrefixRules({ silent: true }), 400);
    };

    /**
     * Build preview text showing how a rule transforms a sample clipboard value.
     *
     * @param {string} prefix - Leading pattern to match.
     * @param {string} base - Base string to prepend or join with.
     * @param {boolean} stripPrefix - Whether the matched prefix is removed before joining.
     * @returns {string} Human-readable preview text.
     */
    const buildRulePreviewText = (prefix, base, stripPrefix) => {
        if (!prefix) {
            return "先頭パターンを入力すると、変換結果のプレビューが表示されます。";
        }
        const sample = `${prefix}123`;
        const body = stripPrefix ? sample.slice(prefix.length) : sample;
        return `例: 「${sample}」 → 「${(base || "") + body}」`;
    };

    /**
     * Move a prefix rule up or down in the evaluation order.
     *
     * @param {number} index - Current index of the rule.
     * @param {number} direction - -1 to move up, 1 to move down.
     * @returns {void}
     */
    const movePrefixRule = (index, direction) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= prefixRules.length) return;
        [prefixRules[index], prefixRules[targetIndex]] = [prefixRules[targetIndex], prefixRules[index]];
        savePrefixRules();
        renderPrefixRules();
    };

    /**
     * Build one labelled text field for a rule card.
     *
     * @param {string} labelText - Field label.
     * @param {string} className - Class for the input element.
     * @param {string} value - Initial value.
     * @param {string} placeholder - Placeholder text.
     * @returns {{field: HTMLDivElement, input: HTMLInputElement}} Wrapper and input.
     */
    const buildRuleField = (labelText, className, value, placeholder) => {
        const field = document.createElement("div");
        field.className = "prefix-rule-field";
        const label = document.createElement("label");
        label.textContent = labelText;
        const input = document.createElement("input");
        input.type = "text";
        input.className = `input mono ${className}`;
        input.spellcheck = false;
        input.placeholder = placeholder;
        input.value = value;
        field.append(label, input);
        return { field, input };
    };

    /**
     * Build the header (number + move/delete actions) for a rule card.
     *
     * @param {number} index - Rule index.
     * @param {number} total - Total rule count.
     * @returns {HTMLDivElement} Header element.
     */
    const buildRuleHeader = (index, total) => {
        const header = document.createElement("div");
        header.className = "prefix-rule-header";

        const number = document.createElement("span");
        number.className = "prefix-rule-number";
        number.dataset.index = String(index + 1);
        number.textContent = index === 0 ? "ルール（最優先）" : "ルール";

        const actions = document.createElement("div");
        actions.className = "prefix-rule-actions";

        const upBtn = document.createElement("button");
        upBtn.type = "button";
        upBtn.className = "rule-move";
        upBtn.title = "上へ移動（優先度を上げる）";
        upBtn.setAttribute("aria-label", "上へ移動");
        upBtn.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>';
        upBtn.disabled = index === 0;
        upBtn.addEventListener("click", () => movePrefixRule(index, -1));

        const downBtn = document.createElement("button");
        downBtn.type = "button";
        downBtn.className = "rule-move";
        downBtn.title = "下へ移動（優先度を下げる）";
        downBtn.setAttribute("aria-label", "下へ移動");
        downBtn.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        downBtn.disabled = index === total - 1;
        downBtn.addEventListener("click", () => movePrefixRule(index, 1));

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "rule-delete";
        delBtn.title = "このルールを削除";
        delBtn.setAttribute("aria-label", "このルールを削除");
        delBtn.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M3.5 6h17M8 6V4h8v2M19 6l-1 14.5H6L5 6M10 10.5v6M14 10.5v6"/></svg>';
        delBtn.addEventListener("click", () => {
            prefixRules.splice(index, 1);
            savePrefixRules();
            renderPrefixRules();
        });

        actions.append(upBtn, downBtn, delBtn);
        header.append(number, actions);
        return header;
    };

    /**
     * Build a single editable prefix-rule card element.
     *
     * @param {{prefix: string, base: string, stripPrefix?: boolean}} rule - The rule data.
     * @param {number} index - Index of the rule within the list.
     * @param {number} total - Total number of rules.
     * @returns {HTMLDivElement} The card element.
     */
    const buildRuleCard = (rule, index, total) => {
        const card = document.createElement("div");
        card.className = "prefix-rule-card";
        card.appendChild(buildRuleHeader(index, total));

        const grid = document.createElement("div");
        grid.className = "prefix-rule-grid";
        const prefixField = buildRuleField("先頭パターン", "rule-prefix", rule.prefix || "", "例: DOC-");
        const baseField = buildRuleField(
            "結合文字列", "rule-base", rule.base || "", "例: https://intra/docs/ または \\\\server\\share\\");
        grid.append(prefixField.field, baseField.field);

        const options = document.createElement("div");
        options.className = "prefix-rule-options";
        const stripLabel = document.createElement("label");
        stripLabel.className = "rule-strip";
        const stripChk = document.createElement("input");
        stripChk.type = "checkbox";
        stripChk.checked = !!rule.stripPrefix;
        stripLabel.append(stripChk, document.createTextNode("先頭パターンを除去してから結合する"));
        options.appendChild(stripLabel);

        const preview = document.createElement("div");
        preview.className = "prefix-rule-preview";
        const refreshPreview = () => {
            preview.innerText = buildRulePreviewText(
                prefixField.input.value, baseField.input.value, stripChk.checked);
        };

        prefixField.input.addEventListener("input", () => {
            prefixRules[index].prefix = prefixField.input.value;
            refreshPreview();
            scheduleSavePrefixRules();
        });
        prefixField.input.addEventListener("blur", () => savePrefixRules({ silent: true }));
        baseField.input.addEventListener("input", () => {
            prefixRules[index].base = baseField.input.value;
            refreshPreview();
            scheduleSavePrefixRules();
        });
        baseField.input.addEventListener("blur", () => savePrefixRules({ silent: true }));
        stripChk.addEventListener("change", () => {
            prefixRules[index].stripPrefix = stripChk.checked;
            refreshPreview();
            savePrefixRules();
        });

        refreshPreview();
        card.append(grid, options, preview);
        return card;
    };

    /**
     * Re-render the whole prefix-rule list from the current state.
     *
     * @param {{focusIndex?: number}} [options] - Optional render options.
     * @returns {void}
     */
    function renderPrefixRules(options = {}) {
        if (!prefixRulesContainer) return;
        prefixRulesContainer.innerHTML = "";
        if (prefixRules.length === 0) {
            const empty = document.createElement("div");
            empty.className = "prefix-rule-empty";
            empty.innerText = "ルールはまだありません。「ルールを追加」から作成できます。";
            prefixRulesContainer.appendChild(empty);
            return;
        }
        prefixRules.forEach((rule, index) => {
            prefixRulesContainer.appendChild(buildRuleCard(rule, index, prefixRules.length));
        });
        if (typeof options.focusIndex === "number") {
            const cards = prefixRulesContainer.querySelectorAll(".prefix-rule-card");
            const targetCard = cards[options.focusIndex];
            if (targetCard) {
                const prefixInput = targetCard.querySelector(".rule-prefix");
                targetCard.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
                prefixInput?.focus();
            }
        }
    }

    on(btnAddPrefixRule, "click", () => {
        prefixRules.push({ prefix: "", base: "", stripPrefix: false });
        savePrefixRules();
        renderPrefixRules({ focusIndex: prefixRules.length - 1 });
    });

    renderPrefixRules();

    // ---- 動作テスト ----
    const txtTester = $("txtTester");
    const chkTesterParent = $("chkTesterParent");
    const btnLoadClipboard = $("btnLoadClipboard");
    const btnOpenTest = $("btnOpenTest");
    const testerResults = $("testerResults");

    /** Show a dashed placeholder message in the tester result area. */
    const setTesterPlaceholder = (message) => {
        if (!testerResults) return;
        testerResults.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "tester-empty";
        empty.textContent = message;
        testerResults.appendChild(empty);
    };

    /**
     * Render dry-run results returned by the main process.
     *
     * @param {Array<object>} results - Entries from previewPaths().
     * @returns {void}
     */
    const renderTesterResults = (results) => {
        if (!testerResults) return;
        testerResults.innerHTML = "";
        if (!results.length) {
            setTesterPlaceholder("開ける対象が見つかりませんでした。");
            return;
        }
        results.forEach((r) => {
            const row = document.createElement("div");
            row.className = "tr-row";

            const flow = document.createElement("div");
            flow.className = "tr-flow";
            const input = document.createElement("span");
            input.className = "tr-input";
            input.textContent = r.input;
            flow.appendChild(input);
            const finalTarget = r.kind === "fallback" ? r.openPath : r.target;
            if (finalTarget && finalTarget !== r.input) {
                const arrow = document.createElement("span");
                arrow.className = "tr-arrow";
                arrow.textContent = "→";
                const target = document.createElement("span");
                target.className = "tr-target";
                target.textContent = finalTarget;
                flow.append(arrow, target);
            }

            const badge = document.createElement("span");
            const kind = r.kind || (r.isUrl ? "url" : "exact");
            if (kind === "url") {
                badge.className = "badge badge-url";
                badge.textContent = "URL";
            } else if (kind === "exact") {
                badge.className = "badge badge-ok";
                badge.textContent = r.isDirectory ? "フォルダ" : "ファイル";
            } else if (kind === "fallback") {
                badge.className = "badge badge-warn";
                badge.textContent = `${r.levels} 階層上を開く`;
            } else {
                badge.className = "badge badge-err";
                badge.textContent = "見つかりません";
            }

            row.append(flow, badge);
            if (kind === "fallback") {
                const note = document.createElement("div");
                note.className = "tr-note";
                note.textContent = `「${r.target}」が見つからないため、存在する親フォルダを開きます。`;
                row.appendChild(note);
            }
            testerResults.appendChild(row);
        });
    };

    /** Run the dry-run preview for the current tester text. */
    async function runTesterPreview() {
        if (!txtTester || !testerResults) return;
        const text = txtTester.value;
        if (!text.trim()) {
            setTesterPlaceholder("テキストを入力すると、ここに解析結果が表示されます。");
            return;
        }
        try {
            const openParent = !!(chkTesterParent && chkTesterParent.checked);
            const results = api.previewPaths ? (await api.previewPaths(text, openParent)) || [] : [];
            renderTesterResults(results);
        } catch (err) {
            console.error("プレビューエラー:", err);
            setTesterPlaceholder("解析中にエラーが発生しました。");
        }
    }

    const runTesterPreviewDebounced = debounce(runTesterPreview, 300);
    setTesterPlaceholder("テキストを入力すると、ここに解析結果が表示されます。");

    on(txtTester, "input", runTesterPreviewDebounced);
    on(txtTester, "change", runTesterPreview);
    on(chkTesterParent, "change", runTesterPreview);
    on(btnLoadClipboard, "click", async () => {
        try {
            const text = api.getClipboardText ? await api.getClipboardText() : "";
            if (typeof text === "string" && text.length) {
                txtTester.value = text;
                runTesterPreview();
            } else {
                toast("クリップボードにテキストがありません", "error");
            }
        } catch (err) {
            console.error("クリップボード読み込みエラー:", err);
        }
    });
    on(btnOpenTest, "click", async () => {
        if (!txtTester || !txtTester.value.trim()) {
            toast("テストするテキストを入力してください", "error");
            return;
        }
        try {
            const openParent = !!(chkTesterParent && chkTesterParent.checked);
            if (api.openText) await api.openText(txtTester.value, openParent);
            toast("開く処理を実行しました");
        } catch (err) {
            console.error("テスト実行エラー:", err);
            toast("開く処理に失敗しました", "error");
        }
    });

    // ---- スタートアップ ----
    const chkStartup = $("chkStartup");
    const lblStartupStatus = $("lblStartupStatus");
    const startupLoading = $("startupLoading");
    let startupSupported = true;
    let startupBusy = false;

    /**
     * Render the startup registration status label.
     *
     * @param {"on"|"off"|"checking"|"unsupported"} state - Display state.
     * @returns {void}
     */
    const renderStartupStatus = (state) => {
        if (!lblStartupStatus) return;
        const map = {
            on: ["登録済み", "status-inline ok"],
            off: ["未登録", "status-inline muted"],
            checking: ["確認中…", "status-inline muted"],
            unsupported: ["この OS では利用できません", "status-inline muted"],
        };
        const [text, className] = map[state] || map.off;
        lblStartupStatus.textContent = text;
        lblStartupStatus.className = className;
    };

    /** Query the current startup registration and reflect it in the switch. */
    const refreshStartup = async () => {
        if (!chkStartup) return;
        try {
            const isRegistered = !!(await api.checkStartup());
            chkStartup.checked = isRegistered;
            renderStartupStatus(isRegistered ? "on" : "off");
        } catch (err) {
            console.error("スタートアップ確認エラー:", err);
            renderStartupStatus("off");
        }
    };

    /**
     * Poll the startup registration until it reaches the wanted state.
     * ショートカット作成は PowerShell 経由で非同期のため、反映を少し待つ。
     *
     * @param {boolean} want - Desired registration state.
     * @returns {Promise<boolean>} Final observed state.
     */
    const waitForStartupState = async (want) => {
        for (let attempt = 0; attempt < 12; attempt++) {
            let state = false;
            try {
                state = !!(await api.checkStartup());
            } catch (err) {
                state = false;
            }
            if (state === want) return state;
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
        try {
            return !!(await api.checkStartup());
        } catch (err) {
            return false;
        }
    };

    on(chkStartup, "change", async () => {
        if (startupBusy || !startupSupported) return;
        startupBusy = true;
        const wantOn = chkStartup.checked;
        chkStartup.disabled = true;
        if (startupLoading) startupLoading.classList.add("show");
        renderStartupStatus("checking");
        try {
            if (wantOn) api.registerStartup();
            else api.unRegisterStartup();
            const finalState = await waitForStartupState(wantOn);
            chkStartup.checked = finalState;
            renderStartupStatus(finalState ? "on" : "off");
            if (finalState === wantOn) {
                toast(wantOn ? "スタートアップに登録しました" : "スタートアップ登録を解除しました");
            } else {
                toast("スタートアップ設定を変更できませんでした", "error");
            }
        } catch (err) {
            console.error("スタートアップ変更エラー:", err);
            toast("スタートアップ設定の変更中にエラーが発生しました", "error");
            await refreshStartup();
        } finally {
            chkStartup.disabled = false;
            if (startupLoading) startupLoading.classList.remove("show");
            startupBusy = false;
        }
    });

    // ---- アプリ情報・初期状態 ----
    try {
        const info = api.getAppInfo ? await api.getAppInfo() : null;
        if (info) {
            const appVersion = $("appVersion");
            const aboutInfo = $("aboutInfo");
            if (appVersion && info.version) appVersion.textContent = `FilePathOpenner v${info.version}`;
            if (aboutInfo) {
                aboutInfo.textContent =
                    `FilePathOpenner v${info.version || "?"} — MIT License / 作者: suupaagorira`;
            }
            if (info.platform && info.platform !== "win32") {
                startupSupported = false;
                if (chkStartup) chkStartup.disabled = true;
                renderStartupStatus("unsupported");
            }
            if (Array.isArray(info.shortcutFailures) && info.shortcutFailures.length) {
                updateShortcutStatuses(info.shortcutFailures);
            }
        }
    } catch (err) {
        console.error("アプリ情報取得エラー:", err);
    }

    if (startupSupported) {
        renderStartupStatus("checking");
        await refreshStartup();
    }
})();
