/** @jest-environment jsdom */
import { jest } from '@jest/globals';

// Prepare DOM elements required by renderer.js
beforeEach(() => {
    document.body.innerHTML = `
        <input id="txtOpenShortcut" />
        <button id="btnSetOpenShortcut"></button>
        <input id="txtOpenParentShortcut" />
        <button id="btnSetOpenParentShortcut"></button>
        <input id="chkSinglePath" type="checkbox" />
        <input id="chkTrimSpaces" type="checkbox" />
        <input id="txtRemoveList" />
        <input id="txtBasePath" />
        <button id="btnSetBasePath"></button>
        <button id="btnAddPrefixRule"></button>
        <div id="prefixRulesContainer"></div>
        <span id="lblStartupStatus"></span>
        <button id="btnRegisterStartup"></button>
        <button id="btnUnRegisterStartup"></button>
        <div id="startupLoading" style="display:none;"></div>
    `;
});

test('startup registration button shows loading and updates status', async () => {
    const registerStartup = jest.fn();
    const checkStartup = jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
    const getSettings = jest.fn().mockResolvedValue({});
    window.electronAPI = {
        updateSettings: jest.fn(),
        registerStartup,
        checkStartup,
        unRegisterStartup: jest.fn(),
        getSettings,
    };

    await import('../renderer.js');

    const btn = document.getElementById('btnRegisterStartup');
    const loading = document.getElementById('startupLoading');

    await btn.click();
    // Wait for async handlers
    await Promise.resolve();

    expect(registerStartup).toHaveBeenCalled();
    expect(checkStartup).toHaveBeenCalledTimes(2);
    expect(loading.style.display).toBe('none');
    expect(btn.disabled).toBe(false);
    expect(document.getElementById('lblStartupStatus').innerText).toBe('する');
});

test('renders existing prefix rules and adds a new one', async () => {
    jest.resetModules();
    const updateSettings = jest.fn();
    const getSettings = jest.fn().mockResolvedValue({
        prefixRules: [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }],
    });
    window.electronAPI = {
        updateSettings,
        registerStartup: jest.fn(),
        checkStartup: jest.fn().mockResolvedValue(false),
        unRegisterStartup: jest.fn(),
        getSettings,
    };

    await import('../renderer.js');
    await Promise.resolve();
    await Promise.resolve();

    const container = document.getElementById('prefixRulesContainer');
    expect(container.querySelectorAll('.prefix-rule').length).toBe(1);
    expect(container.querySelector('.rule-prefix').value).toBe('DOC-');
    expect(container.querySelector('.rule-base').value).toBe('https://intra/docs/');

    document.getElementById('btnAddPrefixRule').click();
    expect(container.querySelectorAll('.prefix-rule').length).toBe(2);

    const lastCall = updateSettings.mock.calls[updateSettings.mock.calls.length - 1][0];
    expect(lastCall.prefixRules.length).toBe(2);
});

test('deletes a prefix rule', async () => {
    jest.resetModules();
    const updateSettings = jest.fn();
    const getSettings = jest.fn().mockResolvedValue({
        prefixRules: [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }],
    });
    window.electronAPI = {
        updateSettings,
        registerStartup: jest.fn(),
        checkStartup: jest.fn().mockResolvedValue(false),
        unRegisterStartup: jest.fn(),
        getSettings,
    };

    await import('../renderer.js');
    await Promise.resolve();
    await Promise.resolve();

    const container = document.getElementById('prefixRulesContainer');
    container.querySelector('.rule-delete').click();
    await Promise.resolve();

    expect(container.querySelectorAll('.prefix-rule').length).toBe(0);
    expect(container.querySelector('.prefix-rule-empty')).not.toBeNull();
    const lastCall = updateSettings.mock.calls[updateSettings.mock.calls.length - 1][0];
    expect(lastCall.prefixRules).toEqual([]);
});

test('toggle stripPrefix saves setting', async () => {
    jest.resetModules();
    const updateSettings = jest.fn();
    const getSettings = jest.fn().mockResolvedValue({
        prefixRules: [{ prefix: 'id:', base: 'https://intra/view?id=', stripPrefix: false }],
    });
    window.electronAPI = {
        updateSettings,
        registerStartup: jest.fn(),
        checkStartup: jest.fn().mockResolvedValue(false),
        unRegisterStartup: jest.fn(),
        getSettings,
    };

    await import('../renderer.js');
    await Promise.resolve();
    await Promise.resolve();

    const stripChk = document.querySelector('.rule-strip input');
    stripChk.checked = true;
    stripChk.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    const lastCall = updateSettings.mock.calls[updateSettings.mock.calls.length - 1][0];
    expect(lastCall.prefixRules[0].stripPrefix).toBe(true);
});
