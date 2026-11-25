// 監査ログ（案件フォルダの case/audit/YYYY-MM.jsonl。1 行 = 1 つの出来事。追記だけ）。DOM を使わない＝テストで読める。
// 本文は入れない。送った文・受け取った文・書いたファイルは sha256 と文字数だけを残し、会話アーカイブと照合できるようにする。
// 1 行ごとに前の行の hash をつなぐ（ハッシュチェーン）。途中の書き換え・削除・入れ替えは verify で見つかる
(function (GK) {
  "use strict";

  // 残してよい項目（これ以外は捨てる。本文が紛れ込まないように）
  const FIELDS = ["time", "run", "seq", "step", "actor", "where", "action", "tool", "target", "result", "stage", "sha256", "chars", "files", "ms", "note"];
  const ACTORS = ["人", "拡張", "Gemini", "NotebookLM", "Meet"];
  const NOTE_MAX = 80; // note は短い補足だけ（件数・理由）。本文を入れない
  const enc = new TextEncoder();

  async function sha256(data) {
    const bytes = typeof data === "string" ? enc.encode(data) : data instanceof Uint8Array ? data : enc.encode(String(data ?? ""));
    const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // 決まった順で並べた JSON（hash の計算に使う）
  const canon = (e) => JSON.stringify(FIELDS.filter((k) => e[k] !== undefined && e[k] !== null && e[k] !== "").map((k) => [k, e[k]]));

  // 出来事を、残してよい項目だけの形にする
  function entry(o) {
    const e = {};
    for (const k of FIELDS) {
      let v = o[k];
      if (v === undefined || v === null || v === "") continue;
      if (k === "note") v = String(v).replace(/\s+/g, " ").slice(0, NOTE_MAX);
      if (k === "target") v = String(v).slice(0, 200);
      if (k === "actor" && !ACTORS.includes(v)) v = "拡張";
      e[k] = v;
    }
    if (!e.time) e.time = new Date().toISOString();
    return e;
  }

  // 前の行の hash（無ければ空）とつないで封をする
  async function seal(prev, ev) {
    const e = Object.assign(entry(ev), { prev: prev || "" });
    e.hash = await sha256((prev || "") + "\n" + canon(e));
    return e;
  }

  // JSONL → 行の配列（読めない行は bad に入れる）
  function parseLines(text) {
    const rows = [], bad = [];
    String(text || "").split(/\r?\n/).forEach((l, i) => {
      if (!l.trim()) return;
      try { rows.push(JSON.parse(l)); } catch (e) { bad.push(i + 1); }
    });
    return { rows, bad };
  }
  const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");

  // 検証：hash の再計算・前の行とのつながり・順番（seq が 1 ずつ増える）
  // from を渡すと途中から確かめる（{ prev }：その前の行の hash）。渡さなければ、全体の始まりから確かめる
  async function verify(input, from) {
    const { rows, bad } = typeof input === "string" ? parseLines(input) : { rows: input, bad: [] };
    const errors = bad.map((n) => ({ line: n, message: "JSON として読めない行です（書き換えられた可能性）" }));
    // 全体の始まりの行は「前の行が無い（prev が空）・seq が 1」でなければならない（先頭の数行や古い月のファイルを消すと分かるように）
    if (rows.length && !from && ((rows[0].prev || "") !== "" || (typeof rows[0].seq === "number" && rows[0].seq !== 1))) errors.push({ line: 1, message: `始まりの行がありません（最初の行の seq が ${rows[0].seq}。先頭の行か、前の月のファイルが消えている可能性）` });
    let prev = from ? from.prev || "" : rows.length ? rows[0].prev || "" : "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const no = i + 1;
      if ((r.prev || "") !== prev) errors.push({ line: no, message: `前の行とのつながりが切れています（行の削除・入れ替え・挿入の可能性）` });
      const h = await sha256((r.prev || "") + "\n" + canon(r));
      if (h !== r.hash) errors.push({ line: no, message: "内容と hash が合いません（この行が書き換えられた可能性）" });
      if (i > 0 && typeof r.seq === "number" && typeof rows[i - 1].seq === "number" && r.seq !== rows[i - 1].seq + 1) errors.push({ line: no, message: `順番が飛んでいます（${rows[i - 1].seq} の次が ${r.seq}）` });
      prev = r.hash;
    }
    return { ok: !errors.length, count: rows.length, errors, last: prev };
  }

  // 進み具合：段階ごとの最初の到達と最後、依頼ごとの始まり・終わり・手数・結果
  function progress(rows) {
    const stages = new Map();
    const runs = new Map();
    for (const r of rows) {
      if (r.stage != null && r.stage !== "") {
        const k = Number(r.stage);
        const s = stages.get(k) || { stage: k, first: r.time, last: r.time, events: 0 };
        s.last = r.time; s.events++;
        stages.set(k, s);
      }
      if (r.run) {
        const u = runs.get(r.run) || { run: r.run, start: r.time, end: r.time, steps: 0, tools: 0, fails: 0, result: "" };
        u.end = r.time;
        if (r.step) u.steps = Math.max(u.steps, r.step);
        if (r.action === "道具") { u.tools++; if (r.result === "失敗") u.fails++; }
        if (r.action === "終了") u.result = r.result || r.note || "";
        runs.set(r.run, u);
      }
    }
    const list = [...stages.values()].sort((a, b) => a.stage - b.stage);
    list.forEach((s, i) => { const next = list[i + 1]; s.minutes = next ? Math.round((Date.parse(next.first) - Date.parse(s.first)) / 60000) : null; });
    return { stages: list, runs: [...runs.values()] };
  }

  const CSV_HEAD = ["time", "run", "seq", "step", "actor", "where", "action", "tool", "target", "result", "stage", "chars", "files", "ms", "note", "sha256", "hash"];
  function toCsv(rows) {
    const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return "\uFEFF" + [CSV_HEAD.join(","), ...rows.map((r) => CSV_HEAD.map((k) => q(r[k])).join(","))].join("\r\n") + "\r\n";
  }

  const fileOf = (d) => { const t = d || new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}.jsonl`; };
  const runId = () => { const t = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}-${Math.random().toString(36).slice(2, 5)}`; };

  GK.audit = { FIELDS, ACTORS, sha256, entry, seal, parseLines, toJsonl, verify, progress, toCsv, fileOf, runId, canon };
})(globalThis.GK = globalThis.GK || {});
