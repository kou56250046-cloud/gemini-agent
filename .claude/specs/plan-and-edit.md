# gemini-agent 弾5：計画モード・選択肢つきの提案・ファイルの編集・書ける場所・検索の強化・横断調査・xlsx/docx の編集

## Context
ユーザーの要望は 2 つある。
- 前回あげた 1〜5 を入れたい
  1. edit_file
  2. 書ける場所の指定
  3. 検索の強化
  4. 横断調査
  5. xlsx・docx の編集
- Claude Code の plan mode のように、Gemini に計画を立てさせたり提案させたりしたい

現状の問題は 3 つある。
- 書けるのは `out/` の新規ファイルだけで、既存ファイルは直せない
- 検索は部分一致だけ
- 人の判断は段階 3 のゲートと ask_user（自由記述）だけ

ファイルを直せるようにするので、「読むだけで計画 → 人が承認 → 実行」の流れを、拡張側で強制する。プロンプトの約束事には頼らない。
仕様は実装の最初に `gemini-agent/.claude/specs/plan-and-edit.md` に書き出す。規模は M。

## A. 計画モード（plan mode）
- パネルの依頼欄の上に、モードの切り替えを置く。選択は設定に保存し、既定は計画。
  - 「計画（読むだけ）」
  - 「実行（書く前に許可）」
- 計画モードで使える道具：list_dir・read_file・search・ask_notebooklm・ask_user。
  - 書く道具（write_file・edit_file・edit_xlsx・edit_docx・render）は execTool で拒む。拒んだときは「計画モードでは書けません。計画を ```plan で出してください」と返す。
- Gemini は調べ終えたら、応答の最後に ```plan の囲み（Markdown）を出す。
  - `runner.decide` は、これを `{type:"plan"}` として扱う。
  - 計画の形は protocol と司令塔 Gem の指示文で決める：目的・調べたこと（ファイルと要点）・変更するファイルと変更内容・作るファイル・非目標・確かめ方・危険と戻し方。
- パネルに計画のカードを出す。表示は既存の `GK.md.render`。ボタンは 3 つ。
  - 「承認して実行」
  - 「直してほしい点を送る」（入力欄つき）
  - 「やめる」
- 計画は `case/計画/YYYYMMDD-HHMM_<題>.md` に保存し、状態（承認／差し戻し／取りやめ）を書く。
- 承認すると、モードを実行に切り替えて送る：「【計画の承認】この計画どおりに進めてください。計画にない変更は ask_user で聞いてください」。
  - 計画の「変更するファイル」からパスを抜き出して覚えておく。
  - 実行中に計画にないファイルを書くときは、許可の画面に「計画にないファイル」と赤で出す。
- 監査ログには「計画の提出」「計画の承認／差し戻し」を、sha256 と文字数だけで残す。

## B. 選択肢つきの提案（AskUserQuestion 相当）
- ask_user に `options: [{label, detail}]` と `recommend`（label）を足せるようにする。
- options があれば、ゲートの枠に選択肢のボタンを出す。
  - 推奨の選択肢には「おすすめ」と付ける。
  - 「その他（自由記述）」を必ず付ける。
- 押すと「【人の返事】<label>（<detail>）」を返す。options が無ければ今までどおり自由記述。
- 司令塔 Gem の指示文に、方針が分かれるときは options と推奨つきで聞くことを書く。

## C. ファイルの編集（1・5）
- 新しい部品 `src/js/edit.js`（DOM に依存しない。テストできる）
  - `applyEdit(text, old, new, all)`：置き換え対象が 0 件、または all でないのに 2 件以上なら失敗。改行は元のファイルに合わせる（CRLF／LF）。
  - `encodeLike(text, enc)`：UTF-8（BOM あり・なし）と Shift_JIS で書き戻す。Shift_JIS の書き出しはブラウザに無いので、`TextDecoder("shift_jis")` で逆引きの表を作る（初回だけ）。表に無い文字があれば止める。
  - `diff`：差分は既存の `GK.model.diffLines` を使う。
  - `xlsxSetCells(u8, sheet, cells)`：zip の中のシートの XML だけを差し替え、ほかの項目は圧縮したまま写す。
    - 書く値：文字は inlineStr、数値は `<v>`。
    - 数式のあるセルは、引数で上書きを許されていなければ止める。
    - 圧縮は `CompressionStream("deflate-raw")`、CRC は `GK.pptx.crc32` を使う。
  - `docxReplace(u8, old, new)`：1 つの `<w:t>` に収まる文だけを置き換える。段落をまたぐもの、書式の境目をまたぐものは止める。
- 足す道具（どれも書く前に差分を見せて人が許可する）
  - `edit_file {path, old, new, all?}`
  - `edit_xlsx {path, sheet, cells: {"B3": 値}, overwrite_formula?}`
  - `edit_docx {path, old, new}`
  - write_file：既存ファイルの上書き・新規作成とも、書ける場所に広げる。拡張子に `.bas`・`.cls`（VBA の取り込み用）を足す。
- 控えと元に戻す
  - 書き換える前の中身を `case/_控え/<パス>.<日時>` に残す。
  - 記録は `case/編集履歴.jsonl` に追記する：時刻・パス・控え・前後の sha256。
  - パネルの「編集の履歴」に「元に戻す」を付ける。今の中身が編集した直後と違えば（人が後から直していれば）、確認を出す。

## D. 書ける場所（2）
- 案件の設定.md に `書ける場所: 資料/仕様, src` を足して読む。caseconf に `write` 項目（カンマ区切り）を足す。
- 書けるのは `out/` と、この一覧の下だけ。
- `case/`・`_控え/`・`案件の設定.md`（拡張がパネルの入力から書き戻す場合を除く）は、一覧に入っていても書けない。
- `runner.writablePath(p, areas)` に一覧を渡す形にする（既存の正規化 `normPath` を使う）。

## E. 検索の強化（3）
- search に引数を足す：`regex?`・`ext?`（例 "md,xlsx"）・`context?`（前後の行数。最大 3）・`office?`（docx・xlsx の中も探す。既存の readAsText を使う）
- 結果が 60 件を超えたら、行は返さず「ファイルごとの件数」の表を返し、絞り込みを促す。
- 正規表現の誤りや、遅すぎる正規表現（1 ファイル 200ms 超）は止めて理由を返す。

## F. 横断調査（4）
- 1 回の依頼の中で読んだファイルと、検索の語を拡張が覚える。
- Gemini が `out/調査_*.md` を書いたら、末尾に「## 調べたファイル（拡張が記録）」を自動で足す。根拠の一覧を、Gemini の申告ではなく拡張の記録にするため。
- protocol と司令塔 Gem に、調査の進め方を書く。
  - 探す → 読む → 要点
  - 量が多いときは NotebookLM に聞く

## 非目標
- コマンドの実行（git・Python・ビルド）。計算は今の run_js だけ
- 案件フォルダの外への読み書き
- PDF・pptx・画像の読み書き
- xlsx の書式・数式・グラフ・シートの追加の編集（値の書き換えだけ）
- docx のレイアウトや書式の変更、段落をまたぐ置き換え
- .xlsm への VBA の書き込み（.bas を書き、人が取り込む）
- 計画モードを Gemini の自己申告だけで守ること（拡張が拒む）
- 許可なしの自動書き込み（confirmWrite を切っても edit 系は許可を取る）

## 触るファイル
- **新規** `src/js/edit.js`、`tests/edit.test.mjs`
- `src/js/runner.js`
  - TOOLS に足す
  - protocol をモードごとに分ける
  - readReply・decide で ```plan と options を扱う
  - writablePath に書ける場所を渡す
- `src/js/caseconf.js`：write 項目
- `src/js/runnerui.js`
  - モードの切り替え、計画のカード、選択肢のゲート
  - edit 系の execTool と差分の許可
  - 控え・編集履歴・元に戻す
  - search の拡張、調査の記録
- `src/items/00-gem-conductor.md`：計画モード・plan の形・options・調査の進め方
- `src/agent.html`：計画のカード・差分・選択肢の CSS
- `build.mjs`：JS_FILES と LOGIC_FILES に edit.js を足す
- `tools/ext-smoke.mjs`、`tests/fixtures/ext/fake-gemini.html`：計画を返す台本・編集の台本を足す

使う既存のもの：`GK.model.diffLines`、`GK.md.render`、`GK.xlsx.entries`／`entryText`、`GK.pptx.crc32`／`zip`、`R.docxText`、`normPath`、`uniquePath`、`approve`、`audit`、`decodeText`。

## 検証
- `node --test tests/*.test.mjs`
  - applyEdit：0 件・2 件・all・CRLF の保持
  - Shift_JIS の往復（ダミーの文。表に無い文字は止める）
  - xlsx：セルの書き換え後に `GK.xlsx.sheets` で読み直すと値が変わり、ほかのシートは同じ。数式のセルは止まる
  - docx：置き換えと、またぐ場合の拒否
  - writablePath：書ける場所の一覧・case/ の拒否
  - search の regex・ext・件数の表への切り替え
  - decide の plan と options
- `node tools/ext-smoke.mjs`（ダミーの Gemini の台本）
  1. 計画モードで write_file を出すと拒まれる → plan が出てカードが表示され、`case/計画/` に保存される
  2. 承認すると実行モードで edit_file → 差分の許可 → 書き換わり、控えと編集履歴ができる → 元に戻すと戻る
  3. options つきの ask_user にボタンが出て、押した label が届く
  4. 書ける場所の外への edit は拒まれる
  5. edit_xlsx・edit_docx がダミーのファイルを書き換える
  6. `out/調査_*.md` に「調べたファイル」が付く
  7. 監査ログに本文と URL が入らない
- 画面：幅 400px で、計画のカード・選択肢・差分の許可を撮る。コンソールのエラーは 0
