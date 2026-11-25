// 会議タブ。Meet の字幕を記録して文字起こしにし（拡張のとき）、文字起こしから議事録を作る。
//  - 記録：content-meet.js が貯めた字幕を 2 秒ごとに取りに行き、meetlog.js で発言に確定させる。止めると 資料/議事録/ に保存
//  - 取り込み：VTT・Teams・Meet の文字起こし・「話者：本文」のファイルや貼り付けも使える（clean.js が読む）
//  - 議事録：minutes.js が分けた依頼文を Gemini のタブに送り（拡張）、議事録・案件メモ・宿題を保存して案件メモに反映する
//    HTML のときは依頼文をコピーし、応答を貼って保存する
(function (GK) {
  "use strict";

  const el = (...a) => GK.dom.el(...a);
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const A = () => GK.agent;
  const ML = () => GK.meetlog, MI = () => GK.minutes;
  let ctx = null, root = null;
  const U = {};
  const S = { rec: null, timer: null, tabId: null, transcript: "", title: "", source: "", last: null };
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const safe = (s) => GK.runner.safeName(s || "会議") || "会議";
  function say(text, kind) { if (U.msg) { U.msg.textContent = text; U.msg.className = `status ${kind || ""}`; } if (kind === "err" && ctx) ctx.toast(text, "err"); }
  const NOTICE = "この会議は、議事録づくりのために字幕を記録しています（音声は録音していません）。記録してほしくない発言があれば、お知らせください。";

  // ---------- 記録（拡張） ----------
  async function start() {
    const ag = A();
    const tab = await ag.findTab("meet");
    if (!tab) { say("Meet の会議のタブがありません", "err"); return; }
    if (!(await ag.ensureContent(tab.id, "meet"))) { say("Meet の画面とつながりません（タブを再読み込みしてください）", "err"); return; }
    const r = await chrome.tabs.sendMessage(tab.id, { to: "meet", op: "start" });
    S.tabId = tab.id;
    S.title = U.title.value.trim() || (tab.title || "会議").replace(/^Meet\s*[-–]\s*/, "");
    S.rec = ML().create(r.started || Date.now());
    S.timer = setInterval(pull, 2000);
    ag.hold("meet", true); // 記録中は案件フォルダを替えさせない
    ag.setState("meet", `会議「${S.title}」を記録中`);
    await ag.audit({ actor: "人", action: "会議の記録の開始", where: ag.hostOf(tab.url), note: r.captions ? "字幕あり" : "字幕が見つからない" });
    say(r.captions ? "記録を始めました。Meet の字幕を出したままにしてください" : "記録を始めましたが、字幕が見つかりません。Meet で字幕（CC）をオンにしてください", r.captions ? "ok" : "warn");
    renderRec();
  }
  function feed(snapshots) { for (const s of snapshots || []) ML().update(S.rec, s.items, s.t); }
  async function pull() {
    if (!S.rec) return;
    try {
      const r = await chrome.tabs.sendMessage(S.tabId, { to: "meet", op: "pull" });
      feed(r.snapshots);
      ML().tick(S.rec, Date.now());
      // Meet のタブが再読み込みされると、画面の側の記録が止まる。始め直して、知らせる
      if (r.recording === false) {
        await chrome.tabs.sendMessage(S.tabId, { to: "meet", op: "start" });
        say("Meet のタブが読み込み直されたので、記録を始め直しました（その間の発言は抜けている可能性があります）", "warn");
        await A().audit({ actor: "拡張", action: "会議の記録の再開", note: "タブの再読み込み" });
      }
      renderRec(r.captions);
    } catch (e) { say("Meet のタブとつながりません（閉じられた可能性）。止めて保存してください", "warn"); }
  }
  async function stop() {
    if (!S.rec) return;
    clearInterval(S.timer); S.timer = null;
    try { const r = await chrome.tabs.sendMessage(S.tabId, { to: "meet", op: "stop" }); feed(r.snapshots); } catch (e) { /* 取れた分で保存する */ }
    ML().finish(S.rec, Date.now());
    const text = ML().transcript(S.rec, { title: S.title });
    const n = S.rec.lines.length;
    S.rec = null;
    A().setState("idle", "");
    A().hold("meet", false);
    await useTranscript(text, S.title, "Meet の字幕");
    const saved = await saveFile("文字起こし", text, "md");
    await A().audit({ actor: "人", action: "会議の記録の終了", target: saved || "", sha256: await GK.audit.sha256(text), chars: text.length, note: `発言 ${n} 件` });
    say(`記録を止めました。発言 ${n} 件${saved ? `を ${saved} に保存しました` : ""}。「議事録を作る」で議事録にできます`, "ok");
    renderRec();
  }
  function renderRec(captions) {
    if (!U.rec) return;
    clear(U.rec);
    if (!S.rec) { U.rec.append(el("span", { class: "small muted", text: "記録していません" })); U.start.disabled = false; U.stop.disabled = true; return; }
    U.start.disabled = true; U.stop.disabled = false;
    const min = Math.floor((Date.now() - S.rec.start) / 60000);
    U.rec.append(el("span", { class: "ag-rec", text: "● 記録中" }), el("span", { class: "small", text: `${min} 分・発言 ${S.rec.lines.length} 件・話者 ${[...S.rec.speakers].join("、") || "なし"}${captions === false ? "・字幕が見えません" : ""}` }));
  }

  // ---------- 文字起こしの用意（記録・ファイル・貼り付け） ----------
  async function useTranscript(text, title, source) {
    S.transcript = text; S.title = title || S.title || "会議"; S.source = source;
    const prep = MI().prepare(text);
    S.prep = prep;
    clear(U.prep).append(el("p", { class: "small", text: `文字起こし：${source}・形式「${prep.format}」・発言 ${prep.stats.list.reduce((a, s) => a + s.count, 0)} 件${prep.unparsed ? `・読めない行 ${prep.unparsed}` : ""}・送る回数 ${prep.parts.length > 1 ? `${prep.parts.length + 1}（分けて要約してからまとめる）` : 1}` }),
      prep.stats.md ? el("div", { class: "md" }, GK.md.render(prep.stats.md)) : null);
    U.title.value = S.title;
  }
  async function readFile(f) {
    const name = f.name || "";
    const u8 = new Uint8Array(await f.arrayBuffer());
    if (/\.docx$/i.test(name)) return GK.runner.docxText(await GK.xlsx.entryText(GK.xlsx.entries(u8), "word/document.xml"));
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^\uFEFF/, ""); } catch (e) { return new TextDecoder("shift_jis").decode(u8); }
  }
  async function saveFile(kind, data, ext) {
    if (!(A() && A().fs)) return "";
    const segs = await A().uniquePath(["資料", "議事録", `${stamp()}_${safe(S.title)}_${kind}.${ext}`]);
    await A().fs.write(segs, data);
    return segs.join("/");
  }

  // ---------- 議事録 ----------
  async function makeMinutes() {
    if (!S.prep || !S.prep.parts.length) { say("先に文字起こしを用意してください（記録・ファイル・貼り付け）", "err"); return; }
    const ag = A();
    // エージェントの実行中は送らない（同じ Gemini の会話に議事録の依頼が混ざり、応答を取り違えるため）
    if (ag.running) { say("エージェントの実行中です。終わってから（または止めてから）議事録を作ってください", "err"); return; }
    const rq = MI().requests(S.prep, { title: U.title.value.trim() || S.title });
    let tab = null;
    try { tab = await ag.findCaseTab("gemini"); } catch (e) { say(e.message, "err"); return; }
    if (!tab || !(await ag.ensureContent(tab.id, "gemini"))) { say("Gemini のタブ（議事録 Gem か司令塔 Gem）を開いてください", "err"); return; }
    const notes = [];
    let reply = "";
    try {
      for (let i = 0; i < rq.length; i++) {
        ag.setState("gen", `議事録を作っています（${i + 1}/${rq.length}）`);
        await ag.record("送信", "拡張", rq[i].text, { where: ag.hostOf(tab.url), note: `議事録 ${i + 1}/${rq.length}` });
        const t0 = Date.now();
        reply = await ag.askTab(tab.id, "gemini", rq[i].text, 300000);
        await ag.record("受信", "Gemini", reply, { where: ag.hostOf(tab.url), ms: Date.now() - t0, note: `議事録 ${i + 1}/${rq.length}` });
        if (rq[i].kind === "part") notes.push(reply);
      }
    } catch (e) { ag.setState("idle", ""); say("議事録づくりで止まりました：" + e.message, "err"); return; }
    ag.setState("idle", "");
    await finish(reply);
  }
  // まとめの応答 → 保存（md・docx・宿題 xlsx）と案件メモへの反映
  async function finish(reply) {
    const r = MI().assemble(reply, S.prep, { title: U.title.value.trim() || S.title });
    S.last = r;
    clear(U.result);
    if (r.missing.length) U.result.append(el("p", { class: "warn", text: `応答に足りないもの：${r.missing.join("・")}（Gemini に「議事録の形で、議事録・memo・table の 3 つを返してください」と送り直してください）` }));
    if (!r.md) return;
    const saved = [];
    if (A() && A().fs) {
      saved.push(await saveFile("議事録", r.md, "md"));
      saved.push(await saveFile("議事録", GK.gexport.docx(r.md, { title: r.title }), "docx"));
      if (r.table) { const rows = GK.gexport.parseTable(r.table).rows; if (rows.length) saved.push(await saveFile("宿題", GK.gexport.xlsx([{ name: "宿題", rows }]), "xlsx")); }
      for (const s of saved.filter(Boolean)) await A().audit({ actor: "拡張", action: "保存", target: s, note: "議事録" });
      if (r.memo) { const m = await A().mergeMemo(r.memo, "議事録から", true); U.result.append(el("p", { class: "ok small", text: `案件メモに反映：追加 ${m.added}・更新 ${m.updated}・回答済 ${m.answered}` })); }
    }
    const open = GK.note.parseMemo(r.memo).filter((x) => x.coll === "questions" && !x.answered).map((x) => x.text);
    U.result.append(
      saved.length ? el("p", { class: "ok small", text: `保存しました：${saved.filter(Boolean).join("、")}` }) : null,
      el("div", { class: "actions" },
        ...GK.intakeUI.docButtons(() => r.md, () => r.title),
        r.table ? el("button", { type: "button", text: "宿題を .xlsx で保存", onclick: () => GK.intakeUI.exports.tableXlsx(GK.gexport.parseTable(r.table).rows, "宿題") }) : null,
        open.length ? el("button", { type: "button", text: `未決・確認事項 ${open.length} 件を質問箱へ`, onclick: () => { GK.qaUI.addQuestions(open); ctx.gotoTab("qa"); } }) : null),
      el("details", { open: true }, el("summary", { text: "議事録" }), el("div", { class: "md" }, GK.md.render(r.md))));
    say("議事録を作りました", "ok");
  }

  function build() {
    const ext = !!A();
    U.title = el("input", { type: "text", placeholder: "会議名（例：第3回 定例）", "aria-label": "会議名" });
    U.rec = el("div", { class: "actions" });
    U.start = el("button", { type: "button", class: "primary", text: "記録を始める", onclick: start });
    U.stop = el("button", { type: "button", text: "止めて保存", disabled: true, onclick: stop });
    U.prep = el("div");
    U.result = el("div");
    U.msg = el("div", { class: "status", role: "status" });
    U.paste = el("textarea", { rows: 6, class: "mono", placeholder: "文字起こし（VTT・Teams・Meet・「話者：本文」）を貼る", "aria-label": "文字起こし" });
    U.reply = el("textarea", { rows: 6, class: "mono", placeholder: "Gemini の議事録の応答（まとめ）を貼る", "aria-label": "議事録の応答" });
    U.parts = el("div");
    const file = el("input", { type: "file", accept: ".vtt,.txt,.md,.docx,.srt", hidden: true });
    file.addEventListener("change", async () => { const f = file.files[0]; file.value = ""; if (!f) return; await useTranscript(await readFile(f), f.name.replace(/\.[^.]+$/, ""), `ファイル ${f.name}`); say(`${f.name} を読みました`, "ok"); });
    root.append(
      el("h2", { text: "会議（文字起こし → 議事録）" }),
      el("p", { class: "muted small", text: "Meet の字幕を記録するか、文字起こしのファイルを読んで、決まった形の議事録（決定・宿題・未決・話題と時刻・発言者ごとの要約・次回の議題と確認事項）を作ります。発言の量はこのツールが数えます。" }),
      el("div", { class: "actions" }, U.title),
      ext ? el("div", { class: "fig" }, el("h3", { text: "Meet の字幕を記録する" }),
        el("p", { class: "small muted", text: "Meet で字幕（CC）をオンにしてから始めます。音声は録音しません。パネルを開いたままにしてください。記録してよいか、参加者に先に伝えてください。" }),
        el("div", { class: "actions" }, U.start, U.stop, el("button", { type: "button", text: "告知文をコピー", onclick: () => ctx.copyText(NOTICE, "告知文") })), U.rec) : null,
      el("div", { class: "fig" }, el("h3", { text: "文字起こしを読む（ファイル・貼り付け）" }),
        el("div", { class: "actions" }, el("button", { type: "button", text: "ファイルを開く（VTT・txt・docx）", onclick: () => file.click() }), file,
          el("button", { type: "button", text: "サンプル（ダミー）", onclick: () => useTranscript(GK.SAMPLES.meeting, "定例（ダミー）", "サンプル") })),
        U.paste, el("div", { class: "actions" }, el("button", { type: "button", text: "貼った文字起こしを使う", onclick: () => { if (U.paste.value.trim()) useTranscript(U.paste.value, U.title.value.trim() || "会議", "貼り付け"); } }))),
      U.prep,
      el("div", { class: "fig" }, el("h3", { text: "議事録を作る" }),
        el("p", { class: "small muted", text: "Gemini で「議事録 Gem」（Gem 設定タブ）を開いておきます。長い会議は分けて要約してからまとめます。" }),
        el("div", { class: "actions" },
          ext ? el("button", { type: "button", class: "primary", text: "議事録を作る（Gemini に送って保存）", onclick: makeMinutes }) : null,
          el("button", { type: "button", text: "依頼文を作る（コピー用）", onclick: () => {
            if (!S.prep) { say("先に文字起こしを用意してください", "err"); return; }
            const rq = MI().requests(S.prep, { title: U.title.value.trim() || S.title });
            clear(U.parts).append(...rq.map((r, i) => el("div", { class: "actions" }, el("span", { class: "small", text: `${i + 1}/${rq.length} 通目（${r.kind === "part" ? "部分" : "まとめ"}・${r.text.length} 字）` }), el("button", { type: "button", text: "コピー", onclick: () => ctx.copyText(r.text, `${i + 1} 通目`) }))));
          } })),
        U.parts,
        el("details", {}, el("summary", { text: "応答を貼って議事録にする（手で）" }), U.reply, el("div", { class: "actions" }, el("button", { type: "button", class: "primary", text: "議事録にする", onclick: () => { if (U.reply.value.trim()) finish(U.reply.value); } })))),
      U.msg, U.result);
    renderRec();
  }

  function init(c) {
    ctx = c;
    root = document.getElementById("meet-root");
    if (!root || root.firstChild) return;
    build();
  }

  GK.meetUI = { init, useTranscript, finish, get state() { return S; }, start, stop, makeMinutes };
})(globalThis.GK = globalThis.GK || {});
