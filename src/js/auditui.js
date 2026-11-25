// 監査タブ（拡張のときだけ）。案件フォルダの case/audit/*.jsonl を読み、どこで・誰が・何を・どこまで進んだかを見せる。
// ハッシュチェーンの検証・段階の進み具合・依頼ごとのまとめ・絞り込み・CSV。本文は監査ログに無いので、会話アーカイブと sha256 で照合する
(function (GK) {
  "use strict";

  const el = (...a) => GK.dom.el(...a);
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const A = () => GK.agent;
  let ctx = null, root = null, rows = [];
  const U = {};

  async function loadRows() {
    rows = [];
    const ag = A();
    if (!ag || !ag.fs) return;
    let names = [];
    try { names = (await ag.fs.list(["case", "audit"])).filter((x) => !x.dir && /\.jsonl$/.test(x.name)).map((x) => x.name).sort(); } catch (e) { names = []; }
    // どのファイルの何行目かを覚えておく（検証の結果を、ファイルの行で示すため。hash の計算には入らない）
    for (const n of names) GK.audit.parseLines(ag.decodeText(await ag.fs.read(["case", "audit", n]))).rows.forEach((r, i) => { Object.defineProperty(r, "at", { value: `${n} の ${i + 1} 行目`, enumerable: false }); rows.push(r); });
  }
  async function refresh() {
    if (!root) return;
    await loadRows();
    render();
  }

  async function verify() {
    const v = await GK.audit.verify(rows);
    clear(U.verify).append(el("p", { class: v.ok ? "ok" : "err", text: v.ok ? `検証 OK：${v.count} 行。書き換え・削除・入れ替えは見つかりません` : `検証 NG：${v.errors.length} か所（${v.errors.slice(0, 3).map((e) => `${(rows[e.line - 1] && rows[e.line - 1].at) || `${e.line} 行目`}：${e.message}`).join("／")}）` }));
    await A().audit({ actor: "人", action: "監査ログの検証", result: v.ok ? "成功" : "失敗", note: `${v.count} 行` });
  }

  // 会話アーカイブで同じ sha256 の箇所を探して見せる
  async function findArchive(sha) {
    const ag = A();
    clear(U.archive);
    let names = [];
    try { names = (await ag.fs.list(["case", "会話"])).filter((x) => !x.dir).map((x) => x.name); } catch (e) { names = []; }
    for (const n of names) {
      const t = ag.decodeText(await ag.fs.read(["case", "会話", n]));
      const i = t.indexOf(`sha256: ${sha}`);
      if (i < 0) continue;
      // 見出しの次の囲みを、開きと同じ長さの閉じまで取る（本文の中の「## 見出し」で切らないように）
      const head = t.lastIndexOf("\n## ", i);
      const m = t.slice(i).match(/\n\n(`{3,})text\n([\s\S]*?)\n\1\n/);
      const part = m ? t.slice(head + 1, i + m.index + m[0].length) : t.slice(head + 1, i + 200);
      // アーカイブの本文から sha256 を計算し直して、監査ログと同じか確かめる
      const same = m ? (await GK.audit.sha256(m[2])) === sha : false;
      U.archive.append(el("div", { class: "fig" }, el("p", { class: same ? "ok small" : "warn small", text: `case/会話/${n}：${same ? "本文の sha256 が監査ログと一致" : "見出しは一致したが、本文の sha256 が合わない（書き換えられた可能性）"}` }), el("pre", { class: "ik-code", text: part.slice(0, 4000) })));
      return;
    }
    U.archive.append(el("p", { class: "muted small", text: "会話アーカイブに同じ sha256 の記録がありません（アーカイブがオフだったか、ファイルが無い）" }));
  }

  function render() {
    if (!root) return;
    const ag = A();
    clear(U.body);
    if (!ag || !ag.fs) { U.body.append(el("p", { class: "muted", text: "エージェントタブで案件フォルダを選ぶと、ここに監査ログが出ます" })); return; }
    if (!rows.length) { U.body.append(el("p", { class: "muted", text: "まだ記録がありません" })); return; }
    const p = GK.audit.progress(rows);
    const fmt = (t) => String(t || "").replace("T", " ").slice(0, 16);
    // 段階の進み具合
    const bar = el("ol", { class: "ik-bar", "aria-label": "段階" }, GK.note.STAGES.map((s, i) => {
      const st = p.stages.find((x) => x.stage === i + 1);
      return el("li", { class: st ? "done" : "", text: `${i + 1} ${s}${st ? ` ${fmt(st.first).slice(5)}` : ""}` });
    }));
    const stTable = el("table", { class: "grid" }, el("tr", {}, ["段階", "最初に着いた", "最後", "次の段階まで", "記録"].map((h) => el("th", { text: h }))),
      p.stages.map((s) => el("tr", {}, el("td", { text: `${s.stage} ${GK.note.STAGES[s.stage - 1] || ""}` }), el("td", { text: fmt(s.first) }), el("td", { text: fmt(s.last) }), el("td", { text: s.minutes == null ? "" : `${s.minutes} 分` }), el("td", { text: String(s.events) }))));
    const runTable = el("table", { class: "grid" }, el("tr", {}, ["依頼", "始まり", "終わり", "手数", "道具", "失敗", "結果"].map((h) => el("th", { text: h }))),
      [...p.runs].reverse().slice(0, 30).map((r) => el("tr", {}, el("td", {}, el("button", { type: "button", class: "linklike", text: r.run, onclick: () => { U.run.value = r.run; renderLog(); } })), el("td", { text: fmt(r.start) }), el("td", { text: fmt(r.end) }), el("td", { text: String(r.steps) }), el("td", { text: String(r.tools) }), el("td", { class: r.fails ? "err" : "", text: String(r.fails) }), el("td", { text: r.result }))));
    U.body.append(
      el("h3", { text: "段階の進み具合" }), bar, el("div", { class: "tablewrap" }, stTable),
      el("h3", { text: "依頼ごと" }), el("div", { class: "tablewrap" }, runTable),
      el("h3", { text: "時系列" }), U.filters, U.log, U.archive);
    clear(U.run).append(el("option", { value: "", text: "すべての依頼" }), ...[...new Set(rows.map((r) => r.run).filter(Boolean))].reverse().map((r) => el("option", { value: r, text: r })));
    renderLog();
  }
  function renderLog() {
    clear(U.log);
    const f = { run: U.run.value, kind: U.kind.value };
    const list = rows.filter((r) => (!f.run || r.run === f.run) && (!f.kind || (f.kind === "失敗" ? r.result === "失敗" || r.result === "却下" : f.kind === "道具" ? r.action === "道具" : r.actor === f.kind))).slice(-400).reverse();
    const t = el("table", { class: "grid au-table" }, el("tr", {}, ["時刻", "どこで", "誰が", "何を", "道具・対象", "結果", "段階", "文字数", "照合"].map((h) => el("th", { text: h }))));
    for (const r of list) {
      t.append(el("tr", { class: r.result === "失敗" || r.result === "却下" ? "au-ng" : "" },
        el("td", { text: String(r.time || "").replace("T", " ").slice(5, 19) }), el("td", { text: r.where || "" }), el("td", { text: r.actor || "" }),
        el("td", { text: r.action || "" }), el("td", { text: [r.tool, r.target].filter(Boolean).join("：") }), el("td", { text: [r.result, r.note].filter(Boolean).join("　") }),
        el("td", { text: r.stage ? String(r.stage) : "" }), el("td", { text: r.chars ? String(r.chars) : "" }),
        el("td", {}, r.sha256 ? el("button", { type: "button", class: "linklike", text: r.sha256.slice(0, 8), title: "会話アーカイブで照合する", onclick: () => findArchive(r.sha256) }) : null)));
    }
    U.log.append(el("p", { class: "small muted", text: `${list.length} 行を表示（全 ${rows.length} 行）。本文は監査ログに入れていません。照合の欄を押すと、会話アーカイブの該当箇所を sha256 で確かめます` }), el("div", { class: "tablewrap" }, t));
  }

  function build() {
    U.verify = el("div");
    U.body = el("div");
    U.log = el("div");
    U.archive = el("div");
    U.run = el("select", { "aria-label": "依頼で絞る" });
    U.kind = el("select", { "aria-label": "種類で絞る" }, [["", "すべて"], ["失敗", "失敗・却下だけ"], ["道具", "道具だけ"], ["人", "人の操作だけ"], ["Gemini", "Gemini"], ["NotebookLM", "NotebookLM"]].map(([v, t]) => el("option", { value: v, text: t })));
    U.run.addEventListener("change", renderLog);
    U.kind.addEventListener("change", renderLog);
    U.filters = el("div", { class: "actions" }, U.run, U.kind);
    root.append(
      el("h2", { text: "監査ログ" }),
      el("p", { class: "muted small", text: "案件フォルダの case/audit/ に、どこで・誰が・何を・どこまで進めたかを 1 行ずつ追記しています。各行は前の行のハッシュとつながっていて、途中を書き換えたり消したりすると検証で分かります。本文は入れていません。" }),
      el("div", { class: "actions" },
        el("button", { type: "button", text: "読み直す", onclick: refresh }),
        el("button", { type: "button", class: "primary", text: "改ざんがないか検証する", onclick: verify }),
        el("button", { type: "button", text: "CSV で保存", onclick: () => ctx.download(`監査ログ-${new Date().toISOString().slice(0, 10)}.csv`, GK.audit.toCsv(rows), "text/csv;charset=utf-8") })),
      U.verify, U.body);
  }

  async function init(c) {
    ctx = c;
    root = document.getElementById("audit-root");
    if (!root || root.firstChild) return;
    build();
    if (A()) A().onFolder(refresh);
    await refresh();
  }

  GK.auditUI = { init, refresh, get rows() { return rows; }, verify };
})(globalThis.GK = globalThis.GK || {});
