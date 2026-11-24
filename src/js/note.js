// 案件メモ（```memo）の読み取りと統合、状況（status.md）・成果物の一覧（index.md）の組み立て（DOM を使わない）。
// 案件メモの形（司令塔 Gem の指示文と同じ）：
//   F-01 事実          D-01 決まったこと          Q-01 未回答の質問（決める人：〇〇／期限：2026-12-05）
//   Q-01 回答済：答え  ← 答えが出たら同じ ID で書く
// 一度振った ID は消さない。同じ ID が来たら本文を新しいものにする（回答済は戻さない）
(function (GK) {
  "use strict";

  const SCHEMA = "gemini-agent.note.v1";
  const KIND = { F: "facts", D: "decisions", Q: "questions" };
  const LABEL = { facts: "事実", decisions: "決まったこと", questions: "質問" };

  function empty(name) {
    return { schema: SCHEMA, name: name || "", stage: null, type: "", next: "", facts: [], decisions: [], questions: [], artifacts: [], log: [], updated: "" };
  }

  // memo の本文 → [{ id, coll, text, answered, answer, who, due }]
  function parseMemo(text) {
    const out = [];
    for (const raw of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
      const m = raw.trim().replace(/^[-*・]\s*/, "").match(/^([FDQ])-(\d{1,3})\s*[:：]?\s*(.+)$/);
      if (!m) continue;
      const id = `${m[1]}-${String(+m[2]).padStart(2, "0")}`;
      let body = m[3].trim();
      const item = { id, coll: KIND[m[1]], text: body };
      if (m[1] === "Q") {
        const a = body.match(/^回答済\s*[:：]\s*(.*)$/);
        if (a) { item.answered = true; item.answer = a[1].trim(); item.text = ""; }
        const meta = body.match(/[（(]([^）)]*)[）)]\s*$/);
        if (meta && !a) {
          const who = meta[1].match(/決める人\s*[:：]\s*([^／/、,]+)/);
          const due = meta[1].match(/期限\s*[:：]\s*(\d{4}-\d{2}-\d{2})/);
          if (who) item.who = who[1].trim();
          if (due) item.due = due[1];
          if (who || due) item.text = body.slice(0, meta.index).trim();
        }
      }
      out.push(item);
    }
    return out;
  }

  // note に memo の項目を足す。戻り値 { note, added, updated, answered }
  function merge(noteIn, items, when) {
    const note = JSON.parse(JSON.stringify(noteIn || empty()));
    let added = 0, updated = 0, answered = 0;
    for (const it of items) {
      const list = note[it.coll];
      const cur = list.find((x) => x.id === it.id);
      if (!cur) {
        list.push(Object.assign({ id: it.id, text: it.text || "", since: when || "" }, it.coll === "questions" ? { status: it.answered ? "回答済" : "未回答", answer: it.answer || "", who: it.who || "", due: it.due || "" } : {}));
        added++;
        if (it.answered) answered++;
        continue;
      }
      if (it.coll === "questions" && it.answered) {
        if (cur.status !== "回答済") answered++;
        cur.status = "回答済"; cur.answer = it.answer;
        continue;
      }
      if (it.text && it.text !== cur.text) { cur.text = it.text; updated++; }
      if (it.who) cur.who = it.who;
      if (it.due) cur.due = it.due;
    }
    for (const k of ["facts", "decisions", "questions"]) note[k].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    note.updated = when || note.updated;
    return { note, added, updated, answered };
  }

  // 応答の見出し（intake.header）を note に入れる
  function setHeader(note, header) {
    if (!header) return note;
    return Object.assign({}, note, { stage: header.stage, type: header.type, next: header.next });
  }

  const STAGES = ["受付", "ヒヤリング", "仕様", "作成", "自己点検", "修正", "仕上げ"];
  // 状況の Markdown（案件フォルダの case/status.md）。人が開いて読む用
  function statusMd(note, today) {
    const open = note.questions.filter((q) => q.status !== "回答済");
    const soon = open.filter((q) => q.due).sort((a, b) => a.due.localeCompare(b.due));
    const lines = [
      `# ${note.name || "案件"}：状況`,
      "",
      `- 更新：${note.updated || today || ""}`,
      `- 段階：${note.stage ? `${note.stage}/7 ${STAGES[note.stage - 1] || ""}` : "（未開始）"}${note.type ? `｜型：${note.type}` : ""}`,
      `- 次に人がすること：${note.next || "（なし）"}`,
      "",
      `## 未回答の質問（${open.length} 件）`,
      ...(open.length ? open.map((q) => `- ${q.id} ${q.text}${q.who ? `（決める人：${q.who}` : ""}${q.due ? `${q.who ? "／" : "（"}期限：${q.due}` : ""}${q.who || q.due ? "）" : ""}${today && q.due && q.due < today ? " ⚠期限切れ" : ""}`) : ["- なし"]),
      "",
      `## 決まったこと（${note.decisions.length} 件）`,
      ...(note.decisions.length ? note.decisions.map((d) => `- ${d.id} ${d.text}`) : ["- なし"]),
      "",
      `## 事実（${note.facts.length} 件）`,
      ...(note.facts.length ? note.facts.map((f) => `- ${f.id} ${f.text}`) : ["- なし"]),
      "",
      `## 回答済の質問`,
      ...(note.questions.filter((q) => q.status === "回答済").map((q) => `- ${q.id} ${q.text ? q.text + " → " : ""}${q.answer}`)),
      "",
      `## 成果物（${note.artifacts.length} 個）`,
      ...(note.artifacts.length ? [...note.artifacts].reverse().map((a) => `- ${a.date} ${a.file}（${a.kind}${a.stage ? `・段階 ${a.stage}` : ""}）`) : ["- なし"]),
      "",
    ];
    if (soon.length) lines.splice(5, 0, `- 期限が一番近い質問：${soon[0].id}（${soon[0].due}）`);
    return lines.join("\n");
  }

  // 成果物の一覧（out/index.md）
  function indexMd(note) {
    const rows = [...note.artifacts].reverse();
    return [`# ${note.name || "案件"}：成果物`, "", "| 日時 | ファイル | 種類 | 段階 |", "|---|---|---|---|", ...rows.map((a) => `| ${a.date} | ${a.file} | ${a.kind} | ${a.stage || ""} |`), ""].join("\n");
  }

  function addArtifact(note, a) {
    const n = Object.assign({}, note, { artifacts: [...note.artifacts.filter((x) => x.file !== a.file), a] });
    return n;
  }

  // NotebookLM に入れ直す用の要約（事実・決まったこと・質問）
  function notebookMd(note) {
    return [`# ${note.name || "案件"}：案件メモ`, "", ...["facts", "decisions", "questions"].flatMap((k) => [`## ${LABEL[k]}`, ...note[k].map((x) => `- ${x.id} ${x.text}${x.status === "回答済" ? ` → 回答：${x.answer}` : ""}`), ""])].join("\n");
  }

  GK.note = { SCHEMA, empty, parseMemo, merge, setHeader, statusMd, indexMd, addArtifact, notebookMd, STAGES };
})(globalThis.GK = globalThis.GK || {});
