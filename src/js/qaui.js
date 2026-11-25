// 質問箱タブ。qa-box の部品（GK.parse・GK.model）で、NotebookLM の質問と回答を状態つきで管理する。
// 拡張のとき：質問を NotebookLM のタブに送り、回答を回収して取り込む（新しい質問は自動、更新は差分を見て選ぶ）。保存は案件フォルダの case/qa.json
// HTML のとき：送る文をコピーし、回答を貼って取り込む（今の qa-box.html と同じ使い方）。保存はこのブラウザ（IndexedDB）
(function (GK) {
  "use strict";

  const el = (...a) => GK.dom.el(...a);
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const M = () => GK.model, QF = () => GK.qaflow;
  const A = () => GK.agent; // 拡張のときだけある
  const STATES = ["確定", "未確定", "提案", "対応中", "要確認"];
  let ctx = null, root = null, db = null, pending = [], where = "";
  const U = {};
  const sel = new Set();

  // ---------- 保存 ----------
  // 保存するのは拡張で案件フォルダを選んだときだけ（case/qa.json）。HTML 版とフォルダを選ぶ前は、この画面の中だけで持つ
  // （ブラウザの保存領域に機密の Q&A を残さない。残したいときは「控え（JSON）を保存」）
  const useFolder = () => !!(A() && A().fs);
  async function load() {
    db = M().empty();
    if (useFolder()) {
      where = `案件フォルダ（${A().fs.name}/case/qa.json）`;
      if (await A().fs.exists(["case", "qa.json"])) {
        const raw = await A().fs.read(["case", "qa.json"]);
        try { db = M().fromJson(A().decodeText(raw)); }
        catch (e) {
          // 読めないときは、空で上書きする前に元のファイルを退避する
          const bk = ["case", "_控え", `qa.json.${stamp()}-${Date.now() % 100000}`];
          await A().fs.write(bk, raw);
          say(`case/qa.json を読めませんでした（${e.message}）。元のファイルを ${bk.join("/")} に退避し、空の質問箱で始めます`, "err");
        }
      }
    } else {
      where = "保存しません（タブを閉じると消えます）。残すときは「書き出し・控え」の「控え（JSON）を保存」。拡張で案件フォルダを選ぶと case/qa.json に保存します";
    }
    pending = []; sel.clear();
    render();
  }
  async function save() {
    if (useFolder()) await A().fs.write(["case", "qa.json"], M().toJson(db) + "\n");
  }
  const audit = (ev) => (A() ? A().audit(Object.assign({ actor: "拡張" }, ev)) : Promise.resolve());

  // ---------- 取り込み（新規は自動・更新は保留） ----------
  async function importReply(text, how) {
    const t = QF().triage(db, text);
    const done = QF().applyNew(db, t);
    // 確かめる更新は足していく（次の取り込みで前の分を捨てない）
    if (t.updates.length) pending.push(t);
    await save();
    const msg = `取り込み：新規 ${done.added.length} 件${done.added.length ? `（${done.added.join("・")}）` : ""}・確かめる更新 ${t.updates.length} 件・同じ/重複 ${t.quiet.length} 件${t.bad.length ? `・読めないブロック ${t.bad.length} 件` : ""}`;
    say(msg, t.bad.length ? "warn" : "ok");
    await audit({ action: "質問箱の取り込み", note: `${how || ""} 新規 ${done.added.length}・更新待ち ${t.updates.length}・見送り ${t.quiet.length}・読めない ${t.bad.length}` });
    if (t.bad.length) U.bad = t.bad;
    render();
    return { added: done.added, updates: t.updates.length, bad: t.bad.length };
  }
  // choices：{ "取り込みの番号:entry の番号": "apply" | "new" | "skip" }。古い取り込みから順に入れる
  async function decide(choices) {
    if (!pending.length) return;
    const d = { updated: [], added: [], skipped: [] };
    pending.forEach((t, k) => {
      const c = {};
      for (const i of t.updates) c[i] = choices[`${k}:${i}`] || "skip";
      const r = QF().applyChosen(db, t, c);
      d.updated.push(...r.updated); d.added.push(...r.added); d.skipped.push(...r.skipped.filter((id) => t.updates.some((i) => t.plan.entries[i].id === id)));
    });
    pending = [];
    await save();
    await audit({ action: "質問箱の更新の反映", note: `反映 ${d.updated.length}・新規 ${d.added.length}・見送り ${d.skipped.length}` });
    say(`更新を反映しました：反映 ${d.updated.length}・新規として追加 ${d.added.length}・見送り ${d.skipped.length}`, "ok");
    render();
  }

  // ---------- NotebookLM に送る（拡張） ----------
  async function sendToNlm(parts, label) {
    const ag = A();
    let tab = null;
    try { tab = await ag.findCaseTab("notebooklm"); } catch (e) { say(e.message, "err"); return null; }
    if (!tab) { say("NotebookLM のノートブックを開いたタブがありません（案件の設定.md に URL を書くと、自動で開きます）", "err"); return null; }
    // sent：最後の通まで送って取り込めたか（入力欄を消してよいかの判断に使う）
    const res = { added: [], updates: 0, bad: 0, sent: false };
    ag.hold("qa", true); // 送っている間は案件フォルダを替えさせない
    try {
      for (let i = 0; i < parts.length; i++) {
        ag.setState("qa", `NotebookLM に質問しています（${i + 1}/${parts.length}）`);
        await ag.record("送信", "拡張", parts[i], { where: ag.hostOf(tab.url), note: `質問箱 ${label} ${i + 1}/${parts.length}` });
        const t0 = Date.now();
        const reply = await ag.askTab(tab.id, "notebooklm", parts[i], 240000);
        await ag.record("受信", "NotebookLM", reply, { where: ag.hostOf(tab.url), ms: Date.now() - t0, note: `質問箱 ${label}` });
        const r = await importReply(reply, label);
        res.added.push(...r.added); res.updates += r.updates; res.bad += r.bad;
      }
      res.sent = true;
    } catch (e) { say("NotebookLM とのやり取りで止まりました：" + e.message, "err"); }
    finally { ag.setState("idle", ""); ag.hold("qa", false); }
    return res;
  }
  function promptPrefix() {
    const it = GK.ITEMS.find((x) => x.id === "qa-prompt");
    return A() && A().settings.qaPromptPrefix && it ? it.body : "";
  }

  // ---------- 画面 ----------
  function say(text, kind) { if (U.msg) { U.msg.textContent = text; U.msg.className = `status ${kind || ""}`; } if (kind === "err" && ctx) ctx.toast(text, "err"); }

  function build() {
    U.q = el("textarea", { rows: 5, placeholder: "質問（1 行に 1 問。複数行の質問は空行で区切る）", "aria-label": "質問" });
    U.parts = el("div");
    U.paste = el("textarea", { rows: 6, class: "mono", placeholder: "NotebookLM の回答（```markdown のブロック）を貼る", "aria-label": "回答" });
    U.msg = el("div", { class: "status", role: "status" });
    U.where = el("p", { class: "muted small" });
    U.pending = el("div");
    U.filter = { status: el("select", { "aria-label": "状態で絞る" }, el("option", { value: "", text: "すべての状態" }), STATES.map((s) => el("option", { value: s, text: s }))), text: el("input", { type: "search", placeholder: "言葉で探す", "aria-label": "言葉で探す" }) };
    U.filter.status.addEventListener("change", renderList);
    U.filter.text.addEventListener("input", renderList);
    U.list = el("div", { class: "tablewrap" });
    U.detail = el("div");
    const ext = !!A();
    const file = el("input", { type: "file", accept: ".json", hidden: true });
    file.addEventListener("change", async () => {
      const f = file.files[0]; file.value = "";
      if (!f) return;
      try {
        const inc = M().fromJson(await f.text());
        const have = new Set(db.items.map((x) => x.id));
        const add = inc.items.filter((x) => !have.has(x.id));
        db.items.push(...add);
        await save();
        say(`qa-box の控えから ${add.length} 件を読み込みました（同じ ID の ${inc.items.length - add.length} 件は今のものを残しました）`, "ok");
        await audit({ action: "質問箱の読み込み", note: `qa-box の控え ${add.length} 件` });
        render();
      } catch (e) { say(e.message, "err"); }
    });
    root.append(
      el("h2", { text: "質問箱（NotebookLM）" }),
      el("p", { class: "muted small", text: "NotebookLM の質問と回答を、状態（確定・未確定・提案・対応中・要確認）つきで管理します。回答の形の指示は Gem 設定タブの「質問箱の回答の形」を NotebookLM のチャットの設定に入れてください。" }),
      U.where,
      el("div", { class: "qa-ask" },
        U.q,
        el("div", { class: "actions" },
          ext ? el("button", { type: "button", class: "primary", text: "NotebookLM に聞く（回答を自動で取り込む）", onclick: () => ask(U.q.value) }) : null,
          el("button", { type: "button", text: "送る文を作る（コピー用）", onclick: () => {
            const qs = QF().questions(U.q.value);
            if (!qs.length) { ctx.toast("質問を入れてください", "err"); return; }
            const c = QF().compose(qs, { prompt: promptPrefix() });
            showParts(c.parts, c.warnings);
          } }))),
      U.parts,
      el("details", { class: "qa-paste" }, el("summary", { text: "回答を貼って取り込む（手で）" }), U.paste,
        el("div", { class: "actions" }, el("button", { type: "button", class: "primary", text: "取り込む", onclick: async () => { if (!U.paste.value.trim()) return; await importReply(U.paste.value, "貼り付け"); U.paste.value = ""; } }))),
      U.msg, U.pending,
      el("div", { class: "actions qa-filter" }, U.filter.status, U.filter.text),
      el("div", { class: "actions" },
        ext ? el("button", { type: "button", text: "選んだものを NotebookLM に聞き直す", onclick: () => reask() }) : null,
        el("button", { type: "button", text: "聞き直しの文をコピー", onclick: () => { const items = chosen(); if (!items.length) { ctx.toast("聞き直す質問を選んでください", "err"); return; } const r = M().reaskManyText(items); showParts(r.parts, r.warnings); } }),
        ext ? el("button", { type: "button", text: "選んだものを案件メモに反映", onclick: toNote }) : null,
        el("button", { type: "button", text: "要確認・未確定・提案を選ぶ", onclick: () => { sel.clear(); db.items.filter((x) => ["要確認", "未確定", "提案"].includes(x.status)).forEach((x) => sel.add(x.id)); renderList(); } })),
      U.list, U.detail,
      el("details", {}, el("summary", { text: "書き出し・控え" }),
        el("div", { class: "actions" },
          el("button", { type: "button", text: "表をコピー（スプレッドシート）", onclick: () => GK.intakeUI.exports.tableCopy(tableRows()) }),
          el("button", { type: "button", text: ".xlsx で保存", onclick: () => GK.intakeUI.exports.tableXlsx(tableRows(), "質問箱") }),
          el("button", { type: "button", text: "CSV で保存", onclick: () => ctx.download(`質問箱-${stamp()}.csv`, "\uFEFF" + M().itemsCsv(view()), "text/csv;charset=utf-8") }),
          el("button", { type: "button", text: "確定した Q&A を NotebookLM 用 .md に", onclick: notebookMd }),
          el("button", { type: "button", text: "控え（JSON）を保存", onclick: () => ctx.download(`質問箱-${stamp()}.json`, M().toJson(db), "application/json") }),
          el("button", { type: "button", text: "qa-box の控え（JSON）を読み込む", onclick: () => file.click() }), file)));
  }
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const view = () => M().filter(db, { status: U.filter.status.value, text: U.filter.text.value, sort: "id" });
  const chosen = () => db.items.filter((x) => sel.has(x.id));
  const tableRows = () => [["ID", "状態", "分類", "質問", "回答", "根拠", "要確認の理由", "担当", "期限", "更新"], ...view().map((x) => [x.id, x.status, x.category, x.question, String(x.answer || "").replace(/\s+/g, " ").slice(0, 300), x.source, x.reason, x.owner, x.due, String(x.updatedAt || "").slice(0, 10)])];

  function showParts(parts, warnings) {
    clear(U.parts);
    (warnings || []).forEach((w) => U.parts.append(el("p", { class: "warn small", text: w })));
    parts.forEach((p, i) => U.parts.append(el("div", { class: "actions" }, el("span", { class: "small", text: `${i + 1}/${parts.length} 通目（${p.length} 字）` }), el("button", { type: "button", text: "コピー", onclick: () => ctx.copyText(p, `${i + 1} 通目`) }))));
  }
  // 質問を NotebookLM に送って取り込む（ボタンと同じ。テストからも呼ぶ）
  async function ask(text) {
    const qs = QF().questions(text);
    if (!qs.length) { ctx.toast("質問を入れてください", "err"); return null; }
    const c = QF().compose(qs, { prompt: promptPrefix() });
    c.warnings.forEach((w) => say(w, "warn"));
    const r = await sendToNlm(c.parts, `新しい質問 ${qs.length} 件`);
    // 最後まで送れて、全部読めたときだけ消す（失敗したら残して送り直せるように）
    if (r && r.sent && !r.bad && U.q.value === text) U.q.value = "";
    return r;
  }
  async function reask(ids) {
    if (Array.isArray(ids)) { sel.clear(); ids.forEach((x) => sel.add(x)); }
    const items = chosen();
    if (!items.length) { ctx.toast("聞き直す質問を選んでください", "err"); return; }
    const r = M().reaskManyText(items);
    const pre = promptPrefix();
    await sendToNlm(pre ? r.parts.map((p) => `${pre.trim()}\n\n---\n\n${p}`) : r.parts, `聞き直し ${items.length} 件`);
  }
  async function toNote() {
    if (!A().fs) { say("案件フォルダを選んでください（エージェントタブ）", "err"); return; }
    const ids = [...sel];
    if (!ids.length) { ctx.toast("反映する質問を選んでください", "err"); return; }
    const memo = QF().toMemo(db, ids, A().note);
    if (!memo) { say("選んだ質問は、もう案件メモに入っています", "warn"); return; }
    const r = await A().mergeMemo(memo, "質問箱から");
    say(`案件メモに反映しました（追加 ${r.added} 件）`, "ok");
  }
  async function notebookMd() {
    const md = GK.gexport.notebookMd(QF().confirmedMd(db, A() && A().note ? A().note.name : ""), { title: "確定した質問と回答", kind: "確定した Q&A" });
    if (useFolder()) { await A().fs.write(["case", "NotebookLM用_確定QA.md"], md); await audit({ action: "保存", target: "case/NotebookLM用_確定QA.md", chars: md.length }); say("case/NotebookLM用_確定QA.md に保存しました。NotebookLM のソースに入れ直してください", "ok"); }
    else ctx.download(`確定QA_NotebookLM用-${stamp()}.md`, md, "text/markdown;charset=utf-8");
  }

  function renderPending() {
    clear(U.pending);
    if (!pending.length) return;
    const choices = {};
    const total = pending.reduce((s, t) => s + t.updates.length, 0);
    const box = el("div", { class: "ag-gate" }, el("p", { class: "ag-gate-h", text: `既にある質問の回答が変わりました（${total} 件）。差分を見て選んでください` }));
    pending.forEach((t, k) => { for (const i of t.updates) {
      const e = t.plan.entries[i];
      const cur = M().find(db, e.id);
      const key = `${k}:${i}`;
      choices[key] = "apply";
      const diff = M().diffLines(cur ? cur.answer : "", e.block.answer).filter((d) => d.op !== "same").slice(0, 30);
      const pick = el("select", { "aria-label": `${e.id} をどうするか` }, [["apply", "反映する"], ["new", "新規として追加"], ["skip", "見送る"]].map(([v, tx]) => el("option", { value: v, text: tx })));
      pick.addEventListener("change", () => { choices[key] = pick.value; });
      box.append(el("div", { class: "qa-upd" },
        el("div", { class: "actions" }, el("b", { text: e.id }), el("span", { text: e.question || e.block.question }), el("span", { class: "ik-chip", text: `${cur ? cur.status : "?"} → ${e.block.fields.status || "?"}` }), pick),
        el("pre", { class: "qa-diff" }, diff.map((d) => el("span", { class: d.op === "add" ? "qa-add" : "qa-del", text: `${d.op === "add" ? "+ " : "- "}${d.text}\n` }))),
        e.warnings && e.warnings.length ? el("p", { class: "small warn", text: e.warnings.join("／") }) : null));
    } });
    box.append(el("div", { class: "actions" }, el("button", { type: "button", class: "primary", text: "選んだとおりに入れる", onclick: () => decide(choices) }), el("button", { type: "button", text: "全部見送る", onclick: () => { pending = []; render(); } })));
    U.pending.append(box);
  }

  function renderList() {
    const list = view();
    clear(U.list);
    const counts = M().counts(db.items, (x) => x.status);
    const t = el("table", { class: "grid qa-table" },
      el("tr", {}, el("th", { text: "" }), ["ID", "状態", "分類", "質問", "回答", "根拠", "更新"].map((h) => el("th", { text: h }))));
    for (const it of list) {
      const cb = el("input", { type: "checkbox", "aria-label": `${it.id} を選ぶ` });
      cb.checked = sel.has(it.id);
      cb.addEventListener("change", () => { cb.checked ? sel.add(it.id) : sel.delete(it.id); });
      const st = el("select", { "aria-label": `${it.id} の状態`, class: `qa-st qa-st-${it.status}` }, STATES.map((s) => el("option", { value: s, text: s, selected: s === it.status })));
      st.addEventListener("change", async () => { M().edit(db, it.id, "status", st.value); await save(); await audit({ actor: "人", action: "質問箱の編集", target: it.id, note: `状態 → ${st.value}` }); renderList(); });
      t.append(el("tr", {},
        el("td", {}, cb), el("td", {}, el("button", { type: "button", class: "linklike", text: it.id, onclick: () => showDetail(it.id) })), el("td", {}, st),
        el("td", { text: it.category || "" }), el("td", { text: it.question }), el("td", { text: String(it.answer || "").replace(/\s+/g, " ").slice(0, 60) }),
        el("td", { text: it.source || "" }), el("td", { text: String(it.updatedAt || "").slice(0, 10) })));
    }
    U.list.append(el("p", { class: "small muted", text: `${list.length} 件を表示（全 ${db.items.length} 件：${STATES.map((s) => `${s} ${counts[s] || 0}`).join("・")}）` }), t);
  }
  function showDetail(id) {
    const it = M().find(db, id);
    clear(U.detail);
    if (!it) return;
    U.detail.append(el("div", { class: "fig" },
      el("h3", { text: `${it.id}　${it.question}` }),
      el("p", { class: "small muted", text: `状態：${it.status}${it.reason ? `（${it.reason}）` : ""}・根拠：${it.source || "なし"}・前の版 ${(it.prevAnswers || []).length} 件` }),
      el("div", { class: "md" }, GK.md.render(String(it.answer || "")))));
    U.detail.scrollIntoView({ block: "nearest" });
  }
  function render() {
    if (!root) return;
    U.where.textContent = `保存先：${where}`;
    renderPending();
    renderList();
  }

  async function init(c) {
    ctx = c;
    root = document.getElementById("qa-root");
    if (!root || root.firstChild) return;
    build();
    await load();
    if (A()) A().onFolder(load);
  }

  // エージェントの ask_notebooklm の回答が質問箱の形なら入れる・議事録の未決を質問にする口
  GK.qaUI = {
    init, load, importReply, ask, reask, get pending() { return pending; },
    get db() { return db; },
    addQuestions: (qs) => { if (!U.q) return; U.q.value = [U.q.value.trim(), ...qs].filter(Boolean).join("\n"); say(`${qs.length} 件の質問を入れました。「NotebookLM に聞く」で送れます`, "ok"); },
    decide,
  };
})(globalThis.GK = globalThis.GK || {});
