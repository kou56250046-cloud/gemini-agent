// 画面：タブ・文書・フロー図・スライド・表・Gem 設定・使い方。取り込みタブは intakeui.js。
// 貼った内容は保存しない（タブを閉じると消える）。覚えるのは開いていたタブだけ（sessionStorage）
(function (GK) {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const h = (...a) => GK.dom.el(...a);
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const safe = (s, def) => String(s || def).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const debounce = (fn, ms) => { let t = null; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

  function toast(msg, kind) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "show " + (kind || "");
    t.setAttribute("role", kind === "err" ? "alert" : "status");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.className = ""), kind === "err" ? 7000 : 2600);
  }
  async function copyText(s, note) {
    const ok = await GK.dom.copyText(s);
    toast(ok ? (note ? `コピーしました（${note}）` : "コピーしました") : "コピーできませんでした", ok ? "" : "err");
  }
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const themeHash = () => ({ primary: "#" + GK.slides.DEFAULT_THEME.primary, accent: "#" + GK.slides.DEFAULT_THEME.accent });

  // ---------- タブ ----------
  let gotoTab = () => {};
  function initTabs() {
    const tabs = [...document.querySelectorAll("nav.tabs button")];
    const show = (name) => {
      if (!tabs.some((b) => b.dataset.tab === name)) name = "intake";
      tabs.forEach((b) => {
        const on = b.dataset.tab === name;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
      document.querySelectorAll("section.tab").forEach((s) => (s.hidden = s.id !== "tab-" + name));
      try { sessionStorage.setItem("ga.tab", name); } catch (e) { /* 無視 */ }
      if (name === "slides") fitSlides();
    };
    gotoTab = show;
    tabs.forEach((b, i) => {
      b.addEventListener("click", () => show(b.dataset.tab));
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        show(next.dataset.tab);
        next.focus();
      });
    });
    let first = document.getElementById("tabbtn-agent") ? "agent" : "intake"; // 拡張のサイドパネルではエージェントから
    try { first = sessionStorage.getItem("ga.tab") || first; } catch (e) { /* 無視 */ }
    show(first);
  }

  // ---------- 文書 ----------
  let docTitle = "文書";
  function flowFigure(src) {
    const r = GK.flow.render(src, { theme: themeHash() });
    if (!r.svg || r.graph.errors.length) return null;
    return h("div", { class: "fig" }, GK.preview.parseSvg(r.svg));
  }
  function renderDoc() {
    const src = $("#doc-src").value;
    const view = clear($("#doc-view"));
    if (!src.trim()) { view.append(h("p", { class: "muted", text: "左に Markdown を貼ると、ここに整形した文書が出ます。" })); return; }
    const m = src.match(/^#\s+(.+)$/m);
    docTitle = m ? m[1].trim() : "文書";
    view.append(GK.md.render(src, { code: (b) => (b.lang === "flow" ? flowFigure(b.text) : null) }));
  }
  function initDoc() {
    $("#doc-src").addEventListener("input", debounce(renderDoc, 300));
    $("#doc-actions").append(...GK.intakeUI.docButtons(() => $("#doc-src").value, () => docTitle),
      h("button", { type: "button", text: ".md で保存", onclick: () => { const s = $("#doc-src").value; if (s.trim()) download(`${safe(docTitle, "文書")}-${stamp()}.md`, s.endsWith("\n") ? s : s + "\n", "text/markdown;charset=utf-8"); } }));
    renderDoc();
  }

  // ---------- 図（フロー図・構成図・論点マップ） ----------
  const FIG_NAMES = { flow: "フロー図", arch: "構成図", map: "論点マップ" };
  // 中身から種類を決める：layer と node @ があれば構成図、「- 」の行が多く矢印が無ければ論点マップ、ほかはフロー図
  function figKind(src) {
    const t = String(src || "");
    if (/^\s*layer\s+\S/m.test(t) && /^\s*node\s+\S+\s+@/m.test(t)) return "arch";
    const lines = t.split("\n").filter((l) => l.trim() && !/^\s*title\s/.test(l));
    if (lines.length && !/->|\.\.>/.test(t) && lines.filter((l) => /^\s*[-*・]\s/.test(l)).length >= lines.length / 2) return "map";
    return "flow";
  }
  // 種類ごとの描画 → { kind, svg, w, h, errors, warnings, ok }
  function drawFig(src, kind) {
    const k = kind && kind !== "auto" ? kind : figKind(src);
    if (k === "arch" || k === "map") {
      const r = GK[k].render(src);
      return { kind: k, svg: r.svg, w: r.geo ? r.geo.width : 0, h: r.geo ? r.geo.height : 0, errors: r.graph.errors, warnings: r.graph.warnings, ok: r.geo ? (k === "arch" ? `ノード ${r.geo.nodes.length} 個・矢印 ${r.geo.edges.length} 本・層 ${r.geo.rows.length} 段` : `項目 ${r.geo.nodes.length} 個`) : "" };
    }
    const r = GK.flow.render(src, { theme: themeHash() });
    return { kind: "flow", svg: r.svg, w: r.geo ? r.geo.width : 0, h: r.geo ? r.geo.height : 0, errors: r.graph.errors, warnings: r.graph.warnings, ok: `ノード ${r.graph.nodes.length} 個・矢印 ${r.graph.edges.length} 本・レーン ${r.graph.lanes.length} 本` };
  }
  const dataUrlBlob = (url) => { const bin = atob(url.split(",")[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Blob([u8], { type: "image/png" }); };
  async function savePng(svg, w, hgt, name) {
    try { download(`${name}-${stamp()}.png`, dataUrlBlob(await GK.intakeUI.svgToPng(svg, w, hgt, 2))); }
    catch (e) { toast("PNG にできませんでした。SVG で保存してください", "err"); }
  }
  // 画像としてコピー（Google ドキュメント・スライドに Ctrl+V で貼れる）
  async function copyPng(svg, w, hgt) {
    try {
      const blob = dataUrlBlob(await GK.intakeUI.svgToPng(svg, w, hgt, 2));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("画像をコピーしました（Google ドキュメント・スライドに貼れます）");
    } catch (e) { toast("画像をコピーできませんでした。PNG で保存して貼ってください", "err"); }
  }
  let lastFig = null;
  function renderFlow() {
    const src = $("#flow-src").value;
    const r = drawFig(src, $("#fig-kind").value);
    lastFig = r;
    const msg = clear($("#flow-msg"));
    if (!src.trim()) { clear($("#flow-view")); return; }
    for (const e of r.errors) msg.append(h("li", { class: "err", text: `エラー　${e.line} 行目：${e.message}` }));
    for (const w of r.warnings) msg.append(h("li", { class: "warn", text: `警告　${w.line} 行目：${w.message}` }));
    if (!r.errors.length) msg.append(h("li", { class: "ok", text: `OK　${FIG_NAMES[r.kind]}：${r.ok}` }));
    const view = clear($("#flow-view"));
    if (r.svg && !r.errors.length) view.append(GK.preview.parseSvg(r.svg));
  }
  function initFlow() {
    $("#flow-src").addEventListener("input", debounce(renderFlow, 300));
    $("#fig-kind").addEventListener("change", renderFlow);
    const sample = (k) => () => { $("#fig-kind").value = "auto"; $("#flow-src").value = GK.SAMPLES[k]; renderFlow(); };
    $("#flow-sample").addEventListener("click", sample("flow"));
    $("#arch-sample").addEventListener("click", sample("arch"));
    $("#map-sample").addEventListener("click", sample("map"));
    const ready = () => (lastFig && lastFig.svg && !lastFig.errors.length ? true : (toast("先に記法を貼り、エラーを直してください", "err"), false));
    $("#flow-svg").addEventListener("click", () => { if (ready()) download(`${FIG_NAMES[lastFig.kind]}-${stamp()}.svg`, lastFig.svg, "image/svg+xml"); });
    $("#flow-png").addEventListener("click", () => { if (ready()) savePng(lastFig.svg, lastFig.w, lastFig.h, FIG_NAMES[lastFig.kind]); });
    $("#flow-copy").addEventListener("click", () => { if (ready()) copyPng(lastFig.svg, lastFig.w, lastFig.h); });
    renderFlow();
  }

  // ---------- WBS ----------
  let lastWbs = null;
  function renderWbs() {
    const src = $("#wbs-src").value;
    const msg = clear($("#wbs-msg"));
    const view = clear($("#wbs-view"));
    lastWbs = null;
    if (!src.trim()) { view.append(h("p", { class: "muted", text: "左に WBS の表を貼ると、ここにガント図が出ます。" })); return; }
    const res = GK.wbs.parse(src);
    for (const e of res.errors) msg.append(h("li", { class: "err", text: `エラー　${e.line} 行目：${e.message}` }));
    for (const w of res.warnings) msg.append(h("li", { class: "warn", text: `警告　${w.line} 行目：${w.message}` }));
    if (res.errors.length) return;
    const svg = GK.wbs.gantt(res);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    lastWbs = { res, svg, w: +doc.getAttribute("width"), h: +doc.getAttribute("height") };
    msg.append(h("li", { class: "ok", text: `OK　作業 ${res.tasks.filter((t) => t.leaf).length} 個・${GK.wbs.fromDay(res.start)} 〜 ${GK.wbs.fromDay(res.end)}・工数 計 ${res.totalHours}h・余裕のない作業 ${res.critical.length} 個（★）` }));
    view.append(GK.preview.parseSvg(svg));
  }
  function initWbs() {
    $("#wbs-src").addEventListener("input", debounce(renderWbs, 300));
    $("#wbs-sample").addEventListener("click", () => { $("#wbs-src").value = GK.SAMPLES.wbs; renderWbs(); });
    const ready = () => (lastWbs ? true : (toast("先に WBS の表を貼り、エラーを直してください", "err"), false));
    $("#wbs-xlsx").addEventListener("click", () => {
      if (!ready()) return;
      try {
        const bytes = GK.gexport.xlsx([GK.wbs.sheet(lastWbs.res)]);
        download(`WBS-${stamp()}.xlsx`, new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        toast("xlsx を保存しました。Excel で開くか、Drive にアップロードしてスプレッドシートで開けます");
      } catch (e) { toast("xlsx にできませんでした：" + e.message, "err"); }
    });
    // 表のコピーは日の列を除いた 9 列（計算した開始・終了・余裕を含む）
    $("#wbs-copy").addEventListener("click", () => { if (ready()) GK.intakeUI.exports.tableCopy(GK.wbs.sheet(lastWbs.res).rows.map((r) => r.slice(0, 9).map((c) => (c && typeof c === "object" ? c.v : c)))); });
    $("#wbs-png").addEventListener("click", () => { if (ready()) savePng(lastWbs.svg, lastWbs.w, lastWbs.h, "ガント図"); });
    renderWbs();
  }

  // ---------- 解説ページ ----------
  let lastExplain = null;
  function renderExplain() {
    const src = $("#explain-src").value;
    const msg = clear($("#explain-msg"));
    const view = clear($("#explain-view"));
    lastExplain = null;
    if (!src.trim()) { view.append(h("p", { class: "muted", style: "padding:12px 16px", text: "左に解説ページの JSON を貼ると、ここに出ます。" })); return; }
    const r = GK.explain.render(src);
    for (const e of r.errors) msg.append(h("li", { class: "err", text: `エラー　${e.message}` }));
    for (const w of r.warnings) msg.append(h("li", { class: "warn", text: `警告　${w.message}` }));
    if (r.errors.length) return;
    lastExplain = r;
    if (!r.warnings.length) msg.append(h("li", { class: "ok", text: `OK　節 ${r.data.sections.length} 個` }));
    // 保存する HTML と同じものを、スクリプトを動かさない iframe で見せる
    const fr = h("iframe", { title: "解説ページのプレビュー", sandbox: "" });
    fr.srcdoc = r.html;
    view.append(fr);
  }
  function initExplain() {
    $("#explain-src").addEventListener("input", debounce(renderExplain, 400));
    $("#explain-sample").addEventListener("click", () => { $("#explain-src").value = GK.SAMPLES.explain; renderExplain(); });
    $("#explain-save").addEventListener("click", () => {
      if (!lastExplain) { toast("先に JSON を貼り、エラーを直してください", "err"); return; }
      download(`${safe(lastExplain.data.title, "解説")}-${stamp()}.html`, lastExplain.html, "text/html;charset=utf-8");
      toast("HTML を保存しました。そのまま配れます（ダブルクリックで開けます）");
    });
    renderExplain();
  }

  // ---------- スライド ----------
  let lastLayout = null, lastDeck = null;
  function renderDeck() {
    const msg = clear($("#deck-msg"));
    const view = clear($("#deck-view"));
    const gc = clear($("#deck-gcheck"));
    const src = $("#deck-src").value;
    lastLayout = null;
    if (!src.trim()) return;
    const p = GK.slides.parseDeck(src);
    if (p.error) { msg.append(h("li", { class: "err", text: "エラー　" + p.error })); return; }
    const L = GK.slides.layoutDeck(p.deck);
    lastLayout = L; lastDeck = p.deck;
    for (const w of L.warnings) msg.append(h("li", { class: "warn", text: `警告　${w.slide} 枚目：${w.message}` }));
    if (!L.warnings.length) msg.append(h("li", { class: "ok", text: `OK　${L.pages.length} 枚。あふれ・はみ出しはありません` }));
    L.pages.forEach((page, i) => {
      const wrap = h("div", { class: "slide-wrap" }, GK.preview.slideDom(page, L));
      view.append(h("div", { class: "slide-cap", text: `${i + 1}. ${GK.slides.TYPE_LABEL[page.type] || page.type}` }), wrap);
    });
    fitSlides();
    for (const c of GK.gexport.slidesCheck(p.deck, L)) gc.append(h("li", { class: c.level === "warn" ? "warn" : "", text: `${c.slide ? `${c.slide} 枚目：` : ""}${c.message}` }));
  }
  function fitSlides() {
    document.querySelectorAll("#deck-view .slide-wrap").forEach((w) => {
      const k = w.clientWidth / 960;
      if (!k) return;
      w.firstChild.style.transform = `scale(${k})`;
      w.style.height = 540 * k + "px";
    });
  }
  function initDeck() {
    $("#deck-src").addEventListener("input", debounce(renderDeck, 500));
    $("#deck-sample").addEventListener("click", () => { $("#deck-src").value = GK.SAMPLES.deck; renderDeck(); });
    $("#deck-pptx").addEventListener("click", () => {
      if (!lastLayout) { toast("先に JSON を貼り、エラーを直してください", "err"); return; }
      try {
        const bytes = GK.pptx.build(lastLayout, { title: lastDeck.title, author: lastDeck.author });
        download(`${safe(lastDeck.title, "スライド")}-${stamp()}.pptx`, new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
      } catch (e) { toast("書き出しに失敗しました：" + e.message, "err"); }
    });
    $("#deck-gslides").addEventListener("click", () => {
      if (!lastLayout) { toast("先に JSON を貼り、エラーを直してください", "err"); return; }
      GK.intakeUI.exports.pptxGoogle(lastLayout, lastDeck);
    });
    window.addEventListener("resize", fitSlides);
    renderDeck();
  }

  // ---------- 表 ----------
  let tableRows = [];
  function renderTable() {
    const view = clear($("#table-view"));
    tableRows = GK.gexport.parseTable($("#table-src").value).rows;
    if (!tableRows.length) { view.append(h("p", { class: "muted", text: "左に表を貼ると、ここに出ます。" })); return; }
    const t = h("table", { class: "grid" }, h("tr", {}, tableRows[0].map((c) => h("th", { text: c }))));
    for (const r of tableRows.slice(1, 201)) t.append(h("tr", {}, tableRows[0].map((_, i) => h("td", { text: r[i] ?? "" }))));
    view.append(h("p", { class: "muted small", text: `${tableRows.length - 1} 行 × ${tableRows[0].length} 列${tableRows.length > 201 ? "（表示は先頭 200 行）" : ""}` }), h("div", { class: "tablewrap" }, t));
  }
  function initTable() {
    $("#table-src").addEventListener("input", debounce(renderTable, 300));
    const need = (fn) => () => (tableRows.length ? fn() : toast("先に表を貼ってください", "err"));
    $("#table-actions").append(
      h("button", { type: "button", class: "primary", text: "表をコピー（スプレッドシート・ドキュメント）", onclick: need(() => GK.intakeUI.exports.tableCopy(tableRows)) }),
      h("button", { type: "button", text: ".xlsx で保存", onclick: need(() => GK.intakeUI.exports.tableXlsx(tableRows, "表")) }),
      h("button", { type: "button", text: "TSV をコピー", onclick: need(() => copyText(GK.gexport.tsv(tableRows), "TSV")) }));
    renderTable();
  }

  // ---------- Gem 設定 ----------
  const itemById = (id) => GK.ITEMS.find((x) => x.id === id);
  function gemCard(it) {
    const kn = (it.knowledge || []).map((k) => itemById(k.id)).filter(Boolean);
    return h("section", { class: "gem-card", id: "gem-" + it.id },
      h("h3", { text: it.title }),
      it.usage ? h("p", { class: "small", text: it.usage }) : null,
      h("div", { class: "actions" },
        h("button", { type: "button", class: "primary", text: it.category === "Gem 指示文" ? "指示文をコピー" : "コピー", onclick: () => copyText(it.body) }),
        h("button", { type: "button", text: ".md で保存", onclick: () => download(`${safe(it.title, it.id)}.md`, it.body, "text/markdown;charset=utf-8") }),
        kn.length ? h("button", { type: "button", text: `知識ファイル ${kn.length} 個をまとめて保存`, onclick: () => kn.forEach((k, i) => setTimeout(() => download(`${safe(k.title, k.id)}.md`, k.body, "text/markdown;charset=utf-8"), i * 300)) }) : null),
      kn.length ? h("div", { class: "kn" }, h("span", { class: "small muted", text: "知識ファイル：" }), kn.map((k) => h("a", { href: "#gem-" + k.id, class: "small", text: k.title }))) : null,
      it.knowledgeNote ? h("p", { class: "small muted", text: it.knowledgeNote }) : null,
      h("details", {}, h("summary", { text: "全文を見る" }), h("pre", { text: it.body })));
  }
  function initGem() {
    const root = $("#gem-root");
    for (const cat of GK.CATEGORIES) {
      const list = GK.ITEMS.filter((x) => x.category === cat);
      if (!list.length) continue;
      root.append(h("h3", { text: cat === "Gem 指示文" ? "Gem の指示文" : `知識ファイル：${cat}` }), ...list.map(gemCard));
    }
  }
  function openItem(id) {
    gotoTab("gem");
    const n = document.getElementById("gem-" + id);
    if (n) { n.scrollIntoView({ block: "start" }); const d = n.querySelector("details"); if (d) d.open = true; }
  }

  // ---------- 使い方の図（7 段階） ----------
  const HELP_FLOW = [
    "title 司令塔 Gem の 7 段階",
    "lane 人",
    "lane 司令塔",
    "lane gemini-agent",
    "start S @人 やりたいことと資料を渡す",
    "task A @司令塔 1 受付：型を判定",
    "task B @司令塔 2 ヒヤリング：選択肢つきで最大 5 問",
    "task C @司令塔 3 仕様：背景・受入条件・非目標",
    "decision D @人 承認するか",
    "task E @司令塔 4 作成：ブロックで出す",
    "task F @gemini-agent 取り込み：図・文書・表に分けて書き出す",
    "task G @司令塔 5 自己点検とレビュー依頼",
    "task H @司令塔 6 修正",
    "end Z @人 7 仕上げ：Google へ渡す",
    "S -> A -> B -> C -> D",
    "D -> E : 承認",
    "D -> C : 直す",
    "E -> F -> G -> H -> Z",
  ].join("\n");
  function initHelp() {
    const r = GK.flow.render(HELP_FLOW, { theme: themeHash() });
    if (r.svg && !r.graph.errors.length) $("#help-flow").append(h("div", { class: "tablewrap" }, GK.preview.parseSvg(r.svg)));
  }

  // ---------- 配る：この HTML と Chrome 拡張（zip）を保存する（HTML で開いたときだけ。拡張のパネルでは出さない） ----------
  function initDownloads() {
    const box = $("#dl-box");
    if (!box || GK.runnerUI.EXT || !GK.PRISTINE_HTML) return;
    box.append(h("button", { type: "button", text: "この HTML を保存", title: "このツールを 1 ファイルで保存します。オフラインで開けます", onclick: () => {
      download("gemini-agent.html", GK.PRISTINE_HTML, "text/html;charset=utf-8");
      toast("gemini-agent.html を保存しました。ダブルクリックでオフラインで開けます");
    } }));
    if (GK.EXT_ZIP) {
      box.append(h("button", { type: "button", class: "primary", text: "Chrome 拡張をダウンロード", title: "サイドパネルで自動で進める拡張（zip）", onclick: () => {
        const bin = atob(GK.EXT_ZIP);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        download(`gemini-agent-extension-${GK.EXT_VERSION || ""}.zip`, new Blob([u8], { type: "application/zip" }));
        toast("zip を保存しました。展開して、chrome://extensions →「デベロッパー モード」→「パッケージ化されていない拡張機能を読み込む」で gemini-agent-extension フォルダを選んでください");
        gotoTab("help");
        const f = document.getElementById("help-ext");
        if (f) f.scrollIntoView({ block: "start" });
      } }));
    }
    box.hidden = false;
  }

  function start() {
    GK.intakeUI.init({
      toast, copyText, download, themeHash, parseSvg: GK.preview.parseSvg,
      gotoTab: (n) => gotoTab(n), openItem,
      openFlow: (src, kind) => { $("#fig-kind").value = kind || "auto"; $("#flow-src").value = src; renderFlow(); gotoTab("flow"); },
      openDeck: (src) => { $("#deck-src").value = src; renderDeck(); gotoTab("slides"); },
      openDoc: (md) => { $("#doc-src").value = md; renderDoc(); gotoTab("doc"); },
      openTable: (src) => { $("#table-src").value = src; renderTable(); gotoTab("table"); },
      openWbs: (src) => { $("#wbs-src").value = src; renderWbs(); gotoTab("wbs"); },
      openExplain: (src) => { $("#explain-src").value = src; renderExplain(); gotoTab("explain"); },
      drawFig, savePng, copyPng,
    });
    initDoc();
    initFlow();
    initDeck();
    initTable();
    initWbs();
    initExplain();
    initGem();
    initHelp();
    // エージェント（拡張のときだけ）。拡張でなければ、ここでタブごと消える（initTabs より前に呼ぶ）
    GK.runnerUI.init({ toast, drawFig, openIntake: (t) => { GK.intakeUI.load(t); gotoTab("intake"); } });
    // 会議・質問箱・監査（監査は拡張のときだけ。HTML のときは上でタブごと消えている）
    const tabCtx = { toast, copyText, download, gotoTab: (n) => gotoTab(n) };
    GK.meetUI.init(tabCtx);
    GK.qaUI.init(tabCtx);
    if (GK.auditUI) GK.auditUI.init(tabCtx);
    initDownloads();
    initTabs();
  }
  GK.app = { start, HELP_FLOW };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})(globalThis.GK = globalThis.GK || {});
