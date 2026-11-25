# gemini-agent：案件フォルダの「案件の設定.md」からリンクを読む（NotebookLM・司令塔 Gem・レビュー Gem）

## Context
今は NotebookLM へ送るとき、開いている NotebookLM のタブを順に探して使う（`runnerui.js:238` の `findTab`）。そのため案件 A と B のノートブックを同時に開いていると、別の案件のノートブックに質問が送られる。
Gem の URL も、全案件で共通の設定値 1 つしか持てない。
ユーザーの要望：URL を案件ごとに登録したい。登録は、ローカルの案件フォルダから読み取る形にしたい。
実装の最初に `gemini-agent/.claude/specs/case-links.md` として仕様を書き出す。

## 受入条件
1. **設定ファイル**：案件フォルダの直下に置く、人が書く `案件の設定.md` から読む。形は 1 行 1 項目。
   - 例：`NotebookLM: https://…`・`司令塔 Gem: https://…`・`レビュー Gem: https://…`
   - 区切りは `:` でも `：` でもよい。行頭の `- ` もよい。知らない行は無視する。
   - 読むのは DOM に依存しない関数 `GK.caseconf.parse(text)` で、テストできるようにする。
2. **読むとき**：案件フォルダを選んだとき・許可を戻したとき・送る直前（mtime が変わっていれば読み直す）。
   - 拡張の保存領域（chrome.storage）には入れない。
3. **ファイルが無いとき**
   - 案件メモに「案件の設定.md を作る」ボタンを出す。ひな形を書き出し、項目は空欄にする。
   - パネルにも入力欄を置き、そこで入れた値はこのファイルへ書き戻す。手で書いた行・コメントは残し、該当の行だけを置き換える。
4. **URL の検査**
   - NotebookLM は `https://notebooklm.google.com/notebook/`、Gem は `https://gemini.google.com/` で始まること。照らす相手は `HOSTS()`（試験用のダミー画面も同じ扱いにする）。
   - 違っていれば、その項目は使わず、案件メモに「案件の設定.md の〇行目の URL が NotebookLM のものではありません」と出す。
5. **NotebookLM への送信**（質問箱・`ask_notebooklm`）
   - 登録あり：URL の前方一致（`?` と `#` は除く）で同じノートブックのタブを探す。開いていなければ、そのノートブックを開いてから送る。読み込みは既存の `waitLoaded` で待つ。
   - 登録なしで、タブが 1 つ：今までどおり。
   - 登録なしで、タブが 2 つ以上：送らずに止め、「どのノートブックか分かりません。案件の設定.md に NotebookLM の URL を書いてください」と出す。
6. **Gemini**（run・議事録）
   - 登録した Gem の URL で始まるタブを優先する。無ければ、今までどおり開いている Gemini のタブを使う（送信は止めない）。
   - 「司令塔 Gem を開く」と `review` は、案件の設定を先に使う。無ければパネルの設定（既定値）を使う。
7. 案件メモに「NotebookLM を開く」ボタンを足す。
8. **監査ログ**
   - 「案件の設定の読み込み」を記録する。残すのは件数と sha256 だけで、URL は入れない。
   - 送信の行の where は、今までどおりホスト名だけ。

## 非目標
- PDF・pptx・画像を読めるようにすること（読みたいときは NotebookLM に入れる）
- NotebookLM からノートブックの一覧を取ること（通信も画面の解析もしない）
- 1 つの案件に複数のノートブックを持つこと
- Gem の会話の URL から、どの Gem かを特定すること
- パネルの設定にある共通の URL をなくすこと（既定値として残す）
- HTML 版での読み込み（拡張だけ）
- 設定ファイルに URL 以外の項目（担当者・期限など）を足すこと

## 触るファイル
- **新規** `src/js/caseconf.js`：parse／検査／該当の行だけの書き戻し（`update(text, key, url)`）。build.mjs の JS_FILES に足す
- `src/js/runnerui.js`
  - `findTab` の横に `findCaseTab(kind)` を足す。照合・開く・止めるはここでまとめる
  - loadNote と同じ場所で、設定ファイルを読む
  - 案件メモに、リンクの行・作るボタン・開くボタンを足す
  - `run`（:439）と `ask_notebooklm`（:354）、「司令塔 Gem を開く」と `review` を、案件のリンクを使う形にする
  - `GK.agent.findCaseTab` を外に出す
- `src/js/qaui.js:79`・`src/js/meetui.js:108`：`findTab` を `findCaseTab` に替える
- `tests/`：caseconf の parse／検査／書き戻し、照合（前方一致・クエリの除去・2 タブで止める判定）
- `tools/ext-smoke.mjs`：ダミーの NotebookLM を 2 つ開き、設定ファイルにあるほうへ送られることを確かめる

使う既存のもの：`dirFs`（read/write/exists）・`readAsText`・`HOSTS()`・`waitLoaded`・`ensureContent`・`askTab`・`audit`。

## 検証
- `node --test tests/*.test.mjs`
  - parse：区切りの揺れ・知らない行
  - 検査：別のサイトの URL を使わない
  - 書き戻し：手で書いた行を残す
  - 古い案件（ファイルなし）
- `node tools/ext-smoke.mjs`
  - `fake-nlm.html?nb=A` と `?nb=B` を開き、設定ファイルを B にすると、質問箱の送信が B に届く
  - 設定ファイルが無く、タブが 2 つなら止まる
  - 登録したノートブックが閉じていれば、開いてから送る
  - パネルで入れた値がファイルへ書き戻される
  - 監査ログに URL が入らない
- 画面：幅 400px の案件メモでリンクの行を撮る。コンソールのエラーは 0
