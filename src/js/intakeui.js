// 取り込みタブと、Google への出口のボタン。Gem の応答を丸ごと貼ると、ブロックごとに行き先と書き出しを出す。
// 貼った応答は保存しない（タブを開き直すと消える）。文書ビュー・スライドのタブからも、ここの書き出しを使う（GK.intakeUI.exports）
(function (GK) {
  "use strict";

  const el = (...a) => GK.dom.el(...a);
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const safe = (s, def) => String(s || def || "文書").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const MIME = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  let ctx = null;
  let root = null;
  const R = {};

  // ---------- クリップボード（text/html と text/plain を両方渡す） ----------
  // ClipboardItem が使えないときは、copy イベントの clipboardData に入れる（innerHTML は使わない）
  async function copyRich(html, text, note) {
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
        ctx.toast(`コピーしました（${note}）`);
        return true;
      }
    } catch (e) { /* 下の方法へ */ }
    let ok = false;
    const onCopy = (ev) => { ev.clipboardData.setData("text/html", html); ev.clipboardData.setData("text/plain", text); ev.preventDefault(); ok = true; };
    document.addEventListener("copy", onCopy);
    try { document.execCommand("copy"); } catch (e) { ok = false; }
    document.removeEventListener("copy", onCopy);
    ctx.toast(ok ? `コピーしました（${note}）` : "コピーできませんでした。ファイルで保存してください", ok ? "" : "err");
    return ok;
  }

  // SVG の文字列 → PNG（data URL）。k は倍率
  function svgToPng(svg, w, hgt, k) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = el("canvas", { width: Math.ceil(w * k), height: Math.ceil(hgt * k) });
        const g = c.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL("image/png")); } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error("PNG にできませんでした"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }

  // ---------- 書き出し（文書・表・スライド） ----------
  // 文書の中の flow ブロックを PNG にする。描けない図は記法のまま残す
  async function flowImages(md) {
    const out = [];
    for (const src of GK.gexport.flowSources(md)) {
      const r = GK.flow.render(src, { theme: ctx.themeHash() });
      if (!r.svg || r.graph.errors.length) { out.push(null); continue; }
      const k = Math.min(1, 620 / r.geo.width); // Docs の本文の幅（約 620px）に収める
      try { out.push({ src: await svgToPng(r.svg, r.geo.width, r.geo.height, 2), w: r.geo.width * k, h: r.geo.height * k }); } catch (e) { out.push(null); }
    }
    return out;
  }
  const exportsApi = {
    async docRich(md) {
      const images = await flowImages(md);
      return copyRich(GK.gexport.richHTML(md, { images }), md, "Google ドキュメントに貼ると見出し・表・図が保たれます");
    },
    docx(md, title) {
      try {
        const bytes = GK.gexport.docx(md, { title });
        ctx.download(`${safe(title)}-${stamp()}.docx`, new Blob([bytes], { type: MIME.docx }));
        ctx.toast("docx を保存しました。Drive にアップロードして開くと Google ドキュメントになります");
      } catch (e) { ctx.toast("docx にできませんでした：" + e.message, "err"); }
    },
    notebook(md, title, kind) {
      ctx.download(`${safe(title)}_NotebookLM用-${stamp()}.md`, GK.gexport.notebookMd(md, { title, kind }), "text/markdown;charset=utf-8");
      ctx.toast("NotebookLM 用の .md を保存しました。古い版のソースがあれば削除してから入れてください");
    },
    tableCopy(rows) { return copyRich(GK.gexport.tableHTML(rows), GK.gexport.tsv(rows), "スプレッドシート・ドキュメントに貼ると表になります"); },
    tableXlsx(rows, name) {
      try {
        const bytes = GK.gexport.xlsx([{ name: name || "表", rows }]);
        ctx.download(`${safe(name, "表")}-${stamp()}.xlsx`, new Blob([bytes], { type: MIME.xlsx }));
        ctx.toast("xlsx を保存しました。Excel で開くか、Drive にアップロードしてスプレッドシートで開けます");
      } catch (e) { ctx.toast("xlsx にできませんでした：" + e.message, "err"); }
    },
    // Google スライド向け：日本語を Noto Sans JP にして書き出す
    pptxGoogle(layout, deck) {
      try {
        const bytes = GK.pptx.build(layout, { title: deck.title, author: deck.author, eaFont: "Noto Sans JP" });
        ctx.download(`${safe(deck.title, "スライド")}_Googleスライド用-${stamp()}.pptx`, new Blob([bytes], { type: MIME.pptx }));
        ctx.toast("保存しました。Drive にアップロードし、右クリック →「アプリで開く → Google スライド」で開いてください");
      } catch (e) { ctx.toast("書き出しに失敗しました：" + e.message, "err"); }
    },
  };

  // 文書の書き出しボタンの並び（取り込みタブと文書ビューで共通）
  function docButtons(getMd, getTitle) {
    const md = () => getMd();
    const need = (fn) => () => { const m = md(); if (!m || !m.trim()) { ctx.toast("先に文書を開いてください", "err"); return; } fn(m); };
    return [
      el("button", { type: "button", class: "primary", text: "Google ドキュメント用にコピー", title: "見出し・表・図を保ったまま貼れる形でコピー", onclick: need((m) => exportsApi.docRich(m)) }),
      el("button", { type: "button", text: ".docx で保存", onclick: need((m) => exportsApi.docx(m, getTitle())) }),
      el("button", { type: "button", text: "NotebookLM 用 .md", onclick: need((m) => exportsApi.notebook(m, getTitle(), "文書")) }),
    ];
  }

  // ---------- 取り込みタブ ----------
  function init(c) {
    ctx = c;
    root = document.getElementById("intake-root");
    if (!root || root.firstChild) return;
    R.src = el("textarea", { id: "intake-src", class: "mono", spellcheck: "false", rows: 10, placeholder: "Gem（司令塔など）の応答を、説明文ごと丸ごと貼り付け", "aria-label": "Gem の応答" });
    R.head = el("div", { class: "ik-head", hidden: true });
    R.sum = el("div", { class: "ik-sum", role: "status" });
    R.list = el("div", { class: "ik-list" });
    let timer = null;
    R.src.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 300); });
    root.append(
      el("h2", { text: "取り込み" }),
      el("p", { class: "muted small", text: "司令塔 Gem などの応答を丸ごと貼ると、中のブロック（文書・図・スライド・表・カルテ・コード）を見分けて、行き先と書き出しのボタンを出します。貼った内容は保存しません。" }),
      R.src,
      el("div", { class: "actions" },
        el("button", { type: "button", class: "primary", text: "読み分ける", onclick: run }),
        el("button", { type: "button", text: "クリップボードから貼る", onclick: pasteClip }),
        el("button", { type: "button", text: "サンプル（ダミー）", onclick: () => { R.src.value = sample(); run(); } }),
        el("button", { type: "button", text: "クリア", onclick: () => { R.src.value = ""; run(); } }),
        el("button", { type: "button", text: "司令塔 Gem の指示文", onclick: () => ctx.openItem("gem-conductor") })),
      R.head, R.sum, R.list);
  }

  async function pasteClip() {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) { ctx.toast("クリップボードが空です", "err"); return; }
      R.src.value = t;
      run();
    } catch (e) { ctx.toast("クリップボードを読めませんでした。欄に Ctrl+V で貼ってください", "err"); }
  }

  function run() {
    const res = GK.intake.parse(R.src.value);
    clear(R.head); clear(R.sum); clear(R.list);
    R.head.hidden = !res.header;
    if (res.header) {
      const hd = res.header;
      R.head.append(
        el("div", { class: "ik-stage" }, el("b", { text: `段階 ${hd.stage}${hd.total ? ` / ${hd.total}` : ""}` }), el("span", { class: "ik-type", text: hd.type })),
        stageBar(hd),
        el("p", { class: "ik-next" }, el("b", { text: "次に人がすること：" }), hd.next));
    }
    if (!R.src.value.trim()) { R.sum.append(el("span", { class: "muted", text: "応答を貼ってください" })); return; }
    if (!res.blocks.length) { R.sum.append(el("span", { class: "warn", text: "ブロックが見つかりません。成果物はコードブロック（```flow など）か ````markdown で返すよう Gem に頼んでください" })); return; }
    R.sum.append(el("span", { text: `${res.blocks.length} 個のブロック：` }), ...GK.intake.summary(res).map((s) => el("span", { class: `ik-chip ik-k-${s.kind}`, text: `${s.label} ${s.count}` })));
    res.blocks.forEach((b, i) => R.list.append(card(b, i)));
  }

  const STAGES = ["受付", "ヒヤリング", "仕様", "作成", "自己点検", "修正", "仕上げ"];
  function stageBar(hd) {
    return el("ol", { class: "ik-bar", "aria-label": "段階" }, STAGES.map((s, i) => el("li", { class: i + 1 < hd.stage ? "done" : i + 1 === hd.stage ? "now" : "", "aria-current": i + 1 === hd.stage ? "step" : null, text: `${i + 1} ${s}` }, i + 1 < hd.stage ? el("span", { class: "sr-only", text: "（済）" }) : null)));
  }

  function card(b, i) {
    const label = GK.intake.KINDS[b.kind] || b.kind;
    const body = el("div", { class: "ik-body" });
    const acts = el("div", { class: "actions" });
    const text = () => b.text;
    if (b.kind === "doc") {
      const md = b.text; // ````markdown の囲みは intake.parse が外している
      body.append(el("details", {}, el("summary", { text: "中身を見る" }), el("div", { class: "ik-md" }, GK.md.render(md))));
      acts.append(el("button", { type: "button", text: "文書タブで開く", onclick: () => ctx.openDoc(md) }), ...docButtons(() => md, () => b.title || "文書"));
    } else if (b.kind === "flow" || b.kind === "arch" || b.kind === "map") {
      const r = ctx.drawFig(b.text, b.kind);
      if (r.svg && !r.errors.length) body.append(el("div", { class: "ik-fig" }, ctx.parseSvg(r.svg)));
      else body.append(el("p", { class: "err", text: `図にできません：${(r.errors[0] || {}).message || "記法を確かめてください"}` }));
      const ok = r.svg && !r.errors.length;
      acts.append(el("button", { type: "button", class: "primary", text: "図タブで開く", onclick: () => ctx.openFlow(b.text, b.kind) }),
        el("button", { type: "button", text: "画像をコピー", disabled: !ok, onclick: () => ctx.copyPng(r.svg, r.w, r.h) }),
        el("button", { type: "button", text: "PNG で保存", disabled: !ok, onclick: () => ctx.savePng(r.svg, r.w, r.h, label) }),
        el("button", { type: "button", text: "記法をコピー", onclick: () => ctx.copyText(b.text) }));
    } else if (b.kind === "wbs") {
      const res = GK.wbs.parse(b.text);
      if (res.errors.length) body.append(el("p", { class: "err", text: `日程を引けません：${res.errors[0].message}` }));
      else body.append(el("p", { class: "muted small", text: `${GK.wbs.fromDay(res.start)} 〜 ${GK.wbs.fromDay(res.end)}・工数 計 ${res.totalHours}h・余裕のない作業 ${res.critical.join("、") || "なし"}` }), el("div", { class: "ik-fig" }, ctx.parseSvg(GK.wbs.gantt(res))));
      acts.append(el("button", { type: "button", class: "primary", text: "WBS タブで開く", onclick: () => ctx.openWbs(b.text) }),
        el("button", { type: "button", text: ".xlsx で保存（ガント付き）", disabled: !!res.errors.length, onclick: () => { try { ctx.download(`WBS-${stamp()}.xlsx`, new Blob([GK.gexport.xlsx([GK.wbs.sheet(res)])], { type: MIME.xlsx })); } catch (e) { ctx.toast(e.message, "err"); } } }),
        el("button", { type: "button", text: "表をコピー", onclick: () => exportsApi.tableCopy(GK.gexport.parseTable(b.text).rows) }));
    } else if (b.kind === "memo") {
      const items = GK.note.parseMemo(b.text);
      const n = (c) => items.filter((x) => x.coll === c).length;
      body.append(el("p", { class: "muted small", text: `事実 ${n("facts")}・決まったこと ${n("decisions")}・質問 ${n("questions")}（うち回答済 ${items.filter((x) => x.answered).length}）。Chrome 拡張を使うと、案件フォルダの case/note.json に自動で足します` }), el("pre", { class: "ik-code", text: b.text }));
      acts.append(el("button", { type: "button", class: "primary", text: "コピー", onclick: () => ctx.copyText(b.text) }));
    } else if (b.kind === "explain") {
      const r = GK.explain.render(b.text);
      body.append(el("p", { class: r.errors.length ? "err" : "muted small", text: r.errors.length ? `読めません：${r.errors[0].message}` : `節 ${r.data.sections.length} 個${r.warnings.length ? `・注意 ${r.warnings.length} 件` : ""}` }));
      acts.append(el("button", { type: "button", class: "primary", text: "解説ページタブで開く", onclick: () => ctx.openExplain(b.text) }),
        el("button", { type: "button", text: "HTML で保存", disabled: !!r.errors.length, onclick: () => ctx.download(`${safe(r.data && r.data.title, "解説")}-${stamp()}.html`, r.html, "text/html;charset=utf-8") }));
    } else if (b.kind === "slides") {
      const p = GK.slides.parseDeck(b.text);
      body.append(el("p", { class: p.error ? "err" : "muted small", text: p.error ? `読めません：${p.error}` : `${p.deck.slides.length} 枚` }));
      acts.append(el("button", { type: "button", class: "primary", text: "スライドタブで開く", onclick: () => ctx.openDeck(b.text) }));
    } else if (b.kind === "table") {
      const rows = GK.gexport.parseTable(b.text).rows;
      body.append(previewTable(rows));
      acts.append(el("button", { type: "button", class: "primary", text: "表をコピー（スプレッドシート・ドキュメント）", onclick: () => exportsApi.tableCopy(rows) }),
        el("button", { type: "button", text: ".xlsx で保存", onclick: () => exportsApi.tableXlsx(rows, tableName(b, i)) }),
        el("button", { type: "button", text: "NotebookLM 用 .md", onclick: () => exportsApi.notebook(toMdTable(rows), tableName(b, i), "表") }),
        el("button", { type: "button", text: "表タブで開く", onclick: () => ctx.openTable(b.text) }));
    } else if (b.kind === "karte") {
      body.append(el("p", { class: "muted small", text: `gemini-kit の案件カルテ（${/"patch"/.test(b.text) ? "追加分" : "全体"}）です。コピーして gemini-kit のダッシュボードに貼ってください` }));
      acts.append(el("button", { type: "button", class: "primary", text: "コピー", onclick: () => ctx.copyText(b.text) }));
    } else {
      body.append(el("pre", { class: "ik-code", text: b.text.split("\n").slice(0, 12).join("\n") + (b.text.split("\n").length > 12 ? "\n…" : "") }));
      acts.append(el("button", { type: "button", class: "primary", text: "コピー", onclick: () => ctx.copyText(text()) }));
      // VBA は Excel の VBE に貼る。.bas は文字コード（cp932）をここで作れないので書き出さない
      if (b.lang === "vba" || b.lang === "vb") body.append(el("p", { class: "muted small", text: "Excel で Alt+F11 →［挿入］→［標準モジュール］に貼り、F5 で実行。エラーが出たら、エラー文と止まった行を Gem に貼ってください" }));
    }
    return el("section", { class: `ik-card ik-k-${b.kind}` },
      el("div", { class: "ik-title" },
        el("span", { class: `ik-chip ik-k-${b.kind}`, text: label }),
        el("b", { text: b.title || (b.lang ? `（${b.lang}）` : "") }),
        el("span", { class: "muted small", text: `${b.line} 行目から` }),
        b.truncated ? el("span", { class: "warn small", text: "閉じていません（応答が途中で切れたかもしれません。Gem に「続き」と送ってください）" }) : null),
      body, acts);
  }

  const tableName = (b, i) => { const m = b.text.match(/^\|\s*ID\s*\|\s*階層/); return m ? "WBS" : `表${i + 1}`; };
  const toMdTable = (rows) => rows.length ? [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map((r) => `| ${rows[0].map((_, i) => String(r[i] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`).join("\n") + "\n" : "";
  function previewTable(rows) {
    if (!rows.length) return el("p", { class: "muted small", text: "表が空です" });
    const t = el("table", { class: "grid" }, el("tr", {}, rows[0].map((c) => el("th", { text: c }))));
    for (const r of rows.slice(1, 8)) t.append(el("tr", {}, rows[0].map((_, i) => el("td", { text: r[i] ?? "" }))));
    return el("div", { class: "tablewrap" }, t, rows.length > 8 ? el("p", { class: "muted small", text: `ほか ${rows.length - 8} 行` }) : null);
  }

  // ダミーの応答（司令塔 Gem の段階 4 の形）
  function sample() {
    return [
      "【段階 4/7｜資料｜図と WBS を確かめ、担当の空欄を埋めて返してください】",
      "仕様どおり、現行の流れの図・要件の骨子・WBS を作りました。【仮置き】締め日は月末としています。",
      "",
      "**1. 現行の流れ**",
      "```flow",
      "title 受注処理（現行・ダミー）",
      "lane 顧客",
      "lane 営業部",
      "lane 倉庫",
      "start S @顧客 注文する",
      "task A @営業部 注文内容を確認",
      "decision B @営業部 在庫はあるか",
      "task C @倉庫 出荷する",
      "end Z @顧客 受け取る",
      "S -> A -> B",
      "B -> C : ある",
      "C -> Z",
      "B -> A : ない",
      "```",
      "",
      "**2. 要件の骨子**",
      "````markdown",
      "# 受注業務の効率化 要件の骨子（ダミー）",
      "## 1. 目的",
      "- 受注の確認にかかる時間を **半分** にする",
      "## 2. 対象外",
      "- 請求・入金の処理",
      "## 3. 未確定",
      "| 項目 | 決める人 | 期限 |",
      "|---|---|---|",
      "| 締め日 | 営業部長 | 2026-12-05 |",
      "````",
      "",
      "**3. WBS**",
      "```table",
      "| ID | 階層 | 作業 | 成果物 | 工数(h) | 依存 | 担当 | 開始 | 終了 |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 1 | 要件定義 | 要件定義書 | 40 |  | 山田 | 2026-12-01 | 2026-12-12 |",
      "| 1.1 | 2 | 現行業務の聞き取り | 議事録 | 16 |  | 山田 | 2026-12-01 | 2026-12-03 |",
      "| 1.2 | 2 | 要件の整理 | 要件一覧 | 24 | 1.1 |  | 2026-12-04 | 2026-12-12 |",
      "```",
    ].join("\n");
  }

  // 外から応答を入れて読み分ける（拡張の「最新の応答を取り込みタブへ」）
  function load(text) { if (!R.src) return; R.src.value = String(text || ""); run(); }

  GK.intakeUI = { init, run, load, exports: exportsApi, docButtons, copyRich, svgToPng };
})(globalThis.GK = globalThis.GK || {});
