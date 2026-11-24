// 配布用の HTML 1 枚を作る。src/agent.html に src/js と src/items（Gem の指示文と知識ファイル）とサンプルを埋め込み、
// output/gemini-agent.html に書き出す。
//
//   node build.mjs [--out FILE]
//
// 開いた PC では Node もネットワークも要らない。Node は開発（組み立てとテスト）にだけ使う。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const MARK = "/*__AGENT__*/";
// 読み込み順。intakeui.js と app.js は最後（ほかのモジュールを使う）
export const JS_FILES = ["dom.js", "md.js", "flow.js", "slides.js", "pptx.js", "xlsx.js", "intake.js", "gexport.js", "diagram.js", "arch.js", "map.js", "wbs.js", "explain.js", "note.js", "runner.js", "preview.js", "intakeui.js", "runnerui.js", "app.js"];
// 画面を使わないモジュール（テストで読む）
export const LOGIC_FILES = ["dom.js", "md.js", "flow.js", "slides.js", "pptx.js", "xlsx.js", "intake.js", "gexport.js", "diagram.js", "arch.js", "map.js", "wbs.js", "explain.js", "note.js", "runner.js"];
// Gem 設定タブでの並び
export const CATEGORIES = ["Gem 指示文", "図・スライドの書式", "Excel・VBA", "デザイン（PPT）"];
const splitList = (s) => String(s || "").split(/[,、]\s*/).map((x) => x.trim()).filter(Boolean);

// 先頭の --- で囲んだ部分（key: value）と本文に分ける。gemini-kit の items と同じ書き方（use / place は読まない）
export function parseItem(name, text) {
  const m = text.replace(/\r\n?/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${name}: 先頭に --- で囲んだ見出し情報がありません`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const k of ["id", "category", "title"]) if (!meta[k]) throw new Error(`${name}: ${k} がありません`);
  const item = { id: meta.id, category: meta.category, title: meta.title, usage: meta.usage || "", body: m[2].replace(/^\n+/, "").replace(/\s+$/, "") + "\n" };
  if (meta.knowledge) item.knowledge = splitList(meta.knowledge).map((x) => ({ id: x.replace(/\?$/, ""), optional: x.endsWith("?") }));
  if (meta.knowledgeNote) item.knowledgeNote = meta.knowledgeNote;
  return item;
}

export function readItems() {
  const dir = path.join(SRC, "items");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const items = files.map((f) => parseItem(f, fs.readFileSync(path.join(dir, f), "utf8")));
  const ids = new Set();
  for (const it of items) {
    if (ids.has(it.id)) throw new Error(`id「${it.id}」が重複しています`);
    ids.add(it.id);
    if (!CATEGORIES.includes(it.category)) throw new Error(`${it.id} の category「${it.category}」は ${CATEGORIES.join(" / ")} のどれかにしてください`);
  }
  for (const it of items) for (const k of it.knowledge || []) if (!ids.has(k.id)) throw new Error(`${it.id} の knowledge「${k.id}」がありません`);
  return items;
}

// サンプル（すべてダミー）
export function readSamples() {
  const fx = (f) => fs.readFileSync(path.join(ROOT, "tests", "fixtures", f), "utf8");
  return { flow: fx("order-flow.txt"), deck: fx("deck.json"), arch: fx("arch.txt"), map: fx("map.txt"), wbs: fx("wbs.md"), explain: fx("explain.json") };
}

// テスト用：ロジックのモジュールを Node のグローバルに読み込む
export function loadGK() {
  if (!globalThis.GK || !globalThis.GK.intake) {
    for (const f of LOGIC_FILES) vm.runInThisContext(fs.readFileSync(path.join(SRC, "js", f), "utf8"), { filename: f });
  }
  const GK = globalThis.GK;
  GK.ITEMS = readItems();
  return GK;
}

// 本文に </script> などがあっても埋め込みが壊れないよう、< > & と U+2028/2029 を \uXXXX にする
const scriptSafe = (s) => s.replace(/[<>&\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

// 実行時に外へ出ていく API を使っていないことを確かめる
const BAD_API = /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts)\s*\(/;
function checkJs(name, js) {
  const bad = js.match(BAD_API);
  if (bad) throw new Error(`${name} が通信 API（${bad[1]}）を使っています`);
}
// 画面の JS をつないだ 1 本（HTML に埋め込むものと、拡張の panel.js は同じ中身）
function bundle(extra) {
  const parts = [
    `globalThis.GK = globalThis.GK || {};`,
    `GK.ITEMS = ${scriptSafe(JSON.stringify(readItems()))};`,
    `GK.SAMPLES = ${scriptSafe(JSON.stringify(readSamples()))};`,
    `GK.CATEGORIES = ${scriptSafe(JSON.stringify(CATEGORIES))};`,
    ...(extra || []),
  ];
  for (const name of JS_FILES) {
    const js = fs.readFileSync(path.join(SRC, "js", name), "utf8");
    if (js.toLowerCase().includes("</script")) throw new Error(`${name} に </script が含まれていて埋め込めません`);
    checkJs(name, js);
    parts.push(`// ---- ${name} ----\n${js}`);
  }
  return parts.join("\n");
}
function writeAtomic(out, data) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, out);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function build(out) {
  let html = fs.readFileSync(path.join(SRC, "agent.html"), "utf8");
  if (!html.includes(MARK)) throw new Error(`agent.html に ${MARK} がありません`);
  html = html.replace(MARK, () => bundle());
  writeAtomic(out, html);
  return html.length;
}

// ---------- Chrome 拡張（デベロッパーモードで「パッケージ化されていない拡張機能を読み込む」） ----------
export const EXT_FILES = ["background.js", "domtomd.js", "content-gemini.js", "content-nlm.js", "sandbox.html", "sandbox.js"];
const HOSTS = { gemini: ["https://gemini.google.com/"], notebooklm: ["https://notebooklm.google.com/"] };
export function manifest(opts) {
  const o = opts || {};
  const hosts = { gemini: [...HOSTS.gemini], notebooklm: [...HOSTS.notebooklm] };
  if (o.test) { hosts.gemini.push(`${o.test}/fake-gemini`); hosts.notebooklm.push(`${o.test}/fake-nlm`); }
  const match = (h) => (h.endsWith("/") ? `${h}*` : `${h}*`);
  return {
    manifest_version: 3,
    name: "Gemini エージェント" + (o.test ? "（試験版）" : ""),
    version: "0.1.0",
    description: "Gemini と NotebookLM の画面をつなぎ、案件を段階を踏んで進める（社内用・通信しない）",
    permissions: ["sidePanel", "storage", "scripting"],
    host_permissions: [...hosts.gemini, ...hosts.notebooklm].map(match),
    side_panel: { default_path: "panel.html" },
    action: { default_title: "Gemini エージェント" },
    background: { service_worker: "background.js" },
    content_scripts: [
      { matches: hosts.gemini.map(match), js: ["domtomd.js", "content-gemini.js"], run_at: "document_idle" },
      { matches: hosts.notebooklm.map(match), js: ["domtomd.js", "content-nlm.js"], run_at: "document_idle" },
    ],
    sandbox: { pages: ["sandbox.html"] },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'none'; frame-src 'self'",
      sandbox: "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'",
    },
  };
}
export function buildExt(dir, opts) {
  const o = opts || {};
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const hosts = { gemini: [...HOSTS.gemini], notebooklm: [...HOSTS.notebooklm] };
  if (o.test) { hosts.gemini.push(`${o.test}/fake-gemini`); hosts.notebooklm.push(`${o.test}/fake-nlm`); }
  const extra = [`GK.EXT_HOSTS = ${JSON.stringify(hosts)};`, ...(o.test ? ["GK.EXT_TEST = true;"] : [])];
  // サイドパネル：HTML と同じ画面。拡張のページはインラインのスクリプトを動かせないので panel.js に分ける
  let html = fs.readFileSync(path.join(SRC, "agent.html"), "utf8");
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, "").replace(`<script>\n${MARK}\n</script>`, '<script src="panel.js"></script>');
  if (!html.includes('<script src="panel.js">')) throw new Error("agent.html のスクリプトの場所が見つかりません");
  writeAtomic(path.join(dir, "panel.html"), html);
  writeAtomic(path.join(dir, "panel.js"), bundle(extra));
  for (const f of EXT_FILES) {
    const s = fs.readFileSync(path.join(SRC, "ext", f), "utf8");
    if (f.endsWith(".js")) checkJs(f, s);
    writeAtomic(path.join(dir, f), s);
  }
  writeAtomic(path.join(dir, "manifest.json"), JSON.stringify(manifest(o), null, 2) + "\n");
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const out = path.resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : path.join(ROOT, "output", "gemini-agent.html"));
  const size = build(out);
  console.log(`${path.relative(process.cwd(), out)} を作りました（${Math.round(size / 1024)} KB）`);
  const extDir = buildExt(path.join(ROOT, "output", "extension"));
  console.log(`${path.relative(process.cwd(), extDir)} に Chrome 拡張を作りました（chrome://extensions → デベロッパーモード →「パッケージ化されていない拡張機能を読み込む」）`);
  const t = process.argv.indexOf("--test-ext");
  if (t >= 0) { const d = buildExt(path.join(ROOT, "output", "extension-test"), { test: process.argv[t + 1] || "http://127.0.0.1:8773" }); console.log(`${path.relative(process.cwd(), d)} に試験版を作りました`); }
}
