// gemini-agent：司令塔 Gem・一括取り込み・Google への出口・組み立て
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadGK, readItems, build, ROOT } from "../build.mjs";

const GK = loadGK();
const fx = (f) => fs.readFileSync(path.join(ROOT, "tests", "fixtures", f), "utf8");
const dec = (u8) => new TextDecoder().decode(u8);
const zipNames = (u8) => [...GK.xlsx.entries(u8).keys()];
// 無圧縮 zip の中身を名前で取り出す
const zipText = (u8, name) => {
  const e = GK.xlsx.entries(u8).get(name);
  assert.ok(e, `${name} がありません`);
  return dec(e.data);
};

const REPLY = [
  "【段階 4/7｜資料｜文書と図を確かめて、レビューに回してください】",
  "要件の骨子を作りました。",
  "",
  "````markdown",
  "# 受注業務 要件定義書",
  "## 1. 業務の流れ",
  "```flow",
  "task A 受注を受ける",
  "task B 在庫を確かめる",
  "A -> B",
  "```",
  "## 2. 未確定",
  "- [ ] 締め日",
  "````",
  "",
  "```table",
  "| ID | 作業 | 工数 |",
  "|---|---|---|",
  "| T-01 | 要件定義 | 24 |",
  "| T-02 | 設計 | 1,200 |",
  "```",
  "",
  "```json",
  JSON.stringify({ patch: "anken.v2", from: "karte-update", add: {}, update: [] }),
  "```",
  "",
  "```",
  "task A 開始",
  "task B 終了",
  "A -> B",
  "```",
  "",
  "```json",
  JSON.stringify({ title: "提案", slides: [{ type: "cover" }] }),
  "```",
].join("\n");

test("取り込み：段階の見出しと、ブロックの種類を読み分ける", () => {
  const r = GK.intake.parse(REPLY);
  assert.deepEqual(r.header, { stage: 4, total: 7, type: "資料", next: "文書と図を確かめて、レビューに回してください" });
  // ```table でも、見出しが ID・作業・工数なら WBS として扱う
  assert.deepEqual(r.blocks.map((b) => b.kind), ["doc", "wbs", "karte", "flow", "slides"]);
  const doc = r.blocks[0];
  assert.match(doc.text, /```flow\ntask A 受注を受ける/, "外側が ````markdown なら中の flow ごと 1 つの文書");
  assert.equal(doc.title, "受注業務 要件定義書");
  assert.equal(r.blocks[1].title, "2 作業");
  assert.equal(r.blocks[4].title, "提案");
  assert.deepEqual(GK.intake.summary(r).map((s) => s.kind), ["karte", "flow", "slides", "doc", "wbs"]);
});

test("取り込み：3 つの ```markdown の中の ```flow で閉じを取り違えない・途中で切れたブロック", () => {
  const r = GK.intake.parse("```markdown\n# 表題\n```flow\nA: x\nB: y\nA -> B\n```\n本文\n```\n\n```table\n|a|b|\n|--|--|\n|1|2|");
  assert.equal(r.blocks.length, 2);
  assert.equal(r.blocks[0].kind, "doc");
  assert.match(r.blocks[0].text, /本文$/);
  assert.equal(r.blocks[1].kind, "table");
  assert.equal(r.blocks[1].truncated, true);
});

test("取り込み：コードブロックが無く見出しのある文は、それ自体を文書にする。言語名と中身からの推定", () => {
  const r = GK.intake.parse("【段階 3/7｜要件｜承認してください】\n# 仕様\n## 背景\n受注の手作業を減らしたい。そのため、取り込みを自動にする。担当者の確認は残す。\n## 非目標\n- 請求は扱わない");
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].kind, "doc");
  assert.equal(r.blocks[0].fromProse, true);
  assert.doesNotMatch(r.blocks[0].text, /段階/);
  assert.equal(GK.intake.guess("tsv", "a\tb"), "table");
  assert.equal(GK.intake.guess("", "名前\t数\nA\t1\nB\t2"), "table");
  assert.equal(GK.intake.guess("python", "print(1)"), "code");
  assert.equal(GK.intake.guess("vba", "Sub A()\nEnd Sub"), "code");
  assert.equal(GK.intake.guess("json", '{"schema":"anken.v2","project":{}}'), "karte");
  assert.equal(GK.intake.parse("").blocks.length, 0);
});

test("出口：表を読む（Markdown・TSV・CSV の引用符）と、TSV・HTML にする", () => {
  assert.deepEqual(GK.gexport.parseTable("| 名前 | 数 |\n|--|--:|\n| **A** | 1 |").rows, [["名前", "数"], ["A", "1"]]);
  assert.deepEqual(GK.gexport.parseTable("a\tb\n1\t2").rows, [["a", "b"], ["1", "2"]]);
  assert.deepEqual(GK.gexport.parseTable('a,b\n"x,y","改\n行"\n').rows, [["a", "b"], ["x,y", "改\n行"]]);
  assert.equal(GK.gexport.tsv([["a", "b\tc"], ['"q"', "改\n行"]]), 'a\t"b\tc"\n"""q"""\t"改\n行"');
  const html = GK.gexport.tableHTML([["<x>", "b"], ["1"]]);
  assert.match(html, /<th[^>]*>&lt;x&gt;<\/th>/);
  assert.match(html, /<td[^>]*><\/td><\/tr>/, "足りないセルは空で埋める");
});

test("出口：xlsx を書き出し、xlsx.js で読み戻すと同じ値になる（数値・文字の番号・数式・シート名）", async () => {
  const rows = [["ID", "作業", "工数", "金額", "合計"], ["007", "要件定義 <確認>", "24", "1,200", "=C2*2"], ["T-02", "設計", "3.5", "", ""]];
  const u8 = GK.gexport.xlsx([{ name: "WBS/案:1", rows }, { name: "WBS/案:1", rows: [["a"]] }]);
  assert.ok(zipNames(u8).includes("xl/styles.xml"));
  const wb = zipText(u8, "xl/workbook.xml");
  assert.match(wb, /name="WBS_案_1"/);
  assert.match(wb, /name="WBS_案_1\(2\)"/, "同じ名前のシートは番号を付ける");
  const s1 = zipText(u8, "xl/worksheets/sheet1.xml");
  assert.match(s1, /state="frozen"/);
  assert.match(s1, /<autoFilter ref="A1:E3"\/>/);
  assert.match(s1, /<c r="E2" s="1"><f>C2\*2<\/f><\/c>/);
  assert.match(s1, /<c r="C2" s="1"><v>24<\/v><\/c>/);
  assert.match(s1, /<c r="D2" s="3"><v>1200<\/v><\/c>/, "桁区切りの数値は数値にする");
  const back = await GK.xlsx.sheets(u8);
  assert.equal(back.length, 2);
  assert.deepEqual(back[0].rows[0], rows[0]);
  assert.equal(back[0].rows[1][0], "007", "先頭が 0 の番号は文字のまま");
  assert.equal(back[0].rows[1][1], "要件定義 <確認>");
  assert.equal(back[0].rows[2][2], "3.5");
  assert.throws(() => GK.gexport.xlsx([]), /表がありません/);
});

test("出口：docx の部品と本文（見出し・箇条書き・番号・表・コード・行内の書式）", () => {
  const md = "# 表題\n本文 **太字** と `code` と [資料](https://example.com)\n\n## 節\n- a\n  - b\n1. 一\n2. 二\n\n3. 三\n\n| x | y |\n|--|--:|\n| 1 | **2** |\n\n```flow\nA: x\nB: y\nA -> B\n```\n> 引用\n\n- [x] 済\n---";
  const u8 = GK.gexport.docx(md, { title: "テスト" });
  const names = zipNames(u8);
  for (const n of ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels", "docProps/core.xml"]) assert.ok(names.includes(n), n);
  const doc = zipText(u8, "word/document.xml");
  assert.match(doc, /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">表題<\/w:t>/);
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">太字/);
  assert.match(doc, /Consolas/);
  assert.match(doc, /資料（https:\/\/example\.com）/, "リンクは文字と URL にする");
  assert.match(doc, /<w:ilvl w:val="1"\/><w:numId w:val="1"\/>/, "入れ子の箇条書き");
  assert.match(doc, /<w:numId w:val="2"\/>/);
  assert.match(doc, /<w:numId w:val="3"\/>/, "番号つきが分かれたら振り直す");
  assert.match(doc, /<w:tblHeader\/>/);
  assert.match(doc, /<w:jc w:val="right"\/>/);
  assert.match(doc, /フロー図（記法）/);
  assert.match(doc, /☑ 済/);
  assert.match(doc, /<w:pStyle w:val="Quote"\/>/);
  const num = zipText(u8, "word/numbering.xml");
  assert.match(num, /<w:num w:numId="3"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"\/>/);
  assert.match(zipText(u8, "word/styles.xml"), /w:eastAsia="メイリオ"/);
  assert.match(zipText(u8, "docProps/core.xml"), /<dc:title>テスト<\/dc:title>/);
  // XML として壊れていない（開きと閉じの数）
  assert.equal((doc.match(/<w:p>/g) || []).length, (doc.match(/<\/w:p>/g) || []).length);
  assert.equal((doc.match(/<w:tbl>/g) || []).length, (doc.match(/<\/w:tbl>/g) || []).length);
});

test("出口：貼り付け用 HTML はインラインの style だけで、文字をエスケープし、図の画像を差し込む", () => {
  const md = "# 表題 <script>\n本文 **太字**\n\n```flow\nA: x\nB: y\nA -> B\n```\n| a |\n|--|\n| <b> |";
  const html = GK.gexport.richHTML(md);
  assert.doesNotMatch(html, /<script>|<b> /);
  assert.match(html, /<h1 style="[^"]+">表題 &lt;script&gt;<\/h1>/);
  assert.match(html, /<b>太字<\/b>/);
  assert.match(html, /<pre style=/, "画像が無ければ記法のまま");
  assert.doesNotMatch(html, /class=/);
  assert.deepEqual(GK.gexport.flowSources(md), ["A: x\nB: y\nA -> B"]);
  const withImg = GK.gexport.richHTML(md, { images: [{ src: "data:image/png;base64,AAAA", w: 320.4, h: 100 }] });
  assert.match(withImg, /<img src="data:image\/png;base64,AAAA" width="320" height="100" alt="フロー図">/);
});

test("出口：NotebookLM 用 md の案内と、Google スライドの点検・フォントの差し替え", () => {
  const md = GK.gexport.notebookMd("# 要件\n本文", { kind: "要件定義書", version: 3, date: "2026-11-24" });
  assert.match(md, /^# 要件（NotebookLM のソース）\n/);
  assert.match(md, /2026-11-24 に書き出した要件定義書です（案件カルテ v3 が元）/);
  assert.match(md, /# 要件\n本文\n$/);
  const deck = JSON.parse(fx("deck.json"));
  const L = GK.slides.layoutDeck(deck);
  const checks = GK.gexport.slidesCheck(deck, L);
  assert.ok(checks.some((c) => /Noto Sans JP/.test(c.message)));
  const long = { slides: [{ type: "content", title: "t", body: ["あ".repeat(500)] }] };
  assert.ok(GK.gexport.slidesCheck(long, { warnings: [] }).some((c) => c.slide === 1 && /文字が多い/.test(c.message)));
  const g = GK.pptx.build(L, { title: "x", eaFont: "Noto Sans JP" });
  assert.match(zipText(g, "ppt/theme/theme1.xml"), /Noto Sans JP/);
  const n = GK.pptx.build(L, { title: "x" });
  assert.match(zipText(n, "ppt/theme/theme1.xml"), /メイリオ/, "指定しなければ元どおりメイリオ");
});

test("司令塔 Gem：Gem 設定に入り、見出しの形・ブロック名・承認の規則を持つ", () => {
  const it = readItems().find((x) => x.id === "gem-conductor");
  assert.ok(it, "gem-conductor がありません");
  assert.equal(it.category, "Gem 指示文");
  assert.doesNotMatch(it.body, /キット|カルテ係|gemini-kit/, "gemini-kit 固有の言い回しが残っていない");
  for (const w of ["【段階", "理解", "アイデア出し", "構成図", "WBS", "Excel・VBA", "HTML", "```flow", "```slides", "```table", "````markdown", "承認", "非目標"]) assert.ok(it.body.includes(w), w);
  // 指示文の見出しの例は、取り込みで読める形になっている
  const ex = it.body.match(/【段階[^】]+】/g) || [];
  assert.ok(ex.length >= 1);
  for (const e of ex.filter((s) => /\d/.test(s))) assert.ok(GK.intake.header(e), e);
});

test("Gem 設定：レビュー Gem があり、指示文の知識ファイルはすべて実在する", () => {
  const items = readItems();
  const gems = items.filter((x) => x.category === "Gem 指示文");
  assert.deepEqual(gems.map((g) => g.id), ["gem-conductor", "gem-reviewer"]);
  for (const g of gems) {
    assert.ok(g.knowledge && g.knowledge.length, g.id);
    assert.ok(g.knowledgeNote, g.id);
    for (const k of g.knowledge) assert.ok(items.some((x) => x.id === k.id && x.category !== "Gem 指示文"), `${g.id} → ${k.id}`);
  }
  for (const it of items) assert.doesNotMatch(it.body, /キットの|判断・データ/, `${it.id} に gemini-kit 固有の言い回し`);
});

test("組み立て：全タブとモジュールが入り、通信 API の検出に通る。使い方の流れ図が描ける", () => {
  const out = path.join(ROOT, "output", "test-agent.html");
  build(out);
  const html = fs.readFileSync(out, "utf8");
  fs.rmSync(out);
  for (const t of ["intake", "doc", "flow", "slides", "table", "wbs", "explain", "gem", "help"]) assert.match(html, new RegExp(`id="tab-${t}"`), t);
  for (const m of ["intake", "gexport", "diagram", "arch", "map", "wbs", "explain", "note", "intakeUI", "preview", "app"]) assert.match(html, new RegExp(`GK\\.${m} = `), m);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/, "外部のファイルを読まない");
  // 使い方の 7 段階の図（app.js の HELP_FLOW）がフロー記法として正しい
  const src = fs.readFileSync(path.join(ROOT, "src", "js", "app.js"), "utf8").match(/const HELP_FLOW = \[([\s\S]*?)\]\.join/)[1];
  const lines = [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const g = GK.flow.parse(lines.join("\n"));
  assert.deepEqual(g.errors, []);
  assert.equal(g.nodes.length, 10);
});
