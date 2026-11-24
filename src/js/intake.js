// 一括取り込みの解析。Gem の応答を丸ごと受け取り、コードブロックを種類ごとに分ける（DOM を使わない）。
// 種類は言語名で決め、言語名が無いときは中身から推定する。外側が ````markdown の囲みなら、中の ```flow ごと 1 つの文書にする。
(function (GK) {
  "use strict";

  // 種類と、画面に出す名前
  const KINDS = {
    karte: "案件カルテ",
    flow: "フロー図",
    slides: "スライド",
    doc: "文書",
    table: "表",
    wbs: "WBS",
    arch: "構成図",
    map: "論点マップ",
    explain: "解説ページ",
    memo: "案件メモ",
    tool: "ツール呼び出し",
    code: "コード",
  };
  // 言語名 → 種類
  const LANG = {
    karte: "karte", "karte-update": "karte",
    flow: "flow",
    slides: "slides", deck: "slides",
    doc: "doc", markdown: "doc", md: "doc",
    table: "table", tsv: "table", csv: "table",
    wbs: "wbs", arch: "arch", map: "map", explain: "explain",
    memo: "memo",
    tool: "tool",
  };
  const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*$/;

  // 【段階 3/7｜資料｜仕様を読んで承認してください】
  const HEAD_RE = /【\s*段階\s*(\d+)\s*(?:\/\s*(\d+))?\s*[｜|]\s*([^｜|】]+?)\s*[｜|]\s*([^】]+?)\s*】/;
  function header(text) {
    const m = String(text || "").match(HEAD_RE);
    return m ? { stage: +m[1], total: m[2] ? +m[2] : null, type: m[3].trim(), next: m[4].trim() } : null;
  }

  const isMdTable = (t) => {
    const lines = String(t).trim().split("\n").filter((l) => l.trim());
    return lines.length >= 2 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l)) && /^\s*\|?\s*:?-{2,}/.test(lines[1]);
  };
  const isTsv = (t) => {
    const lines = String(t).trim().split("\n").filter((l) => l.trim());
    if (lines.length < 2) return false;
    const n = lines[0].split("\t").length;
    return n >= 2 && lines.every((l) => l.split("\t").length === n);
  };
  function jsonOf(t) {
    const s = String(t).trim();
    if (!/^[{[]/.test(s)) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  // フロー記法として読めて、ノード 2 つ以上・矢印 1 本以上あるもの（gemini-kit の docview と同じ基準）
  function looksLikeFlow(text) {
    if (!GK.flow) return false;
    const g = GK.flow.parse(text);
    return !g.errors.length && g.nodes.length >= 2 && g.edges.length >= 1;
  }

  // 言語名が無い・json・text のときに中身から決める
  // 表のうち、WBS の見出し（ID・作業・工数）を持つものは WBS にする
  const tableOrWbs = (t) => {
    const first = String(t).trim().split("\n")[0] || "";
    const head = first.includes("\t") ? first.split("\t") : first.replace(/^\s*\||\|\s*$/g, "").split("|");
    return GK.wbs && GK.wbs.isWbsHeader(head.map((c) => c.trim())) ? "wbs" : "table";
  };
  function guess(lang, text) {
    const l = String(lang || "").toLowerCase();
    if (LANG[l] === "table" || LANG[l] === "wbs") return tableOrWbs(text);
    if (LANG[l]) return LANG[l];
    const t = String(text || "");
    if ((l === "" || l === "text") && /^\s*layer\s+\S/m.test(t) && /^\s*node\s+\S+\s+@/m.test(t)) return "arch";
    if (/"(schema|patch)"\s*:\s*"anken\.v\d"/.test(t)) return "karte";
    if (l === "json" || l === "") {
      const j = jsonOf(t);
      if (j && !Array.isArray(j) && Array.isArray(j.slides)) return "slides";
      if (j && !Array.isArray(j) && j.tool && typeof j.tool === "string") return "tool";
      if (j && !Array.isArray(j) && Array.isArray(j.sections) && j.title) return "explain";
    }
    if ((l === "" || l === "text") && looksLikeFlow(t)) return "flow";
    if (isMdTable(t) || ((l === "" || l === "text") && isTsv(t))) return tableOrWbs(t);
    return "code";
  }

  // 応答 → { header, blocks: [{ kind, lang, text, line, title }], prose }
  // prose はコードブロックの外の文（説明文）。ブロックが無く見出しのある文なら、それ自体を文書として扱う
  function parse(src) {
    const text = String(src == null ? "" : src).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    const blocks = [];
    const prose = [];
    let open = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!open) {
        const m = line.match(FENCE);
        if (m) { open = { mark: m[1], lang: m[2].toLowerCase(), start: i, body: [] }; continue; }
        prose.push(line);
        continue;
      }
      // 閉じ：同じ文字で、開きと同じ長さ以上、言語名なし
      const c = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (c && c[1][0] === open.mark[0] && c[1].length >= open.mark.length) {
        // 外側が 3 つの囲み（```markdown）で、中に ```flow などがあるときは、中の閉じを外側の閉じと取り違えないようにする
        if (open.mark.length === 3 && (open.lang === "markdown" || open.lang === "md") && open.nested) { open.nested = false; open.body.push(line); continue; }
        push(open);
        open = null;
        continue;
      }
      if ((open.lang === "markdown" || open.lang === "md") && open.mark.length === 3 && /^[ \t]*```[ \t]*[\w-]+/.test(line)) open.nested = true;
      open.body.push(line);
    }
    // 閉じていないブロック（応答が途中で切れた）も拾う。truncated で知らせる
    if (open) push(open, true);

    function push(o, truncated) {
      const body = o.body.join("\n");
      const kind = guess(o.lang, body);
      const b = { kind, lang: o.lang, text: body, line: o.start + 1, title: titleOf(kind, body) };
      if (truncated) b.truncated = true;
      blocks.push(b);
    }

    const rest = prose.join("\n").trim();
    if (!blocks.some((b) => b.kind === "doc") && /^#{1,3}\s+\S/m.test(rest) && rest.length > 80) {
      blocks.unshift({ kind: "doc", lang: "", text: stripHeader(rest), line: 1, title: titleOf("doc", rest), fromProse: true });
    }
    return { header: header(text), blocks, prose: rest };
  }

  const stripHeader = (t) => String(t).replace(HEAD_RE, "").replace(/^\s*\n/, "");

  function titleOf(kind, text) {
    const t = String(text || "");
    if (kind === "doc") { const m = t.match(/^#{1,3}\s+(.+)$/m); return m ? m[1].trim() : ""; }
    if (kind === "slides" || kind === "explain") { const j = jsonOf(t); return j && j.title ? String(j.title) : ""; }
    if (kind === "karte") { const m = t.match(/"name"\s*:\s*"([^"]+)"/); return m ? m[1] : /"patch"/.test(t) ? "追加分" : ""; }
    if (kind === "table") { const n = t.trim().split("\n").filter((l) => l.trim()).length; return `${Math.max(0, isMdTable(t) ? n - 2 : n - 1)} 行`; }
    if (kind === "tool") { const j = jsonOf(t); return j && j.tool ? String(j.tool) : ""; }
    if (kind === "flow" || kind === "arch" || kind === "map") { const m = t.match(/^\s*title\s+(.+)$/m); return m ? m[1].trim() : "（題名なし）"; }
    if (kind === "wbs") { const n = t.trim().split("\n").filter((l) => /^\s*\|?\s*[^|\s]+\s*\|/.test(l) && !/^\s*\|?\s*:?-{2,}/.test(l)).length; return `${Math.max(0, n - 1)} 作業`; }
    const first = t.split("\n").find((l) => l.trim());
    return first ? first.trim().slice(0, 40) : "";
  }

  // 種類ごとの件数（画面の見出し用）
  function summary(res) {
    const n = {};
    for (const b of res.blocks) n[b.kind] = (n[b.kind] || 0) + 1;
    return Object.keys(KINDS).filter((k) => n[k]).map((k) => ({ kind: k, label: KINDS[k], count: n[k] }));
  }

  GK.intake = { KINDS, parse, header, guess, summary, isMdTable, isTsv };
})(globalThis.GK = globalThis.GK || {});
