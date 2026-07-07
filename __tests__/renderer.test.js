/** @jest-environment jsdom */
import { jest } from '@jest/globals';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Build the subset of index.html that renderer.js wires up.
const buildDom = () => {
    document.body.innerHTML = `
        <nav id="nav">
            <button class="nav-item active" data-panel="panelHome"></button>
            <button class="nav-item" data-panel="panelTester"></button>
        </nav>
        <main id="content">
            <section class="panel active" id="panelHome"></section>
            <section class="panel" id="panelTester"></section>
        </main>
        <span id="homeShortcutDisplay"></span>
        <span id="homeParentShortcutDisplay"></span>
        <span id="homeReadOnlyShortcutDisplay"></span>
        <input id="txtOpenShortcut" readonly />
        <div id="statusOpenShortcut"></div>
        <input id="txtOpenParentShortcut" readonly />
        <div id="statusOpenParentShortcut"></div>
        <input id="txtOpenReadOnlyShortcut" readonly />
        <div id="statusOpenReadOnlyShortcut"></div>
        <input id="chkSinglePath" type="checkbox" />
        <input id="chkTrimSpaces" type="checkbox" />
        <input id="txtRemoveList" />
        <input id="txtBasePath" />
        <button id="btnPickBasePath"></button>
        <div id="basePathPreview"></div>
        <button id="btnAddPrefixRule"></button>
        <div id="prefixRulesContainer"></div>
        <textarea id="txtTester"></textarea>
        <input id="chkTesterParent" type="checkbox" />
        <button id="btnLoadClipboard"></button>
        <button id="btnOpenTest"></button>
        <div id="testerResults"></div>
        <input id="chkStartup" type="checkbox" />
        <span id="lblStartupStatus"></span>
        <span id="startupLoading"></span>
        <div id="appVersion"></div>
        <div id="aboutInfo"></div>
        <div id="toastHost"></div>
        <div id="previewBanner" hidden></div>
    `;
};

const makeApi = (overrides = {}) => ({
    updateSettings: jest.fn().mockReturnValue({ ok: true, shortcutFailures: [] }),
    registerStartup: jest.fn(),
    unRegisterStartup: jest.fn(),
    checkStartup: jest.fn().mockResolvedValue(false),
    getSettings: jest.fn().mockResolvedValue({}),
    getAppInfo: jest.fn().mockResolvedValue({ version: '1.1.0', platform: 'win32', shortcutFailures: [] }),
    previewPaths: jest.fn().mockResolvedValue([]),
    openText: jest.fn().mockResolvedValue(true),
    getClipboardText: jest.fn().mockResolvedValue(''),
    pickFolder: jest.fn().mockResolvedValue(null),
    ...overrides,
});

const boot = async (overrides = {}) => {
    jest.resetModules();
    localStorage.clear();
    buildDom();
    const api = makeApi(overrides);
    window.electronAPI = api;
    await import('../renderer.js');
    await flush();
    await flush();
    return api;
};

const keydown = (el, init) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
};

const keyup = (el, init) => {
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }));
};

// 修飾キーを 1 回タップ（keydown + keyup）する
const tapModifier = (el, key, extra = {}) => {
    const flag = { Alt: 'altKey', Control: 'ctrlKey', Shift: 'shiftKey', Meta: 'metaKey' }[key];
    keydown(el, { key, code: key, [flag]: true, ...extra });
    keyup(el, { key, code: key, ...extra });
};

afterEach(() => {
    delete window.electronAPI;
});

describe('settings loading and auto-save', () => {
    test('loads settings into the UI', async () => {
        await boot({
            getSettings: jest.fn().mockResolvedValue({
                openShortcut: 'Ctrl+K',
                openParentShortcut: 'Ctrl+Shift+K',
                trimSpaces: true,
                openAsSinglePath: true,
                removeList: '"<>',
                basePath: 'C:\\Base',
                prefixRules: [],
            }),
        });

        expect(document.getElementById('txtOpenShortcut').value).toBe('Ctrl+K');
        expect(document.getElementById('txtOpenParentShortcut').value).toBe('Ctrl+Shift+K');
        expect(document.getElementById('chkTrimSpaces').checked).toBe(true);
        expect(document.getElementById('chkSinglePath').checked).toBe(true);
        expect(document.getElementById('txtRemoveList').value).toBe('"<>');
        expect(document.getElementById('txtBasePath').value).toBe('C:\\Base');
        const kbds = document.getElementById('homeShortcutDisplay').querySelectorAll('kbd');
        expect(Array.from(kbds).map(k => k.textContent)).toEqual(['Ctrl', 'K']);
        expect(document.getElementById('basePathPreview').textContent).toContain('C:\\Base');
    });

    test('checkbox settings default to on and save automatically on change', async () => {
        const api = await boot();
        const chk = document.getElementById('chkTrimSpaces');
        expect(chk.checked).toBe(true);
        chk.click();
        expect(api.updateSettings).toHaveBeenCalled();
        const lastCall = api.updateSettings.mock.calls.at(-1)[0];
        expect(lastCall.trimSpaces).toBe(false);
    });

    test('remove list and base path save on blur', async () => {
        const api = await boot();
        const txtRemoveList = document.getElementById('txtRemoveList');
        txtRemoveList.value = '[]';
        txtRemoveList.dispatchEvent(new Event('blur'));
        expect(api.updateSettings.mock.calls.at(-1)[0].removeList).toBe('[]');

        const txtBasePath = document.getElementById('txtBasePath');
        txtBasePath.value = 'C:\\Root';
        txtBasePath.dispatchEvent(new Event('input'));
        txtBasePath.dispatchEvent(new Event('blur'));
        expect(api.updateSettings.mock.calls.at(-1)[0].basePath).toBe('C:\\Root');
        expect(document.getElementById('basePathPreview').textContent).toContain('C:\\Root');
    });
});

describe('shortcut recorder', () => {
    test('captures a key combination and saves it', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        expect(input.value).toBe('キーを入力…');
        expect(input.classList.contains('recording')).toBe(true);

        keydown(input, { key: 'e', code: 'KeyE', ctrlKey: true, altKey: true });

        expect(input.value).toBe('Ctrl+Alt+E');
        expect(input.classList.contains('recording')).toBe(false);
        expect(api.updateSettings.mock.calls.at(-1)[0].openShortcut).toBe('Ctrl+Alt+E');
        expect(document.getElementById('statusOpenShortcut').textContent).toBe('有効');
    });

    test('cancels recording with Escape', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        keydown(input, { key: 'Escape', code: 'Escape' });

        expect(input.value).toBe('Ctrl+E');
        expect(api.updateSettings).not.toHaveBeenCalled();
    });

    test('clears the shortcut with Backspace', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        keydown(input, { key: 'Backspace', code: 'Backspace' });

        expect(input.value).toBe('');
        expect(api.updateSettings.mock.calls.at(-1)[0].openShortcut).toBe('');
        expect(document.getElementById('statusOpenShortcut').textContent).toContain('未設定');
    });

    test('rejects a combination already used by the other action', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        keydown(input, { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true });

        expect(input.value).toBe('Ctrl+E');
        expect(api.updateSettings).not.toHaveBeenCalled();
    });

    test('requires a modifier except for function keys', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        keydown(input, { key: 'e', code: 'KeyE' });
        expect(api.updateSettings).not.toHaveBeenCalled();
        expect(input.value).toContain('修飾キー');

        keydown(input, { key: 'F5', code: 'F5' });
        expect(input.value).toBe('F5');
        expect(api.updateSettings.mock.calls.at(-1)[0].openShortcut).toBe('F5');
    });

    test('shows an error status when registration fails', async () => {
        const api = await boot({
            updateSettings: jest.fn().mockReturnValue({ ok: true, shortcutFailures: ['Ctrl+Alt+E'] }),
        });
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        keydown(input, { key: 'e', code: 'KeyE', ctrlKey: true, altKey: true });

        expect(document.getElementById('statusOpenShortcut').textContent).toContain('失敗');
        expect(input.classList.contains('error')).toBe(true);
    });

    test('records the read-only shortcut into its own setting', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenReadOnlyShortcut');

        input.click();
        keydown(input, { key: 'r', code: 'KeyR', ctrlKey: true, altKey: true });

        expect(input.value).toBe('Ctrl+Alt+R');
        expect(api.updateSettings.mock.calls.at(-1)[0].openReadOnlyShortcut).toBe('Ctrl+Alt+R');
        expect(document.getElementById('statusOpenReadOnlyShortcut').textContent).toBe('有効');
    });

    test('rejects a combination already used by any other action', async () => {
        const api = await boot({
            getSettings: jest.fn().mockResolvedValue({ openReadOnlyShortcut: 'Ctrl+Alt+R' }),
        });
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        keydown(input, { key: 'r', code: 'KeyR', ctrlKey: true, altKey: true });

        expect(input.value).toBe('Ctrl+E');
        expect(api.updateSettings).not.toHaveBeenCalled();
    });
});

describe('double-tap modifier recording', () => {
    test('captures a quick Alt double tap as Alt×2', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        tapModifier(input, 'Alt');
        expect(input.value).toContain('Alt×2'); // 1 回目のタップでヒントを表示
        expect(input.classList.contains('recording')).toBe(true);
        tapModifier(input, 'Alt');

        expect(input.value).toBe('Alt×2');
        expect(input.classList.contains('recording')).toBe(false);
        expect(api.updateSettings.mock.calls.at(-1)[0].openShortcut).toBe('Alt×2');
        expect(document.getElementById('statusOpenShortcut').textContent).toBe('有効');
    });

    test('captures Shift-held Alt double tap as Shift+Alt×2', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        keydown(input, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
        tapModifier(input, 'Alt', { shiftKey: true });
        tapModifier(input, 'Alt', { shiftKey: true });

        expect(input.value).toBe('Shift+Alt×2');
        expect(api.updateSettings.mock.calls.at(-1)[0].openShortcut).toBe('Shift+Alt×2');
    });

    test('does not commit when the second tap is too slow', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');
        let now = 1000;
        const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

        input.click();
        tapModifier(input, 'Alt');
        now = 3000; // 2 回目のタップは 2 秒後
        tapModifier(input, 'Alt');
        nowSpy.mockRestore();

        expect(api.updateSettings).not.toHaveBeenCalled();
        expect(input.classList.contains('recording')).toBe(true);
        expect(input.value).toContain('Alt×2'); // ヒント表示のまま
    });

    test('a normal key between taps resets the double-tap sequence', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        tapModifier(input, 'Alt');
        keydown(input, { key: 'e', code: 'KeyE' }); // 修飾なしの通常キー → 却下 + タップ列リセット
        tapModifier(input, 'Alt');

        expect(api.updateSettings).not.toHaveBeenCalled();
        expect(input.classList.contains('recording')).toBe(true);
    });

    test('holding a modifier (auto-repeat) does not create a double tap', async () => {
        const api = await boot();
        const input = document.getElementById('txtOpenShortcut');

        input.click();
        keydown(input, { key: 'Alt', code: 'AltLeft', altKey: true });
        keydown(input, { key: 'Alt', code: 'AltLeft', altKey: true, repeat: true });
        keydown(input, { key: 'Alt', code: 'AltLeft', altKey: true, repeat: true });
        keyup(input, { key: 'Alt', code: 'AltLeft' });

        expect(api.updateSettings).not.toHaveBeenCalled();
        expect(input.classList.contains('recording')).toBe(true);
    });

    test('double-tap shortcut renders as keyboard chips on the home panel', async () => {
        await boot({
            getSettings: jest.fn().mockResolvedValue({ openShortcut: 'Shift+Alt×2' }),
        });
        const kbds = document.getElementById('homeShortcutDisplay').querySelectorAll('kbd');
        expect(Array.from(kbds).map(k => k.textContent)).toEqual(['Shift', 'Alt×2']);
    });
});

describe('prefix rules', () => {
    const rulesSettings = () => ({
        prefixRules: [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }],
    });

    test('renders existing prefix rules and adds a new one', async () => {
        const api = await boot({ getSettings: jest.fn().mockResolvedValue(rulesSettings()) });

        const container = document.getElementById('prefixRulesContainer');
        expect(container.querySelectorAll('.prefix-rule-card').length).toBe(1);
        expect(container.querySelector('.rule-prefix').value).toBe('DOC-');
        expect(container.querySelector('.rule-base').value).toBe('https://intra/docs/');
        expect(container.querySelector('.prefix-rule-preview').innerText).toContain('DOC-123');

        document.getElementById('btnAddPrefixRule').click();
        expect(container.querySelectorAll('.prefix-rule-card').length).toBe(2);

        const lastCall = api.updateSettings.mock.calls.at(-1)[0];
        expect(lastCall.prefixRules.length).toBe(2);
    });

    test('deletes a prefix rule', async () => {
        const api = await boot({ getSettings: jest.fn().mockResolvedValue(rulesSettings()) });

        const container = document.getElementById('prefixRulesContainer');
        container.querySelector('.rule-delete').click();
        await flush();

        expect(container.querySelectorAll('.prefix-rule-card').length).toBe(0);
        expect(container.querySelector('.prefix-rule-empty')).not.toBeNull();
        const lastCall = api.updateSettings.mock.calls.at(-1)[0];
        expect(lastCall.prefixRules).toEqual([]);
    });

    test('toggle stripPrefix saves setting', async () => {
        const api = await boot({
            getSettings: jest.fn().mockResolvedValue({
                prefixRules: [{ prefix: 'id:', base: 'https://intra/view?id=', stripPrefix: false }],
            }),
        });

        const stripChk = document.querySelector('.rule-strip input');
        stripChk.checked = true;
        stripChk.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();

        const lastCall = api.updateSettings.mock.calls.at(-1)[0];
        expect(lastCall.prefixRules[0].stripPrefix).toBe(true);
    });

    test('reorders prefix rules with move buttons', async () => {
        const api = await boot({
            getSettings: jest.fn().mockResolvedValue({
                prefixRules: [
                    { prefix: 'A-', base: 'https://a/', stripPrefix: false },
                    { prefix: 'B-', base: 'https://b/', stripPrefix: false },
                ],
            }),
        });

        const container = document.getElementById('prefixRulesContainer');
        const cards = container.querySelectorAll('.prefix-rule-card');
        expect(cards.length).toBe(2);
        expect(cards[0].querySelector('.rule-prefix').value).toBe('A-');

        cards[1].querySelector('.rule-move').click();
        await flush();

        const reordered = container.querySelectorAll('.prefix-rule-card');
        expect(reordered[0].querySelector('.rule-prefix').value).toBe('B-');
        expect(reordered[1].querySelector('.rule-prefix').value).toBe('A-');

        const lastCall = api.updateSettings.mock.calls.at(-1)[0];
        expect(lastCall.prefixRules[0].prefix).toBe('B-');
        expect(lastCall.prefixRules[1].prefix).toBe('A-');
    });
});

describe('tester panel', () => {
    test('renders dry-run results with badges', async () => {
        const api = await boot({
            previewPaths: jest.fn().mockResolvedValue([
                {
                    input: 'DOC-1', target: 'https://intra/docs/DOC-1', isUrl: true,
                    kind: 'url', openPath: 'https://intra/docs/DOC-1', levels: 0, isDirectory: false,
                },
                {
                    input: 'C:\\miss\\a.txt', target: 'C:\\miss\\a.txt', isUrl: false,
                    kind: 'missing', openPath: null, levels: 0, isDirectory: false,
                },
                {
                    input: 'C:\\deep\\b.txt', target: 'C:\\deep\\b.txt', isUrl: false,
                    kind: 'fallback', openPath: 'C:\\deep', levels: 1, isDirectory: true,
                },
            ]),
        });

        const txtTester = document.getElementById('txtTester');
        txtTester.value = 'DOC-1\nC:\\miss\\a.txt\nC:\\deep\\b.txt';
        txtTester.dispatchEvent(new Event('change'));
        await flush();

        expect(api.previewPaths).toHaveBeenCalledWith('DOC-1\nC:\\miss\\a.txt\nC:\\deep\\b.txt', false);
        const rows = document.querySelectorAll('#testerResults .tr-row');
        expect(rows.length).toBe(3);
        expect(rows[0].querySelector('.badge').textContent).toBe('URL');
        expect(rows[0].querySelector('.tr-target').textContent).toBe('https://intra/docs/DOC-1');
        expect(rows[1].querySelector('.badge').textContent).toBe('見つかりません');
        expect(rows[2].querySelector('.badge').textContent).toBe('1 階層上を開く');
    });

    test('previews parent mode when the checkbox is on', async () => {
        const api = await boot();
        document.getElementById('chkTesterParent').checked = true;
        const txtTester = document.getElementById('txtTester');
        txtTester.value = 'C:\\dir\\file.txt';
        txtTester.dispatchEvent(new Event('change'));
        await flush();
        expect(api.previewPaths).toHaveBeenCalledWith('C:\\dir\\file.txt', true);
    });

    test('open button sends the tester text to the main process', async () => {
        const api = await boot();
        const txtTester = document.getElementById('txtTester');
        txtTester.value = 'C:\\dir';
        document.getElementById('btnOpenTest').click();
        await flush();
        expect(api.openText).toHaveBeenCalledWith('C:\\dir', false);
    });

    test('load clipboard button fills the textarea', async () => {
        const api = await boot({
            getClipboardText: jest.fn().mockResolvedValue('C:\\from\\clipboard'),
        });
        document.getElementById('btnLoadClipboard').click();
        await flush();
        expect(api.getClipboardText).toHaveBeenCalled();
        expect(document.getElementById('txtTester').value).toBe('C:\\from\\clipboard');
    });
});

describe('startup toggle', () => {
    test('registers startup when switched on', async () => {
        const checkStartup = jest.fn()
            .mockResolvedValueOnce(false) // initial refresh
            .mockResolvedValue(true);     // after registration
        const api = await boot({ checkStartup });

        const chk = document.getElementById('chkStartup');
        expect(chk.checked).toBe(false);

        chk.click();
        await flush();
        await flush();

        expect(api.registerStartup).toHaveBeenCalled();
        expect(chk.checked).toBe(true);
        expect(chk.disabled).toBe(false);
        expect(document.getElementById('lblStartupStatus').textContent).toBe('登録済み');
    });

    test('unregisters startup when switched off', async () => {
        const checkStartup = jest.fn()
            .mockResolvedValueOnce(true) // initial refresh
            .mockResolvedValue(false);   // after removal
        const api = await boot({ checkStartup });

        const chk = document.getElementById('chkStartup');
        expect(chk.checked).toBe(true);

        chk.click();
        await flush();
        await flush();

        expect(api.unRegisterStartup).toHaveBeenCalled();
        expect(chk.checked).toBe(false);
        expect(document.getElementById('lblStartupStatus').textContent).toBe('未登録');
    });

    test('disables the toggle on non-Windows platforms', async () => {
        await boot({
            getAppInfo: jest.fn().mockResolvedValue({
                version: '1.1.0', platform: 'darwin', shortcutFailures: [],
            }),
        });
        const chk = document.getElementById('chkStartup');
        expect(chk.disabled).toBe(true);
        expect(document.getElementById('lblStartupStatus').textContent).toContain('利用できません');
    });
});

describe('miscellaneous', () => {
    test('shows the version from app info', async () => {
        await boot();
        expect(document.getElementById('appVersion').textContent).toContain('1.1.0');
        expect(document.getElementById('aboutInfo').textContent).toContain('1.1.0');
    });

    test('falls back to a preview API when electronAPI is missing', async () => {
        jest.resetModules();
        localStorage.clear();
        buildDom();
        delete window.electronAPI;
        await import('../renderer.js');
        await flush();
        await flush();
        expect(document.getElementById('previewBanner').hidden).toBe(false);
        expect(document.getElementById('txtOpenShortcut').value).toBe('Ctrl+E');
    });
});
