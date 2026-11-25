// 議事録づくりの段取り（DOM を使わない）。文字起こしを clean.js で読み、長ければ時刻の境目で分け、Gemini への依頼文を作る。
// 返ってきた応答から、議事録（文書）・案件メモ（memo）・宿題（table）を取り出し、発言量の表（meetlog.speakerStats）を足す
(function (GK) {
  "use strict";

  const PART_MAX = 30000; // 1 回で送る文字起こしの目安

  // 文字起こし → { lines, format, stats, header（見出しの行）, parts: [{ from, to, text }] }
  function prepare(text, opts) {
    const o = opts || {};
    const src = String(text || "").replace(/\r\n?/g, "\n");
    // gemini-agent の文字起こしの見出し（# … と - 日時 など）は残し、本文だけを clean に通す
    const head = [];
    const body = [];
    for (const l of src.split("\n")) (body.length === 0 && (/^#\s/.test(l) || /^-\s(日時|参加者|取り方)/.test(l) || !l.trim()) ? head : body).push(l);
    const c = GK.clean.clean(body.join("\n"));
    const lines = c.lines.filter((l) => !l.raw);
    const max = o.max || PART_MAX;
    const parts = [];
    let cur = [], size = 0;
    const flush = () => { if (!cur.length) return; parts.push({ from: cur[0].t || "", to: cur[cur.length - 1].t || "", text: cur.map((l) => `${l.t ? `[${l.t}] ` : ""}${l.speaker}：${l.text}`).join("\n") }); cur = []; size = 0; };
    for (const l of lines) {
      const len = l.text.length + l.speaker.length + 14;
      if (size + len > max && cur.length) flush();
      cur.push(l); size += len;
    }
    flush();
    return { lines: c.lines, format: c.format, unparsed: c.stats.unparsed, header: head.join("\n").trim(), parts, stats: GK.meetlog.speakerStats(c.lines) };
  }

  // Gemini に送る文の並び。1 つなら「まとめ」1 通、複数なら「部分」n 通＋「まとめ」1 通（まとめには部分の要点を入れる）
  function requests(prep, meta) {
    const m = meta || {};
    const head = `会議名：${m.title || "会議"}\n${prep.header ? prep.header + "\n" : ""}`;
    if (prep.parts.length <= 1) {
      return [{ kind: "final", text: `【議事録：まとめ】\n${head}\n次の文字起こしから、指示の形で議事録・案件メモ（memo）・宿題（table）を作ってください。\n\n${(prep.parts[0] || { text: "" }).text}` }];
    }
    const n = prep.parts.length;
    return [
      ...prep.parts.map((p, i) => ({ kind: "part", text: `【議事録の部分 ${i + 1}/${n}】（${p.from || "?"}〜${p.to || "?"}）\n${head}\n次の部分から「部分の要点」だけを返してください。議事録はまだ作らないでください。\n\n${p.text}` })),
      { kind: "final", text: `【議事録：まとめ】\n${head}\nこの会話で返した ${n} 個の「部分の要点」をまとめて、指示の形で議事録・案件メモ（memo）・宿題（table）を作ってください。時刻は部分の要点にあるものだけを使ってください。` },
    ];
  }
  // 部分ごとの要点を、まとめの依頼に入れ直す（新しいチャットで送るとき用）
  const withNotes = (finalText, notes) => `${finalText}\n\n${notes.map((t, i) => `### 部分 ${i + 1} の要点\n${t}`).join("\n\n")}`;

  // まとめの応答 → { md（発言量の表を足した議事録）, memo, table, title, missing: [足りないもの] }
  function assemble(reply, prep, meta) {
    const res = GK.intake.parse(reply);
    const doc = res.blocks.find((b) => b.kind === "doc");
    const memo = res.blocks.filter((b) => b.kind === "memo").map((b) => b.text).join("\n");
    const table = res.blocks.find((b) => b.kind === "table" || b.kind === "wbs");
    const missing = [];
    if (!doc) missing.push("議事録（````markdown）");
    if (!memo) missing.push("案件メモ（```memo）");
    if (!table) missing.push("宿題（```table）");
    let md = doc ? doc.text.replace(/\s+$/, "") + "\n" : "";
    if (md && prep && prep.stats.md) md += `\n## 発言の量（gemini-agent が文字起こしから数えた値）\n\n${prep.stats.md}\n`;
    return { md, memo, table: table ? table.text : "", title: (doc && doc.title) || (meta && meta.title) || "議事録", missing };
  }

  GK.minutes = { PART_MAX, prepare, requests, withNotes, assemble };
})(globalThis.GK = globalThis.GK || {});
