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

    const lblStartupStatus = document.getElementById("lblStartupStatus");
    const btnRegisterStartup = document.getElementById("btnRegisterStartup");
    const btnUnRegisterStartup = document.getElementById("btnUnRegisterStartup");

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
    txtRemoveList.value = currentSettings.removeList || "\"";

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
        registerStartup();
        // 再度チェック
        const isRegistered = await checkStartup();
        lblStartupStatus.innerText = isRegistered ? "する" : "しない";
        lblStartupStatus.style.color = isRegistered ? "green" : "red";
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
