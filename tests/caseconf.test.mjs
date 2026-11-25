// 案件の設定（案件の設定.md）：リンクの読み取り・確かめ・1 項目の書き戻し・タブとの照合。URL はすべてダミー
import test from "node:test";
import assert from "node:assert/strict";
import { loadGK } from "../build.mjs";

const GK = loadGK();
const C = GK.caseconf;
const HOSTS = { gemini: ["https://gemini.google.com/"], notebooklm: ["https://notebooklm.google.com/"], meet: ["https://meet.google.com/"] };

test("案件の設定：区切りの揺れ・行頭の記号・飾り・知らない行", () => {
  const p = C.parse([
    "# 案件の設定",
    "説明の行：ここは読まない",
    "- NotebookLM： https://notebooklm.google.com/notebook/aaa-111 ",
    "司令塔 Gem: <https://gemini.google.com/gem/conductor1>",
    "* レビューGem : [レビュー](https://gemini.google.com/gem/review1)",
    "担当: 山田",
  ].join("\r\n"));
  assert.deepEqual(p.links, { notebook: "https://notebooklm.google.com/notebook/aaa-111", conductor: "https://gemini.google.com/gem/conductor1", reviewer: "https://gemini.google.com/gem/review1" });
  assert.equal(p.lines.notebook, 3);
  assert.deepEqual(C.parse("").links, {});
  assert.deepEqual(C.parse(C.template()).links, { notebook: "", conductor: "", reviewer: "", write: "" });
});

test("案件の設定：別のサイトや NotebookLM のトップは使わない。空欄は誤りにしない", () => {
  const r = C.check(C.parse([
    "NotebookLM: https://notebooklm.google.com/",
    "司令塔 Gem: https://evil.example.com/gem/x",
    "レビュー Gem: ",
  ].join("\n")), HOSTS);
  assert.deepEqual(r.ok, {});
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0].msg, /1 行目.*NotebookLM のノートブック/);
  assert.match(r.errors[1].msg, /2 行目.*Gemini/);
  assert.equal(C.valid("notebooklm", "https://notebooklm.google.com/notebook/abc?authuser=1", HOSTS), true);
  assert.equal(C.valid("gemini", "https://gemini.google.com/gem/a b", HOSTS), false);
  assert.equal(C.valid("gemini", "javascript:alert(1)", HOSTS), false);
});

test("案件の設定：書き戻しは該当の行だけ。手で書いた行は残し、無ければ足す", () => {
  const src = "# 案件の設定\nメモ：先方の担当は山田\n- NotebookLM: https://notebooklm.google.com/notebook/old\n";
  const t1 = C.update(src, "notebook", "https://notebooklm.google.com/notebook/new");
  assert.equal(t1, "# 案件の設定\nメモ：先方の担当は山田\n- NotebookLM: https://notebooklm.google.com/notebook/new\n");
  const t2 = C.update(t1, "conductor", "https://gemini.google.com/gem/c1");
  assert.match(t2, /メモ：先方の担当は山田/);
  assert.equal(C.parse(t2).links.conductor, "https://gemini.google.com/gem/c1");
  assert.equal(C.parse(C.update(t2, "conductor", "")).links.conductor, "");
  assert.throws(() => C.update(t2, "other", "x"));
});

test("案件の設定：タブとの照合は前方一致（? と # は見ない）。似た別のノートブックは別", () => {
  const nb = "https://notebooklm.google.com/notebook/abc";
  assert.equal(C.matches("https://notebooklm.google.com/notebook/abc?authuser=1#x", nb), true);
  assert.equal(C.matches("https://notebooklm.google.com/notebook/abc/", nb), true);
  assert.equal(C.matches("https://notebooklm.google.com/notebook/abcd", nb), false);
  assert.equal(C.matches("https://notebooklm.google.com/notebook/xyz", nb), false);
  assert.equal(C.matches("https://gemini.google.com/gem/c1/9f8e", "https://gemini.google.com/gem/c1"), true);
  assert.equal(C.matches("https://gemini.google.com/app", ""), false);
});
