// 弾3：エージェントの進め方（ツール呼び出しの読み取り・次の一手・パス・結果の文・安全装置）と、拡張の組み立て
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGK, manifest, buildExt, ROOT } from "../build.mjs";

const GK = loadGK();
const R = GK.runner;
const reply = (...lines) => R.readReply(lines.join("\n"));

test("ツール呼び出し：```tool の JSON を読み、引数の欠け・知らない道具・JSON の誤りを知らせる", () => {
  const ok = reply("【段階 1/7｜理解｜待ってください】", "資料を見ます。", "```tool", '{"tool":"read_file","args":{"path":"資料/a.txt"}}', "```");
  assert.deepEqual(ok.calls, [{ tool: "read_file", args: { path: "資料/a.txt" } }]);
  assert.equal(ok.header.stage, 1);
  assert.deepEqual(R.decide(ok), { type: "tool", call: ok.calls[0] });
  assert.match(reply("```tool", '{"tool":"delete_all","args":{}}', "```").errors[0], /道具「delete_all」はありません/);
  assert.match(reply("```tool", '{"tool":"read_file","args":{}}', "```").errors[0], /引数 path がありません/);
  assert.match(reply("```tool", "{tool: read}", "```").errors[0], /JSON として読めません/);
  assert.equal(R.decide(reply("```tool", "{x", "```")).type, "fix");
  const two = reply("```tool", '{"tool":"list_dir","args":{}}', "```", "```tool", '{"tool":"list_dir","args":{}}', "```");
  assert.match(R.decide(two).message, /1 つだけ/);
});

test("次の一手：ask_user と段階 3 とツールの無い応答は人を待つ。done で終わる", () => {
  assert.deepEqual(R.decide(reply("```tool", '{"tool":"ask_user","args":{"question":"締め日は？"}}', "```")), { type: "gate", reason: "締め日は？", ask: true });
  assert.deepEqual(R.decide(reply("【段階 3/7｜WBS｜仕様を読んで承認してください】", "背景…")), { type: "gate", reason: "仕様を読んで承認してください" });
  assert.equal(R.decide(reply("【段階 4/7｜WBS｜表を確かめてください】")).type, "gate");
  assert.equal(R.decide(reply("ふつうの文")).type, "gate");
  assert.deepEqual(R.decide(reply("```tool", '{"tool":"done","args":{"summary":"WBS を保存しました"}}', "```")), { type: "done", summary: "WBS を保存しました" });
});

test("パス：案件フォルダの外・絶対パス・.. を拒み、書けるのは out/ の中だけ", () => {
  assert.deepEqual(R.normPath("資料\\議事録.txt"), ["資料", "議事録.txt"]);
  assert.deepEqual(R.normPath("./out//a.md"), ["out", "a.md"]);
  assert.deepEqual(R.normPath(""), []);
  for (const p of ["../秘密.txt", "資料/../../x", "C:\\Users\\x", "/etc/passwd", "~/a", "a/b?.txt"]) assert.throws(() => R.normPath(p), /使えません|\.\. は使えません|使えない文字/, p);
  assert.deepEqual(R.writablePath("out/メモ.md"), ["out", "メモ.md"]);
  for (const p of ["資料/a.md", "out", "case/note.json", "out/_控え/a.md"]) assert.throws(() => R.writablePath(p), /out\/ の中だけ|_控え/, p);
});

test("結果の文：成功・失敗の見出し、長いときの続きの案内、中に ``` があれば囲みを長くする", () => {
  assert.match(R.resultMessage("list_dir", true, "a.txt"), /^【ツール結果｜list_dir｜成功】\n```\na\.txt\n```/);
  assert.match(R.resultMessage("read_file", false, "ありません"), /｜失敗】[\s\S]*ask_user で人に聞いて/);
  const long = R.resultMessage("read_file", true, "あ".repeat(R.MAX_RESULT + 10), { from: 0 });
  assert.match(long, new RegExp(`続きは from: ${R.MAX_RESULT} で読めます`));
  assert.match(R.resultMessage("read_file", true, "```flow\nA\n```"), /^【[^\n]+\n````\n```flow/);
});

test("成果物の名前・docx の本文・安全装置・ログ（本文を入れない）・最初の発言", () => {
  const d = new Date(2026, 10, 24, 9, 5);
  assert.deepEqual(R.artifactPaths("wbs", "受注/WBS", d), [["out", "20261124-0905_WBS_受注_WBS.xlsx"], ["out", "20261124-0905_WBS_受注_WBS.svg"]]);
  assert.deepEqual(R.artifactPaths("unknown", "x", d), []);
  const docx = GK.gexport.docx("# 表題\n本文 **太字**\n\n| a | b |\n|--|--|\n| 1 | 2 |");
  const xml = new TextDecoder().decode(GK.xlsx.entries(docx).get("word/document.xml").data);
  assert.equal(R.docxText(xml), "表題\n本文 太字\na\tb\n1\t2");
  const g = R.guard(2);
  assert.equal(g.step(), true); assert.equal(g.step(), true); assert.equal(g.step(), false, "上限で止まる");
  assert.equal(g.fail("read_file"), true); assert.equal(g.fail("read_file"), true); assert.equal(g.fail("read_file"), false, "同じ失敗 3 回で止まる");
  g.ok(); assert.equal(g.fail("read_file"), true);
  const e = R.logEntry({ step: 1, action: "道具", tool: "read_file", ok: true, chars: 10, text: "本文" });
  assert.deepEqual(Object.keys(e).sort(), ["action", "chars", "ok", "step", "time", "tool"]);
  const p = R.protocol({ maxSteps: 12, folder: "ダミー案件" });
  for (const w of ["```tool", "read_file", "write_file", "ask_user", "段階 3 の仕様は、必ず ask_user", "12 手まで", "ダミー案件"]) assert.ok(p.includes(w), w);
});

test("拡張：権限は最小（Gemini と NotebookLM だけ）、通信を CSP で止め、組み立てたファイルがそろう", () => {
  const m = manifest();
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ["sidePanel", "storage", "scripting"]);
  assert.deepEqual(m.host_permissions, ["https://gemini.google.com/*", "https://notebooklm.google.com/*"]);
  assert.match(m.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(m.content_security_policy.sandbox, /connect-src 'none'/);
  assert.deepEqual(m.sandbox.pages, ["sandbox.html"]);
  const t = manifest({ test: "http://127.0.0.1:8773" });
  assert.ok(t.host_permissions.includes("http://127.0.0.1:8773/fake-gemini*"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ga-ext-"));
  try {
    buildExt(dir);
    for (const f of ["manifest.json", "panel.html", "panel.js", "background.js", "domtomd.js", "content-gemini.js", "content-nlm.js", "sandbox.html", "sandbox.js"]) assert.ok(fs.existsSync(path.join(dir, f)), f);
    const html = fs.readFileSync(path.join(dir, "panel.html"), "utf8");
    assert.match(html, /<script src="panel\.js"><\/script>/);
    assert.doesNotMatch(html, /<script>\s*[^<\s]/, "インラインのスクリプトが無い（拡張のページでは動かない）");
    assert.match(html, /id="tab-agent"/);
    const js = fs.readFileSync(path.join(dir, "panel.js"), "utf8");
    assert.match(js, /GK\.EXT_HOSTS = /);
    assert.doesNotMatch(js, /GK\.EXT_TEST = true/, "本番版に試験用の口を入れない");
    for (const f of ["panel.js", "content-gemini.js", "content-nlm.js", "background.js", "sandbox.js", "domtomd.js"]) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), "utf8"), /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/, f);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
