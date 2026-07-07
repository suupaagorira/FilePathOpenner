import { jest } from '@jest/globals';
import path from 'path';
jest.unstable_mockModule('fs', () => ({
  default: {
    existsSync: jest.fn(),
    unlink: jest.fn(),
    statSync: jest.fn(),
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

const uIOhookMock = { on: jest.fn(), start: jest.fn(), stop: jest.fn() };
jest.unstable_mockModule('uiohook-napi', () => ({
  default: {
    uIOhook: uIOhookMock,
    UiohookKey: {
      Ctrl: 29, CtrlRight: 3613,
      Alt: 56, AltRight: 3640,
      Shift: 42, ShiftRight: 54,
      Meta: 3675, MetaRight: 3676,
    },
  },
}));

const electronMock = {
  clipboard: { readText: jest.fn() },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showErrorBox: jest.fn(), showMessageBox: jest.fn() },
  app: {},
  BrowserWindow: {},
  globalShortcut: { register: jest.fn().mockReturnValue(true), unregisterAll: jest.fn() },
  Menu: {},
  Tray: {},
  nativeImage: {},
  ipcMain: { on: jest.fn(), handle: jest.fn() }
};
jest.unstable_mockModule('electron', () => electronMock);

const fs = (await import('fs')).default;
const { execFile } = await import('child_process');
const {
  openClipboardPath,
  openTextTargets,
  registerGlobalShortcuts,
  checkIfStartupRegistered,
  unRegisterStartupShortcut,
  applyPrefixRules,
  previewClipboardText,
} = await import('../main.js');
const { clipboard, shell, dialog } = electronMock;

// uiohook のキーイベントリスナーは main.js の import 時に一度だけ登録される。
// afterEach の clearAllMocks で消える前にここで捕まえておく。
const uiohookListeners = Object.fromEntries(uIOhookMock.on.mock.calls);

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

  test('previewClipboardText classifies url, exact, fallback and missing entries', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = true;
    storeData.removeList = '"';
    storeData.basePath = '';
    storeData.prefixRules = [{ prefix: 'DOC-', base: 'https://intra/docs/', stripPrefix: false }];
    fs.existsSync.mockImplementation(p => p === '/data' || p === '/data/file.txt');
    fs.statSync.mockImplementation(p => ({ isDirectory: () => p === '/data' }));

    const results = previewClipboardText('DOC-9\n/data/file.txt\n/data/missing/deep.txt\nZ:\\nope', false);

    expect(results).toHaveLength(4);
    expect(results[0]).toMatchObject({ kind: 'url', target: 'https://intra/docs/DOC-9', isUrl: true });
    expect(results[1]).toMatchObject({
      kind: 'exact', openPath: '/data/file.txt', levels: 0, isDirectory: false,
    });
    expect(results[2]).toMatchObject({ kind: 'fallback', openPath: '/data', levels: 2 });
    expect(results[3]).toMatchObject({ kind: 'missing', openPath: null });
    expect(shell.openPath).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(dialog.showErrorBox).not.toHaveBeenCalled();
  });

  test('previewClipboardText previews parent-opening behavior', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    clipboard.readText.mockReturnValue('');
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ isDirectory: () => true });

    const results = previewClipboardText('https://example.com/dir/file.txt\n/data/dir/file.txt', true);

    expect(results[0]).toMatchObject({ kind: 'url', target: 'https://example.com/dir' });
    expect(results[1]).toMatchObject({ kind: 'exact', target: '/data/dir', isDirectory: true });
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

describe('registerGlobalShortcuts with double-tap accelerators', () => {
  const { globalShortcut } = electronMock;

  afterEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(storeData)) delete storeData[k];
    // フックの状態をリセット（2連打バインドなしで再登録すると stop される）
    registerGlobalShortcuts();
    jest.clearAllMocks();
  });

  test('routes ordinary accelerators to globalShortcut and double taps to the key hook', () => {
    storeData.openShortcut = 'Ctrl+E';
    storeData.openParentShortcut = 'Shift+Alt×2';
    storeData.openReadOnlyShortcut = 'Alt×2';

    const failures = registerGlobalShortcuts();

    expect(failures).toEqual([]);
    expect(globalShortcut.register).toHaveBeenCalledTimes(1);
    expect(globalShortcut.register).toHaveBeenCalledWith('Ctrl+E', expect.any(Function));
    expect(uIOhookMock.start).toHaveBeenCalledTimes(1);
  });

  test('stops the key hook when no double-tap binding remains', () => {
    storeData.openShortcut = 'Alt×2';
    registerGlobalShortcuts();
    expect(uIOhookMock.start).toHaveBeenCalled();

    storeData.openShortcut = 'Ctrl+E';
    registerGlobalShortcuts();
    expect(uIOhookMock.stop).toHaveBeenCalled();
  });

  test('reports an invalid double-tap accelerator as a failure', () => {
    storeData.openShortcut = 'E×2';
    const failures = registerGlobalShortcuts();
    expect(failures).toEqual(['E×2']);
    expect(uIOhookMock.start).not.toHaveBeenCalled();
  });

  test('a global Alt double tap opens the clipboard path', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    storeData.openShortcut = 'Alt×2';
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
    clipboard.readText.mockReturnValue('C:\\Temp');
    fs.existsSync.mockReturnValue(true);
    registerGlobalShortcuts();

    const ALT = 56;
    uiohookListeners.keydown({ keycode: ALT });
    uiohookListeners.keyup({ keycode: ALT });
    uiohookListeners.keydown({ keycode: ALT });
    uiohookListeners.keyup({ keycode: ALT });

    expect(shell.openPath).toHaveBeenCalledWith('C:\\Temp');
  });
});

describe('read-only opening', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    for (const k of Object.keys(storeData)) delete storeData[k];
  });

  const setupOpenSettings = () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    storeData.openAsSinglePath = false;
    storeData.trimSpaces = false;
    storeData.removeList = '';
  };

  test('opens an Excel file read-only through PowerShell COM automation', () => {
    setupOpenSettings();
    fs.existsSync.mockReturnValue(true);

    openTextTargets('C:\\docs\\book.xlsx', false, { readOnly: true });

    expect(shell.openPath).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args] = execFile.mock.calls[0];
    expect(file).toBe('powershell.exe');
    const script = args[args.indexOf('-Command') + 1];
    expect(script).toContain("'Excel.Application'");
    expect(script).toContain("$path = 'C:\\docs\\book.xlsx'");
    expect(script).toContain('$app.Workbooks.Open($path, 0, $true)');
  });

  test('selects Word and PowerPoint by extension', () => {
    setupOpenSettings();
    fs.existsSync.mockReturnValue(true);

    openTextTargets('C:\\docs\\spec.docx', false, { readOnly: true });
    openTextTargets('C:\\docs\\deck.pptx', false, { readOnly: true });

    const scripts = execFile.mock.calls.map(call => call[1][call[1].indexOf('-Command') + 1]);
    expect(scripts[0]).toContain("'Word.Application'");
    expect(scripts[1]).toContain("'PowerPoint.Application'");
  });

  test('escapes single quotes in the file path', () => {
    setupOpenSettings();
    fs.existsSync.mockReturnValue(true);

    openTextTargets("C:\\docs\\o'brien.xlsx", false, { readOnly: true });

    const [, args] = execFile.mock.calls[0];
    const script = args[args.indexOf('-Command') + 1];
    expect(script).toContain("$path = 'C:\\docs\\o''brien.xlsx'");
  });

  test('falls back to a normal open for non-Office files', () => {
    setupOpenSettings();
    fs.existsSync.mockReturnValue(true);

    openTextTargets('C:\\docs\\readme.txt', false, { readOnly: true });

    expect(execFile).not.toHaveBeenCalled();
    expect(shell.openPath).toHaveBeenCalledWith('C:\\docs\\readme.txt');
  });

  test('shows an error dialog when PowerShell fails', () => {
    setupOpenSettings();
    fs.existsSync.mockReturnValue(true);
    execFile.mockImplementationOnce((file, args, options, cb) => cb(new Error('boom')));

    openTextTargets('C:\\docs\\book.xlsx', false, { readOnly: true });

    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '読み取り専用で開けませんでした', expect.stringContaining('book.xlsx'));
  });

  test('openClipboardPath forwards the readOnly option', () => {
    setupOpenSettings();
    clipboard.readText.mockReturnValue('C:\\docs\\book.xlsx');
    fs.existsSync.mockReturnValue(true);

    openClipboardPath(false, { readOnly: true });

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  test('URLs still open in the browser in read-only mode', () => {
    setupOpenSettings();
    openTextTargets('https://example.com/page', false, { readOnly: true });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/page');
    expect(execFile).not.toHaveBeenCalled();
  });
});
