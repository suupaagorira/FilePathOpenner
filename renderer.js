// renderer.js
// index.html上で動作するフロントエンド処理

(async () => {
    const { updateSettings, registerStartup, checkStartup, unRegisterStartup, getSettings } = window.electronAPI;

    // index.htmlの各DOM要素
    const txtOpenShortcut = document.getElementById("txtOpenShortcut");
    const btnSetOpenShortcut = document.getElementById("btnSetOpenShortcut");

    const txtOpenParentShortcut = document.getElementById("txtOpenParentShortcut");
    const btnSetOpenParentShortcut = document.getElementById("btnSetOpenParentShortcut");

    const chkSinglePath = document.getElementById("chkSinglePath");
    const chkTrimSpaces = document.getElementById("chkTrimSpaces");
    const txtRemoveList = document.getElementById("txtRemoveList");
    const txtBasePath = document.getElementById("txtBasePath");
    const btnSetBasePath = document.getElementById("btnSetBasePath");

    const prefixRulesContainer = document.getElementById("prefixRulesContainer");
    const btnAddPrefixRule = document.getElementById("btnAddPrefixRule");

    const lblStartupStatus = document.getElementById("lblStartupStatus");
    const btnRegisterStartup = document.getElementById("btnRegisterStartup");
    const btnUnRegisterStartup = document.getElementById("btnUnRegisterStartup");
    const divStartupLoading = document.getElementById("startupLoading");

    // Electronストアから現在の設定を読み出し
    let currentSettings = {};
    try {
        currentSettings = await getSettings();
    } catch (err) {
        console.error("設定読み込みエラー:", err);
    }

    // UIへ反映
    txtOpenShortcut.value = currentSettings.openShortcut || "Ctrl+E";
    txtOpenParentShortcut.value = currentSettings.openParentShortcut || "Ctrl+Shift+E";
    chkSinglePath.checked = !!currentSettings.openAsSinglePath;
    chkTrimSpaces.checked = !!currentSettings.trimSpaces;
    txtRemoveList.value = currentSettings.removeList || "\"'<>＜＞[]{}";
    txtBasePath.value = currentSettings.basePath || "";

    // スタートアップ登録をチェック
    try {
        const isRegistered = await checkStartup();
        lblStartupStatus.innerText = isRegistered ? "する" : "しない";
        lblStartupStatus.style.color = isRegistered ? "green" : "red";
    } catch (err) {
        console.error("スタートアップ確認エラー:", err);
    }

    // 更新ボタンを押した際の動作
    const updateSetting = (key, value) => {
        currentSettings[key] = value;
        // メインプロセスに設定を送信して保存・グローバルショートカット再登録
        updateSettings(currentSettings);
    };

    btnSetOpenShortcut.addEventListener("click", () => {
        updateSetting("openShortcut", txtOpenShortcut.value);
    });
    btnSetOpenParentShortcut.addEventListener("click", () => {
        updateSetting("openParentShortcut", txtOpenParentShortcut.value);
    });
    btnSetBasePath.addEventListener("click", () => {
        updateSetting("basePath", txtBasePath.value);
    });

    // --- プレフィックス判定ルール ---
    let prefixRules = Array.isArray(currentSettings.prefixRules)
        ? currentSettings.prefixRules
        : [];
    let prefixRulesSaveTimer = null;

    /**
     * Persist the current prefix rule list to the main process.
     *
     * @returns {void}
     */
    const savePrefixRules = () => {
        clearTimeout(prefixRulesSaveTimer);
        updateSetting("prefixRules", prefixRules);
    };

    /**
     * Schedule a debounced save for prefix rule text edits.
     *
     * @returns {void}
     */
    const scheduleSavePrefixRules = () => {
        clearTimeout(prefixRulesSaveTimer);
        prefixRulesSaveTimer = setTimeout(savePrefixRules, 400);
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
        const result = `${base || ""}${body}`;
        return `例: 「${sample}」→「${result}」`;
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
        if (targetIndex < 0 || targetIndex >= prefixRules.length) {
            return;
        }
        [prefixRules[index], prefixRules[targetIndex]] = [
            prefixRules[targetIndex],
            prefixRules[index],
        ];
        savePrefixRules();
        renderPrefixRules();
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

        const header = document.createElement("div");
        header.className = "prefix-rule-header";

        const number = document.createElement("span");
        number.className = "prefix-rule-number";
        number.innerText = `ルール ${index + 1}`;

        const actions = document.createElement("div");
        actions.className = "prefix-rule-actions";

        const upBtn = document.createElement("button");
        upBtn.type = "button";
        upBtn.className = "rule-move";
        upBtn.title = "上へ（優先度を上げる）";
        upBtn.innerText = "↑";
        upBtn.disabled = index === 0;
        upBtn.addEventListener("click", () => movePrefixRule(index, -1));

        const downBtn = document.createElement("button");
        downBtn.type = "button";
        downBtn.className = "rule-move";
        downBtn.title = "下へ（優先度を下げる）";
        downBtn.innerText = "↓";
        downBtn.disabled = index === total - 1;
        downBtn.addEventListener("click", () => movePrefixRule(index, 1));

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "rule-delete";
        delBtn.title = "このルールを削除";
        delBtn.innerText = "削除";
        delBtn.addEventListener("click", () => {
            prefixRules.splice(index, 1);
            savePrefixRules();
            renderPrefixRules();
        });

        actions.append(upBtn, downBtn, delBtn);
        header.append(number, actions);

        const prefixField = document.createElement("div");
        prefixField.className = "prefix-rule-field";
        const prefixLabel = document.createElement("label");
        prefixLabel.innerText = "先頭パターン";
        const prefixInput = document.createElement("input");
        prefixInput.type = "text";
        prefixInput.className = "rule-prefix";
        prefixInput.placeholder = "例: DOC-";
        prefixInput.value = rule.prefix || "";
        prefixField.append(prefixLabel, prefixInput);

        const baseField = document.createElement("div");
        baseField.className = "prefix-rule-field";
        const baseLabel = document.createElement("label");
        baseLabel.innerText = "結合文字列";
        const baseInput = document.createElement("input");
        baseInput.type = "text";
        baseInput.className = "rule-base";
        baseInput.placeholder = "例: https://intra/docs/ または \\\\server\\share\\";
        baseInput.value = rule.base || "";
        baseField.append(baseLabel, baseInput);

        const options = document.createElement("div");
        options.className = "prefix-rule-options";
        const stripLabel = document.createElement("label");
        stripLabel.className = "rule-strip";
        const stripChk = document.createElement("input");
        stripChk.type = "checkbox";
        stripChk.checked = !!rule.stripPrefix;
        stripLabel.append(stripChk, document.createTextNode("先頭パターンを除去して結合"));

        const preview = document.createElement("div");
        preview.className = "prefix-rule-preview";

        const refreshPreview = () => {
            preview.innerText = buildRulePreviewText(
                prefixInput.value,
                baseInput.value,
                stripChk.checked
            );
        };

        prefixInput.addEventListener("input", () => {
            prefixRules[index].prefix = prefixInput.value;
            refreshPreview();
            scheduleSavePrefixRules();
        });
        prefixInput.addEventListener("blur", savePrefixRules);

        baseInput.addEventListener("input", () => {
            prefixRules[index].base = baseInput.value;
            refreshPreview();
            scheduleSavePrefixRules();
        });
        baseInput.addEventListener("blur", savePrefixRules);

        stripChk.addEventListener("change", () => {
            prefixRules[index].stripPrefix = stripChk.checked;
            refreshPreview();
            savePrefixRules();
        });

        options.appendChild(stripLabel);
        refreshPreview();
        card.append(header, prefixField, baseField, options, preview);
        return card;
    };

    /**
     * Re-render the whole prefix-rule list from the current state.
     *
     * @param {{focusIndex?: number}} [options] - Optional render options.
     * @returns {void}
     */
    function renderPrefixRules(options = {}) {
        prefixRulesContainer.innerHTML = "";
        if (prefixRules.length === 0) {
            const empty = document.createElement("div");
            empty.className = "prefix-rule-empty";
            empty.innerText = "ルールがありません。「ルールを追加」で作成してください。";
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

    btnAddPrefixRule.addEventListener("click", () => {
        prefixRules.push({ prefix: "", base: "", stripPrefix: false });
        savePrefixRules();
        renderPrefixRules({ focusIndex: prefixRules.length - 1 });
    });

    renderPrefixRules();

    chkSinglePath.addEventListener("change", () => {
        updateSetting("openAsSinglePath", chkSinglePath.checked);
    });
    chkTrimSpaces.addEventListener("change", () => {
        updateSetting("trimSpaces", chkTrimSpaces.checked);
    });

    // テキストボックスはフォーカスが外れた時点で反映 (必要に応じてinputに変更)
    txtRemoveList.addEventListener("blur", () => {
        updateSetting("removeList", txtRemoveList.value);
    });

    // スタートアップ登録ボタン
    btnRegisterStartup.addEventListener("click", async () => {
        btnRegisterStartup.disabled = true;
        divStartupLoading.style.display = "block";
        try {
            registerStartup();
            const isRegistered = await checkStartup();
            lblStartupStatus.innerText = isRegistered ? "する" : "しない";
            lblStartupStatus.style.color = isRegistered ? "green" : "red";
        } catch (err) {
            console.error("スタートアップ登録エラー:", err);
        } finally {
            divStartupLoading.style.display = "none";
            btnRegisterStartup.disabled = false;
        }
    });
    // スタートアップ削除ボタン
    btnUnRegisterStartup.addEventListener("click", async () => {
        unRegisterStartup();
        // 再度チェック
        const isRegistered = await checkStartup();
        lblStartupStatus.innerText = isRegistered ? "する" : "しない";
        lblStartupStatus.style.color = isRegistered ? "green" : "red";
    });
})();
