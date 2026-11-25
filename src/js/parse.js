// NotebookLM の出力（ブロック形式）を読む。DOM を使わない（テストで読む）。
//   ## Q-012            ← 新しい質問は「## 新規」
//   案件: ○○
//   分類: データ設計
//   状態: 要確認
//   根拠: ○○.pdf
//   要確認の理由: ...
//   日付: 2026-11-20
//   ### 質問
//   ...
//   ### 回答
//   （Markdown。表は最後に「状態」列）
(function (GK) {
  "use strict";

  const STATES = ["確定", "未確定", "提案", "対応中", "要確認"];
  const FALLBACK = "要確認";
  // メタ行の見出し → 項目名。表記ゆれも受ける
  const META = {
    "案件": "project", "案件名": "project",
    "分類": "category", "カテゴリ": "category",
    "状態": "status", "ステータス": "status",
    "根拠": "source", "根拠ソース": "source", "ソース": "source", "出典": "source",
    "要確認の理由": "reason", "理由": "reason",
    "日付": "date",
  };
  const META_RE = /^\s*([^:：\s][^:：]{0,9}?)\s*[:：]\s*(.*)$/;
  const SECTION_RE = /^\s*###\s*(質問|回答)\s*$/;
  const HEAD_RE = /^\s*##\s+(.*?)\s*$/;

  // ```markdown の囲みを外す。囲みが複数あれば中身をつなぐ（囲みの外の前置き・後書きは捨てる）。
  // 囲みの中に ```sql などのコードがあっても、言語つきで開いたものは中の囲みとして数える。囲みが無ければ全文
  function unwrap(text) {
    const t = String(text == null ? "" : text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (!/^\s*##\s/m.test(t)) return t;
    const out = [];
    let outer = null, inner = 0, found = false;
    for (const line of t.split("\n")) {
      const m = line.match(/^\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/);
      if (!outer) {
        if (m && (m[2] === "" || /^(markdown|md)$/i.test(m[2]))) { outer = m[1]; inner = 0; found = true; continue; }
        if (!found) out.push(line);
        continue;
      }
      if (m && m[1][0] === outer[0]) {
        if (m[2]) inner++;
        else if (inner > 0) inner--;
        else if (m[1].length >= outer.length) { outer = null; continue; }
      }
      out.push(line);
    }
    if (!found) return t;
    return out.join("\n");
  }

  function normState(s) {
    const v = String(s == null ? "" : s).replace(/[\s*`【】\[\]]/g, "");
    if (STATES.includes(v)) return { state: v, ok: true };
    const hit = STATES.find((x) => v.includes(x) && !(x === "確定" && v.includes("未確定")));
    if (hit) return { state: hit, ok: true };
    return { state: FALLBACK, ok: false, raw: String(s == null ? "" : s).trim() };
  }

  // ID：Q-12 / Q12 / q-012 → Q-012。「新規」や空は null
  function normId(s) {
    const m = String(s || "").match(/^\s*[QＱq]\s*[-－ー]?\s*(\d{1,5})\b/);
    return m ? "Q-" + String(+m[1]).padStart(3, "0") : null;
  }

  const isMeta = (line) => {
    const m = line.match(META_RE);
    return !!(m && META[m[1].trim()]);
  };

  // ブロックに分ける。始まりは「## 」の行のうち、次の空でない行がメタ行か ### 質問 のもの
  function splitBlocks(text) {
    const lines = unwrap(text).split("\n");
    const starts = [];
    for (let i = 0; i < lines.length; i++) {
      if (!HEAD_RE.test(lines[i]) || /^\s*###/.test(lines[i])) continue;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && (isMeta(lines[j]) || SECTION_RE.test(lines[j]))) starts.push(i);
    }
    const blocks = [];
    starts.forEach((s, n) => {
      const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
      blocks.push({ line: s + 1, lines: lines.slice(s, end) });
    });
    return blocks;
  }

  // 1 ブロックを読む。戻り値 { ok, id, isNew, fields, question, answer, tables, warnings, error }
  function readBlock(b) {
    const head = b.lines[0].match(HEAD_RE)[1];
    const id = normId(head);
    const fields = {};
    const warnings = [];
    let section = null;
    const buf = { 質問: [], 回答: [] };
    for (const line of b.lines.slice(1)) {
      const sm = line.match(SECTION_RE);
      if (sm) { section = sm[1]; continue; }
      if (section) { buf[section].push(line); continue; }
      const m = line.match(META_RE);
      if (m && META[m[1].trim()]) fields[META[m[1].trim()]] = m[2].trim();
    }
    const trim = (arr) => arr.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
    const question = trim(buf.質問), answer = trim(buf.回答);
    const label = id || head || `${b.line} 行目`;
    if (!question || !answer) {
      return { ok: false, line: b.line, label, error: !question && !answer ? "「### 質問」と「### 回答」がありません" : !question ? "「### 質問」がありません" : "「### 回答」がありません" };
    }
    const st = normState(fields.status);
    if (!st.ok) warnings.push(fields.status ? `状態「${st.raw}」は 決まった語（${STATES.join(" / ")}）のどれでもないので「${FALLBACK}」にしました` : `状態が無いので「${FALLBACK}」にしました`);
    fields.status = st.state;
    const tables = readTables(answer, warnings);
    return { ok: true, line: b.line, label, id, isNew: !id, fields, question, answer, tables, warnings };
  }

  const keyOf = (s) => String(s || "").replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim();
  // 質問の照合キー。全角半角・大小・空白・句読点・括弧の違いは同じとみなす（似ているだけの文は別物）
  const qkey = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\*\*|`/g, "").replace(/[\s?？。、．.,，!！「」『』()（）\[\]【】:：;；・"'”“’‘]/g, "");

  // 回答の中の表を出現順に。状態の列があれば行の状態として持つ
  function readTables(answer, warnings) {
    const tables = [];
    for (const blk of GK.md.parse(answer)) {
      if (blk.type !== "table") continue;
      const n = tables.length + 1;
      const head = blk.head.map((h) => keyOf(h));
      const stateCol = head.findIndex((h) => h === "状態" || h === "ステータス");
      if (stateCol < 0) warnings.push(`表${n} に「状態」の列がありません（行ごとの状態は持ちません）`);
      let bad = 0;
      const seen = new Map();
      const rows = blk.rows.map((r) => {
        const cells = head.map((_, c) => r[c] == null ? "" : r[c]);
        let key = keyOf(cells[0]) || "(空)";
        const k = (seen.get(key) || 0) + 1;
        seen.set(key, k);
        if (k > 1) key += "#" + k;
        const row = { key, cells, state: "", edited: false };
        if (stateCol >= 0) {
          const st = normState(cells[stateCol]);
          if (!st.ok) bad++;
          row.state = st.state;
          cells[stateCol] = st.state;
        }
        return row;
      });
      if (bad) warnings.push(`表${n} の ${bad} 行は状態が 決まった語（${STATES.join(" / ")}）のどれでもないので「${FALLBACK}」にしました`);
      tables.push({ head, stateCol, rows });
    }
    return tables;
  }

  // 貼った文全体を読む
  function read(text) {
    const blocks = splitBlocks(text).map(readBlock);
    return { ok: blocks.filter((b) => b.ok), bad: blocks.filter((b) => !b.ok) };
  }

  GK.parse = { STATES, FALLBACK, META, unwrap, normState, normId, splitBlocks, readBlock, readTables, read, keyOf, qkey };
})(globalThis.GK = globalThis.GK || {});
