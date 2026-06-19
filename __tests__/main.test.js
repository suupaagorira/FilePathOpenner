import { jest } from '@jest/globals';
import path from 'path';
jest.unstable_mockModule('fs', () => ({
  default: {
    existsSync: jest.fn(),
    unlink: jest.fn(),
  },
}));
jest.unstable_mockModule('child_process', () => ({ execFile: jest.fn() }));

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
  dialog: { showErrorBox: jest.fn(), showMessageBox: jest.fn() },
  app: {},
  BrowserWindow: {},
  globalShortcut: {},
  Menu: {},
  Tray: {},
  nativeImage: {},
  ipcMain: { on: jest.fn(), handle: jest.fn() }
};
jest.unstable_mockModule('electron', () => electronMock);

const fs = (await import('fs')).default;
const { openClipboardPath, checkIfStartupRegistered, unRegisterStartupShortcut, applyPrefixRules } = await import('../main.js');
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
    expect(shell.openPath).toHaveBeenCalledWith('C:\\Temp');
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

  test('openClipboardPath falls back to existing parent', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    clipboard.readText.mockReturnValue('/not/exist/file.txt');
    fs.existsSync.mockImplementation(p => p === '/not/exist');
    openClipboardPath(false);
    expect(shell.openPath).toHaveBeenCalledWith('/not/exist');
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'info',
      message: '"/not/exist/file.txt" は存在しません。1 階層上の "/not/exist" を開きます。'
    }));
  });

  test('openClipboardPath shows error when no part exists', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    clipboard.readText.mockReturnValue('Z:\\no\\path');
    fs.existsSync.mockReturnValue(false);
    openClipboardPath(false);
    expect(dialog.showErrorBox).toHaveBeenCalled();
  });

  test('openClipboardPath prefixes base path for relative path', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    storeData.basePath = '/home';
    clipboard.readText.mockReturnValue('docs/file.txt');
    fs.existsSync.mockReturnValue(true);
    openClipboardPath(false);
    expect(shell.openPath).toHaveBeenCalledWith(path.join('/home', 'docs/file.txt'));
  });

  test('openClipboardPath parent with base path', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    storeData.basePath = '/home';
    clipboard.readText.mockReturnValue('docs/file.txt');
    fs.existsSync.mockReturnValue(true);
    openClipboardPath(true);
    expect(shell.openPath).toHaveBeenCalledWith(path.join('/home', 'docs'));
  });

  test('applyPrefixRules combines base with matched text', () => {
    const rules = [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }];
    expect(applyPrefixRules('DOC-123', rules)).toEqual({
      target: 'https://intra/docs/DOC-123',
      matched: true,
    });
  });

  test('applyPrefixRules strips prefix when requested', () => {
    const rules = [{ prefix: 'id:', base: 'https://intra/view?id=', stripPrefix: true }];
    expect(applyPrefixRules('id:42', rules)).toEqual({
      target: 'https://intra/view?id=42',
      matched: true,
    });
  });

  test('applyPrefixRules returns unmatched when no rule applies', () => {
    expect(applyPrefixRules('plain', [{ prefix: 'X', base: 'Y' }])).toEqual({
      target: 'plain',
      matched: false,
    });
    expect(applyPrefixRules('plain', undefined)).toEqual({ target: 'plain', matched: false });
  });

  test('applyPrefixRules skips http URLs and absolute paths', () => {
    const rules = [
      { prefix: 'http', base: 'https://mirror/' },
      { prefix: 'C:', base: 'X' },
      { prefix: '/home', base: 'Y' },
    ];
    expect(applyPrefixRules('https://example.com', rules)).toEqual({
      target: 'https://example.com',
      matched: false,
    });
    expect(applyPrefixRules('C:\\Users\\file.txt', rules)).toEqual({
      target: 'C:\\Users\\file.txt',
      matched: false,
    });
    expect(applyPrefixRules('/home/file.txt', rules)).toEqual({
      target: '/home/file.txt',
      matched: false,
    });
  });

  test('openClipboardPath opens URL built from prefix rule', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    storeData.prefixRules = [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }];
    clipboard.readText.mockReturnValue('DOC-123');
    openClipboardPath(false);
    expect(shell.openExternal).toHaveBeenCalledWith('https://intra/docs/DOC-123');
  });

  test('openClipboardPath opens shared folder built from prefix rule', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    storeData.prefixRules = [{ prefix: '案件', base: '\\\\server\\share\\', stripPrefix: false }];
    clipboard.readText.mockReturnValue('案件A\\資料');
    fs.existsSync.mockReturnValue(true);
    openClipboardPath(false);
    expect(shell.openPath).toHaveBeenCalledWith('\\\\server\\share\\案件A\\資料');
  });

  test('openClipboardPath prefix rule takes precedence over base path', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    storeData.basePath = '/home';
    storeData.prefixRules = [{ prefix: 'g/', base: 'https://g/', stripPrefix: true }];
    clipboard.readText.mockReturnValue('g/page');
    openClipboardPath(false);
    expect(shell.openExternal).toHaveBeenCalledWith('https://g/page');
  });

  test('openClipboardPath does not rewrite existing URL via prefix rule', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    storeData.prefixRules = [{ prefix: 'http', base: 'https://mirror/' }];
    clipboard.readText.mockReturnValue('https://example.com/page');
    openClipboardPath(false);
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/page');
  });

  test('openClipboardPath opens parent URL built from prefix rule', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    storeData.prefixRules = [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }];
    clipboard.readText.mockReturnValue('DOC-123');
    openClipboardPath(true);
    expect(shell.openExternal).toHaveBeenCalledWith('https://intra/docs');
  });

  test('openClipboardPath applies prefix rule after trimSpaces', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = true;
    storeData.removeList = '';
    storeData.prefixRules = [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }];
    clipboard.readText.mockReturnValue('  DOC-123  ');
    openClipboardPath(false);
    expect(shell.openExternal).toHaveBeenCalledWith('https://intra/docs/DOC-123');
  });

  test('openClipboardPath applies prefix rule after removeList trimming', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '"';
    storeData.prefixRules = [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }];
    clipboard.readText.mockReturnValue('"DOC-123"');
    openClipboardPath(false);
    expect(shell.openExternal).toHaveBeenCalledWith('https://intra/docs/DOC-123');
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
