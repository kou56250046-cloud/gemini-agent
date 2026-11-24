# Gemini エージェント

Gemini（Gem）と NotebookLM しか使えない環境で、Claude Code のように段階を踏んで案件を進めるためのツールです。
司令塔 Gem が「受付 → ヒヤリング → 仕様（承認） → 作成 → 自己点検 → 修正 → 仕上げ」で進めます。
このツールが、応答に含まれる図・文書・WBS・解説ページ・スライド・表を、決まった見た目のファイルにします。
作ったファイルは Google ドキュメント／スプレッドシート／スライド／NotebookLM に渡せます。

- ネットワークに出ません（外部送信なし・依存ゼロ）。貼った内容は保存しません
- サンプルとテストのデータはすべてダミーです

## 配布物

| ファイル | 使い方 |
|---|---|
| `output/gemini-agent.html` | ダブルクリックで開く。Gem の応答を「取り込み」タブに貼る |
| `output/extension/` | Chrome 拡張。サイドパネルの「エージェント」タブが Gemini の画面を操作して、送信・回収・道具の実行・保存を自動で行う |

### 拡張の入れ方
1. `chrome://extensions` を開き、「デベロッパー モード」をオンにする
2. 「パッケージ化されていない拡張機能を読み込む」で `output/extension` フォルダを選ぶ
3. 拡張のアイコンを押してサイドパネルを開き、「設定」に司令塔 Gem とレビュー Gem の URL を入れる

詳しい手順は、画面の「使い方」タブにあります。

## 開発

Node は組み立てとテストにだけ使います（npm パッケージは使いません）。

```bash
node build.mjs                    # output/gemini-agent.html と output/extension/
node --test tests/agent.test.mjs tests/artifacts.test.mjs tests/runner.test.mjs
node tools/ext-smoke.mjs          # 拡張の通し試験（Playwright の Chromium を使う）
```

構成と決まりは `.claude/CLAUDE.md`、仕様は `.claude/specs/` にあります。
