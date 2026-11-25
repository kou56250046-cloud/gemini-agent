// 案件の設定（案件フォルダ直下の「案件の設定.md」）。人が書くファイルから、NotebookLM のノートブック・司令塔 Gem・レビュー Gem の URL を読む（DOM を使わない）。
// 形は 1 行 1 項目：「NotebookLM: https://…」。区切りは : でも ： でもよい。行頭の「- 」もよい。知らない行は無視する。
// 拡張の保存領域には入れない（案件を替えれば、送り先も替わる）
(function (GK) {
  "use strict";

  const FILE = "案件の設定.md";
  const KEYS = [
    { key: "notebook", label: "NotebookLM", kind: "notebooklm", names: ["notebooklm", "ノートブック"] },
    { key: "conductor", label: "司令塔 Gem", kind: "gemini", names: ["司令塔gem", "司令塔"] },
    { key: "reviewer", label: "レビュー Gem", kind: "gemini", names: ["レビューgem", "レビュー"] },
    // URL ではない項目：Gemini が書いてよいフォルダ（カンマ区切り。out/ はいつでも書ける）
    { key: "write", label: "書ける場所", kind: null, names: ["書ける場所", "書き込み先"] },
  ];
  const norm = (s) => String(s).replace(/[\s　]+/g, "").toLowerCase();
  const LINE = /^\s*(?:[-*・]\s*)?([^:：\n]+?)\s*[:：]\s*(.*?)\s*$/;
  // 値の飾りを外す：<URL>・`URL`・[名前](URL)
  const clean = (v) => { const s = String(v || "").trim(); const md = s.match(/^\[[^\]]*\]\((.*)\)$/); return (md ? md[1] : s).replace(/^[<`]+|[>`]+$/g, "").trim(); };

  // → { links: {key: url}, lines: {key: 行番号(1 始まり)} }。同じ項目が 2 回あれば後ろを使う
  function parse(text) {
    const links = {}, lines = {};
    String(text ?? "").replace(/\r\n?/g, "\n").split("\n").forEach((raw, i) => {
      const m = raw.match(LINE);
      if (!m) return;
      const k = KEYS.find((x) => x.names.includes(norm(m[1])));
      if (!k) return;
      links[k.key] = clean(m[2]);
      lines[k.key] = i + 1;
    });
    return { links, lines };
  }

  // URL を確かめる。hosts は種類ごとの許すはじまり（runnerui の HOSTS()）。NotebookLM の本物はノートブックの URL に限る
  function valid(kind, url, hosts) {
    const u = String(url || "");
    if (!/^https?:\/\//.test(u) || /\s/.test(u)) return false;
    if (!(hosts[kind] || []).some((h) => u.startsWith(h))) return false;
    // 本物の NotebookLM は notebooklm.google.com と notebook.google.com の 2 つ
    if (kind === "notebooklm" && /^https:\/\/notebook(lm)?\.google\.com\//.test(u) && !/^https:\/\/notebook(lm)?\.google\.com\/notebook\/[^/?#]+/.test(u)) return false;
    return true;
  }
  // → { ok: {key: url}, errors: [{key, line, msg}] }。空欄は「未登録」で、誤りにしない
  function check(parsed, hosts) {
    const ok = {}, errors = [];
    for (const k of KEYS) {
      const u = parsed.links[k.key];
      if (!u) continue;
      if (!k.kind) { ok[k.key] = u; continue; } // 書ける場所の検査は runner.areasOf が行う
      if (valid(k.kind, u, hosts)) ok[k.key] = u;
      else errors.push({ key: k.key, line: parsed.lines[k.key], msg: `${FILE} の ${parsed.lines[k.key]} 行目の URL が ${k.kind === "notebooklm" ? "NotebookLM のノートブック" : "Gemini（gemini.google.com）"}のものではありません` });
    }
    return { ok, errors };
  }

  // 1 項目だけ書き換える。手で書いた行・説明は残す。無ければ末尾に足す
  function update(text, key, url) {
    const k = KEYS.find((x) => x.key === key);
    if (!k) throw new Error("知らない項目です：" + key);
    const src = String(text ?? "").replace(/\r\n?/g, "\n");
    const rows = src.split("\n");
    const at = parse(src).lines[key];
    const line = `${k.label}: ${url || ""}`.trimEnd();
    if (at) {
      const lead = rows[at - 1].match(/^\s*(?:[-*・]\s*)?/)[0];
      rows[at - 1] = lead + line;
      return rows.join("\n");
    }
    const body = src.replace(/\n+$/, "");
    return (body ? body + "\n" : "") + line + "\n";
  }

  const template = () => [
    "# 案件の設定",
    "",
    "gemini-agent（Chrome 拡張）がこのファイルを読みます。URL を書き換えたら、次に送るときに読み直します。",
    "NotebookLM はこの案件のノートブックを開いたときの URL（https://notebooklm.google.com/notebook/… など）、Gem は Gem を開いたときの URL を書きます。",
    "書ける場所は、Gemini にファイルを直させてよいフォルダです（例：資料/仕様, src）。out/ はいつでも書けます。書く前には毎回、差分を見て許可します。",
    "",
    ...KEYS.map((k) => `${k.label}: `.trimEnd()),
    "",
  ].join("\n");

  // そのタブが登録した URL と同じ所か（? と # の後ろは見ない。前方一致）
  const base = (u) => String(u || "").split(/[?#]/)[0].replace(/\/+$/, "");
  const matches = (tabUrl, url) => { const b = base(url); return !!b && (base(tabUrl) === b || String(tabUrl || "").startsWith(b + "/") || base(tabUrl).startsWith(b + "/")); };

  GK.caseconf = { FILE, KEYS, parse, valid, check, update, template, base, matches };
})(globalThis.GK = globalThis.GK || {});
