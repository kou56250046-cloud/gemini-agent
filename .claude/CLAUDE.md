# gemini-agent（画面名：Gemini エージェント）

会社 PC で使える Gemini（Gem・Canvas・Drive 連携）と NotebookLM を、Claude Code のように段階を踏んで使うためのツール。
司令塔 Gem が案件を「受付 → ヒヤリング → 仕様（承認） → 作成 → 自己点検 → 修正 → 仕上げ」で進める。
このツールは、応答を取り込み、次のものを決まった見た目で作り、Google ドキュメント／スプレッドシート／スライド／NotebookLM に渡す。
- 図（フロー図・構成図・論点マップ）
- 文書・WBS・解説ページ・スライド・表

配るものは 2 つ。
- `output/gemini-agent.html`（1 枚。コピー＆ペーストで使う。右上のボタンで、この HTML と拡張の zip（埋め込み）を保存できる。公開は https://kou56250046-cloud.github.io/gemini-agent/ 。main の docs/index.html。output/gemini-agent.html は git に入れない）
- `output/extension/`（Chrome 拡張。サイドパネルに同じ画面と「エージェント」タブが出て、Gemini の画面を操作して自動で進める）

gemini-kit（案件カルテ・要件定義書づくり）とは別のプロジェクト。
写した部品とその元（こちらで直しても元には反映されない）：
- gemini-kit から：md / flow / slides / pptx / xlsx / dom / clean
- qa-box から：parse / model と、その回答の形（items/03-qa-prompt.md）・テスト（tests/qa.test.mjs）

計画の正：`~/.claude/plans/gemini-claude-code-gemini-notebooklm-valiant-lemon.md`（弾1〜4）
仕様：
- 弾1 司令塔・取り込み・Google への出口：`.claude/specs/conductor-export/requirements.md`
- 弾2 構成図・論点マップ・WBS・解説ページ・Excel/VBA・案件メモ：`.claude/specs/new-artifacts/requirements.md`
- 弾3 Chrome 拡張（エージェント）：`.claude/specs/agent-extension/requirements.md`
- 弾4 監査ログ・質問箱・会議（Meet 字幕 → 議事録）・会話アーカイブ・スラッシュコマンド・Gem 更新・朝の確認・ページ取り込み：`.claude/specs/audit-and-tools/requirements.md`
- 案件ごとのリンク（案件フォルダ直下の `案件の設定.md` から NotebookLM・司令塔 Gem・レビュー Gem の URL を読む）：`.claude/specs/case-links.md`
  - 送り先のタブは `findCaseTab` で選ぶ（`findTab` を直接使うのは Meet・Gem の編集画面・つながりの確認だけ）
  - 監査ログに URL を入れない（読み込みは件数と sha256、登録は種類だけ）
- 弾5 計画モード・選択肢つきの提案・ファイルの編集（edit_file / edit_xlsx / edit_docx）・書ける場所・検索の強化・横断調査：`.claude/specs/plan-and-edit.md`
  - 計画モードは拡張が守る（execTool で WRITE_TOOLS を拒む）。Gemini の約束事に頼らない
  - 書く道具は、out/ の新規ファイル（confirmWrite に従う）以外、必ず差分を見せて人の許可を取る。控えは case/_控え/、記録は case/編集履歴.jsonl
  - 書ける場所は runner.writablePath(p, areas) だけで決める。case/・_控え・案件の設定.md は書かない

## 弾4 の決まり
- 監査ログ（`case/audit/YYYY-MM.jsonl`）
  - 本文を入れない。残してよい項目は audit.js の FIELDS だけ
  - target はファイルの場所と種類だけ（質問の文を入れない）
  - 前の行の hash につなぐ。書き込みは runnerui.js の auditQueue の 1 列だけで行う
- 会話アーカイブ（`case/会話/`）：見出しの sha256 は、監査ログと同じ計算（GK.audit.sha256）
- 別の会話から来た memo（議事録）は `GK.note.renumber` で番号を振り直してから入れる（同じ番号で上書きしない）。司令塔の memo は会話の中で番号が続くので、振り直さない
- 質問箱：新しい質問は自動で入れ、既にある質問の更新は保留して選ばせる（qaflow.triage / applyNew / applyChosen）
- 権限と host は manifest() とテスト（meeting.test.mjs）を一緒に直す

---

## 絶対的な制約

- 実行時にネットワークへ出ない
  - `fetch` 等は使わない（build.mjs が src/js と src/ext を検出して止める）
  - CSP で `connect-src 'none'`（HTML・拡張のページ・sandbox すべて）
- 依存ゼロ。docx・xlsx・pptx（無圧縮 zip + XML）、図、Markdown 表示はすべて自前。npm パッケージを入れない
- `file://` で開ける。DOM は `createElement` / `textContent`。innerHTML を使わない。SVG は自前で作った文字列を DOMParser で入れる
- LLM はこのツールの中では使わない。Gemini API・Apps Script・Google API・ネイティブメッセージングも使わない
- 拡張は Gemini・NotebookLM の画面に文を入れて、表示された応答を読むだけ。権限は sidePanel・storage・scripting と、その 2 つのホストだけ（NotebookLM は notebooklm.google.com と notebook.google.com の 2 つのドメイン）
- 保存してよいもの：
  - HTML：開いていたタブだけ（sessionStorage）。貼った内容は保存しない
  - 拡張：設定・セレクタ・案件フォルダの場所だけ。案件の中身は、ユーザーが選んだ案件フォルダ（case/・out/）にだけ書く
  - 実行ログ：本文を入れない
- 拡張が書けるのは案件フォルダの `out/` と `case/`、`資料/`（議事録・取り込み）と直下の `案件の設定.md`（人がパネルで入れたリンクの書き戻し）だけ。Gemini の道具（write_file・edit_*）が書けるのは `out/` と、人が案件の設定.md の「書ける場所」に足したフォルダだけ。`..`・絶対パスは拒む
- フォントは英数字 Arial、日本語メイリオ。例外は「Google スライド向けに保存」で、日本語を Noto Sans JP にする（Google スライドにメイリオが無い）
- Claude 側の確認はダミー（`tests/fixtures/`、各タブのサンプル、ダミーの Gemini 画面）だけで行う。実際の Gemini には触らない

## 構成

```
src/agent.html        画面・CSS・使い方。拡張のときだけ出すものは data-ext-only
src/js/dom.js md.js flow.js slides.js pptx.js xlsx.js   gemini-kit の写し（pptx は meta.eaFont、xlsx は entryText を足した）
src/js/intake.js      取り込みの解析：Gem の応答 → 段階の見出し【段階 n/7｜型｜次】とブロック（doc/flow/arch/map/wbs/explain/slides/table/memo/tool/karte/code）
src/js/gexport.js     Google への出口：docx・xlsx（ガントの塗り・列幅・固定）・Docs 貼り付け用 HTML・表の TSV/HTML・NotebookLM 用 .md・Google スライドの点検
src/js/diagram.js     図の共通部品（色・文字の折り返し・SVG の外枠）
src/js/arch.js        構成図（```arch）：層・形・枠・矢印。枠は層ごとに囲み、外のノードを含まない範囲でつなぐ。2 層以上飛ばす矢印は右端を通す
src/js/map.js         論点マップ・選択肢の木（```map）：字下げの木と印の札
src/js/wbs.js         WBS：日程（営業日）・余裕・クリティカルパス・ガント図 SVG・xlsx の行
src/js/explain.js     解説ページ（```explain の JSON）→ 単体の HTML（結論 → 全体像 → 詳細 → 次の一手）
src/js/note.js        案件メモ（```memo の F/D/Q）の統合と、status.md・index.md・NotebookLM 用 md
src/js/caseconf.js    案件の設定.md の読み取り・URL の確かめ・1 項目の書き戻し・タブとの照合。DOM 非依存
src/js/edit.js        編集：部分の置き換え・文字コードの書き戻し（UTF-8／Shift_JIS）・差分の塊・xlsx のセルの値・docx の文の置き換え。DOM 非依存
src/js/runner.js      エージェントの進め方（道具の使い方の文・```tool の読み取り・次の一手・パス・結果の文・安全装置・ログ）。DOM 非依存
src/js/preview.js     スライドのプレビュー（gemini-kit の app.js の写し）
src/js/intakeui.js    取り込みタブと出口のボタン
src/js/runnerui.js    エージェントタブ（拡張のときだけ）：Gemini のタブとのやり取り・道具の実行・ゲート・許可・案件フォルダ・状況の表示
src/js/audit.js       監査ログ（封・検証・進み具合・CSV）。DOM 非依存
src/js/clean.js       文字起こしの前処理（VTT・Teams・Meet・話者:本文。gemini-kit の写し）
src/js/meetlog.js     字幕 → 確定した発言 → 文字起こし・発言量。DOM 非依存
src/js/minutes.js     議事録の依頼文（長いときは分ける）と応答の組み立て。DOM 非依存
src/js/parse.js model.js  質問箱（qa-box の写し）
src/js/qaflow.js      質問箱の自動化（質問の分け方・送る文・新規と更新の振り分け・案件メモへ）。DOM 非依存
src/js/qaui.js meetui.js auditui.js  質問箱・会議・監査のタブ（監査は拡張のときだけ）
src/js/app.js         タブ・文書・図・スライド・表・WBS・解説ページ・Gem 設定・使い方の図（HELP_FLOW）
src/ext/              拡張だけのファイル：background.js・domtomd.js（画面 → Markdown）・content-gemini.js・content-nlm.js・sandbox.html/js
src/items/*.md        Gem の指示文（00 司令塔・01 レビュー）・知識ファイル（5x 記法・60/61 Excel・VBA・8x デザイン）
src/vendor/           図解・ダッシュボード部品（~/.claude/skills の写し）。今は埋め込んでいない
build.mjs             組み立て（HTML・拡張・試験版の拡張）。manifest もここで作る
tests/agent.test.mjs      取り込み・出口・Gem の指示文・組み立て
tests/artifacts.test.mjs  構成図・論点マップ・WBS・解説ページ・案件メモ・知識ファイルの例が描けること
tests/runner.test.mjs     エージェントの進め方・manifest・拡張の組み立て
tests/fixtures/ext/       ダミーの Gemini・NotebookLM の画面（拡張の試験用。台本どおりに返す）
tools/ext-smoke.mjs   拡張の試験版を Chromium に読み込み、ダミーの画面で 1 本通す
tools/fix-bom.mjs     見えない文字（U+FEFF・U+2028・U+2029）をエスケープに直す
```

## コマンド

```bash
node build.mjs                    # output/gemini-agent.html と output/extension/
node --test tests/*.test.mjs        # テスト（agent・artifacts・runner・qa・meeting）
node tools/publish.mjs            # docs/index.html（GitHub Pages：main の /docs）へ HTML だけを写す。main をコミットして push すれば公開される
node tools/ext-smoke.mjs          # 拡張の通し試験（Playwright の Chromium を使う。Google Chrome 137 以降は --load-extension を受け付けない）
python -m http.server 8772 --bind 127.0.0.1   # output で実行。画面確認用（Playwright は file:// を開けない）
```

## 決まり

- 司令塔 Gem の指示文と intake.js は対で決まっている。片方を変えたら、両方とテストを直す
  - 応答の 1 行目：`【段階 n/7｜型｜次に人がすること】`
  - ブロックの名前：````markdown・```flow・```arch・```map・```wbs・```explain・```slides・```table・```vba・```memo・```tool
- 拡張の道具（runner.js の TOOLS）を足したら、使い方タブの表と、protocol() の文と、runnerui.js の execTool をそろえる
- 記法の知識ファイル（5x-fmt-*）に書いた例は、そのまま描けること（artifacts.test.mjs が確かめる）
- 司令塔 Gem の知識ファイルは 10 個まで（Gem の上限）
- Gemini の画面の作りが変わったら、content-gemini.js の DEFAULT のセレクタを直す（利用者はパネルの設定で上書きできる）
- 写した部品（md / flow / slides / pptx / xlsx / dom）を直すときは、gemini-kit 側にも同じ不具合が無いか確かめる
