// WBS（```wbs または WBS の見出しの表）→ 日程の計算・クリティカルパス → ガント図 SVG・xlsx の行。
// 見出し：| ID | 階層 | 作業 | 成果物 | 工数(h) | 依存 | 担当 | 開始 | 終了 |（司令塔 Gem の指示文と同じ。列の順は問わない）
// 日程：開始・終了が書いてあればそれを使う。無ければ、依存の終わった翌営業日から、工数 8h = 1 日で引く（土日は休み。祝日は数えない）
(function (GK) {
  "use strict";

  const D = GK.diagram;
  const COLS = { id: /^ID$/i, level: /^階層$/, name: /^(作業|タスク|作業名)$/, deliverable: /^成果物$/, hours: /^工数/, deps: /^(依存|先行)/, owner: /^(担当|担当者)$/, start: /^開始/, end: /^(終了|完了)/ };
  const isWbsHeader = (head) => ["id", "name", "hours"].every((k) => head.some((c) => COLS[k].test(String(c).trim())));

  // ---------- 日付（yyyy-mm-dd・UTC で数える） ----------
  const toDay = (s) => { const m = String(s || "").match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; };
  const fromDay = (d) => { const t = new Date(d * 86400000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`; };
  const isOff = (d) => { const w = new Date(d * 86400000).getUTCDay(); return w === 0 || w === 6; };
  const nextWork = (d) => { while (isOff(d)) d++; return d; };
  const addWork = (d, n) => { d = nextWork(d); for (let i = 1; i < n; i++) d = nextWork(d + 1); return d; }; // n 営業日目の日
  const workDays = (a, b) => { let n = 0; for (let d = a; d <= b; d++) if (!isOff(d)) n++; return n; };

  function parse(text, opts) {
    const o = opts || {};
    const res = { tasks: [], ...D.issues() };
    const rows = GK.gexport.parseTable(String(text ?? "").replace(/^\s*```\w*\s*\n|\n\s*```\s*$/g, "")).rows;
    if (!rows.length) { res.errors.push({ line: 1, message: "表がありません" }); return res; }
    const head = rows[0].map((c) => String(c).trim());
    if (!isWbsHeader(head)) { res.errors.push({ line: 1, message: "WBS の見出し（ID・作業・工数(h) を含む）がありません" }); return res; }
    const col = {};
    for (const [k, re] of Object.entries(COLS)) col[k] = head.findIndex((c) => re.test(c));
    const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? "").trim() : "");
    const ids = new Set();
    rows.slice(1).forEach((r, i) => {
      const line = i + 3; // 見出しと区切りの次
      const id = get(r, "id");
      if (!id) { res.warnings.push({ line, message: "ID の無い行は飛ばしました" }); return; }
      if (ids.has(id)) { res.errors.push({ line, message: `ID「${id}」が重複しています` }); return; }
      ids.add(id);
      const hoursRaw = get(r, "hours").replace(/,/g, "");
      const hours = hoursRaw === "" ? null : Number(hoursRaw);
      if (hoursRaw !== "" && !(hours >= 0)) res.warnings.push({ line, message: `${id} の工数「${hoursRaw}」は数ではありません` });
      const lv = Number(get(r, "level"));
      const t = {
        id, name: get(r, "name"), deliverable: get(r, "deliverable"), owner: get(r, "owner"),
        level: lv >= 1 ? lv : id.split(".").length, hours: hours >= 0 ? hours : null,
        deps: get(r, "deps").split(/[,、\s]+/).filter(Boolean), start: toDay(get(r, "start")), end: toDay(get(r, "end")), line,
      };
      if (get(r, "start") && t.start == null) res.warnings.push({ line, message: `${id} の開始「${get(r, "start")}」は yyyy-mm-dd ではありません` });
      if (get(r, "end") && t.end == null) res.warnings.push({ line, message: `${id} の終了「${get(r, "end")}」は yyyy-mm-dd ではありません` });
      res.tasks.push(t);
    });
    const byId = new Map(res.tasks.map((t) => [t.id, t]));
    // 親子：ID の「.」で決める（1.2 の親は 1）。最下層の作業だけが日程と工数を持つ
    for (const t of res.tasks) {
      const pid = t.id.includes(".") ? t.id.slice(0, t.id.lastIndexOf(".")) : null;
      t.parent = pid && byId.has(pid) ? pid : null;
    }
    for (const t of res.tasks) t.leaf = !res.tasks.some((c) => c.parent === t.id);
    for (const t of res.tasks) {
      t.deps = t.deps.filter((d) => { if (byId.has(d)) return true; res.warnings.push({ line: t.line, message: `${t.id} の依存「${d}」がありません` }); return false; });
      if (t.leaf && t.hours > 80) res.warnings.push({ line: t.line, message: `${t.id} は ${t.hours}h です。80h を超える作業は分けてください` });
      if (t.leaf && t.hours != null && t.hours > 0 && t.hours < 8 && !t.start) res.warnings.push({ line: t.line, message: `${t.id} は ${t.hours}h です。8h 未満の作業はまとめると管理しやすくなります` });
    }
    // 依存の循環
    const state = new Map();
    const cyc = (t, path) => {
      if (state.get(t.id) === 2) return false;
      if (state.get(t.id) === 1) { res.errors.push({ line: t.line, message: `依存が循環しています：${[...path, t.id].join(" → ")}` }); return true; }
      state.set(t.id, 1);
      for (const d of t.deps) if (cyc(byId.get(d), [...path, t.id])) return true;
      state.set(t.id, 2);
      return false;
    };
    for (const t of res.tasks) if (cyc(t, [])) break;
    if (!res.errors.length) schedule(res, o);
    return res;
  }

  // 日程と余裕（クリティカルパス）。依存は親に書いてあれば子全部に効く
  function schedule(res, o) {
    const byId = new Map(res.tasks.map((t) => [t.id, t]));
    const leaves = res.tasks.filter((t) => t.leaf);
    const ancestors = (t) => { const a = []; let p = t.parent; while (p) { a.push(byId.get(p)); p = byId.get(p).parent; } return a; };
    const leavesOf = (t) => (t.leaf ? [t] : res.tasks.filter((c) => c.parent === t.id).flatMap(leavesOf));
    const depsOf = (t) => [...new Set([t, ...ancestors(t)].flatMap((x) => x.deps).flatMap((d) => leavesOf(byId.get(d))))];
    const given = leaves.map((t) => t.start).filter((d) => d != null);
    const base = nextWork(given.length ? Math.min(...given) : (o.start != null ? toDay(o.start) : Math.floor(Date.now() / 86400000) + 1));
    for (const t of leaves) t.dur = t.start != null && t.end != null ? Math.max(1, workDays(t.start, t.end)) : Math.max(1, Math.ceil((t.hours || 8) / 8));
    // 前から：書いてある日付を優先し、無ければ依存の後
    const done = new Set();
    const calc = (t) => {
      if (done.has(t.id)) return;
      const ds = depsOf(t);
      ds.forEach(calc);
      if (t.start == null) t.start = ds.length ? nextWork(Math.max(...ds.map((d) => d.end)) + 1) : base;
      if (t.end == null) t.end = addWork(t.start, t.dur);
      if (t.end < t.start) { res.warnings.push({ line: t.line, message: `${t.id} の終了が開始より前です` }); t.end = t.start; }
      for (const d of ds) if (d.end >= t.start) res.warnings.push({ line: t.line, message: `${t.id} は依存 ${d.id} の終了（${fromDay(d.end)}）より前に始まります` });
      done.add(t.id);
    };
    leaves.forEach(calc);
    // 後ろから：遅くとも終える日（LF）。余裕 = LF - 終了（営業日）
    const projEnd = Math.max(...leaves.map((t) => t.end));
    const succ = (t) => leaves.filter((s) => depsOf(s).includes(t));
    const prevWork = (d) => { d--; while (isOff(d)) d--; return d; };
    const lf = new Map();
    const late = (t) => { // 遅くとも終える日 = 後続のうち最も早い「遅くとも始める日」の前の営業日
      if (lf.has(t.id)) return lf.get(t.id);
      let v = projEnd;
      for (const s of succ(t)) {
        let ls = late(s);
        for (let k = 1; k < s.dur; k++) ls = prevWork(ls);
        v = Math.min(v, prevWork(ls));
      }
      lf.set(t.id, v);
      return v;
    };
    for (const t of leaves) { t.slack = Math.max(0, workDays(t.end + 1, late(t))); t.critical = t.slack === 0; }
    // 親：子の最初と最後・工数の合計
    for (const t of [...res.tasks].reverse()) {
      if (t.leaf) continue;
      const ls = leavesOf(t);
      t.start = Math.min(...ls.map((x) => x.start));
      t.end = Math.max(...ls.map((x) => x.end));
      if (t.hours == null) t.hours = ls.reduce((s, x) => s + (x.hours || 0), 0);
      t.critical = ls.some((x) => x.critical);
    }
    res.start = Math.min(...res.tasks.map((t) => t.start));
    res.end = projEnd;
    res.totalHours = leaves.reduce((s, t) => s + (t.hours || 0), 0);
    res.critical = leaves.filter((t) => t.critical).map((t) => t.id);
  }

  // ---------- ガント図 ----------
  function gantt(res, opts) {
    const C = D.C;
    const tasks = res.tasks;
    const days = res.end - res.start + 1;
    const LEFT = 300, RIGHT_PAD = 16, ROW = 26, HEAD = 58;
    const dayW = Math.max(10, Math.min(30, ((opts && opts.width) || 1100 - LEFT) / days));
    const W = LEFT + days * dayW + RIGHT_PAD, H = HEAD + tasks.length * ROW + 40;
    const x = (d) => LEFT + (d - res.start) * dayW;
    const out = [];
    out.push(`<text x="12" y="18" font-size="14" font-weight="bold" fill="${C.navy}" dominant-baseline="central">${D.esc((opts && opts.title) || "WBS・日程")}</text>`);
    out.push(`<text x="12" y="38" font-size="11" fill="${C.sub}" dominant-baseline="central">${D.esc(`${fromDay(res.start)} 〜 ${fromDay(res.end)}（${workDays(res.start, res.end)} 営業日）・工数 計 ${res.totalHours}h`)}</text>`);
    // 日の目盛り（土日は網掛け）。日付は月初と月曜だけ書く
    for (let d = res.start; d <= res.end; d++) {
      const dt = new Date(d * 86400000);
      if (isOff(d)) out.push(`<rect x="${D.r1(x(d))}" y="${HEAD - 14}" width="${D.r1(dayW)}" height="${tasks.length * ROW + 14}" fill="${C.light}"/>`);
      if (dt.getUTCDay() === 1 || d === res.start || dt.getUTCDate() === 1) out.push(`<text x="${D.r1(x(d) + 2)}" y="${HEAD - 7}" font-size="9" fill="${C.sub}" dominant-baseline="central">${dt.getUTCMonth() + 1}/${dt.getUTCDate()}</text>`, `<line x1="${D.r1(x(d))}" y1="${HEAD - 14}" x2="${D.r1(x(d))}" y2="${HEAD + tasks.length * ROW}" stroke="${C.line}" stroke-width="0.6"/>`);
    }
    tasks.forEach((t, i) => {
      const y = HEAD + i * ROW;
      if (i % 2) out.push(`<rect x="0" y="${y}" width="${LEFT}" height="${ROW}" fill="${C.alt}"/>`);
      const indent = (t.level - 1) * 12;
      const label = D.wrap(`${t.id}　${t.name}`, LEFT - 70 - indent, 11, 1)[0];
      out.push(`<text x="${10 + indent}" y="${y + ROW / 2}" font-size="11" fill="${C.ink}"${t.leaf ? "" : ' font-weight="bold"'} dominant-baseline="central">${D.esc(label)}</text>`);
      out.push(`<text x="${LEFT - 8}" y="${y + ROW / 2}" font-size="10" fill="${C.sub}" text-anchor="end" dominant-baseline="central">${D.esc(t.owner || "")}</text>`);
      const bx = x(t.start), bw = (t.end - t.start + 1) * dayW;
      if (t.leaf) {
        out.push(`<rect x="${D.r1(bx + 1)}" y="${y + 6}" width="${D.r1(Math.max(3, bw - 2))}" height="${ROW - 12}" rx="3" fill="${t.critical ? C.gold : C.navy}"${t.critical ? ` stroke="#6E4B00" stroke-width="1.2"` : ""}/>`);
        if (t.critical) out.push(`<text x="${D.r1(bx + bw + 3)}" y="${y + ROW / 2}" font-size="10" fill="#6E4B00" dominant-baseline="central">★</text>`);
      } else {
        out.push(`<path d="M${D.r1(bx)},${y + 8} h${D.r1(bw)} v8 l-5,-4 h${D.r1(-(bw - 10))} l-5,4 z" fill="${C.navy}" opacity="0.75"/>`);
      }
    });
    // 依存の矢印（最下層どうし）
    const byId = new Map(tasks.map((t, i) => [t.id, { t, i }]));
    for (const { t, i } of byId.values()) for (const d of t.deps) {
      const p = byId.get(d);
      if (!p || !t.leaf || !p.t.leaf) continue;
      const x1 = x(p.t.end + 1) - 1, y1 = HEAD + p.i * ROW + ROW / 2, x2 = x(t.start) + 1, y2 = HEAD + i * ROW + ROW / 2;
      out.push(`<path d="M${D.r1(x1)},${D.r1(y1)} h4 V${D.r1(y2)} H${D.r1(x2)}" fill="none" stroke="${C.sub}" stroke-width="0.9" marker-end="url(#dg-arr)"/>`);
    }
    const ly = HEAD + tasks.length * ROW + 22;
    out.push(`<rect x="12" y="${ly - 6}" width="22" height="12" rx="2" fill="${C.navy}"/><text x="40" y="${ly}" font-size="10.5" fill="${C.ink}" dominant-baseline="central">作業</text>`);
    out.push(`<rect x="90" y="${ly - 6}" width="22" height="12" rx="2" fill="${C.gold}" stroke="#6E4B00"/><text x="118" y="${ly}" font-size="10.5" fill="${C.ink}" dominant-baseline="central">★ 余裕のない作業（遅れると全体が遅れる）</text>`);
    out.push(`<rect x="370" y="${ly - 6}" width="22" height="12" fill="${C.light}"/><text x="398" y="${ly}" font-size="10.5" fill="${C.ink}" dominant-baseline="central">土日</text>`);
    return D.svgDoc(W, H, out.join(""), (opts && opts.title) || "WBS");
  }

  // ---------- xlsx（表＋日ごとのセルを塗ったガント） ----------
  function sheet(res) {
    const head = ["ID", "作業", "成果物", "工数(h)", "依存", "担当", "開始", "終了", "余裕(日)"];
    const dayCols = [];
    for (let d = res.start; d <= res.end; d++) dayCols.push(d);
    const top = [...head, ...dayCols.map((d) => { const t = new Date(d * 86400000); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; })];
    const rows = [top];
    for (const t of res.tasks) {
      const base = [t.id, `${"　".repeat(t.level - 1)}${t.name}`, t.deliverable, t.hours == null ? "" : String(t.hours), t.deps.join(", "), t.owner, fromDay(t.start), fromDay(t.end), t.leaf ? String(t.slack) : ""];
      rows.push([...base, ...dayCols.map((d) => ({ v: "", style: d >= t.start && d <= t.end && !isOff(d) ? (t.leaf ? (t.critical ? "crit" : "bar") : "parent") : isOff(d) ? "off" : "" }))]);
    }
    const widths = [8, 30, 16, 8, 8, 10, 11, 11, 8, ...dayCols.map(() => 3.2)];
    return { name: "WBS", rows, widths, freeze: { row: 1, col: 2 } };
  }

  GK.wbs = { parse, gantt, sheet, isWbsHeader, toDay, fromDay, workDays, addWork };
})(globalThis.GK = globalThis.GK || {});
