import { jest } from '@jest/globals';
jest.unstable_mockModule('fs', () => ({
  default: {
    existsSync: jest.fn(),
    unlink: jest.fn(),
  },
}));
jest.unstable_mockModule('child_process', () => ({ exec: jest.fn(), execFile: jest.fn() }));

const storeData = {};
const getMock = jest.fn(key => storeData[key]);
const setMock = jest.fn(obj => Object.assign(storeData, obj));

jest.unstable_mockModule('electron-store', () => ({
  default: jest.fn().mockImplementation(() => ({
    get: getMock,
    set: setMock,
    store: storeData,
  }))
}));

const electronMock = {
  clipboard: { readText: jest.fn() },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showErrorBox: jest.fn() },
  app: {}, BrowserWindow: {}, globalShortcut: {}, Menu: {}, Tray: {}, nativeImage: {}, ipcMain: { on: jest.fn(), handle: jest.fn() }
};
jest.unstable_mockModule('electron', () => electronMock);

const fs = (await import('fs')).default;
const { exec } = await import('child_process');
const { openClipboardPath, checkIfStartupRegistered, unRegisterStartupShortcut } = await import('../main.js');
const { clipboard, shell, dialog } = electronMock;

describe('main.js utilities', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
    for (const k of Object.keys(storeData)) delete storeData[k];
  });

  test('openClipboardPath opens existing path on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = true;
    storeData.removeList = '"';
    clipboard.readText.mockReturnValue('  C:\\Temp  ');
    fs.existsSync.mockReturnValue(true);
    openClipboardPath(false);
    expect(exec).toHaveBeenCalledWith('start "" "C:\\Temp"');
  });

  test('openClipboardPath opens parent url', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    clipboard.readText.mockReturnValue('https://example.com/dir/file.txt');
    openClipboardPath(true);
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/dir');
  });

  test('openClipboardPath shows error for missing path', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    clipboard.readText.mockReturnValue('/not/exist');
    fs.existsSync.mockReturnValue(false);
    openClipboardPath(false);
    expect(dialog.showErrorBox).toHaveBeenCalled();
  });

  test('checkIfStartupRegistered returns true when shortcut exists', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.APPDATA = '/home';
    fs.existsSync.mockReturnValue(true);
    expect(checkIfStartupRegistered()).toBe(true);
  });

  test('unRegisterStartupShortcut removes file if exists', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.APPDATA = '/home';
    fs.existsSync.mockReturnValue(true);
    fs.unlink = jest.fn((_, cb) => cb());
    unRegisterStartupShortcut();
    expect(fs.unlink).toHaveBeenCalled();
  });
});
