# 弾1：司令塔 Gem ＋ 一括取り込み ＋ Google への出口（gemini-agent）

承認済み計画：`~/.claude/plans/gemini-claude-code-gemini-notebooklm-valiant-lemon.md`（弾1〜3。これは弾1）
経緯：最初は gemini-kit の拡張として作った。ユーザーの指示（2026-11-24）で新しいプロジェクト gemini-agent に移し、gemini-kit は元の状態に戻した。

## 背景
会社では Gemini（Gem・Canvas・Drive 連携）と NotebookLM しか使えず、Apps Script も API も使えない。
Claude Code のように段階を踏んで、少ない往復で、同じ品質の成果物を作りたい。
Google との橋渡しは、ファイルとクリップボードで行う。

## 受入条件
1. Gem 設定タブに、司令塔 Gem とレビュー Gem の指示文と、知識ファイル（書式・デザイン）がある。各ファイルでできること：
   - コピー
   - .md で保存
   - 知識ファイルのまとめ保存
2. 司令塔 Gem の指示文で決めること：
   - 案件の型を 7 つ（理解・アイデア出し・資料・構成図・WBS・Excel/VBA・HTML）から判定する
   - 応答の頭は `【段階 n/7｜型｜次に人がすること】` にする
   - 末尾のブロックは決まった名前にする（````markdown・flow・slides・table・vba）
   - 仕様（背景・受入条件・非目標・成果物・確かめ方）の段階では承認を待つ
3. レビュー Gem は、観点を 1 つだけ指定して独立に点検し、指摘を表で返す
4. 取り込みタブで応答を丸ごと貼ると、ブロックを種類別に一覧にする。各ブロックでできること：
   - doc → 文書タブで開く・出口
   - flow → フロー図タブで開く・記法のコピー
   - slides → スライドタブで開く
   - table → 表のコピー・xlsx・NotebookLM 用 .md・表タブで開く
   - karte（gemini-kit の案件カルテ）→ コピー
   - code → コピー
   - 種類の決め方と画面の表示：
     - 種類は言語名で決め、無ければ中身から推定する
     - ````markdown の中の ```flow は文書に含める
     - 段階の見出しがあれば、段階・型・次の一手を上に出す
5. 文書・フロー図・スライド・表のタブで、貼った内容をその場で表示する。文書の中の ```flow は図にする
6. 出口：
   - 文書：Google ドキュメント用のリッチコピー（text/html と text/plain。フロー図は PNG で入れる）・.docx・NotebookLM 用 .md・.md
   - 表：表のコピー（text/html と TSV）・.xlsx（見出しの固定・フィルタ・罫線・数値型・数式）・TSV のコピー
   - スライド：PowerPoint・Google スライド向け（日本語を Noto Sans JP）・開く前の点検
   - フロー図：PNG・SVG
7. 使い方タブに、7 段階の流れ図・準備・毎回の流れ・出口ごとの手順がある
8. 通信 API を使わない（build.mjs の検出に通る）。貼った内容を保存しない。幅 390px で横にはみ出さない

## 非目標
- Gemini API・Apps Script・Google API は使わない。Google へ直接送信しない
- 案件カルテ（gemini-kit の anken.v2）の取り込み・管理はしない（gemini-kit を使う）
- docx は文書タブと同じ見た目を再現しない。flow 図は docx では記法のまま（コード）
- xlsx の条件付き書式・グラフ（WBS のガントは弾2）
- VBA の .bas 書き出し（cp932 を作れないため。VBE に貼る）
- 貼った内容の履歴・保存

## 検証方法
- `node --test tests/agent.test.mjs`
- `node build.mjs`
- Word / Excel の COM で docx・xlsx を開く（弾1では gemini-kit 上で確認済み。生成コードは同じ）
- 簡易サーバー＋Playwright：取り込みのサンプル → 各ボタン → 各タブ、コンソールのエラー 0、390px の横幅
