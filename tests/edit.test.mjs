// 弾5：ファイルの編集（置き換え・文字コード・差分・xlsx・docx）と、書ける場所・計画・選択肢の読み取り。ダミーだけを使う
import test from "node:test";
import assert from "node:assert/strict";
import { loadGK } from "../build.mjs";

const GK = loadGK();
const E = GK.edit, R = GK.runner;

test("置き換え：0 件・2 件は止める。all・改行（CRLF）は元のファイルに合わせる", () => {
  const t = "a\r\nb\r\nb\r\nc";
  assert.throws(() => E.applyEdit(t, "x", "y"), /見つかりません/);
  assert.throws(() => E.applyEdit(t, "b", "B"), /2 か所/);
  assert.equal(E.applyEdit(t, "b", "B", true).text, "a\r\nB\r\nB\r\nc");
  const r = E.applyEdit(t, "a\nb", "A\nX", false);
  assert.equal(r.text, "A\r\nX\r\nb\r\nc");
  assert.throws(() => E.applyEdit(t, "", "y"), /空/);
});

test("文字コード：UTF-8（BOM）・Shift_JIS を読み分け、同じ形で書き戻す。Shift_JIS に無い字は止める", () => {
  const sj = E.encodeSjis("締め日は月末\r\n");
  const d = E.decode(sj);
  assert.equal(d.enc, "sjis");
  assert.equal(d.eol, "\r\n");
  assert.equal(d.text, "締め日は月末\r\n");
  assert.deepEqual([...E.encodeLike(E.applyEdit(d.text, "月末", "20 日").text, "sjis")], [...E.encodeSjis("締め日は20 日\r\n".replace("20 日", "20 日"))]);
  assert.throws(() => E.encodeSjis("𠮷"), /Shift_JIS で書けません/);
  const bom = E.encodeLike("あ", "utf8bom");
  assert.deepEqual([...bom.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(E.decode(bom).enc, "utf8bom");
  assert.equal(E.decode(new TextEncoder().encode("い\n")).enc, "utf8");
});

test("差分：変わった行の前後だけを出し、離れた所は … でつなぐ", () => {
  const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n");
  const b = a.replace("2", "二").replace("9", "九");
  const h = E.hunks(a, b, 1);
  assert.deepEqual(h.map((x) => x.op + x.text), [" 1", "-2", "+二", " 3", "…", " 8", "-9", "+九"]);
});

test("xlsx：セルの値だけを書き換え、ほかのシートと値はそのまま。数式は許しが無ければ止める", async () => {
  const u8 = GK.gexport.xlsx([{ name: "案件", rows: [["項目", "値"], ["締め日", "未定"], ["件数", "=1+1"]] }, { name: "別", rows: [["x"], ["y"]] }]);
  const r = await E.xlsxSetCells(u8, "案件", { B2: "月末", C5: 42 });
  assert.equal(r.sheet, "案件");
  const s = await GK.xlsx.sheets(r.data);
  assert.equal(s[0].rows[1][1], "月末");
  assert.equal(String(s[0].rows.at(-1)[2]), "42"); // 読み取りは空の行（4 行目）を詰める
  assert.deepEqual(s[1].rows.map((x) => x[0]), ["x", "y"]);
  await assert.rejects(() => E.xlsxSetCells(u8, "案件", { B3: 5 }), /数式があります/);
  const r2 = await E.xlsxSetCells(u8, "案件", { B3: 5 }, true);
  assert.deepEqual(r2.formulas, ["B3"]);
  assert.equal(String((await GK.xlsx.sheets(r2.data))[0].rows[2][1]), "5");
  await assert.rejects(() => E.xlsxSetCells(u8, "無い", { A1: 1 }), /シート「無い」がありません/);
  await assert.rejects(() => E.xlsxSetCells(u8, "案件", { "1A": 1 }), /番地/);
});

test("docx：1 つの文字の塊の中の文を置き換える。書式の境目をまたぐもの・改行は止める", async () => {
  const u8 = GK.gexport.docx("# 仕様\n\n締め日は未定です。\n\n**重要**な点は確認中です。");
  const r = await E.docxReplace(u8, "未定", "月末");
  assert.equal(r.count, 1);
  const xml = await GK.xlsx.entryText(GK.xlsx.entries(r.data), "word/document.xml");
  assert.match(R.docxText(xml), /締め日は月末です/);
  await assert.rejects(() => E.docxReplace(u8, "重要な点", "x"), /境目/);
  await assert.rejects(() => E.docxReplace(u8, "無い文", "x"), /見つかりません/);
  await assert.rejects(() => E.docxReplace(u8, "a\nb", "x"), /改行/);
});

test("書ける場所：out/ と指定した場所だけ。case/・_控え・案件の設定.md・拡張子の外は拒む", () => {
  const areas = [["資料", "仕様"], ["src"]];
  assert.deepEqual(R.writablePath("資料/仕様/a.md", areas), ["資料", "仕様", "a.md"]);
  assert.deepEqual(R.writablePath("src/app.js", areas), ["src", "app.js"]);
  assert.deepEqual(R.writablePath("out/メモ.md", areas), ["out", "メモ.md"]);
  assert.throws(() => R.writablePath("資料/議事録.md", areas), /書ける場所/);
  assert.throws(() => R.writablePath("case/note.json", [["case"]]), /case/);
  assert.throws(() => R.writablePath("src/_控え/a.md", areas), /_控え/);
  assert.throws(() => R.writablePath("案件の設定.md", [[]]), /書ける場所|案件の設定/);
  assert.throws(() => R.writablePath("out/a.html", areas), /md・txt/);
  assert.deepEqual(R.writablePath("out/Module1.bas", areas), ["out", "Module1.bas"]);
  assert.deepEqual(R.writablePath("src/page.html", areas), ["src", "page.html"]);
  assert.throws(() => R.writablePath("src/a.exe", areas), /書けない種類/);
  assert.deepEqual(GK.caseconf.parse("書ける場所: 資料/仕様, src ,  \n").links.write, "資料/仕様, src ,");
  assert.deepEqual(R.areasOf("資料/仕様, src ,"), [["資料", "仕様"], ["src"]]);
  assert.deepEqual(R.areasOf("../x, case, /abs"), []);
});

test("計画と選択肢：```plan は計画、ask_user の options は選択肢として読む", () => {
  const p = R.decide(R.readReply("調べました。\n\n```plan\n# 計画\n## 変更するファイル\n- 資料/仕様/a.md：締め日を直す\n- `src/app.js`\n```"));
  assert.equal(p.type, "plan");
  assert.match(p.plan, /変更するファイル/);
  assert.deepEqual(R.planFiles(p.plan), ["資料/仕様/a.md", "src/app.js"]);
  const q = R.decide(R.readReply('どちらにしますか。\n\n```tool\n{"tool": "ask_user", "args": {"question": "締め日は？", "options": [{"label": "月末", "detail": "会議の決定"}, {"label": "20 日"}], "recommend": "月末"}}\n```'));
  assert.equal(q.type, "gate");
  assert.deepEqual(q.options.map((o) => o.label), ["月末", "20 日"]);
  assert.equal(q.recommend, "月末");
  assert.equal(R.decide(R.readReply("```plan\nx\n```\n\n```tool\n{\"tool\": \"done\", \"args\": {\"summary\": \"s\"}}\n```")).type, "done");
  assert.match(R.protocol({ mode: "plan" }), /計画モード/);
  assert.doesNotMatch(R.protocol({ mode: "exec" }), /計画モード（読むだけ）です/);
});
