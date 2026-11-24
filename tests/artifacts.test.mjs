// 弾2：構成図・論点マップ・WBS（日程とガント・xlsx）・解説ページ・案件メモ・Excel/VBA の知識ファイル
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadGK, readItems, ROOT } from "../build.mjs";

const GK = loadGK();
const fx = (f) => fs.readFileSync(path.join(ROOT, "tests", "fixtures", f), "utf8");
const dec = (u8) => new TextDecoder().decode(u8);
const zipText = (u8, name) => { const e = GK.xlsx.entries(u8).get(name); assert.ok(e, name); return dec(e.data); };
// 箱どうしが重ならないこと
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlap = (boxes) => { for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${i} と ${j} が重なる`); };

test("構成図：サンプルを読み、層・形・枠・矢印を配置する。箱は重ならない", () => {
  const r = GK.arch.render(fx("arch.txt"));
  assert.deepEqual(r.graph.errors, []);
  assert.deepEqual(r.graph.warnings, []);
  assert.equal(r.geo.rows.length, 5);
  assert.equal(r.geo.nodes.length, 9);
  assert.equal(r.geo.edges.length, 8);
  assert.ok(r.geo.groups.length >= 1);
  noOverlap(r.geo.nodes);
  // 枠の中に、枠の外のノードが入らない
  const members = new Set(["W", "A", "B", "D", "M"]);
  for (const gr of r.geo.groups) for (const n of r.geo.nodes) if (!members.has(n.id)) assert.ok(!overlap(gr, n), `${n.id} が枠の中に入る`);
  // 2 層以上飛ばす矢印（B ..> X）は、途中の層のノードを横切らない
  const skip = r.geo.edges.find((e) => e.pts.length === 6);
  assert.ok(skip, "B ..> X は右端の通り道を通る");
  for (let i = 0; i < skip.pts.length - 1; i++) {
    const [[x1, y1], [x2, y2]] = [skip.pts[i], skip.pts[i + 1]];
    const seg = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 0.1, h: Math.abs(y2 - y1) || 0.1 };
    for (const n of r.geo.nodes) if (n.id !== "B" && n.id !== "X") assert.ok(!overlap(seg, n), `線が ${n.id} を横切る`);
  }
  for (const n of r.geo.nodes) { const row = r.geo.rows[n.row]; assert.ok(n.y >= row.y && n.y + n.h <= row.y + row.h, `${n.id} が層からはみ出す`); }
  assert.match(r.svg, /^<svg /);
  assert.match(r.svg, /stroke-dasharray="5 4"/, "..> は点線");
  assert.match(r.svg, /社内ネットワーク/);
  assert.doesNotMatch(r.svg, /<script|on\w+=/i);
});

test("構成図：書き間違いを行番号つきで知らせ、文字はエスケープする", () => {
  const g = GK.arch.parse("layer A\nnode X @B 箱\nnode Y @A 箱 [cloud]\nY -> Z\nこれは何\nnode Y @A 二重");
  const msgs = g.errors.map((e) => `${e.line}:${e.message}`).join("\n");
  assert.match(msgs, /^2:層「B」は定義されていません/m);
  assert.match(msgs, /^4:矢印のノード「Z」がありません/m);
  assert.match(msgs, /^5:読めない行です/m);
  assert.match(msgs, /^6:ノード ID「Y」が重複/m);
  assert.match(g.warnings.map((w) => w.message).join(), /形「\[cloud\]」は使えません/);
  const r = GK.arch.render('layer L\nnode A @L <b>"x"</b>');
  assert.match(r.svg, /&lt;b&gt;&quot;x&quot;&lt;\/b&gt;/);
});

test("論点マップ：字下げの木・印・根。親は子の中央、箱は重ならない", () => {
  const r = GK.map.render(fx("map.txt"));
  assert.deepEqual(r.graph.errors, []);
  assert.deepEqual(r.graph.warnings, []);
  assert.equal(r.graph.root.label, "受注の確認を半分の時間にする");
  assert.equal(r.graph.root.children.length, 3);
  assert.deepEqual(r.graph.root.children[0].children[1].tags, ["案", "推奨"]);
  assert.equal(r.geo.nodes.length, 11);
  noOverlap(r.geo.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })));
  const root = r.geo.root;
  assert.ok(Math.abs(root.cy - (root.kids[0].cy + root.kids[root.kids.length - 1].cy) / 2) < 0.01);
  assert.match(r.svg, />推奨</, "印は文字の札でも出す");
  const bad = GK.map.parse("根\n- a [謎]\n根2");
  assert.equal(bad.warnings.length, 2);
  assert.equal(GK.map.parse("").errors.length, 1);
});

test("WBS：依存と工数から営業日で日程を引き、余裕とクリティカルパスを出す", () => {
  const r = GK.wbs.parse(fx("wbs.md"));
  assert.deepEqual(r.errors, []);
  const t = Object.fromEntries(r.tasks.map((x) => [x.id, x]));
  const d = (id) => [GK.wbs.fromDay(t[id].start), GK.wbs.fromDay(t[id].end)];
  assert.deepEqual(d("1.1"), ["2026-12-01", "2026-12-02"], "16h = 2 日");
  assert.deepEqual(d("1.2"), ["2026-12-03", "2026-12-07"], "土日を飛ばす");
  assert.deepEqual(d("2.1"), ["2026-12-08", "2026-12-10"], "親（2）の依存（1）は子全部に効く");
  assert.deepEqual(d("1"), ["2026-12-01", "2026-12-07"], "親は子の最初と最後");
  assert.equal(t["1"].hours, 56, "親の工数は子の合計");
  assert.equal(t["1.3"].slack, 1);
  assert.deepEqual(r.critical, ["1.1", "1.2", "2.1", "2.2", "3"]);
  assert.equal(r.totalHours, 116);
  assert.ok(r.warnings.some((w) => /8h 未満/.test(w.message)));
});

test("WBS：循環・重複・見出し違い・存在しない依存を知らせる", () => {
  const head = "| ID | 作業 | 工数(h) | 依存 |\n|---|---|---|---|\n";
  assert.match(GK.wbs.parse(head + "| A | a | 8 | B |\n| B | b | 8 | A |").errors[0].message, /循環/);
  assert.match(GK.wbs.parse(head + "| A | a | 8 |  |\n| A | b | 8 |  |").errors[0].message, /重複/);
  assert.match(GK.wbs.parse("| a | b |\n|--|--|\n| 1 | 2 |").errors[0].message, /WBS の見出し/);
  const r = GK.wbs.parse(head + "| A | a | 100 | Z |", { start: "2026-12-07" });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /依存「Z」がありません/.test(w.message)));
  assert.ok(r.warnings.some((w) => /80h を超える/.test(w.message)));
  assert.equal(GK.wbs.fromDay(r.tasks[0].start), "2026-12-07");
  assert.equal(GK.wbs.fromDay(r.tasks[0].end), "2026-12-23", "100h = 13 日（土日を除く）");
});

test("WBS：ガント図の SVG と、日ごとに塗った xlsx（固定・列幅・塗りのスタイル）", async () => {
  const r = GK.wbs.parse(fx("wbs.md"));
  const svg = GK.wbs.gantt(r);
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/>★</g) || []).length, 5, "余裕のない作業に ★");
  const sh = GK.wbs.sheet(r);
  assert.equal(sh.rows.length, 9);
  assert.equal(sh.rows[0].length, 9 + 17, "9 列＋12/1〜12/17 の 17 日");
  const u8 = GK.gexport.xlsx([sh]);
  const x = zipText(u8, "xl/worksheets/sheet1.xml");
  assert.match(x, /<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"\/>/);
  assert.match(x, /<col min="10" max="10" width="3.2" customWidth="1"\/>/);
  assert.match(x, /<c r="J3" s="5"\/>/, "1.1 の 12/1 は余裕のない作業の塗り");
  assert.match(x, /<c r="O3" s="7"\/>/, "12/6（日）は土日の塗り");
  assert.match(zipText(u8, "xl/styles.xml"), /<cellXfs count="8">/);
  const back = await GK.xlsx.sheets(u8);
  assert.equal(back[0].rows[2][6], "2026-12-01");
  assert.equal(back[0].rows[4][8], "1", "余裕(日)");
});

test("解説ページ：決まった型の HTML 1 枚。図を埋め込み、スクリプトと外部参照を入れない", () => {
  const r = GK.explain.render(fx("explain.json"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  const h = r.html;
  assert.match(h, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">/);
  assert.doesNotMatch(h, /<script|<link|src="http|href="http|@import|url\((?!#)/i, "SVG の中の url(#…) だけ");
  assert.equal((h.match(/<svg /g) || []).length, 3, "全体像（flow）・論点（map）・構成（arch）");
  const order = ["結論", "全体像", "いま何が起きているか", "打ち手の比べ方", "システムの形", "次の一手"].map((s) => h.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "結論 → 全体像 → 詳細 → 次の一手の順");
  assert.match(h, /<b>なくす<\/b>/);
  assert.match(h, /<td>1 件の確認時間<\/td>/);
  const bad = GK.explain.render('{"title":"<x>","conclusion":["1","2","3","4"],"sections":[{"heading":"h","figure":{"type":"flow","src":"???"}}]}');
  assert.match(bad.html, /<title>&lt;x&gt;<\/title>/);
  assert.match(bad.html, /図を描けませんでした/);
  assert.ok(bad.warnings.some((w) => /3 つまで/.test(w.message)));
  assert.ok(bad.warnings.some((w) => /next/.test(w.message)));
  assert.match(GK.explain.render("{x").errors[0].message, /JSON として読めません/);
});

test("取り込み：arch・map・wbs・explain・memo を見分ける（言語名と中身）", () => {
  const reply = ["【段階 4/7｜構成図｜図を確かめてください】", "```arch", fx("arch.txt"), "```", "```map", fx("map.txt"), "```", "```wbs", fx("wbs.md"), "```", "```explain", fx("explain.json"), "```", "```memo", "F-01 事実", "Q-01 締め日は？（決める人：部長／期限：2026-12-05）", "```", "```", "layer A", "node X @A 箱", "```"].join("\n");
  const r = GK.intake.parse(reply);
  assert.deepEqual(r.blocks.map((b) => b.kind), ["arch", "map", "wbs", "explain", "memo", "arch"]);
  assert.equal(r.blocks[0].title, "受注システムの構成（ダミー）");
  assert.equal(r.blocks[2].title, "8 作業");
  assert.equal(r.blocks[3].title, "受注業務の見直し（ダミー）");
});

test("案件メモ：ID で統合し、回答済にし、状況と成果物の一覧を作る", () => {
  const a = GK.note.parseMemo("F-1 受注は月 300 件\n- D-01 ポータルで入力してもらう\nQ-01 締め日は？（決める人：営業部長／期限：2026-12-05）\nQ-02 上限金額は？\nメモではない行");
  assert.deepEqual(a.map((x) => x.id), ["F-01", "D-01", "Q-01", "Q-02"]);
  assert.equal(a[2].who, "営業部長");
  assert.equal(a[2].due, "2026-12-05");
  assert.equal(a[2].text, "締め日は？");
  let r = GK.note.merge(GK.note.empty("受注"), a, "2026-11-24");
  assert.equal(r.added, 4);
  r = GK.note.merge(r.note, GK.note.parseMemo("Q-01 回答済：月末\nF-01 受注は月 320 件\nF-02 新しい事実"), "2026-11-25");
  assert.deepEqual([r.added, r.updated, r.answered], [1, 1, 1]);
  const n = GK.note.addArtifact(GK.note.setHeader(r.note, { stage: 4, type: "WBS", next: "担当を決める" }), { date: "2026-11-25 10:00", file: "out/WBS.xlsx", kind: "WBS", stage: 4 });
  assert.equal(n.questions[0].status, "回答済");
  assert.equal(n.questions[0].answer, "月末");
  assert.equal(n.facts[0].text, "受注は月 320 件");
  const s = GK.note.statusMd(n, "2026-12-10");
  assert.match(s, /段階：4\/7 作成｜型：WBS/);
  assert.match(s, /## 未回答の質問（1 件）\n- Q-02 上限金額は？\n/);
  assert.match(s, /- Q-01 締め日は？ → 月末/);
  assert.match(GK.note.indexMd(n), /\| 2026-11-25 10:00 \| out\/WBS\.xlsx \| WBS \| 4 \|/);
  assert.match(GK.note.notebookMd(n), /- Q-01 締め日は？ → 回答：月末/);
});

test("Gem：司令塔の知識ファイルは 10 個以内で、新しい記法と VBA を含む。VBA の規則と取り込みマクロ", () => {
  const items = readItems();
  const c = items.find((x) => x.id === "gem-conductor");
  const kn = c.knowledge.map((k) => k.id);
  assert.ok(kn.length <= 10);
  for (const id of ["fmt-arch", "fmt-map", "fmt-wbs", "fmt-explain", "vba-guide"]) assert.ok(kn.includes(id), id);
  for (const w of ["```arch", "```map", "```wbs", "```explain", "```memo", "Q-01 回答済："]) assert.ok(c.body.includes(w), w);
  const v = items.find((x) => x.id === "vba-guide").body;
  for (const w of ["Option Explicit", "控え", "vbYesNo", "件数", "エラーの番号"]) assert.ok(v.includes(w), w);
  const m = items.find((x) => x.id === "vba-import").body;
  assert.match(m, /^```vba\nOption Explicit/);
  assert.match(m, /Public Sub 表を取り込む\(\)/);
  // 記法の説明に書いた例は、そのまま図になる
  for (const [id, mod] of [["fmt-arch", "arch"], ["fmt-map", "map"]]) {
    const ex = items.find((x) => x.id === id).body.match(new RegExp("```" + mod + "\\n([\\s\\S]*?)\\n```"))[1];
    assert.deepEqual(GK[mod].parse(ex).errors, [], id);
  }
  const wex = items.find((x) => x.id === "fmt-wbs").body.match(/```wbs\n([\s\S]*?)\n```/)[1];
  assert.deepEqual(GK.wbs.parse(wex).errors, []);
  const eex = items.find((x) => x.id === "fmt-explain").body.match(/```explain\n([\s\S]*?)\n```/)[1];
  assert.deepEqual(GK.explain.parse(eex).errors, []);
});
