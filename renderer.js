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

    /**
     * Persist the current prefix rule list to the main process.
     *
     * @returns {void}
     */
    const savePrefixRules = () => {
        updateSetting("prefixRules", prefixRules);
    };

    /**
     * Build a single editable prefix-rule row element.
     *
     * @param {{prefix: string, base: string, stripPrefix?: boolean}} rule - The rule data.
     * @param {number} index - Index of the rule within the list.
     * @returns {HTMLDivElement} The row element.
     */
    const buildRuleRow = (rule, index) => {
        const row = document.createElement("div");
        row.className = "prefix-rule";

        const prefixInput = document.createElement("input");
        prefixInput.type = "text";
        prefixInput.className = "rule-prefix";
        prefixInput.placeholder = "先頭パターン (例: DOC-)";
        prefixInput.value = rule.prefix || "";
        prefixInput.addEventListener("input", () => {
            prefixRules[index].prefix = prefixInput.value;
        });
        prefixInput.addEventListener("blur", savePrefixRules);

        const baseInput = document.createElement("input");
        baseInput.type = "text";
        baseInput.className = "rule-base";
        baseInput.placeholder = "結合する文字列 (URL / 共有フォルダ等)";
        baseInput.value = rule.base || "";
        baseInput.addEventListener("input", () => {
            prefixRules[index].base = baseInput.value;
        });
        baseInput.addEventListener("blur", savePrefixRules);

        const stripLabel = document.createElement("label");
        stripLabel.className = "rule-strip";
        const stripChk = document.createElement("input");
        stripChk.type = "checkbox";
        stripChk.checked = !!rule.stripPrefix;
        stripChk.addEventListener("change", () => {
            prefixRules[index].stripPrefix = stripChk.checked;
            savePrefixRules();
        });
        stripLabel.appendChild(stripChk);
        stripLabel.appendChild(document.createTextNode("パターンを除去"));

        const delBtn = document.createElement("button");
        delBtn.className = "rule-delete";
        delBtn.innerText = "削除";
        delBtn.addEventListener("click", () => {
            prefixRules.splice(index, 1);
            savePrefixRules();
            renderPrefixRules();
        });

        row.append(prefixInput, baseInput, stripLabel, delBtn);
        return row;
    };

    /**
     * Re-render the whole prefix-rule list from the current state.
     *
     * @returns {void}
     */
    function renderPrefixRules() {
        prefixRulesContainer.innerHTML = "";
        if (prefixRules.length === 0) {
            const empty = document.createElement("div");
            empty.className = "prefix-rule-empty";
            empty.innerText = "ルールがありません。「ルールを追加」で作成してください。";
            prefixRulesContainer.appendChild(empty);
            return;
        }
        prefixRules.forEach((rule, index) => {
            prefixRulesContainer.appendChild(buildRuleRow(rule, index));
        });
    }

    btnAddPrefixRule.addEventListener("click", () => {
        prefixRules.push({ prefix: "", base: "", stripPrefix: false });
        savePrefixRules();
        renderPrefixRules();
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
