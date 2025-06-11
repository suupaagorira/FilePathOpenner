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
