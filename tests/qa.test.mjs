// qa-box の tests/qa.test.mjs の写し（写した parse.js・model.js が同じ動きをすることを確かめる）。組み立てのテストは agent.test.mjs にある
// 質問箱のロジック（取り込み・貼り直し・編集・検索・書き出し）。ダミーだけを使う
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadGK, readItems } from "../build.mjs";
const readPrompt = () => readItems().find((x) => x.id === "qa-prompt").body;

const GK = loadGK();
const { parse: P, model: M } = GK;
const fx = (f) => fs.readFileSync(path.join(ROOT, "tests", "fixtures", "qa", f), "utf8");
const T1 = "2026-11-20T01:00:00.000Z", T2 = "2026-11-21T01:00:00.000Z", T3 = "2026-11-22T01:00:00.000Z";

function importText(db, text, opt = {}) {
  const pl = M.plan(db, text, opt);
  const done = M.apply(db, pl, opt);
  return { pl, done };
}

// 10 件のダミー（状態と分類を回す）
function tenBlocks() {
  const st = ["確定", "未確定", "対応中", "要確認"];
  return "```markdown\n" + Array.from({ length: 10 }, (_, i) => [
    "## 新規", `案件: ${i < 5 ? "ダミーA" : "ダミーB"}`, `分類: ${i % 2 ? "運用" : "画面"}`, `状態: ${st[i % 4]}`, "根拠: ダミー.pdf",
    "### 質問", `ダミーの質問 ${i + 1}`, "### 回答", `ダミーの回答 ${i + 1}。キーワード${i === 7 ? " 棚卸し" : ""}`, "",
  ].join("\n")).join("\n") + "```\n";
}

test("状態の正規化と ID の正規化", () => {
  assert.equal(P.normState("確定").state, "確定");
  assert.equal(P.normState("**要確認**").state, "要確認");
  assert.equal(P.normState("未確定").state, "未確定");
  const bad = P.normState("たぶん");
  assert.equal(bad.state, "要確認");
  assert.equal(bad.ok, false);
  assert.equal(P.normState("").ok, false);
  assert.equal(P.normState("提案").state, "提案");
  assert.equal(P.normState("**提案**").state, "提案");
  assert.equal(P.normId("Q-12"), "Q-012");
  assert.equal(P.normId("Q12"), "Q-012");
  assert.equal(P.normId("新規"), null);
});

test("囲みを外す：前置き・後書きを捨て、中の ```sql は残す", () => {
  const t = "前置き\n```markdown\n## 新規\n状態: 確定\n### 質問\nq\n### 回答\n```sql\nselect 1;\n```\n続き\n```\n後書き\n";
  const u = P.unwrap(t);
  assert.ok(!u.includes("後書き"));
  assert.ok(u.includes("select 1;") && u.includes("続き"));
  const r = P.read(t);
  assert.equal(r.ok.length, 1);
  assert.ok(r.ok[0].answer.includes("```sql") && r.ok[0].answer.endsWith("続き"));
});

test("1 件：表の行の状態を読む", () => {
  const db = M.empty();
  const { pl, done } = importText(db, fx("one.md"), { now: T1 });
  assert.deepEqual(done.added, ["Q-001"]);
  assert.equal(pl.bad.length, 0);
  const it = db.items[0];
  assert.equal(it.project, "ダミー在庫システム");
  assert.equal(it.status, "未確定");
  assert.equal(it.tables.length, 1);
  const t = it.tables[0];
  assert.equal(t.stateCol, 4);
  assert.deepEqual(t.rows.map((r) => [r.key, r.state]), [["品目コード", "要確認"], ["品目名", "確定"], ["単位", "確定"], ["保管場所", "未確定"]]);
  assert.equal(t.rows[2].cells[4], "確定", "** を外した状態をセルにも入れる");
  assert.ok(it.answer.includes("#### 補足"), "回答の #### 見出しは本文に残る");
  assert.ok(!it.answer.includes("ご不明点"), "囲みの外は入らない");
});

test("提案：ブロックと表の行の状態に使え、要確認の次に並ぶ", () => {
  const db = M.empty();
  const text = fx("one.md").replace("状態: 未確定", "状態: 提案").replace("| 保管場所 | 文字列 |  | 倉庫コードと紐づけるか検討中 | 未確定 |", "| 保管場所 | 文字列 |  | ソースに無いので案 | 提案 |");
  const { pl } = importText(db, text, { now: T1 });
  assert.equal(pl.entries[0].warnings.length, 0);
  importText(db, fx("broken.md"), { now: T1 });
  assert.equal(db.items[0].status, "提案");
  assert.equal(db.items[0].tables[0].rows[3].state, "提案");
  assert.equal(M.filterRows(M.rows(db), { status: "提案" }).length, 1);
  assert.equal(M.counts(db.items, (x) => x.status).提案, 1);
  assert.deepEqual(M.filter(db, { sort: "status" }).map((x) => x.status), ["要確認", "要確認", "提案"]);
  assert.match(readPrompt(), /提案：ソースには決まりも案も無く/);
});

test("10 件：まとめて取り込み、連番になる", () => {
  const db = M.empty();
  const { done } = importText(db, tenBlocks(), { now: T1 });
  assert.equal(done.added.length, 10);
  assert.deepEqual(db.items.map((x) => x.id).slice(0, 3), ["Q-001", "Q-002", "Q-003"]);
  assert.equal(db.items[9].id, "Q-010");
  // 続けて新規を貼ると Q-011
  const { done: d2 } = importText(db, fx("one.md"), { now: T2 });
  assert.deepEqual(d2.added, ["Q-011"]);
});

test("壊れたもの：読めないブロックと警告", () => {
  const db = M.empty();
  const pl = M.plan(db, fx("broken.md"), { now: T1 });
  assert.equal(pl.entries.length, 2);
  assert.equal(pl.bad.length, 1);
  assert.match(pl.bad[0].error, /回答/);
  assert.equal(pl.bad[0].label, "Q-050");
  const w0 = pl.entries[0].warnings.join("\n");
  assert.match(w0, /たぶん決まり/);
  assert.match(w0, /表1 に「状態」の列がありません/);
  assert.match(pl.entries[1].warnings.join("\n"), /状態が無い/);
  M.apply(db, pl, { now: T1, project: "取り込み時の案件" });
  assert.equal(db.items[0].status, "要確認");
  assert.equal(db.items[0].tables[0].stateCol, -1);
  assert.equal(db.items[1].project, "取り込み時の案件", "ブロックに案件が無ければ取り込み時の値");
  assert.equal(M.rows(db).length, 0, "状態の列が無い表は項目の一覧に出ない");
});

test("貼り直し：手で直した値と行の状態は残し、変更は履歴に残す", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  // 手で直す：分類と、品目名の行の状態
  assert.ok(M.edit(db, "Q-001", "category", "マスタ（品目）", { now: T2 }));
  assert.ok(M.editRow(db, "Q-001", 0, "品目名", "要確認", { now: T2 }));
  M.edit(db, "Q-001", "owner", "ダミー担当", { now: T2 });

  const pl = M.plan(db, fx("reask.md"), { now: T3 });
  assert.equal(pl.entries[0].action, "update");
  const w = pl.entries[0].warnings.join("\n");
  assert.match(w, /手で直した 分類 は残しました/);
  assert.match(w, /表1 から 1 行が消えました（保管場所）/);
  assert.equal(db.items[0].status, "未確定", "plan は db を変えない");

  M.apply(db, pl, { now: T3 });
  const it = db.items[0];
  assert.equal(it.status, "確定");
  assert.equal(it.category, "マスタ（品目）");
  assert.equal(it.owner, "ダミー担当");
  assert.equal(it.reason, "", "要確認の理由は空欄で消える");
  const rows = Object.fromEntries(it.tables[0].rows.map((r) => [r.key, r]));
  assert.equal(rows["品目コード"].state, "確定");
  assert.equal(rows["品目名"].state, "要確認", "手で直した行は残す");
  assert.equal(rows["品目名"].cells[4], "要確認");
  assert.equal(rows["発注点"].state, "未確定");
  assert.ok(!rows["保管場所"]);
  const h = it.history.map((x) => `${x.field}:${x.from}→${x.to}`);
  assert.ok(h.includes("状態:未確定→確定"));
  assert.ok(h.includes("表1「品目コード」の状態:要確認→確定"));
  assert.ok(h.includes("表1「保管場所」:行→消えた"));
  assert.ok(h.includes("表1「発注点」:→行を追加"));
  assert.ok(!h.some((x) => x.startsWith("表1「品目名」の状態:要確認→確定")));
});

test("貼り直し：新規として追加に切り替え・同じ ID が 2 回", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  const other = fx("reask.md").replace("品目マスタの項目案を出してください", "倉庫マスタの項目案は？");
  const pl = M.plan(db, other, { now: T2 });
  assert.match(pl.entries[0].warnings.join("\n"), /質問文が前と違います/);
  const done = M.apply(db, pl, { now: T2, asNew: [0] });
  assert.deepEqual(done.added, ["Q-002"]);
  assert.equal(db.items[0].question, "品目マスタの項目案を出してください");

  const twice = fx("reask.md").replace(/```/g, "") + "\n" + fx("reask.md").replace(/```/g, "");
  const pl2 = M.plan(db, twice, { now: T3 });
  assert.equal(pl2.entries[0].action, "update");
  assert.equal(pl2.entries[1].action, "dup", "同じ質問が 2 回なら 2 つ目は取り込まない");
  assert.match(pl2.entries[1].warnings.join("\n"), /2 回出てきた/);
  const sameIdOtherQ = fx("reask.md").replace(/```/g, "") + "\n" + fx("reask.md").replace(/```/g, "").replace("品目マスタの項目案を出してください", "棚マスタの項目案は？");
  const pl3 = M.plan(db, sameIdOtherQ, { now: T3 });
  assert.equal(pl3.entries[1].action, "new", "同じ ID で別の質問なら新しい番号");
  assert.equal(pl3.entries[1].id, "Q-003");
});

test("ID 指定の新規はその番号で入る", () => {
  const db = M.empty();
  const { done } = importText(db, fx("reask.md"), { now: T1 });
  assert.deepEqual(done.added, ["Q-001"]);
  const { done: d2 } = importText(db, fx("one.md").replace("品目マスタの項目案", "単位マスタの項目案"), { now: T2 });
  assert.deepEqual(d2.added, ["Q-002"]);
});

test("回答の編集：表を読み直し、手で直した行は残す", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  M.editRow(db, "Q-001", 0, "単位", "対応中", { now: T2 });
  const ans = db.items[0].answer.replace("| 保管場所 | 文字列 |  | 倉庫コードと紐づけるか検討中 | 未確定 |\n", "");
  const w = M.editAnswer(db, "Q-001", ans, { now: T3 });
  assert.match(w.join("\n"), /消えました（保管場所）/);
  const t = db.items[0].tables[0];
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows.find((r) => r.key === "単位").state, "対応中");
});

test("検索・絞り込み・並べ替え・件数", () => {
  const db = M.empty();
  importText(db, tenBlocks(), { now: T1 });
  importText(db, fx("one.md"), { now: T2 });
  assert.equal(M.filter(db, { text: "棚卸し" }).length, 1);
  assert.equal(M.filter(db, { text: "倉庫コード" })[0].id, "Q-011", "表の中身も検索する");
  assert.equal(M.filter(db, { text: "ｄｕｍｍｙ" }).length, 0);
  assert.equal(M.filter(db, { status: "確定" }).length, 3);
  assert.equal(M.filter(db, { project: "ダミーB" }).length, 5);
  assert.equal(M.filter(db, { category: "運用", project: "ダミーA" }).length, 2);
  M.edit(db, "Q-002", "due", "2026-11-01");
  M.edit(db, "Q-002", "owner", "ダミー担当");
  M.edit(db, "Q-001", "due", "2026-11-01"); // 確定は期限切れにしない
  assert.deepEqual(M.filter(db, { overdue: true, today: "2026-11-20" }).map((x) => x.id), ["Q-002"]);
  assert.deepEqual(M.filter(db, { owner: "ダミー担当" }).map((x) => x.id), ["Q-002"]);
  assert.equal(M.filter(db, { sort: "due" })[0].id, "Q-001");
  assert.equal(M.filter(db, { sort: "status" })[0].status, "要確認");
  const c = M.counts(db.items, (x) => x.status);
  assert.equal(c.確定 + c.未確定 + c.対応中 + c.要確認, 11);
  assert.deepEqual(M.values(db, "project"), ["ダミーA", "ダミーB", "ダミー在庫システム"]);
});

test("項目の一覧：横断・絞り込み", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  importText(db, fx("one.md"), { now: T2, asNew: [0] });
  const all = M.rows(db);
  assert.equal(all.length, 8);
  assert.equal(M.filterRows(all, { status: "要確認" }).length, 2);
  assert.equal(M.filterRows(all, { text: "倉庫" }).length, 2);
  const c = M.counts(all, (r) => r.state);
  assert.equal(c.確定, 4);
});

test("書き出し：CSV（BOM・引用）・TSV・JSON の往復", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  M.edit(db, "Q-001", "memo", 'メモ, "引用" と\n改行', { now: T2 });
  const csv = M.itemsCsv(db.items);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('"メモ, ""引用"" と\n改行"'));
  const rc = M.rowsCsv(M.rows(db));
  assert.ok(rc.includes("Q-001,ダミー在庫システム,表1,品目コード,要確認,型: 文字列 / 必須: ○ / 備考: 桁数は未定"));
  const tsv = M.tableTsv(db.items[0].tables[0]);
  assert.equal(tsv.split("\n")[0], "項目名\t型\t必須\t備考\t状態");
  assert.equal(tsv.split("\n")[3], "単位\t区分\t○\t個・箱・kg\t確定");

  const back = M.fromJson(M.toJson(db, { now: T3 }));
  assert.deepEqual(back.items, db.items);
  assert.throws(() => M.fromJson("{}"), /書き出しファイルではありません/);
  assert.throws(() => M.fromJson("壊れた"), /JSON として読めません/);
  assert.throws(() => M.fromJson(JSON.stringify({ app: "qa-box", version: 9, items: [] })), /新しい版/);
  assert.throws(() => M.fromJson(JSON.stringify({ app: "qa-box", version: 1, items: [{ id: "Q-001", question: "a" }, { id: "Q-001", question: "b" }] })), /2 回/);
});

test("AI 用 JSON：質問・回答・状態だけ。履歴と手の印は入れず、表の行は列名のキー", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  M.edit(db, "Q-001", "owner", "ダミー担当", { now: T2 });
  M.editRow(db, "Q-001", 0, "品目コード", "確定", { now: T2 });
  const d = JSON.parse(M.toAiJson(db.items, { now: T3 }));
  assert.equal(d.format, "qa-box.ai.v1");
  assert.equal(d.exportedAt, T3);
  assert.deepEqual(Object.keys(d.states), P.STATES);
  const it = d.items[0];
  assert.equal(it.id, "Q-001");
  assert.equal(it.status, db.items[0].status);
  assert.equal(it.question, db.items[0].question);
  assert.equal(it.answer, db.items[0].answer);
  assert.equal(it.owner, "ダミー担当");
  for (const k of ["history", "edited", "createdAt", "memo", "due"]) assert.ok(!(k in it), k);
  const t = it.tables[0];
  assert.deepEqual(t.columns, ["項目名", "型", "必須", "備考", "状態"]);
  assert.equal(t.hasState, true);
  assert.equal(t.rows[0].項目名, "品目コード");
  assert.equal(t.rows[0].状態, "確定");
  assert.equal(Object.values(d.counts).reduce((a, n) => a + n, 0), 1);
  assert.throws(() => M.fromJson(M.toAiJson(db.items)), /書き出しファイルではありません/);
});

test("聞き直す文は ID を持つブロックとして読める", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  const t = M.reaskText(db.items[0]);
  assert.match(t, /## Q-001\n### 質問\n品目マスタ/);
});

test("重複：同じ「## 新規」を 2 回貼っても 2 回目は取り込まない", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  const { pl, done } = importText(db, fx("one.md"), { now: T2 });
  assert.equal(pl.entries[0].action, "dup");
  assert.equal(pl.entries[0].id, "Q-001");
  assert.deepEqual(done, { added: [], updated: [], skipped: ["Q-001"] });
  assert.equal(db.items.length, 1);
  assert.equal(db.items[0].history.length, 1, "履歴も増えない");
  assert.equal(db.items[0].updatedAt, T1);
  // 句読点・空白・全角半角だけ違う質問も同じとみなす
  const loose = fx("one.md").replace("品目マスタの項目案を出してください", "品目マスタの 項目案を出してください。");
  assert.equal(M.plan(db, loose, { now: T2 }).entries[0].action, "dup");
  // 重複でも「新規として追加」にできる
  const r = importText(db, fx("one.md"), { now: T2, asNew: [0] });
  assert.deepEqual(r.done.added, ["Q-002"]);
});

test("重複：同じ質問で回答が違えば、その ID を更新し前の版を残す", () => {
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  const firstAnswer = db.items[0].answer;
  const changed = fx("one.md").replace("全角 40 字まで", "全角 60 字まで").replace("状態: 未確定", "状態: 確定");
  const { pl, done } = importText(db, changed, { now: T2 });
  assert.equal(pl.entries[0].action, "update");
  assert.equal(pl.entries[0].matched, "question");
  assert.match(pl.entries[0].warnings[0], /同じ質問の Q-001 を更新します/);
  assert.deepEqual(done.updated, ["Q-001"]);
  assert.equal(db.items.length, 1);
  const it = db.items[0];
  assert.equal(it.status, "確定");
  assert.equal(it.prevAnswers.length, 1);
  assert.equal(it.prevAnswers[0].answer, firstAnswer);
  assert.equal(it.prevAnswers[0].at, T1);
  assert.equal(it.prevAnswers[0].replacedAt, T2);
  assert.equal(it.prevAnswers[0].tables[0].rows[1].cells[3], "全角 40 字まで");
  const h = it.history.map((x) => `${x.field}:${x.from}→${x.to}`);
  assert.ok(h.includes("表1「品目名」の備考:全角 40 字まで→全角 60 字まで"), "セルの変化も履歴に残る");
  assert.ok(h.includes("状態:未確定→確定"));
});

test("ID 指定で中身が同じなら変化なし。前の版は 3 版まで", () => {
  const db = M.empty();
  importText(db, fx("reask.md"), { now: T1 });
  const { pl, done } = importText(db, fx("reask.md"), { now: T2 });
  assert.equal(pl.entries[0].action, "same");
  assert.deepEqual(done.skipped, ["Q-001"]);
  assert.equal(db.items[0].history.length, 1);
  for (let i = 1; i <= 5; i++) M.editAnswer(db, "Q-001", `回答 ${i}`, { now: T3 });
  assert.equal(db.items[0].prevAnswers.length, 3);
  assert.equal(db.items[0].prevAnswers[0].answer, "回答 4", "新しい順");
});

test("version 1 の控えを読める", () => {
  const v1 = { app: "qa-box", version: 1, items: [{ id: "Q-001", question: "ダミー", answer: "a", tables: [] }] };
  const db = M.fromJson(JSON.stringify(v1));
  assert.equal(db.version, 2);
  assert.deepEqual(db.items[0].prevAnswers, []);
  assert.equal(JSON.parse(M.toJson(db)).version, 2);
});

test("根拠で絞り込む・重複の疑い", () => {
  const db = M.empty();
  importText(db, tenBlocks(), { now: T1 });
  importText(db, fx("one.md"), { now: T2 });
  assert.deepEqual(M.sources(db), ["ダミー.pdf", "ダミー要件メモ.pdf", "第2回打合せ.txt"]);
  assert.deepEqual(M.filter(db, { source: "第2回打合せ.txt" }).map((x) => x.id), ["Q-011"]);
  assert.equal(M.filter(db, { source: "打合せ" }).length, 0, "部分一致ではない");
  assert.equal(M.dupKeys(db).size, 0);
  importText(db, fx("one.md"), { now: T3, asNew: [0] });
  assert.deepEqual(M.filter(db, { dup: true }).map((x) => x.id), ["Q-011", "Q-012"]);
});

test("まとめて聞き直す：1 通 3000 字以内に分け、全 ID がそろう", () => {
  const db = M.empty();
  importText(db, tenBlocks(), { now: T1 });
  for (const it of db.items) it.question = `ダミーの長い質問 ${it.id} ` + "あ".repeat(500);
  db.items[2].question = "い".repeat(3200);
  const r = M.reaskManyText(db.items);
  assert.ok(r.parts.length > 1);
  for (const [i, t] of r.parts.entries()) if (!t.includes("Q-003")) assert.ok(t.length <= M.INPUT_MAX, `${i + 1} 通目が ${t.length} 字`);
  assert.equal(r.parts.filter((t) => t.includes("## Q-003")).length, 1);
  assert.ok(r.parts.find((t) => t.includes("## Q-003")).split("\n## Q-").length === 2, "長すぎる質問は単独の通");
  assert.match(r.warnings.join("\n"), /Q-003 は 1 件で 3000 字を超えています/);
  const ids = r.parts.flatMap((t) => [...t.matchAll(/^## (Q-\d+)$/gm)].map((m) => m[1]));
  assert.deepEqual(ids, db.items.map((x) => x.id));
  assert.match(r.parts[0], /前回の状態：\n- Q-001：前回 確定/);
  // 少なければ 1 通
  assert.equal(M.reaskManyText(db.items.slice(0, 1)).parts.length, 1);
});

test("差分：行単位の本文と、表の行・セル", () => {
  assert.deepEqual(M.diffLines("a\nb\nc", "a\nx\nc"), [{ op: "same", text: "a" }, { op: "del", text: "b" }, { op: "add", text: "x" }, { op: "same", text: "c" }]);
  const db = M.empty();
  importText(db, fx("one.md"), { now: T1 });
  importText(db, fx("reask.md"), { now: T2 });
  const it = db.items[0];
  const d = M.diffTables(it.prevAnswers[0].tables, it.tables)[0];
  const by = Object.fromEntries(d.rows.map((r) => [r.key, r]));
  assert.equal(by["発注点"].op, "add");
  assert.equal(by["保管場所"].op, "del");
  assert.equal(by["品目名"].op, "same");
  assert.equal(by["品目コード"].op, "chg");
  const c = by["品目コード"].cells.filter((x) => x.changed).map((x) => `${x.head}:${x.from}→${x.to}`);
  assert.deepEqual(c, ["備考:桁数は未定→8 桁", "状態:要確認→確定"]);
});

