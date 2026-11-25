# gemini-agent：NotebookLM の URL をパネルの設定にも登録できるようにする（S）

## 背景
NotebookLM の URL は案件フォルダの `案件の設定.md` にしか書けない。Gem はパネルの「設定」にも入れられる（全案件共通の既定値）。
ユーザーは NotebookLM も Gem と同じように設定に入れ、案件を替えるときは URL を入れ替えて回したい。

## 受入条件
1. エージェントタブの「設定」に「NotebookLM の URL」の欄がある（司令塔 Gem・レビュー Gem の下）。値は chrome.storage の settings.notebookUrl に入る
2. 入れた URL が NotebookLM のノートブック（`GK.caseconf.valid("notebooklm", …)`）でなければ、保存せずに知らせる。空欄は保存してよい
3. 送り先のノートブックは「案件の設定.md → 設定の URL」の順で決まる（`linkOf("notebook")`）。どちらも無いときは今までどおり（タブ 1 つなら使い、2 つ以上なら止める）
4. NotebookLM のタブを決めたら、エージェントタブの状況に「NotebookLM の送り先：〈タブの題名〉（案件の設定.md／設定／開いているタブ）」と出す。監査ログには入れない
5. 「NotebookLM を開く」ボタンも同じ順で URL を使う
6. 止まるときの文と使い方タブの説明に「設定の NotebookLM の URL でもよい」を足す

## 非目標
- 案件ごとに URL を覚えて自動で切り替えること
- 案件の設定.md をなくすこと（引き続き優先する）
- 1 つの案件で複数のノートブックを使うこと
- HTML 版での登録

## 触るファイル
- `src/js/runnerui.js`（settings の既定値・linkOf・findCaseTab・settingsPanel・renderLinks）
- `src/agent.html`（使い方の説明）
- `tools/ext-smoke.mjs`（設定の URL で送り先が決まること・md が優先されること）

## 検証
- `node build.mjs` と `node --test tests/*.test.mjs`
- `node tools/ext-smoke.mjs`：md なし＋設定 A → A、md に B＋設定 A → B、不正な URL は保存されない
