// 解説ページ（```explain の JSON）→ 単体で開ける HTML 1 枚。型は「結論 → 全体像の図 → 詳細 → 次の一手」で固定する。
// 図は ```flow / ```arch / ```map / WBS の記法をこのツールの描画で SVG にして埋め込む。スクリプトも外部参照も入れない（CSP で止める）。
//
// {
//   "title": "受注業務の見直し", "subtitle": "現状と進め方", "date": "2026-11-24", "audience": "営業部長",
//   "conclusion": ["結論 1", "結論 2"],                 3 つまで
//   "overview": { "type": "flow", "src": "…", "caption": "…" },     全体像の図（任意）
//   "sections": [{ "heading": "…", "lead": "…", "points": ["…"], "figure": { … }, "table": "| a | b |\n|---|---|\n| 1 | 2 |" }],
//   "next": [{ "what": "…", "who": "…", "due": "2026-12-05" }],
//   "notes": ["出典・前提"]
// }
(function (GK) {
  "use strict";

  const D = GK.diagram;
  const esc = D.esc;
  const FIG_TYPES = ["flow", "arch", "map", "wbs", "table"];

  function parse(text) {
    const res = { data: null, ...D.issues() };
    let j = null;
    const s = String(text ?? "").trim().replace(/^```\w*\s*\n|\n?```\s*$/g, "");
    try { j = JSON.parse(s); } catch (e) { res.errors.push({ line: 1, message: `JSON として読めません（${e.message}）` }); return res; }
    if (!j || typeof j !== "object" || Array.isArray(j)) { res.errors.push({ line: 1, message: "{ … } の形にしてください" }); return res; }
    if (!j.title) res.errors.push({ line: 1, message: "title がありません" });
    const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const data = {
      title: String(j.title || ""), subtitle: String(j.subtitle || ""), date: String(j.date || ""), audience: String(j.audience || ""),
      conclusion: arr(j.conclusion).map(String), overview: j.overview || null,
      sections: arr(j.sections).filter((x) => x && typeof x === "object"), next: arr(j.next), notes: arr(j.notes).map(String),
    };
    if (data.conclusion.length > 3) res.warnings.push({ line: 1, message: `結論は 3 つまでにしてください（${data.conclusion.length} 個）。読み手が覚えられる数にする` });
    if (!data.conclusion.length) res.warnings.push({ line: 1, message: "conclusion（結論）がありません。最初に読む人が結論を探すことになります" });
    if (!data.next.length) res.warnings.push({ line: 1, message: "next（次の一手）がありません" });
    for (const f of [data.overview, ...data.sections.map((x) => x.figure)].filter(Boolean)) if (!FIG_TYPES.includes(f.type)) res.warnings.push({ line: 1, message: `図の type「${f.type}」は使えません（${FIG_TYPES.join(" / ")}）` });
    res.data = data;
    return res;
  }

  // 図 → { svg | html, errors }
  function figure(f) {
    if (!f || !f.type) return null;
    try {
      if (f.type === "flow") { const r = GK.flow.render(String(f.src || ""), {}); return r.graph.errors.length ? { err: r.graph.errors[0].message } : { svg: r.svg }; }
      if (f.type === "arch") { const r = GK.arch.render(String(f.src || "")); return r.graph.errors.length ? { err: r.graph.errors[0].message } : { svg: r.svg }; }
      if (f.type === "map") { const r = GK.map.render(String(f.src || "")); return r.graph.errors.length ? { err: r.graph.errors[0].message } : { svg: r.svg }; }
      if (f.type === "wbs") { const r = GK.wbs.parse(String(f.src || "")); return r.errors.length ? { err: r.errors[0].message } : { svg: GK.wbs.gantt(r, { title: f.caption || "日程" }) }; }
      if (f.type === "table") return { html: tableHtml(String(f.src || "")) };
    } catch (e) { return { err: e.message }; }
    return { err: `図の type「${f.type}」は使えません` };
  }
  function tableHtml(src) {
    const rows = GK.gexport.parseTable(src).rows;
    if (!rows.length) return "";
    const inl = (s) => GK.gexport.inline(s).map((r) => (r.b ? `<b>${esc(r.t)}</b>` : r.code ? `<code>${esc(r.t)}</code>` : esc(r.t))).join("");
    return `<div class="tw"><table><thead><tr>${rows[0].map((c) => `<th>${inl(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${rows[0].map((_, i) => `<td>${inl(r[i] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const inline = (s) => GK.gexport.inline(s).map((r) => (r.b ? `<b>${esc(r.t)}</b>` : r.code ? `<code>${esc(r.t)}</code>` : r.i ? `<i>${esc(r.t)}</i>` : esc(r.t))).join("");
  function figHtml(f) {
    const r = figure(f);
    if (!r) return "";
    const cap = f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : "";
    if (r.err) return `<figure class="fig err"><p>図を描けませんでした：${esc(r.err)}</p>${cap}</figure>`;
    return `<figure class="fig">${r.svg ? `<div class="sv">${r.svg}</div>` : r.html}${cap}</figure>`;
  }

  const CSS = `
*{box-sizing:border-box}body{margin:0;background:#F4F6F9;color:#222;font:15px/1.8 Arial,"メイリオ",Meiryo,sans-serif}
.pg{max-width:1080px;margin:0 auto;padding:0 20px 48px}
header{background:#1F3A5F;color:#fff;padding:36px 0 28px;margin-bottom:28px}
header .pg{padding-bottom:0}header h1{margin:0;font-size:30px;line-height:1.35;letter-spacing:.02em}
header p{margin:8px 0 0;color:#D5DEEA}.meta{font-size:13px;color:#B9C6D8;margin-top:14px}
.concl{background:#fff;border-left:6px solid #B8892B;border-radius:10px;padding:18px 24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.concl h2{margin:0 0 6px;font-size:14px;color:#8A6A1F;letter-spacing:.08em}
.concl ol{margin:0;padding-left:1.4em}.concl li{font-size:18px;font-weight:bold;color:#1F3A5F;margin:4px 0}
section{background:#fff;border-radius:10px;padding:20px 24px;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
section h2{margin:0 0 8px;font-size:20px;color:#1F3A5F;border-bottom:2px solid #E3E8EF;padding-bottom:6px}
.no{display:inline-block;min-width:1.8em;color:#B8892B}
.lead{font-size:16px;margin:4px 0 10px}
ul.pt{margin:6px 0;padding-left:1.3em}ul.pt li{margin:3px 0}
.fig{margin:14px 0 4px}.fig .sv{overflow-x:auto;border:1px solid #E3E8EF;border-radius:8px;background:#fff}
.fig .sv svg{display:block;max-width:100%;height:auto}figcaption{font-size:12.5px;color:#5A6573;margin-top:4px}
.fig.err p{color:#B3261E}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0}
th,td{border:1px solid #C9D1DC;padding:6px 10px;text-align:left;vertical-align:top}th{background:#EEF2F7;color:#1F3A5F;white-space:nowrap}
code{background:#F0F2F5;padding:0 4px;border-radius:3px;font-family:Consolas,monospace;font-size:.92em}
.next table td:first-child{font-weight:bold}
.notes{font-size:12.5px;color:#5A6573;margin-top:24px}.notes li{margin:2px 0}
footer{font-size:12px;color:#8A94A3;margin-top:28px;text-align:right}
@media (max-width:640px){header h1{font-size:23px}.concl li{font-size:16px}section{padding:16px}}
@media print{body{background:#fff}section,.concl{box-shadow:none;break-inside:avoid}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

  function toHTML(data) {
    const d = data;
    const meta = [d.date, d.audience ? `対象：${d.audience}` : ""].filter(Boolean).join("　");
    const secs = d.sections.map((s, i) => `<section><h2><span class="no">${i + 1}</span>${esc(s.heading || "")}</h2>${s.lead ? `<p class="lead">${inline(s.lead)}</p>` : ""}` +
      `${Array.isArray(s.points) && s.points.length ? `<ul class="pt">${s.points.map((p) => `<li>${inline(p)}</li>`).join("")}</ul>` : ""}` +
      `${s.figure ? figHtml(s.figure) : ""}${s.table ? tableHtml(String(s.table)) : ""}</section>`).join("\n");
    const next = d.next.length ? `<section class="next"><h2>次の一手</h2><div class="tw"><table><thead><tr><th>やること</th><th>担当</th><th>期限</th></tr></thead><tbody>${d.next.map((n) => (typeof n === "object" ? `<tr><td>${inline(n.what || "")}</td><td>${esc(n.who || "")}</td><td>${esc(n.due || "")}</td></tr>` : `<tr><td>${inline(n)}</td><td></td><td></td></tr>`)).join("")}</tbody></table></div></section>` : "";
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(d.title)}</title>
<style>${CSS}</style>
</head>
<body>
<header><div class="pg"><h1>${esc(d.title)}</h1>${d.subtitle ? `<p>${esc(d.subtitle)}</p>` : ""}${meta ? `<div class="meta">${esc(meta)}</div>` : ""}</div></header>
<div class="pg">
${d.conclusion.length ? `<div class="concl"><h2>結論</h2><ol>${d.conclusion.map((c) => `<li>${inline(c)}</li>`).join("")}</ol></div>` : ""}
${d.overview ? `<section><h2>全体像</h2>${figHtml(d.overview)}</section>` : ""}
${secs}
${next}
${d.notes.length ? `<ul class="notes">${d.notes.map((n) => `<li>${inline(n)}</li>`).join("")}</ul>` : ""}
<footer>gemini-agent で作成</footer>
</div>
</body>
</html>
`;
  }

  function render(text) {
    const r = parse(text);
    return r.errors.length ? { ...r, html: "" } : { ...r, html: toHTML(r.data) };
  }

  GK.explain = { parse, render, toHTML, figure, FIG_TYPES };
})(globalThis.GK = globalThis.GK || {});
