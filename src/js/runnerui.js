// 「エージェント」タブ（Chrome 拡張のサイドパネルのときだけ出す）。
// Gemini のタブに依頼を送り、応答を読み、ツールを実行して結果を返す、を繰り返す。人の判断が要るところで止まる。
// 案件フォルダ（File System Access API）に、案件メモ（case/note.json）・状況（case/status.md）・成果物（out/）・一覧（out/index.md）を自動で書く。
// 案件の本文は拡張の保存領域に残さない（保存するのは設定・セレクタ・フォルダの場所だけ）。ログは件数とファイル名だけ
(function (GK) {
  "use strict";

  const EXT = typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.id);
  const el = (...a) => GK.dom.el(...a);
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const R = GK.runner;
  const HOSTS = () => GK.EXT_HOSTS || { gemini: ["https://gemini.google.com/"], notebooklm: ["https://notebooklm.google.com/"] };
  const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const nowText = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${today()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const enc = new TextEncoder();

  let ctx = null;
  const S = {
    settings: { conductorUrl: "", reviewerUrl: "", maxSteps: 20, autoSave: true, confirmWrite: true },
    fs: null, folderName: "", note: null, running: false, stop: false, gate: null, lastArtifact: "", firstSent: false, log: [],
  };
  const UI = {};

  // ---------- 保存（設定・フォルダの場所だけ） ----------
  const store = {
    get: (k) => new Promise((res) => { try { chrome.storage.local.get(k, (v) => res(v ? v[k] : undefined)); } catch (e) { res(undefined); } }),
    set: (k, v) => new Promise((res) => { try { chrome.storage.local.set({ [k]: v }, () => res()); } catch (e) { res(); } }),
  };
  // フォルダのハンドルは chrome.storage に入らないので IndexedDB に入れる
  function idb(op, val) {
    return new Promise((res, rej) => {
      const r = indexedDB.open("gemini-agent", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", op === "get" ? "readonly" : "readwrite");
        const st = tx.objectStore("kv");
        const q = op === "get" ? st.get("folder") : op === "set" ? st.put(val, "folder") : st.delete("folder");
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      };
    });
  }

  // ---------- 案件フォルダ（読み書きの口をそろえる。テストでは同じ形のメモリ上のフォルダを使う） ----------
  function dirFs(root) {
    const dir = async (segs, create) => { let d = root; for (const s of segs) d = await d.getDirectoryHandle(s, { create }); return d; };
    const file = async (segs, create) => (await dir(segs.slice(0, -1), create)).getFileHandle(segs[segs.length - 1], { create });
    return {
      name: root.name,
      async list(segs) { const d = await dir(segs, false); const out = []; for await (const [n, h] of d.entries()) out.push({ name: n, dir: h.kind === "directory", size: h.kind === "file" ? (await h.getFile()).size : 0 }); return out; },
      async read(segs) { return new Uint8Array(await (await (await file(segs, false)).getFile()).arrayBuffer()); },
      async exists(segs) { try { await file(segs, false); return true; } catch (e) { return false; } },
      async write(segs, data) { const w = await (await file(segs, true)).createWritable(); await w.write(data); await w.close(); },
    };
  }
  function memFs(name, files) {
    const m = new Map(Object.entries(files || {}).map(([k, v]) => [k, typeof v === "string" ? enc.encode(v) : v]));
    const key = (segs) => segs.join("/");
    return {
      name, files: m,
      async list(segs) {
        const p = segs.length ? key(segs) + "/" : "";
        const seen = new Map();
        for (const [k, v] of m) if (k.startsWith(p)) { const rest = k.slice(p.length).split("/"); seen.set(rest[0], rest.length > 1 ? { name: rest[0], dir: true, size: 0 } : { name: rest[0], dir: false, size: v.length }); }
        if (!seen.size && segs.length) throw new Error("ありません");
        return [...seen.values()];
      },
      async read(segs) { const v = m.get(key(segs)); if (!v) throw new Error("ありません"); return v; },
      async exists(segs) { return m.has(key(segs)); },
      async write(segs, data) { m.set(key(segs), data instanceof Uint8Array ? data : typeof data === "string" ? enc.encode(data) : new Uint8Array(await data.arrayBuffer())); },
    };
  }
  function decodeText(u8) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^\uFEFF/, ""); }
    catch (e) { return new TextDecoder("shift_jis").decode(u8); }
  }
  async function readAsText(segs) {
    const name = segs[segs.length - 1] || "";
    if (!R.READABLE.test(name)) throw new Error(`「${name}」は読めない種類です（読めるもの：txt・md・csv・tsv・json・xlsx・docx・html）。PDF は NotebookLM に入れて ask_notebooklm で聞いてください`);
    const u8 = await S.fs.read(segs);
    if (/\.(xlsx|xlsm)$/i.test(name)) {
      const sheets = await GK.xlsx.sheets(u8);
      return sheets.map((s) => `## シート：${s.name}（${s.rows.length} 行）\n${GK.gexport.tsv(s.rows)}`).join("\n\n");
    }
    if (/\.docx$/i.test(name)) return R.docxText(await GK.xlsx.entryText(GK.xlsx.entries(u8), "word/document.xml"));
    return decodeText(u8);
  }
  async function writeSafe(segs, data) {
    // 上書きの前に控えを残す（out/_控え/名前.日時）
    if (await S.fs.exists(segs)) {
      const old = await S.fs.read(segs);
      await S.fs.write(["out", "_控え", `${segs.slice(1).join("_")}.${R.stampOf(new Date())}`], old);
    }
    await S.fs.write(segs, data);
  }
  async function uniquePath(segs) {
    let p = segs, k = 2;
    while (await S.fs.exists(p)) { const n = segs[segs.length - 1].replace(/(\.[^.]+)$/, `(${k++})$1`); p = [...segs.slice(0, -1), n]; }
    return p;
  }

  // ---------- 案件メモ・状況 ----------
  async function loadNote() {
    S.note = null;
    if (S.fs && await S.fs.exists(["case", "note.json"])) {
      try { const j = JSON.parse(decodeText(await S.fs.read(["case", "note.json"]))); if (j && j.schema === GK.note.SCHEMA) S.note = j; } catch (e) { say("case/note.json を読めませんでした。新しく作ります", "warn"); }
    }
    if (!S.note) S.note = GK.note.empty(S.fs ? S.fs.name : "");
    renderStatus();
  }
  async function saveNote() {
    if (!S.fs || !S.note) return;
    S.note.updated = nowText();
    await S.fs.write(["case", "note.json"], JSON.stringify(S.note, null, 2) + "\n");
    await S.fs.write(["case", "status.md"], GK.note.statusMd(S.note, today()));
    await S.fs.write(["out", "index.md"], GK.note.indexMd(S.note));
    await S.fs.write(["case", "NotebookLM用_案件メモ.md"], GK.gexport.notebookMd(GK.note.notebookMd(S.note), { title: `${S.note.name}：案件メモ`, kind: "案件メモ" }));
  }
  function addLog(o) {
    const e = R.logEntry(o);
    S.log.push(e);
    if (S.note) { S.note.log = [...(S.note.log || []), e].slice(-300); }
    renderLog();
  }

  // ---------- 成果物をファイルにする ----------
  async function makeFiles(kind, src, title) {
    const date = new Date();
    const paths = R.artifactPaths(kind, title, date);
    const files = [];
    const add = (i, data) => files.push({ segs: paths[i], data });
    if (kind === "doc") { add(0, GK.gexport.docx(src, { title })); add(1, src.endsWith("\n") ? src : src + "\n"); }
    else if (kind === "flow" || kind === "arch" || kind === "map") {
      const r = ctx.drawFig(src, kind);
      if (!r.svg || r.errors.length) throw new Error(`図にできません：${(r.errors[0] || {}).message || ""}`);
      add(0, r.svg);
      try { const url = await GK.intakeUI.svgToPng(r.svg, r.w, r.h, 2); const bin = atob(url.split(",")[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); add(1, u8); } catch (e) { /* PNG は作れなくても SVG は残す */ }
    } else if (kind === "wbs") {
      const r = GK.wbs.parse(src);
      if (r.errors.length) throw new Error(`WBS の日程を引けません：${r.errors[0].message}`);
      add(0, GK.gexport.xlsx([GK.wbs.sheet(r)])); add(1, GK.wbs.gantt(r, { title }));
    } else if (kind === "explain") {
      const r = GK.explain.render(src);
      if (r.errors.length) throw new Error(`解説ページにできません：${r.errors[0].message}`);
      add(0, r.html);
    } else if (kind === "slides") {
      const p = GK.slides.parseDeck(src);
      if (p.error) throw new Error(`スライド JSON を読めません：${p.error}`);
      add(0, GK.pptx.build(GK.slides.layoutDeck(p.deck), { title: p.deck.title, author: p.deck.author }));
    } else if (kind === "table") {
      const rows = GK.gexport.parseTable(src).rows;
      if (!rows.length) throw new Error("表が空です");
      add(0, GK.gexport.xlsx([{ name: title || "表", rows }]));
    } else throw new Error(`kind「${kind}」はファイルにできません（${Object.keys(R.KIND_JA).join("・")}）`);
    const written = [];
    for (const f of files) { const p = await uniquePath(f.segs); await S.fs.write(p, f.data); written.push(p.join("/")); }
    S.note = GK.note.addArtifact(S.note, { date: nowText(), file: written[0], kind: R.KIND_JA[kind], stage: S.note.stage || "" });
    for (const w of written.slice(1)) S.note = GK.note.addArtifact(S.note, { date: nowText(), file: w, kind: R.KIND_JA[kind], stage: S.note.stage || "" });
    return written;
  }

  // ---------- Gemini・NotebookLM のタブ ----------
  async function findTab(kind) {
    const tabs = await chrome.tabs.query({});
    const ok = tabs.filter((t) => HOSTS()[kind].some((h) => String(t.url || "").startsWith(h)));
    return ok.find((t) => t.active) || ok[0] || null;
  }
  async function ensureContent(tabId, to) {
    const ping = () => chrome.tabs.sendMessage(tabId, { to, op: "ping" }).then((r) => r && r.ok).catch(() => false);
    if (await ping()) return true;
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ["domtomd.js", to === "gemini" ? "content-gemini.js" : "content-nlm.js"] }); } catch (e) { /* 入れられないページ */ }
    for (let i = 0; i < 10; i++) { if (await ping()) return true; await new Promise((r) => setTimeout(r, 300)); }
    return false;
  }
  async function askTab(tabId, to, text, timeoutMs) {
    if (!(await ensureContent(tabId, to))) throw new Error(`${to === "gemini" ? "Gemini" : "NotebookLM"} の画面とつながりません（タブを再読み込みしてください）`);
    const r = await chrome.tabs.sendMessage(tabId, { to, op: "ask", text, timeoutMs });
    if (!r || !r.ok) throw new Error((r && r.error) || "応答を受け取れませんでした");
    return r.text;
  }
  function waitLoaded(tabId) {
    return new Promise((res) => {
      const done = (id, info) => { if (id === tabId && info.status === "complete") { chrome.tabs.onUpdated.removeListener(done); res(); } };
      chrome.tabs.onUpdated.addListener(done);
      chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") { chrome.tabs.onUpdated.removeListener(done); res(); } }).catch(() => {});
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); res(); }, 30000);
    });
  }

  // ---------- run_js（sandbox ページ） ----------
  let sandbox = null, sandboxReady = null;
  const pending = new Map();
  function runJs(code, input) {
    if (!sandbox) {
      sandbox = el("iframe", { src: "sandbox.html", hidden: true, title: "計算の実行場所" });
      sandboxReady = new Promise((res) => { window.addEventListener("message", function f(e) { if (e.data && e.data.type === "ga-sandbox-ready") { window.removeEventListener("message", f); res(); } }); });
      window.addEventListener("message", (e) => { const d = e.data || {}; if (d.type === "ga-result" && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } });
      document.body.append(sandbox);
    }
    return sandboxReady.then(() => new Promise((res) => {
      const id = Math.random().toString(36).slice(2);
      pending.set(id, res);
      sandbox.contentWindow.postMessage({ type: "ga-run", id, code, input }, "*");
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ ok: false, error: "応答がありません（5 秒）" }); } }, 5000);
    }));
  }

  // ---------- ツールの実行 ----------
  const needFs = () => { if (!S.fs) throw new Error("案件フォルダが選ばれていません。パネルの「案件フォルダを選ぶ」で選んでもらってください（ask_user）"); };
  async function execTool(call) {
    const a = call.args;
    switch (call.tool) {
      case "list_dir": {
        needFs();
        const segs = R.normPath(a.path || "");
        const list = (await S.fs.list(segs)).sort((x, y) => (x.dir === y.dir ? x.name.localeCompare(y.name, "ja") : x.dir ? -1 : 1)).slice(0, 300);
        return { text: list.map((x) => (x.dir ? `${x.name}/` : `${x.name}（${Math.ceil(x.size / 1024)} KB）`)).join("\n") || "（空）", files: list.length };
      }
      case "read_file": {
        needFs();
        const segs = R.normPath(a.path);
        const from = Math.max(0, +a.from || 0);
        const t = await readAsText(segs);
        return { text: t.slice(from), more: { from }, chars: t.length, files: 1 };
      }
      case "search": {
        needFs();
        const qy = String(a.query).toLowerCase();
        const hits = [];
        let files = 0;
        const walk = async (segs) => {
          for (const x of await S.fs.list(segs)) {
            if (hits.length >= 60 || files >= 400) return;
            const p = [...segs, x.name];
            if (x.dir) { if (x.name !== "_控え") await walk(p); continue; }
            if (!R.TEXT.test(x.name) || x.size > 3e6) continue;
            files++;
            decodeText(await S.fs.read(p)).split(/\r?\n/).forEach((line, i) => { if (hits.length < 60 && line.toLowerCase().includes(qy)) hits.push(`${p.join("/")}:${i + 1}: ${line.trim().slice(0, 160)}`); });
          }
        };
        await walk(R.normPath(a.path || ""));
        return { text: hits.length ? hits.join("\n") : `「${a.query}」は見つかりませんでした（${files} ファイルを見ました。xlsx・docx は read_file で読んでください）`, files };
      }
      case "write_file": {
        needFs();
        const segs = R.writablePath(a.path);
        const body = String(a.content);
        if (S.settings.confirmWrite && !(await approve(`${segs.join("/")} に書きます（${body.length} 文字）${(await S.fs.exists(segs)) ? "。今あるファイルは out/_控え/ に残します" : ""}`))) throw new Error("人が書き込みを許可しませんでした");
        await writeSafe(segs, body);
        S.note = GK.note.addArtifact(S.note, { date: nowText(), file: segs.join("/"), kind: "ファイル", stage: S.note.stage || "" });
        return { text: `${segs.join("/")} に書きました`, files: 1, chars: body.length };
      }
      case "render": {
        needFs();
        const w = await makeFiles(String(a.kind), String(a.src), String(a.name || ""));
        return { text: `保存しました：\n${w.join("\n")}`, files: w.length };
      }
      case "run_js": {
        const r = await runJs(String(a.code), a.input);
        if (!r.ok) throw new Error(r.error);
        const t = typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 2);
        return { text: t, chars: t.length };
      }
      case "ask_notebooklm": {
        const tab = await findTab("notebooklm");
        if (!tab) throw new Error("NotebookLM のノートブックを開いたタブがありません。人に開いてもらってください（ask_user）");
        const t = await askTab(tab.id, "notebooklm", String(a.question), 180000);
        return { text: t, chars: t.length };
      }
      case "review": {
        if (!S.settings.reviewerUrl) throw new Error("レビュー Gem の URL が設定されていません。パネルの設定に入れてもらってください（ask_user）");
        const views = (Array.isArray(a.viewpoints) ? a.viewpoints : String(a.viewpoints).split(/[,、]/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
        const text = String(a.text || S.lastArtifact || "");
        if (!text) throw new Error("点検する成果物がありません（text に入れるか、先に成果物を出してください）");
        const results = await Promise.all(views.map(async (v) => {
          const tab = await chrome.tabs.create({ url: S.settings.reviewerUrl, active: false });
          try {
            await waitLoaded(tab.id);
            await new Promise((r) => setTimeout(r, 1500));
            const out = await askTab(tab.id, "gemini", `観点：${v}\n\n次の成果物を、この観点だけで点検してください。\n\n${text}`, 240000);
            return `### 観点：${v}\n${out}`;
          } finally { chrome.tabs.remove(tab.id).catch(() => {}); }
        }));
        return { text: results.join("\n\n"), files: views.length };
      }
      default: throw new Error(`道具「${call.tool}」は実行できません`);
    }
  }

  // ---------- 応答を読んで、管理を自動で行う ----------
  async function absorb(text) {
    const reply = R.readReply(text);
    if (reply.header) S.note = GK.note.setHeader(S.note, reply.header);
    const memo = reply.blocks.filter((b) => b.kind === "memo");
    let m = { added: 0, updated: 0, answered: 0 };
    for (const b of memo) { const r = GK.note.merge(S.note, GK.note.parseMemo(b.text), nowText()); S.note = r.note; m = { added: m.added + r.added, updated: m.updated + r.updated, answered: m.answered + r.answered }; }
    const arts = reply.blocks.filter((b) => R.KIND_JA[b.kind]);
    if (arts.length) S.lastArtifact = arts.map((b) => b.text).join("\n\n");
    const saved = [];
    if (S.fs && S.settings.autoSave) for (const b of arts) { try { saved.push(...(await makeFiles(b.kind, b.text, b.kind === "wbs" || b.kind === "table" ? "" : b.title))); } catch (e) { say(`成果物（${R.KIND_JA[b.kind]}）を保存できませんでした：${e.message}`, "warn"); } }
    await saveNote();
    renderStatus();
    return { reply, memo: m, saved };
  }

  // ---------- 人の判断（ゲート）と承認 ----------
  function gate(reason, reply) {
    return new Promise((resolve) => {
      // 外から（止めるボタン・テスト）答えるときも、待ちを片付けてから返す
      S.gate = (t) => { S.gate = null; clear(UI.gate); resolve(t == null ? null : String(t)); };
      const ta = el("textarea", { rows: 4, placeholder: "Gemini への返事（承認・選んだ答え・直してほしい点など）", "aria-label": "返事" });
      const send = (t) => { if (!t.trim()) { ctx.toast("返事を入れてください", "err"); return; } S.gate = null; clear(UI.gate); resolve(t); };
      clear(UI.gate).append(el("div", { class: "ag-gate" },
        el("p", { class: "ag-gate-h", text: "人の判断を待っています" }),
        el("p", { text: reason || "Gemini の応答を読んで、返事をしてください" }),
        reply ? el("details", {}, el("summary", { text: "Gemini の応答を見る" }), el("div", { class: "ik-md" }, GK.md.render(reply))) : null,
        ta,
        el("div", { class: "actions" },
          el("button", { type: "button", class: "primary", text: "返事を送って続ける", onclick: () => send(ta.value) }),
          el("button", { type: "button", text: "「承認」と送る", onclick: () => send("承認します。進めてください。") }),
          el("button", { type: "button", text: "「全部仮置きで進めて」と送る", onclick: () => send("全部仮置きで進めてください。") }),
          el("button", { type: "button", class: "danger", text: "ここで止める", onclick: () => { S.gate = null; clear(UI.gate); resolve(null); } }))));
      UI.gate.scrollIntoView({ block: "nearest" });
      ta.focus();
    });
  }
  function approve(what) {
    return new Promise((resolve) => {
      const done = (v) => { S.gate = null; clear(UI.gate); resolve(v); };
      clear(UI.gate).append(el("div", { class: "ag-gate ag-approve" },
        el("p", { class: "ag-gate-h", text: "書き込みの許可" }),
        el("p", { text: what }),
        el("div", { class: "actions" },
          el("button", { type: "button", class: "primary", text: "許可する", onclick: () => done(true) }),
          el("button", { type: "button", text: "許可しない", onclick: () => done(false) }))));
      S.gate = () => done(false); // 止めるボタンは「許可しない」と同じ
    });
  }

  // ---------- 進める（ループ） ----------
  async function run(first) {
    if (S.running) return;
    const tab = await findTab("gemini");
    if (!tab) { say("Gemini のタブがありません。司令塔 Gem を開いてから押してください", "err"); return; }
    if (!(await ensureContent(tab.id, "gemini"))) { say("Gemini の画面とつながりません。タブを再読み込みしてください", "err"); return; }
    S.running = true; S.stop = false;
    renderRun();
    const g = R.guard(S.settings.maxSteps);
    let msg = (S.firstSent ? "" : R.protocol({ maxSteps: g.max, folder: S.fs ? S.fs.name : "" }) + "\n") + first;
    S.firstSent = true;
    try {
      for (;;) {
        if (S.stop) { say("止めました", "warn"); break; }
        if (!g.step()) { say(`${g.max} 手に達したので止めました。続けるときは、もう一度依頼を送ってください`, "warn"); break; }
        addLog({ step: g.steps, action: "送信", chars: msg.length });
        setBusy(`Gemini の応答を待っています（${g.steps} 手目）`);
        const text = await askTab(tab.id, "gemini", msg, 300000);
        const got = await absorb(text);
        addLog({ step: g.steps, action: "受信", chars: text.length, files: got.saved.length || undefined, note: [got.reply.header ? `段階 ${got.reply.header.stage}` : "", got.memo.added ? `メモ +${got.memo.added}` : "", got.saved.length ? `保存 ${got.saved.length}` : ""].filter(Boolean).join("・") || undefined });
        if (S.stop) { say("止めました", "warn"); break; }
        const d = R.decide(got.reply);
        if (d.type === "done") { say(`終わりました：${d.summary}`, "ok"); break; }
        if (d.type === "fix") {
          if (!g.fail("書式")) { say("ツール呼び出しの書き方の間違いが 3 回続いたので止めました", "err"); break; }
          msg = `【gemini-agent】${d.message}`;
          continue;
        }
        if (d.type === "gate") {
          setBusy("");
          const ans = await gate(d.reason, text);
          if (ans == null) { say("止めました", "warn"); break; }
          addLog({ step: g.steps, action: "人の返事", chars: ans.length });
          msg = ans;
          continue;
        }
        // ツール
        setBusy(`道具「${d.call.tool}」を実行しています`);
        try {
          const r = await execTool(d.call);
          g.ok();
          addLog({ step: g.steps, action: "道具", tool: d.call.tool, ok: true, files: r.files, chars: r.chars });
          msg = R.resultMessage(d.call.tool, true, r.text, r.more);
        } catch (e) {
          addLog({ step: g.steps, action: "道具", tool: d.call.tool, ok: false });
          if (!g.fail(d.call.tool)) { say(`道具「${d.call.tool}」が 3 回続けて失敗したので止めました：${e.message}`, "err"); break; }
          msg = R.resultMessage(d.call.tool, false, e.message);
        }
        await saveNote();
      }
    } catch (e) {
      say("止まりました：" + e.message, "err");
    } finally {
      S.running = false; S.stop = false;
      setBusy("");
      await saveNote().catch(() => {});
      renderRun();
      renderStatus();
    }
  }

  // ---------- 画面 ----------
  function say(text, kind) {
    if (!UI.msg) return;
    UI.msg.textContent = text;
    UI.msg.className = `status ${kind || ""}`;
    if (kind === "err") ctx.toast(text, "err");
  }
  function setBusy(t) { if (UI.busy) { UI.busy.textContent = t; UI.busy.hidden = !t; } }
  function renderRun() {
    if (!UI.go) return;
    UI.go.disabled = S.running;
    UI.stopBtn.disabled = !S.running;
  }
  function renderLog() {
    if (!UI.log) return;
    clear(UI.log);
    for (const e of S.log.slice(-40).reverse()) UI.log.append(el("li", { class: e.ok === false ? "err" : "", text: `${e.time.slice(11, 16)}　${e.step ? `${e.step} 手目　` : ""}${e.action}${e.tool ? `：${e.tool}` : ""}${e.ok === false ? "（失敗）" : ""}${e.files ? `　${e.files} 件` : ""}${e.chars ? `　${e.chars} 字` : ""}${e.note ? `　${e.note}` : ""}` }));
  }
  function renderStatus() {
    if (!UI.status) return;
    const n = S.note;
    clear(UI.status);
    if (!n) { UI.status.append(el("p", { class: "muted small", text: "案件フォルダを選ぶと、ここに今の段階・次の一手・未回答の質問が出ます" })); return; }
    const open = n.questions.filter((q) => q.status !== "回答済");
    const t = today();
    UI.status.append(
      el("div", { class: "ik-stage" }, el("b", { text: n.name || "案件" }), n.stage ? el("span", { class: "ik-type", text: n.type || "" }) : null, el("span", { class: "muted small", text: n.updated ? `更新 ${n.updated}` : "" })),
      el("ol", { class: "ik-bar", "aria-label": "段階" }, GK.note.STAGES.map((s, i) => el("li", { class: n.stage && i + 1 < n.stage ? "done" : i + 1 === n.stage ? "now" : "", text: `${i + 1} ${s}` }))),
      el("p", { class: "ik-next" }, el("b", { text: "次に人がすること：" }), n.next || "（まだありません）"),
      el("div", { class: "ag-cols" },
        el("div", {}, el("h4", { text: `未回答の質問 ${open.length}` }), el("ul", { class: "ag-list" }, open.slice(0, 6).map((q) => el("li", { class: q.due && q.due < t ? "err" : "", text: `${q.id} ${q.text}${q.due ? `（${q.due}${q.due < t ? "・期限切れ" : ""}）` : ""}` })))),
        el("div", {}, el("h4", { text: `決まったこと ${n.decisions.length}` }), el("ul", { class: "ag-list" }, n.decisions.slice(-4).reverse().map((d) => el("li", { text: `${d.id} ${d.text}` })))),
        el("div", {}, el("h4", { text: `成果物 ${n.artifacts.length}` }), el("ul", { class: "ag-list" }, n.artifacts.slice(-5).reverse().map((a) => el("li", { text: `${a.file.replace(/^out\//, "")}` }))))));
  }
  function renderFolder() {
    if (!UI.folder) return;
    clear(UI.folder);
    UI.folder.append(el("span", { class: "small", text: S.fs ? `案件フォルダ：${S.fs.name}` : "案件フォルダ：未選択" }));
  }

  async function pickFolder() {
    try {
      const h = await window.showDirectoryPicker({ mode: "readwrite" });
      await idb("set", h);
      S.fs = dirFs(h);
      S.firstSent = false;
      renderFolder();
      await loadNote();
      say(`案件フォルダ「${h.name}」を選びました`, "ok");
    } catch (e) { if (e.name !== "AbortError") say("フォルダを選べませんでした：" + e.message, "err"); }
  }
  async function restoreFolder(ask) {
    let h = null;
    try { h = await idb("get"); } catch (e) { h = null; }
    if (!h) return;
    let perm = await h.queryPermission({ mode: "readwrite" });
    if (perm !== "granted" && ask) perm = await h.requestPermission({ mode: "readwrite" });
    if (perm === "granted") { S.fs = dirFs(h); renderFolder(); await loadNote(); UI.restore.hidden = true; }
    else { UI.restore.hidden = false; UI.restore.textContent = `「${h.name}」の許可を戻す`; }
  }

  async function selftest() {
    const out = [];
    for (const [kind, to] of [["gemini", "gemini"], ["notebooklm", "notebooklm"]]) {
      const tab = await findTab(kind);
      if (!tab) { out.push(`${kind === "gemini" ? "Gemini" : "NotebookLM"}：タブがありません`); continue; }
      if (!(await ensureContent(tab.id, to))) { out.push(`${tab.title}：つながりません（再読み込みしてください）`); continue; }
      const r = await chrome.tabs.sendMessage(tab.id, { to, op: "selftest" });
      out.push(`${kind === "gemini" ? "Gemini" : "NotebookLM"}：${r.ok ? "OK" : "入力欄が見つかりません（設定のセレクタを確かめてください）"}（応答 ${r.responses} 件）`);
    }
    say(out.join("　／　"), out.every((x) => /OK/.test(x)) ? "ok" : "warn");
  }

  function settingsPanel() {
    const s = S.settings;
    const inp = (k, label, type) => { const i = el("input", { type: type || "text", value: s[k] ?? "", "aria-label": label }); if (type === "checkbox") i.checked = !!s[k]; i.addEventListener("change", async () => { s[k] = type === "checkbox" ? i.checked : type === "number" ? Math.max(1, Math.min(60, +i.value || 20)) : i.value.trim(); await store.set("settings", s); }); return el("label", { class: "ag-set" }, el("span", { text: label }), i); };
    const selTa = el("textarea", { rows: 6, class: "mono", spellcheck: "false", "aria-label": "セレクタ" });
    store.get("selectors").then((v) => { selTa.value = JSON.stringify(v || { gemini: {}, notebooklm: {} }, null, 2); });
    return el("details", { class: "ag-settings" }, el("summary", { text: "設定" }),
      inp("conductorUrl", "司令塔 Gem の URL（https://gemini.google.com/gem/…）"),
      inp("reviewerUrl", "レビュー Gem の URL（review で使う）"),
      inp("maxSteps", "1 回の依頼で進める手数の上限", "number"),
      inp("autoSave", "成果物を out/ に自動で保存する", "checkbox"),
      inp("confirmWrite", "write_file の前に毎回許可を取る", "checkbox"),
      el("p", { class: "small muted", text: "画面の作りが変わって動かなくなったら、セレクタを上書きします（例：{\"gemini\": {\"input\": \"…\"}}）。空の {} なら既定値を使います" }),
      selTa,
      el("div", { class: "actions" }, el("button", { type: "button", text: "セレクタを保存", onclick: async () => { try { await store.set("selectors", JSON.parse(selTa.value || "{}")); ctx.toast("保存しました。Gemini のタブを再読み込みしてください"); } catch (e) { ctx.toast("JSON として読めません：" + e.message, "err"); } } })));
  }

  function build(root) {
    UI.status = el("div", { class: "ik-head ag-status" });
    UI.folder = el("div", { class: "ag-folder" });
    UI.restore = el("button", { type: "button", hidden: true, onclick: () => restoreFolder(true) });
    UI.msg = el("div", { class: "status", role: "status" });
    UI.busy = el("p", { class: "ag-busy", hidden: true, role: "status" });
    UI.gate = el("div");
    UI.log = el("ul", { class: "msgs ag-log" });
    const req = el("textarea", { rows: 5, placeholder: "やりたいこと（例：添付の議事録から論点マップと WBS を作りたい。資料は 資料/ フォルダ）", "aria-label": "依頼" });
    UI.go = el("button", { type: "button", class: "primary", text: "送って進める", onclick: () => { if (!req.value.trim()) { ctx.toast("依頼を入れてください", "err"); return; } const t = req.value; req.value = ""; run(t); } });
    UI.stopBtn = el("button", { type: "button", class: "danger", text: "止める", disabled: true, onclick: () => { S.stop = true; if (S.gate) S.gate(null); say("止めています…", "warn"); } });
    root.append(
      el("h2", { text: "エージェント" }),
      el("p", { class: "muted small", text: "Gemini のタブ（司令塔 Gem）に依頼を送り、応答に書かれた道具（ファイルを読む・保存する・計算・NotebookLM・レビュー）をこのパネルが実行して返します。人の判断が要るところで止まります。" }),
      UI.status,
      el("div", { class: "actions" }, UI.folder, el("button", { type: "button", text: "案件フォルダを選ぶ", onclick: pickFolder }), UI.restore,
        el("button", { type: "button", text: "司令塔 Gem を開く", onclick: async () => { if (!S.settings.conductorUrl) { ctx.toast("設定に司令塔 Gem の URL を入れてください", "err"); return; } await chrome.tabs.create({ url: S.settings.conductorUrl }); S.firstSent = false; } }),
        el("button", { type: "button", text: "つながりを確かめる", onclick: selftest })),
      req,
      el("div", { class: "actions" }, UI.go, UI.stopBtn, el("button", { type: "button", text: "最新の応答を取り込みタブへ", onclick: async () => { const tab = await findTab("gemini"); if (!tab || !(await ensureContent(tab.id, "gemini"))) { say("Gemini のタブとつながりません", "err"); return; } const r = await chrome.tabs.sendMessage(tab.id, { to: "gemini", op: "last" }); ctx.openIntake(r.text || ""); } })),
      UI.busy, UI.msg, UI.gate,
      el("details", { open: true }, el("summary", { text: "実行ログ（本文は残しません）" }), UI.log),
      settingsPanel());
    renderFolder(); renderStatus(); renderRun();
  }

  async function init(c) {
    ctx = c;
    const root = document.getElementById("agent-root");
    if (!EXT && !GK.EXT_TEST) {
      // ふつうの HTML として開いたときは、エージェントのタブを出さない
      document.querySelectorAll("[data-ext-only]").forEach((n) => n.remove());
      return;
    }
    S.settings = Object.assign(S.settings, (await store.get("settings")) || {});
    if (root && !root.firstChild) build(root);
    if (EXT) await restoreFolder(false);
  }

  GK.runnerUI = { init, EXT };
  // テスト用（拡張の試験版だけ）：メモリ上のフォルダに差し替えて、ループを動かす
  if (GK.EXT_TEST) GK.runnerUI.test = { memFs, useFs: async (fs) => { S.fs = fs; renderFolder(); await loadNote(); }, run, state: S, absorb, execTool, answerGate: (t) => S.gate && S.gate(t) };
})(globalThis.GK = globalThis.GK || {});
