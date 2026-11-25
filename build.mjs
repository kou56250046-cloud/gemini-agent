// 配布用の HTML 1 枚を作る。src/agent.html に src/js と src/items（Gem の指示文と知識ファイル）とサンプルを埋め込み、
// output/gemini-agent.html に書き出す。
//
//   node build.mjs [--out FILE]
//
// 開いた PC では Node もネットワークも要らない。Node は開発（組み立てとテスト）にだけ使う。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const MARK = "/*__AGENT__*/";
// 読み込み順。intakeui.js と app.js は最後（ほかのモジュールを使う）
export const JS_FILES = ["dom.js", "md.js", "flow.js", "slides.js", "pptx.js", "xlsx.js", "intake.js", "gexport.js", "diagram.js", "arch.js", "map.js", "wbs.js", "explain.js", "note.js", "runner.js", "parse.js", "model.js", "audit.js", "clean.js", "meetlog.js", "minutes.js", "qaflow.js", "preview.js", "intakeui.js", "runnerui.js", "qaui.js", "meetui.js", "auditui.js", "app.js"];
// 画面を使わないモジュール（テストで読む）
export const LOGIC_FILES = ["dom.js", "md.js", "flow.js", "slides.js", "pptx.js", "xlsx.js", "intake.js", "gexport.js", "diagram.js", "arch.js", "map.js", "wbs.js", "explain.js", "note.js", "runner.js", "parse.js", "model.js", "audit.js", "clean.js", "meetlog.js", "minutes.js", "qaflow.js"];
// Gem 設定タブでの並び
export const CATEGORIES = ["Gem 指示文", "NotebookLM 指示", "図・スライドの書式", "Excel・VBA", "デザイン（PPT）"];
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
  return { flow: fx("order-flow.txt"), deck: fx("deck.json"), arch: fx("arch.txt"), map: fx("map.txt"), wbs: fx("wbs.md"), explain: fx("explain.json"), meeting: fx("meeting.vtt") };
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

// opts.extZip：Chrome 拡張の zip（Uint8Array）。HTML に埋め込み、画面の「Chrome 拡張をダウンロード」で保存できるようにする
export function build(out, opts) {
  const o = opts || {};
  let html = fs.readFileSync(path.join(SRC, "agent.html"), "utf8");
  if (!html.includes(MARK)) throw new Error(`agent.html に ${MARK} がありません`);
  // 先頭で、読み込んだままの HTML を控える（「この HTML を保存」で使う。画面を組む前なので、配ったものと同じ中身になる）
  const extra = ['GK.PRISTINE_HTML = "<!DOCTYPE html>\\n" + document.documentElement.outerHTML;'];
  if (o.extZip) extra.push(`GK.EXT_ZIP = ${JSON.stringify(Buffer.from(o.extZip).toString("base64"))};`, `GK.EXT_VERSION = ${JSON.stringify(manifest().version)};`);
  html = html.replace(MARK, () => bundle(extra));
  writeAtomic(out, html);
  return html.length;
}

// ---------- zip（Deflate で圧縮。Node だけで使う：拡張を HTML に埋め込むとき） ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// files: [{ name, data(Buffer) }] → Buffer。名前は UTF-8（日本語のファイル名も化けない）
export function zipDeflate(files) {
  const local = [], central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.from(f.data);
    const comp = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
// 拡張のフォルダ → zip（展開すると gemini-agent-extension/ のフォルダになる）
export function zipDir(dir, top) {
  const files = [];
  const walk = (d, rel) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, `${rel}${n}/`); else files.push({ name: `${top}/${rel}${n}`, data: fs.readFileSync(p) }); } };
  walk(dir, "");
  return zipDeflate(files);
}

// ---------- Chrome 拡張（デベロッパーモードで「パッケージ化されていない拡張機能を読み込む」） ----------
export const EXT_FILES = ["background.js", "domtomd.js", "content-gemini.js", "content-nlm.js", "content-meet.js", "sandbox.html", "sandbox.js"];
const HOSTS = { gemini: ["https://gemini.google.com/"], notebooklm: ["https://notebooklm.google.com/"], meet: ["https://meet.google.com/"] };
// 試験版は、ダミーの画面（tests/fixtures/ext）を配る 127.0.0.1 も相手にする
function hostsOf(o) {
  const h = { gemini: [...HOSTS.gemini], notebooklm: [...HOSTS.notebooklm], meet: [...HOSTS.meet] };
  if (o.test) { h.gemini.push(`${o.test}/fake-gemini`); h.notebooklm.push(`${o.test}/fake-nlm`); h.meet.push(`${o.test}/fake-meet`); }
  return h;
}
export function manifest(opts) {
  const o = opts || {};
  const hosts = hostsOf(o);
  const match = (h) => `${h}*`;
  return {
    manifest_version: 3,
    name: "Gemini エージェント" + (o.test ? "（試験版）" : ""),
    version: "0.2.0",
    description: "Gemini・NotebookLM・Meet の画面をつなぎ、案件を段階を踏んで進める（社内用・通信しない）",
    // alarms・notifications：朝の確認。contextMenus・activeTab：右クリックでページを資料に保存
    permissions: ["sidePanel", "storage", "scripting", "alarms", "notifications", "contextMenus", "activeTab"],
    host_permissions: [...hosts.gemini, ...hosts.notebooklm, ...hosts.meet].map(match),
    side_panel: { default_path: "panel.html" },
    action: { default_title: "Gemini エージェント", default_icon: { 128: "icon128.png" } },
    icons: { 128: "icon128.png" },
    background: { service_worker: "background.js" },
    content_scripts: [
      { matches: hosts.gemini.map(match), js: ["domtomd.js", "content-gemini.js"], run_at: "document_idle" },
      { matches: hosts.notebooklm.map(match), js: ["domtomd.js", "content-nlm.js"], run_at: "document_idle" },
      { matches: hosts.meet.map(match), js: ["content-meet.js"], run_at: "document_idle" },
    ],
    sandbox: { pages: ["sandbox.html"] },
    content_security_policy: {
      // 既定は自分の中だけ。画面の style 属性と <style> は使うので style は unsafe-inline を許す（スクリプトは自分のファイルだけ）
      extension_pages: "default-src 'self'; script-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; frame-src 'self'",
      sandbox: "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'",
    },
  };
}
export function buildExt(dir, opts) {
  const o = opts || {};
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const hosts = hostsOf(o);
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
  fs.writeFileSync(path.join(dir, "icon128.png"), iconPng(128));
  writeAtomic(path.join(dir, "manifest.json"), JSON.stringify(manifest(o), null, 2) + "\n");
  return dir;
}

// 拡張の印（紺の角丸に金の横線 3 本）。通知には印が要る。依存なしで PNG を作る（zlib は Node の標準）
function iconPng(n) {
  const px = Buffer.alloc(n * (n * 4 + 1));
  const r = n * 0.18;
  for (let y = 0; y < n; y++) {
    px[y * (n * 4 + 1)] = 0; // 行の頭のフィルタ（なし）
    for (let x = 0; x < n; x++) {
      const dx = Math.max(0, r - x, x - (n - 1 - r)), dy = Math.max(0, r - y, y - (n - 1 - r));
      const inside = dx * dx + dy * dy <= r * r;
      const bar = [0.3, 0.48, 0.66].some((p) => Math.abs(y - n * p) < n * 0.045) && x > n * 0.22 && x < n * (y < n * 0.5 ? 0.78 : 0.62);
      const [R, G, B] = bar ? [0xb8, 0x89, 0x2b] : [0x1f, 0x3a, 0x5f];
      const o = y * (n * 4 + 1) + 1 + x * 4;
      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = inside ? 255 : 0;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(px)), chunk("IEND", Buffer.alloc(0))]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const out = path.resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : path.join(ROOT, "output", "gemini-agent.html"));
  // 先に拡張を作り、その zip を HTML に埋め込む
  const extDir = buildExt(path.join(ROOT, "output", "extension"));
  console.log(`${path.relative(process.cwd(), extDir)} に Chrome 拡張を作りました（chrome://extensions → デベロッパーモード →「パッケージ化されていない拡張機能を読み込む」）`);
  const extZip = zipDir(extDir, "gemini-agent-extension");
  const size = build(out, { extZip });
  console.log(`${path.relative(process.cwd(), out)} を作りました（${Math.round(size / 1024)} KB。拡張の zip ${Math.round(extZip.length / 1024)} KB を含む）`);
  const t = process.argv.indexOf("--test-ext");
  if (t >= 0) { const d = buildExt(path.join(ROOT, "output", "extension-test"), { test: process.argv[t + 1] || "http://127.0.0.1:8773" }); console.log(`${path.relative(process.cwd(), d)} に試験版を作りました`); }
}
