# FilePathOpenner

FilePathOpenner は、クリップボードにコピーしたパスをショートカットキーで素早く開くための Electron 製アプリです。コピーしたテキストを整形してファイル/フォルダや URL を開き、Windows ではスタートアップへの登録もサポートします。

## Features

- **Clipboard Path Opening**: ショートカットでクリップボード上のパスを開きます。複数行なら改行区切りでそれぞれ開くことも、1 行に結合して開くことも可能です。
- **Parent Directory Option**: 別のショートカットで 1 階層上のディレクトリ（または URL の親）を開けます。
- **Input Cleanup**: 前後の空白除去や指定文字の削除など、パス整形オプションを備えます。
- **Base Path Prefix**: GUI 上で前提パスを設定し、相対パス検索時に先頭へ付加できます。
- **Path Fallback**: 指定したパスが存在しない場合、親ディレクトリを自動で開き、
  元のパスと移動した階層数を知らせます。
- **Customizable Shortcuts**: 設定画面から開くキーを自由に変更できます。
- **Tray Minimization**: ウィンドウを閉じてもアプリは終了せず、タスクトレイに常駐します。
- **Windows Startup Registration**: Windows 環境ではスタートアップフォルダにショートカットを作成・削除できます。

## Build Instructions

1. 依存関係をインストールします。

   ```bash
   npm install
   ```

2. アプリを起動する場合は次のコマンドを実行します。

   ```bash
   npm start
   ```

3. ポータブル版をビルドするには以下を実行します。成果物は `release/` ディレクトリに生成されます。

   ```bash
   npm run dist
   ```

## Known Limitations

- スタートアップ登録機能は Windows のみに対応しています。
- 他 OS ではパスのオープン自体は動作しますが、細かな動作差異がある可能性があります。

## License

This project is licensed under the MIT License.
