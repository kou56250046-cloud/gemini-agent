# 弾3：Chrome 拡張「Gemini エージェント」

承認済み計画：`~/.claude/plans/gemini-claude-code-gemini-notebooklm-valiant-lemon.md`

## 背景
コピペ・管理・現状の把握の手間を減らし、Gemini を Claude Code のように「道具を使って自分で進め、人の判断が要るところで止まる」形で使いたい。
会社では自作の拡張をデベロッパーモードで入れられる。Gemini API は使えないので、拡張が Gemini の画面を操作する。

## 受入条件
1. MV3。権限は sidePanel・storage・scripting と、gemini.google.com・notebooklm.google.com だけ。拡張のページと sandbox は CSP で通信を止める
2. サイドパネルに、gemini-agent の画面と「エージェント」タブを出す（ふつうの HTML のときはエージェントタブを出さない）
3. Gemini の画面（content script）：
   - 入力欄に文を入れて送る。応答が終わるのを待ち（応答が増え、停止ボタンが消え、本文が 1.5 秒変わらない）、Markdown で返す
   - コードブロックは言語名つきの囲みにする
   - セレクタは既定値を持ち、設定で上書きできる。自己点検で、入力欄が見つかるかを知らせる
4. ループ：
   - 最初の発言に道具の使い方を付ける。応答の ```tool を 1 つ実行して結果を返す、を繰り返す
   - 人を待つのは、ask_user・段階 3・道具の無い応答のとき。done で終わる
   - 書式の誤りは Gemini に直させる
5. 道具：
   - list_dir・read_file（txt・md・csv・json・xlsx・docx）・search：案件フォルダの中だけ。`..`・絶対パスは拒む
   - write_file：out/ だけ。許可を取り、上書き前に控えを残す
   - render：決まった見た目でファイルにする
   - run_js：sandbox の Worker で 3 秒まで。通信できず、拡張の API も使えない
   - ask_notebooklm
   - review：観点ごとに別タブ・最大 3 つ・互いの結果を見せない
   - ask_user・done
6. 管理の自動化：応答の段階の見出し・案件メモ（```memo）・成果物ブロックを読み、案件フォルダに保存する
   - 保存するもの：case/note.json・case/status.md・case/NotebookLM用_案件メモ.md・out/ の成果物・out/index.md
   - パネルの上に、段階・次の一手・未回答の質問（期限切れを強調）・決まったこと・成果物を出す
   - 案件フォルダは記憶し、次回は自動で開く
7. 安全装置：
   - 止めるもの：手数の上限（既定 20）、同じ道具が 3 回続けて失敗したとき、止めるボタン
   - 実行ログには本文を入れない（件数・文字数・道具名だけ）
   - 拡張の保存領域に案件の本文を入れない（設定・セレクタ・フォルダの場所だけ）

## 非目標
- Gemini API・Google API（OAuth）・Apps Script・ネイティブメッセージング（PC のコマンドや Excel を拡張から動かす）
- Gemini の画面の変化への自動追従（セレクタの設定で直す運用）
- 複数の案件を同時に走らせる
- Chrome ウェブストアへの公開・自動更新
- PDF を読む（NotebookLM に入れて ask_notebooklm で聞く）

## 検証方法
- `node --test tests/runner.test.mjs`：ツール呼び出しの読み取り・次の一手・パス・結果の文・安全装置・ログ・manifest・組み立て
- `node tools/ext-smoke.mjs`：Playwright の Chromium（Google Chrome 137 以降は --load-extension を受け付けないため）に試験版を読み込み、ダミーの Gemini・NotebookLM の画面を相手に確かめる
  - 1 本通す：段階 3 での停止 → 承認 → 成果物・メモの保存 → NotebookLM → done
  - 手数の上限、書き込みの許可（許可しないと書かない）
  - run_js：打ち切り・通信の遮断・拡張の API に触れない
  - パスの拒否
- 実機（ユーザー）：会社の Gemini で「つながりを確かめる」が OK になること。実際の Gem で 1 本通すこと
