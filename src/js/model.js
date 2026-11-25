// 質問箱のデータ（db）の操作。DOM を使わない（テストで読む）。
// db = { version: 2, items: [Item] }。Item の形は .claude/specs/qa-box/design.md
(function (GK) {
  "use strict";

  // 2：prevAnswers（前の版の回答と表）を追加。1 は prevAnswers: [] で読む
  const VERSION = 2;
  const PREV_MAX = 3;
  // NotebookLM の入力欄に 1 回で貼れる字数（上限は 3000〜4000 字。安全側の下限）
  const INPUT_MAX = 3000;
  const P = () => GK.parse;
  // ブロックから入る項目（手で直したら貼り直しでは上書きしない）
  const BLOCK_FIELDS = ["project", "category", "status", "source", "reason", "date"];
  // 画面で直す項目
  const EDIT_FIELDS = [...BLOCK_FIELDS, "owner", "due", "memo", "question"];
  const LABEL = {
    project: "案件", category: "分類", status: "状態", source: "根拠", reason: "要確認の理由", date: "日付",
    owner: "担当", due: "期限", memo: "メモ", question: "質問", answer: "回答",
  };
  const HIST_MAX = 200;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const nowIso = (now) => (now ? new Date(now) : new Date()).toISOString();
  const today = (now) => nowIso(now).slice(0, 10);

  const empty = () => ({ version: VERSION, items: [] });

  function nextId(db, taken) {
    let max = 0;
    for (const it of db.items) { const m = it.id.match(/^Q-(\d+)$/); if (m) max = Math.max(max, +m[1]); }
    for (const id of taken || []) { const m = id.match(/^Q-(\d+)$/); if (m) max = Math.max(max, +m[1]); }
    return "Q-" + String(max + 1).padStart(3, "0");
  }
  const find = (db, id) => db.items.find((x) => x.id === id);

  function pushHist(item, at, field, from, to) {
    item.history.push({ at, field, from: from == null ? "" : String(from), to: to == null ? "" : String(to) });
    if (item.history.length > HIST_MAX) item.history.splice(0, item.history.length - HIST_MAX);
  }

  function newItem(id, b, opt, at) {
    const f = b.fields;
    return {
      id,
      project: f.project || opt.project || "", category: f.category || "", status: f.status,
      source: f.source || "", reason: f.reason || "", date: f.date || today(at),
      question: b.question, answer: b.answer, tables: clone(b.tables),
      owner: "", due: "", memo: "",
      edited: {}, history: [{ at, field: "取り込み", from: "", to: "新規" }],
      prevAnswers: [],
      createdAt: at, updatedAt: at,
    };
  }

  // 回答を書き換える直前に、今の回答と表を前の版として退避する（新しい順に PREV_MAX 版まで）
  function pushPrev(item, at) {
    if (!Array.isArray(item.prevAnswers)) item.prevAnswers = [];
    item.prevAnswers.unshift({ at: item.updatedAt || "", replacedAt: at, answer: item.answer, tables: clone(item.tables || []) });
    if (item.prevAnswers.length > PREV_MAX) item.prevAnswers.length = PREV_MAX;
  }

  // 表を貼り直す。k 番目の表どうしを行の key（1 列目）で突き合わせる。手で直した行の状態は残す。
  // 戻り値 { warnings, changed }（changed は履歴に足した数）
  function mergeTables(item, newTables, at) {
    const warnings = [];
    let changed = 0;
    const hist = (field, from, to) => { changed++; pushHist(item, at, field, from, to); };
    const oldTables = item.tables || [];
    const tables = clone(newTables);
    tables.forEach((t, k) => {
      const old = oldTables[k];
      if (!old) { if (oldTables.length) hist(`表${k + 1}`, "", "表を追加"); return; }
      const byKey = new Map(old.rows.map((r) => [r.key, r]));
      const keep = new Set();
      for (const r of t.rows) {
        const o = byKey.get(r.key);
        if (!o) { hist(`表${k + 1}「${r.key}」`, "", "行を追加"); continue; }
        keep.add(r.key);
        // 状態以外のセル：列名で突き合わせる（列名が新しい列は比べない）
        t.head.forEach((h, c) => {
          if (c === 0 || c === t.stateCol) return;
          const oc = old.head.indexOf(h);
          if (oc < 0 || oc === old.stateCol) return;
          const from = String(o.cells[oc] == null ? "" : o.cells[oc]).trim(), to = String(r.cells[c] == null ? "" : r.cells[c]).trim();
          if (from !== to) hist(`表${k + 1}「${r.key}」の${h}`, from, to);
        });
        if (t.stateCol < 0) continue;
        if (o.edited) { r.state = o.state; r.edited = true; r.cells[t.stateCol] = o.state; continue; }
        if (o.state !== r.state) hist(`表${k + 1}「${r.key}」の状態`, o.state, r.state);
      }
      const gone = old.rows.filter((r) => !keep.has(r.key));
      for (const r of gone) hist(`表${k + 1}「${r.key}」`, "行", "消えた");
      if (gone.length) warnings.push(`表${k + 1} から ${gone.length} 行が消えました（${gone.slice(0, 3).map((r) => r.key).join("、")}${gone.length > 3 ? " ほか" : ""}）`);
    });
    if (oldTables.length > tables.length) {
      warnings.push(`表が ${oldTables.length} から ${tables.length} に減りました`);
      for (let k = tables.length; k < oldTables.length; k++) hist(`表${k + 1}`, "表", "消えた");
    }
    item.tables = tables;
    return { warnings, changed };
  }

  // 既存の質問にブロックを重ねる（item を書き換える）。戻り値 { warnings, changed }
  function mergeInto(item, b, at) {
    const warnings = [];
    const kept = [];
    let changed = 0;
    const hist = (field, from, to) => { changed++; pushHist(item, at, field, from, to); };
    for (const k of BLOCK_FIELDS) {
      // 空欄は「分からない」なので前の値を残す。要確認の理由だけは、空欄で消す（確定になったとき）
      if (!(k in b.fields) || (b.fields[k] === "" && k !== "reason")) continue;
      const v = b.fields[k];
      if (item[k] === v) continue;
      if (item.edited && item.edited[k]) { kept.push(LABEL[k]); continue; }
      hist(LABEL[k], item[k], v);
      item[k] = v;
    }
    if (kept.length) warnings.push(`手で直した ${kept.join("・")} は残しました`);
    // 句読点・空白・全角半角だけの違いは同じ質問とみなし、元の文を残す
    if (P().qkey(item.question) !== P().qkey(b.question)) {
      warnings.push("質問文が前と違います。別の質問なら「新規として追加」にしてください");
      hist(LABEL.question, item.question, b.question);
      item.question = b.question;
    }
    if (item.answer !== b.answer) {
      pushPrev(item, at);
      hist(LABEL.answer, "", "回答を更新");
      item.answer = b.answer;
    }
    const t = mergeTables(item, b.tables, at);
    warnings.push(...t.warnings);
    changed += t.changed;
    if (changed) item.updatedAt = at;
    return { warnings, changed };
  }

  // 取り込みの計画。db は変えない。
  // entries[i] = { block, action, id, warnings, question?, matched? }
  //   action：new（新しく足す）／update（既存を更新）／dup（既存か貼った中に同じ質問があり、中身も同じ。取り込まない）
  //           ／same（ID 指定で中身が既存と同じ。取り込まない）
  //   matched：update と dup で、何で既存と突き合わせたか（id ／ question）
  function plan(db, text, opt = {}) {
    const res = P().read(text);
    const at = nowIso(opt.now);
    const taken = [];
    const seen = new Set();
    const byQ = new Map();
    for (const it of db.items) { const k = P().qkey(it.question); if (!byQ.has(k)) byQ.set(k, it.id); }
    const seenQ = new Map();
    const entries = res.ok.map((b) => {
      const warnings = b.warnings.slice();
      const qk = P().qkey(b.question);
      if (seenQ.has(qk)) {
        warnings.push(`同じ質問が貼った中に 2 回出てきたので、2 つ目は取り込みません（1 つ目：${seenQ.get(qk)}）`);
        return { block: b, action: "dup", id: seenQ.get(qk), warnings, matched: "paste" };
      }
      let id = b.id;
      if (id && seen.has(id)) { warnings.push(`${id} が貼った中で 2 回出てきたので、2 つ目は新しい番号にしました`); id = null; }
      if (id) seen.add(id);
      let cur = id && find(db, id);
      let matched = cur ? "id" : null;
      if (!cur && byQ.has(qk)) {
        cur = find(db, byQ.get(qk));
        matched = "question";
      }
      if (cur) {
        const r = mergeInto(clone(cur), b, at);
        seenQ.set(qk, cur.id);
        if (!r.changed) {
          return { block: b, action: matched === "question" ? "dup" : "same", id: cur.id, warnings: matched === "question" ? [`${cur.id} と同じ質問・同じ回答です`] : [], question: cur.question, matched };
        }
        if (matched === "question") warnings.unshift(`${id ? id + " は無いので、" : ""}同じ質問の ${cur.id} を更新します`);
        warnings.push(...r.warnings);
        return { block: b, action: "update", id: cur.id, warnings, question: cur.question, matched };
      }
      if (!id) { id = nextId(db, [...taken, ...seen]); }
      taken.push(id);
      seenQ.set(qk, id);
      return { block: b, action: "new", id, warnings };
    });
    return { entries, bad: res.bad };
  }

  // 計画を db に反映する。asNew は「新規として追加」に切り替えた entries の番号（update と dup で有効）
  function apply(db, pl, opt = {}) {
    const at = nowIso(opt.now);
    const asNew = new Set(opt.asNew || []);
    const done = { added: [], updated: [], skipped: [] };
    const taken = [];
    pl.entries.forEach((e, i) => {
      const toNew = asNew.has(i) && (e.action === "update" || e.action === "dup");
      if (e.action === "same" || (e.action === "dup" && !toNew)) { done.skipped.push(e.id); return; }
      const cur = e.action === "update" && !toNew && find(db, e.id);
      if (cur) {
        if (mergeInto(cur, e.block, at).changed) done.updated.push(cur.id);
        else done.skipped.push(cur.id);
        return;
      }
      let id = e.action === "new" && !find(db, e.id) ? e.id : nextId(db, taken);
      taken.push(id);
      db.items.push(newItem(id, e.block, opt, at));
      done.added.push(id);
    });
    return done;
  }

  // ---------- 画面での編集 ----------
  function edit(db, id, field, value, opt = {}) {
    const it = find(db, id);
    if (!it || !EDIT_FIELDS.includes(field)) return false;
    let v = String(value == null ? "" : value);
    if (field === "status") v = P().normState(v).state;
    if (it[field] === v) return false;
    const at = nowIso(opt.now);
    pushHist(it, at, LABEL[field], it[field], v);
    it[field] = v;
    if (BLOCK_FIELDS.includes(field)) it.edited[field] = true;
    it.updatedAt = at;
    return true;
  }

  // 回答を画面で直したとき：表を読み直し、手で直した行の状態は残す
  function editAnswer(db, id, answer, opt = {}) {
    const it = find(db, id);
    if (!it || it.answer === answer) return null;
    const at = nowIso(opt.now);
    const warnings = [];
    const tables = P().readTables(answer, warnings);
    pushPrev(it, at);
    pushHist(it, at, LABEL.answer, "", "回答を編集");
    it.answer = answer;
    warnings.push(...mergeTables(it, tables, at).warnings);
    it.updatedAt = at;
    return warnings;
  }

  function editRow(db, id, t, key, state, opt = {}) {
    const it = find(db, id);
    const tb = it && it.tables[t];
    const r = tb && tb.stateCol >= 0 && tb.rows.find((x) => x.key === key);
    if (!r) return false;
    const v = P().normState(state).state;
    if (r.state === v) return false;
    const at = nowIso(opt.now);
    pushHist(it, at, `表${t + 1}「${key}」の状態`, r.state, v);
    r.state = v;
    r.edited = true;
    r.cells[tb.stateCol] = v;
    it.updatedAt = at;
    return true;
  }

  function remove(db, id) {
    const i = db.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    db.items.splice(i, 1);
    return true;
  }

  // ---------- 検索・絞り込み ----------
  const textOf = (it) => [it.id, it.project, it.category, it.status, it.source, it.reason, it.question, it.answer, it.owner, it.memo].join("\n");
  const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();
  const isOverdue = (it, day) => !!it.due && it.due < day && it.status !== "確定";
  // 根拠の欄を、ソース名ごとに分ける
  const sourcesOf = (s) => String(s || "").split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean);
  const sources = (db) => [...new Set(db.items.flatMap((x) => sourcesOf(x.source)))].sort((a, b) => a.localeCompare(b, "ja"));
  // 同じ質問（qkey が同じ）が 2 件以上ある、その qkey の集合
  function dupKeys(db) {
    const n = new Map();
    for (const it of db.items) { const k = P().qkey(it.question); n.set(k, (n.get(k) || 0) + 1); }
    return new Set([...n].filter(([, c]) => c > 1).map(([k]) => k));
  }

  // f = { text, status, project, category, owner, source, dup, overdue, sort, today }
  function filter(db, f = {}) {
    const words = norm(f.text).split(/\s+/).filter(Boolean);
    const day = f.today || today();
    const dups = f.dup ? dupKeys(db) : null;
    const list = db.items.filter((it) => {
      if (f.status && it.status !== f.status) return false;
      if (f.project && it.project !== f.project) return false;
      if (f.category && it.category !== f.category) return false;
      if (f.owner && it.owner !== f.owner) return false;
      if (f.source && !sourcesOf(it.source).includes(f.source)) return false;
      if (dups && !dups.has(P().qkey(it.question))) return false;
      if (f.overdue && !isOverdue(it, day)) return false;
      if (words.length) { const t = norm(textOf(it)); if (!words.every((w) => t.includes(w))) return false; }
      return true;
    });
    const order = { 要確認: 0, 提案: 1, 対応中: 2, 未確定: 3, 確定: 4 };
    const by = {
      id: (a, b) => a.id.localeCompare(b.id),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      due: (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.id.localeCompare(b.id),
      status: (a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id),
    }[f.sort || "id"];
    // 重複の疑いは、同じ質問どうしを隣に並べる
    if (dups) return list.sort((a, b) => P().qkey(a.question).localeCompare(P().qkey(b.question)) || by(a, b));
    return list.sort(by);
  }

  // 全質問の表の行（状態の列がある表だけ）
  function rows(db) {
    const out = [];
    for (const it of db.items) {
      it.tables.forEach((t, k) => {
        if (t.stateCol < 0) return;
        for (const r of t.rows) out.push({ id: it.id, project: it.project, table: k, head: t.head, stateCol: t.stateCol, key: r.key, state: r.state, cells: r.cells, edited: r.edited });
      });
    }
    return out;
  }
  function filterRows(list, f = {}) {
    const words = norm(f.text).split(/\s+/).filter(Boolean);
    return list.filter((r) => {
      if (f.status && r.state !== f.status) return false;
      if (f.project && r.project !== f.project) return false;
      if (words.length) { const t = norm([r.id, r.project, ...r.cells].join("\n")); if (!words.every((w) => t.includes(w))) return false; }
      return true;
    });
  }

  function counts(list, get) {
    const c = Object.fromEntries(P().STATES.map((s) => [s, 0]));
    for (const x of list) c[get(x)] = (c[get(x)] || 0) + 1;
    return c;
  }
  const values = (db, k) => [...new Set(db.items.map((x) => x[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));

  // ---------- 書き出し ----------
  const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = (rowsArr) => "\uFEFF" + rowsArr.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const ITEM_COLS = ["ID", "案件", "分類", "質問", "回答", "状態", "根拠ソース", "要確認の理由", "担当", "期限", "日付", "メモ", "更新日時"];
  function itemsCsv(items) {
    return csv([ITEM_COLS, ...items.map((it) => [it.id, it.project, it.category, it.question, it.answer, it.status, it.source, it.reason, it.owner, it.due, it.date, it.memo, it.updatedAt])]);
  }
  function rowsCsv(list) {
    return csv([["ID", "案件", "表", "項目", "状態", "内容"], ...list.map((r) => [r.id, r.project, "表" + (r.table + 1), r.key, r.state, r.head.map((h, c) => (c === 0 || c === r.stateCol ? null : `${h}: ${r.cells[c] || ""}`)).filter(Boolean).join(" / ")])]);
  }
  // スプレッドシートにそのまま貼れるタブ区切り。セルの中のタブと改行は空白にする
  function tableTsv(t) {
    const cell = (s) => String(s == null ? "" : s).replace(/\*\*|`/g, "").replace(/<br\s*\/?>/gi, " ").replace(/[\t\r\n]+/g, " ");
    return [t.head, ...t.rows.map((r) => r.cells)].map((r) => r.map(cell).join("\t")).join("\n") + "\n";
  }

  function toJson(db, opt = {}) {
    return JSON.stringify({ app: "qa-box", version: VERSION, exportedAt: nowIso(opt.now), items: db.items }, null, 2);
  }
  // AI に渡す用の JSON。控え（toJson）と違い、履歴・手で直した印・作成日時は入れず、空の値は省く。
  // 表の行は列名をキーにした形にする。読み込み（fromJson）では読めない
  const STATE_NOTE = {
    確定: "ソースに明記されていて、決まっている",
    未確定: "ソースに案や候補はあるが、決まっていない",
    提案: "ソースに決まりも案も無く、NotebookLM が考えた案",
    対応中: "誰かが調べている・作っている",
    要確認: "ソースに書かれていない、またはソースどうしが食い違う",
  };
  function aiTable(t) {
    // 同じ列名が 2 つあればキーに番号を付ける
    const seen = {};
    const keys = t.head.map((h, c) => {
      const k = String(h || "").trim() || `列${c + 1}`;
      seen[k] = (seen[k] || 0) + 1;
      return seen[k] > 1 ? `${k}(${seen[k]})` : k;
    });
    return {
      columns: keys,
      hasState: t.stateCol >= 0,
      rows: t.rows.map((r) => {
        const o = Object.fromEntries(keys.map((k, c) => [k, r.cells[c] == null ? "" : r.cells[c]]));
        if (t.stateCol >= 0) o[keys[t.stateCol]] = r.state;
        return o;
      }),
    };
  }
  function aiItem(it) {
    const o = { id: it.id };
    const put = (k, v) => { if (v != null && v !== "") o[k] = v; };
    put("project", it.project); put("category", it.category); put("status", it.status);
    put("question", it.question); put("answer", it.answer);
    put("source", it.source); put("reason", it.reason);
    put("owner", it.owner); put("due", it.due); put("memo", it.memo);
    put("date", it.date); put("updatedAt", it.updatedAt);
    if (it.tables && it.tables.length) o.tables = it.tables.map(aiTable);
    return o;
  }
  function toAiJson(items, opt = {}) {
    const c = counts(items, (x) => x.status);
    return JSON.stringify({
      format: "qa-box.ai.v1",
      about: "NotebookLM に聞いた質問と回答。status は質問全体の状態、tables[].rows の「状態」は表の行ごとの状態。answer は Markdown",
      exportedAt: nowIso(opt.now),
      states: STATE_NOTE,
      counts: Object.fromEntries(Object.entries(c).filter(([, n]) => n)),
      fields: { project: "案件", category: "分類", status: "状態", source: "根拠", reason: "要確認の理由", owner: "担当", due: "期限", memo: "メモ", date: "日付" },
      items: items.map(aiItem),
    }, null, 2);
  }

  // 読み込み。形が違えば Error
  function fromJson(text) {
    let d;
    try { d = JSON.parse(String(text).replace(/^\uFEFF/, "")); } catch (e) { throw new Error("JSON として読めません"); }
    if (!d || d.app !== "qa-box" || !Array.isArray(d.items)) throw new Error("質問箱の書き出しファイルではありません");
    if (d.version > VERSION) throw new Error(`新しい版（version ${d.version}）のファイルです。質問箱の HTML を新しくしてください`);
    const ids = new Set();
    const items = d.items.map((x, i) => {
      if (!x || typeof x.id !== "string" || typeof x.question !== "string") throw new Error(`${i + 1} 件目の形が違います`);
      if (ids.has(x.id)) throw new Error(`${x.id} が 2 回あります`);
      ids.add(x.id);
      const it = Object.assign({ project: "", category: "", status: "要確認", source: "", reason: "", date: "", answer: "", tables: [], owner: "", due: "", memo: "", edited: {}, history: [], prevAnswers: [], createdAt: "", updatedAt: "" }, x);
      it.status = P().normState(it.status).state;
      if (!Array.isArray(it.prevAnswers)) it.prevAnswers = []; // version 1 には無い
      return it;
    });
    return { version: VERSION, items };
  }

  // ---------- 聞き直す ----------
  const reaskBlock = (it) => `## ${it.id}\n### 質問\n${it.question}\n`;
  // NotebookLM に聞き直す文
  function reaskText(it) {
    return `次の質問に、指定の形式で答え直してください。見出しは「## ${it.id}」のままにしてください。\n\n${reaskBlock(it)}`;
  }
  const cut = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
  function reaskCompose(list) {
    const notes = list.map((it) => `- ${it.id}：前回 ${it.status}${it.reason ? `（${cut(it.reason, 40)}）` : ""}`);
    return "次の質問に、指定の形式で答え直してください。見出しは「## Q-012」のような番号をそのまま使ってください。\n\n"
      + "前回の状態：\n" + notes.join("\n") + "\n\n" + list.map(reaskBlock).join("\n");
  }
  // 複数の質問をまとめて聞き直す文。1 通 max 字以内に、質問の切れ目で分ける。
  // 戻り値 { parts: [文], warnings: [文] }。1 件で max を超える質問は単独の 1 通にして警告する
  function reaskManyText(items, max = INPUT_MAX) {
    const parts = [], warnings = [];
    let cur = [];
    for (const it of items) {
      if (reaskCompose([it]).length > max) {
        if (cur.length) { parts.push(reaskCompose(cur)); cur = []; }
        parts.push(reaskCompose([it]));
        warnings.push(`${it.id} は 1 件で ${max} 字を超えています。質問文を短くしてください`);
        continue;
      }
      if (cur.length && reaskCompose([...cur, it]).length > max) { parts.push(reaskCompose(cur)); cur = []; }
      cur.push(it);
    }
    if (cur.length) parts.push(reaskCompose(cur));
    return { parts, warnings };
  }

  // ---------- 前の版との差分 ----------
  // 行単位の差分（LCS）。[{ op: "same"|"add"|"del", text }]
  function diffLines(a, b) {
    const x = String(a || "").split("\n"), y = String(b || "").split("\n");
    const m = x.length, n = y.length;
    if (m * n > 1e6) return [...x.map((text) => ({ op: "del", text })), ...y.map((text) => ({ op: "add", text }))];
    const L = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (x[i] === y[j]) { out.push({ op: "same", text: x[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "del", text: x[i++] });
      else out.push({ op: "add", text: y[j++] });
    }
    while (i < m) out.push({ op: "del", text: x[i++] });
    while (j < n) out.push({ op: "add", text: y[j++] });
    return out;
  }
  // 表の差分。k 番目どうしを行の key で突き合わせ、列は列名で突き合わせる。
  // [{ k, head, rows: [{ key, op: "same"|"add"|"del"|"chg", cells: [{ head, from, to, changed }] }] }]
  function diffTables(oldTables, newTables) {
    const out = [];
    const n = Math.max((oldTables || []).length, (newTables || []).length);
    const val = (r, t, h) => { const c = t.head.indexOf(h); if (c < 0) return ""; return String(c === t.stateCol ? r.state : (r.cells[c] == null ? "" : r.cells[c])).trim(); };
    for (let k = 0; k < n; k++) {
      const o = oldTables[k] || { head: [], stateCol: -1, rows: [] };
      const t = newTables[k] || { head: [], stateCol: -1, rows: [] };
      const head = [...t.head, ...o.head.filter((h) => !t.head.includes(h))];
      const oldBy = new Map(o.rows.map((r) => [r.key, r]));
      const rowsOut = [];
      for (const r of t.rows) {
        const or = oldBy.get(r.key);
        const cells = head.map((h) => { const from = or ? val(or, o, h) : "", to = val(r, t, h); return { head: h, from, to, changed: !!or && from !== to }; });
        rowsOut.push({ key: r.key, op: !or ? "add" : cells.some((c) => c.changed) ? "chg" : "same", cells });
        oldBy.delete(r.key);
      }
      for (const or of oldBy.values()) rowsOut.push({ key: or.key, op: "del", cells: head.map((h) => ({ head: h, from: val(or, o, h), to: "", changed: false })) });
      out.push({ k, head, rows: rowsOut });
    }
    return out;
  }

  GK.model = { VERSION, INPUT_MAX, PREV_MAX, LABEL, EDIT_FIELDS, empty, nextId, find, plan, apply, edit, editAnswer, editRow, remove, filter, rows, filterRows, counts, values, sources, sourcesOf, dupKeys, isOverdue, itemsCsv, rowsCsv, tableTsv, toJson, toAiJson, fromJson, reaskText, reaskManyText, diffLines, diffTables, today };
})(globalThis.GK = globalThis.GK || {});
