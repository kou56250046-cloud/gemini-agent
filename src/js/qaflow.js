// 質問箱の自動化の段取り（DOM を使わない）。qa-box の部品（GK.parse・GK.model）はそのまま使い、送る文と振り分けだけをここで決める。
//   questions(text)            1 行 1 問（空行で区切れば複数行の質問）
//   compose(qs, opts)          NotebookLM に送る文。1 通 INPUT_MAX 字以内に、質問の切れ目で分ける
//   triage(db, text)           回答を plan して、自動で入れるもの（new）と、確かめるもの（update）と、知らせるだけ（same・dup）に分ける
//   applyNew(db, triaged)      new だけを入れる
//   applyChosen(db, triaged, choices)  update を「反映」「新規」「見送り」で入れる
//   toMemo(db, ids, note)      確定 → F、要確認・未確定・提案・対応中 → Q の memo の文（案件メモに入っていれば足さない）
(function (GK) {
  "use strict";

  const M = () => GK.model;
  const tagOf = (id) => `（質問箱 ${id}）`;

  function questions(text) {
    const t = String(text || "").replace(/\r\n?/g, "\n").trim();
    if (!t) return [];
    // 空行があれば空行で区切る（複数行の質問）。無ければ 1 行 1 問
    const chunks = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split("\n");
    return chunks.map((s) => s.trim().replace(/^[-*・]\s*|^\d+[.)．]\s*/, "")).filter(Boolean);
  }

  function compose(qs, opts) {
    const o = opts || {};
    const max = o.max || M().INPUT_MAX;
    const head = (o.prompt ? o.prompt.trim() + "\n\n---\n\n" : "") + (qs.length > 1 ? "次の質問に、指定の形式で 1 つずつ答えてください。質問ごとに 1 ブロックにしてください。\n\n" : "");
    const fmt = (list) => head + list.map((q, i) => (list.length > 1 ? `質問 ${i + 1}：${q}` : q)).join("\n\n");
    const parts = [], warnings = [];
    let cur = [];
    for (const q of qs) {
      if (fmt([q]).length > max) {
        if (cur.length) { parts.push(fmt(cur)); cur = []; }
        parts.push(fmt([q]));
        warnings.push(`${q.slice(0, 20)}… は 1 問で ${max} 字を超えます（回答の形の指示を NotebookLM の設定に入れると短くなります）`);
        continue;
      }
      if (cur.length && fmt([...cur, q]).length > max) { parts.push(fmt(cur)); cur = []; }
      cur.push(q);
    }
    if (cur.length) parts.push(fmt(cur));
    return { parts, warnings };
  }

  function triage(db, text, opts) {
    const pl = M().plan(db, text, opts);
    const idx = (a) => pl.entries.map((e, i) => (e.action === a ? i : -1)).filter((i) => i >= 0);
    return { plan: pl, fresh: idx("new"), updates: idx("update"), quiet: [...idx("same"), ...idx("dup")], bad: pl.bad };
  }
  // new だけを入れる（update・same・dup は入れない）
  function applyNew(db, t, opts) {
    const only = { entries: t.plan.entries.map((e, i) => (t.fresh.includes(i) ? e : Object.assign({}, e, { action: "same" }))), bad: [] };
    return M().apply(db, only, opts);
  }
  // choices: { [entryIndex]: "apply" | "new" | "skip" }
  function applyChosen(db, t, choices, opts) {
    const asNew = [];
    const entries = t.plan.entries.map((e, i) => {
      if (!t.updates.includes(i)) return Object.assign({}, e, { action: "same" });
      const c = choices[i] || "skip";
      if (c === "skip") return Object.assign({}, e, { action: "same" });
      if (c === "new") asNew.push(i);
      return e;
    });
    return M().apply(db, { entries, bad: [] }, Object.assign({}, opts, { asNew }));
  }

  // 案件メモに入れる memo の文。同じ質問箱の ID が入っている項目は足さない
  function toMemo(db, ids, note) {
    const have = JSON.stringify(note || {});
    const lines = [];
    let f = 0, q = 0;
    const nextNo = (coll, k) => { const n = ((note && note[coll]) || []).map((x) => +x.id.slice(2)).reduce((a, b) => Math.max(a, b), 0); return n + k; };
    for (const id of ids) {
      const it = M().find(db, id);
      if (!it || have.includes(tagOf(it.id))) continue;
      const ans = String(it.answer || "").replace(/\s+/g, " ").replace(/[#*|]/g, "").trim().slice(0, 120);
      if (it.status === "確定") lines.push(`F-${String(nextNo("facts", ++f)).padStart(2, "0")} ${it.question.slice(0, 60)} → ${ans}${tagOf(it.id)}`);
      else lines.push(`Q-${String(nextNo("questions", ++q)).padStart(2, "0")} ${it.question.slice(0, 80)}（${it.status}${it.reason ? "：" + String(it.reason).slice(0, 40) : ""}）${tagOf(it.id)}`);
    }
    return lines.join("\n");
  }

  // 確定した Q&A を NotebookLM のソース用の Markdown に
  function confirmedMd(db, title) {
    const list = db.items.filter((x) => x.status === "確定");
    return [`# ${title || "案件"}：確定した質問と回答`, "", ...list.flatMap((x) => [`## ${x.id} ${x.question}`, "", String(x.answer || "").trim(), "", `- 根拠：${M().sourcesOf(x.source).join("、") || "（記載なし）"}`, ""])].join("\n");
  }

  GK.qaflow = { questions, compose, triage, applyNew, applyChosen, toMemo, confirmedMd, tagOf };
})(globalThis.GK = globalThis.GK || {});
