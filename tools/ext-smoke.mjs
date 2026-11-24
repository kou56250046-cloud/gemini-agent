// 開発用：Chrome 拡張の試験版を読み込んだヘッドレス Chrome で、ダミーの Gemini・NotebookLM の画面を相手にエージェントを 1 本通す。
//   node tools/ext-smoke.mjs [保存先]
// 確かめること：送信 → 応答 → ツール（list_dir・read_file・run_js・write_file・ask_notebooklm・done）→ 結果の返送の往復、
// 段階 3 での停止（人の承認）、案件メモ・状況・成果物の自動保存、手数の上限、run_js の打ち切りと通信の遮断、サイドパネルの画面。
// 案件フォルダはメモリ上のダミー（フォルダを選ぶ画面はヘッドレスで操作できないため）。実際の Gemini には触らない
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || path.join(ROOT, "output", "shots"));
// Google Chrome 137 以降は --load-extension を受け付けないので、Playwright が入れた Chromium を使う（GA_CHROME で指定もできる）
const PW = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
const pwChromium = fs.existsSync(PW) ? fs.readdirSync(PW).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(PW, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p)) : null;
const CHROME = process.env.GA_CHROME || pwChromium;
if (!CHROME) { console.error("拡張を読み込める Chromium が見つかりません（npx playwright install chromium で入れるか、GA_CHROME に chrome.exe の場所を入れてください）"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = 8773;

// 1. 試験版の拡張を作る
execFileSync(process.execPath, [path.join(ROOT, "build.mjs"), "--test-ext", `http://127.0.0.1:${SITE}`], { stdio: "inherit" });
const EXT = path.join(ROOT, "output", "extension-test");

// 2. ダミーの画面を配る
const FIX = path.join(ROOT, "tests", "fixtures", "ext");
const server = http.createServer((req, res) => {
  const f = path.join(FIX, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""));
  if (!f.startsWith(FIX) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(f));
}).listen(SITE, "127.0.0.1");

// 3. 拡張を読み込んだ Chrome
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ga-ext-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let extId = null;
for (let i = 0; i < 60 && !extId; i++) {
  // この拡張の service worker（background.js）から ID を取る（Chrome 内蔵の拡張と取り違えない）
  try { const t = (await list()).find((x) => /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(x.url)); if (t) extId = t.url.split("/")[2]; } catch (e) { /* 起動待ち */ }
  if (!extId) await sleep(250);
}
if (!extId) { console.error("拡張を読み込めませんでした"); chrome.kill(); server.close(); process.exit(1); }
// タブを開く：まず空のタブを作り、Page.navigate で移る（/json/new に chrome-extension:// を渡すとエラーのページになるため）
const open = async (url) => {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const c = await connect(t);
  await c.send("Page.enable");
  await c.send("Page.navigate", { url });
  await sleep(1200);
  c.ws.close();
  return t;
};

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800)); return r.result.result.value; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, "base64")); };
  return { ws, send, ev, shot };
}

const result = {};
try {
  await open(`http://127.0.0.1:${SITE}/fake-nlm.html`);
  const gem = await connect(await open(`http://127.0.0.1:${SITE}/fake-gemini.html`));
  const panel = await connect(await open(`chrome-extension://${extId}/panel.html`));
  await panel.send("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  result.panelPage = await panel.ev(`return { href: location.href, title: document.title, gk: typeof GK, scripts: [...document.scripts].map(x => x.src), body: document.body ? document.body.innerText.slice(0, 300) : "" };`);
  if (result.panelPage.gk !== "object") throw new Error(JSON.stringify(result.panelPage));

  // 1 本通す：段階 3 で止まる → 承認 → 成果物・メモ・ファイル → NotebookLM → done
  result.run = await panel.ev(`
    const T = GK.runnerUI.test;
    await T.useFs(T.memFs("ダミー案件", { "資料/議事録.txt": "第1回 打合せ（ダミー）\\n締め日は未定" }));
    T.state.settings.confirmWrite = false;
    T.state.settings.maxSteps = 20;
    const p = T.run("WBS を作りたい（ダミー）");
    let waited = 0;
    while (!T.state.gate && waited < 60000) { await new Promise(r => setTimeout(r, 250)); waited += 250; }
    const gated = !!T.state.gate;
    const gateText = document.querySelector('.ag-gate') ? document.querySelector('.ag-gate').innerText.slice(0, 80) : "";
    T.answerGate("承認します。進めてください。");
    await p;
    const dec = (k) => new TextDecoder().decode(T.state.fs.files.get(k));
    const n = T.state.note;
    return {
      gated, gateText,
      files: [...T.state.fs.files.keys()].sort(),
      log: T.state.log.map(e => [e.action, e.tool || "", e.ok === false ? "失敗" : ""].join(" ").trim()),
      logHasBody: JSON.stringify(T.state.log).includes("締め日"),
      stage: n.stage, facts: n.facts.length, decisions: n.decisions.length, q: n.questions.map(q => q.id + ":" + q.status + ":" + (q.answer || "")),
      artifacts: n.artifacts.map(a => a.kind),
      status: dec("case/status.md").split("\\n").slice(0, 8).join("\\n"),
      msg: document.querySelector('#agent-root .status').textContent,
    };`);
  result.sentToGemini = await gem.ev(`return window.__sent.map(t => t.split("\\n")[0].slice(0, 40));`);
  await panel.shot("ext-panel.png");

  // 手数の上限で止まる（2 手）
  result.maxSteps = await panel.ev(`
    const T = GK.runnerUI.test;
    T.state.firstSent = false; T.state.settings.maxSteps = 2;
    await T.run("もう一度（ダミー）");
    return { msg: document.querySelector('#agent-root .status').textContent, gate: !!T.state.gate };`);
  await panel.ev(`GK.runnerUI.test.answerGate(null); return true;`).catch(() => {});

  // run_js：3 秒で打ち切る・通信できない・拡張の API に触れない
  result.runJs = await panel.ev(`
    const T = GK.runnerUI.test;
    const tryIt = async (code) => { try { return (await T.execTool({ tool: "run_js", args: { code } })).text; } catch (e) { return "失敗：" + e.message; } };
    return {
      sum: await tryIt("return [1,2,3].reduce((a,b)=>a+b,0)"),
      loop: await tryIt("while(true){}"),
      net: await tryIt("return fetch('http://127.0.0.1:${SITE}/fake-nlm.html').then(() => '届いた').catch(e => '止まった：' + e.message)"),
      api: await tryIt("return typeof chrome === 'undefined' || !chrome.tabs ? '使えない' : '使える'"),
    };`);
  // 書き込みの許可：「許可しない」を押すと書かない
  result.approve = await panel.ev(`
    const T = GK.runnerUI.test;
    T.state.settings.confirmWrite = true;
    const p = T.execTool({ tool: "write_file", args: { path: "out/許可の確認.md", content: "x" } }).then(() => "書いた", (e) => "止まった：" + e.message);
    await new Promise(r => setTimeout(r, 300));
    const card = document.querySelector('.ag-approve') ? document.querySelector('.ag-approve').innerText.split("\\n").slice(0, 2).join("／") : "";
    [...document.querySelectorAll('.ag-approve button')].find(x => x.textContent === "許可しない").click();
    return { card, result: await p, written: T.state.fs.files.has("out/許可の確認.md"), gateLeft: !!T.state.gate };`);
  // パスの検査（実行の口で）
  result.paths = await panel.ev(`
    const T = GK.runnerUI.test;
    const tryIt = async (call) => { try { await T.execTool(call); return "通った"; } catch (e) { return e.message.slice(0, 40); } };
    return [
      await tryIt({ tool: "read_file", args: { path: "../x.txt" } }),
      await tryIt({ tool: "write_file", args: { path: "資料/上書き.txt", content: "x" } }),
      await tryIt({ tool: "read_file", args: { path: "資料/a.pdf" } }),
    ];`);
} finally {
  chrome.kill();
  server.close();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch (e) { /* 消せなくても結果には影響しない（一時フォルダ） */ }
}
console.log(JSON.stringify(result, null, 1));
