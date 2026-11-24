// 構成図の記法（```arch）→ 配置 → SVG。層（layer）を上から順に横帯で並べ、ノードを層の中に置く。
//
//   title 受注システムの構成
//   layer 利用者
//   layer 画面
//   node U @利用者 営業担当 [person]      形：[box]（既定）[db] [person] [ext]（社外・点線）
//   node W @画面 受注画面
//   group 社内ネットワーク : W, A, D     境界（点線の枠）
//   U -> W : ブラウザ                      実線。..> は点線（非同期・夜間など）
//   note W スマホにも対応                  ノードの下に小さく添える
(function (GK) {
  "use strict";

  const D = GK.diagram;
  const SHAPES = ["box", "db", "person", "ext"];
  const ID = "[A-Za-z0-9_\\-]+";

  function parse(src) {
    const g = { title: "", layers: [], nodes: [], edges: [], groups: [], ...D.issues() };
    const byId = new Map();
    const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
    const pendingEdges = [];
    lines.forEach((raw, i) => {
      const line = raw.trim();
      const no = i + 1;
      if (!line || line.startsWith("#") || /^```/.test(line)) return;
      let m;
      if ((m = line.match(/^title\s+(.+)$/))) { g.title = m[1].trim(); return; }
      if ((m = line.match(/^layer\s+(.+)$/))) { const name = m[1].trim(); if (g.layers.includes(name)) g.warnings.push({ line: no, message: `層「${name}」が 2 回あります` }); else g.layers.push(name); return; }
      if ((m = line.match(new RegExp(`^node\\s+(${ID})\\s+@(\\S+)\\s+(.+?)(?:\\s+\\[(\\w+)\\])?$`)))) {
        const [, id, layer, label, shape] = m;
        if (byId.has(id)) { g.errors.push({ line: no, message: `ノード ID「${id}」が重複しています` }); return; }
        if (!g.layers.includes(layer)) { g.errors.push({ line: no, message: `層「${layer}」は定義されていません（定義済み：${g.layers.join("、") || "なし"}）。先に layer ${layer} と書いてください` }); return; }
        if (shape && !SHAPES.includes(shape)) g.warnings.push({ line: no, message: `形「[${shape}]」は使えません。四角にします（使える形：${SHAPES.map((s) => `[${s}]`).join(" ")}）` });
        const n = { id, layer, label: label.trim(), shape: SHAPES.includes(shape) ? shape : "box", notes: [], line: no };
        g.nodes.push(n); byId.set(id, n);
        return;
      }
      if ((m = line.match(/^group\s+(.+?)\s*:\s*(.+)$/))) { g.groups.push({ label: m[1].trim(), ids: m[2].split(/[,、\s]+/).filter(Boolean), line: no }); return; }
      if ((m = line.match(new RegExp(`^note\\s+(${ID})\\s+(.+)$`)))) { pendingEdges.push({ note: true, id: m[1], text: m[2].trim(), line: no }); return; }
      if ((m = line.match(new RegExp(`^(${ID})\\s*(->|\\.\\.>)\\s*(${ID})\\s*(?::\\s*(.+))?$`)))) { pendingEdges.push({ from: m[1], to: m[3], dashed: m[2] === "..>", label: (m[4] || "").trim(), line: no }); return; }
      g.errors.push({ line: no, message: `読めない行です：${line.slice(0, 40)}（layer / node / group / note / 矢印 A -> B のどれかで書いてください）` });
    });
    for (const e of pendingEdges) {
      if (e.note) { const n = byId.get(e.id); if (n) n.notes.push(e.text); else g.errors.push({ line: e.line, message: `note のノード「${e.id}」がありません` }); continue; }
      for (const k of ["from", "to"]) if (!byId.has(e[k])) g.errors.push({ line: e.line, message: `矢印のノード「${e[k]}」がありません` });
      if (byId.has(e.from) && byId.has(e.to)) g.edges.push(e);
    }
    for (const gr of g.groups) {
      const miss = gr.ids.filter((id) => !byId.has(id));
      if (miss.length) g.warnings.push({ line: gr.line, message: `group のノード ${miss.join("、")} がありません` });
      gr.ids = gr.ids.filter((id) => byId.has(id));
    }
    if (!g.layers.length && !g.errors.length) g.errors.push({ line: 1, message: "layer が 1 つもありません" });
    for (const l of g.layers) if (!g.nodes.some((n) => n.layer === l)) g.warnings.push({ line: 1, message: `層「${l}」にノードがありません` });
    return g;
  }

  const NW = 156, GAP = 44, LABEL_W = 112, ROW_H = 118, TOP = 44, FS = 12;

  function layout(g) {
    // 層の中の並び：上の層でつながっている相手の位置の平均（重心）で並べ替えて、交差を減らす
    const rows = g.layers.map((l) => g.nodes.filter((n) => n.layer === l));
    const pos = new Map();
    rows.forEach((row, ri) => {
      if (ri > 0) {
        const bary = (n) => {
          const xs = g.edges.filter((e) => (e.to === n.id || e.from === n.id)).map((e) => pos.get(e.to === n.id ? e.from : e.to)).filter((p) => p != null && p.row < ri).map((p) => p.idx);
          return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Infinity;
        };
        const order = row.map((n, i) => ({ n, b: bary(n), i }));
        order.sort((a, b) => (a.b === b.b ? a.i - b.i : a.b === Infinity ? 1 : b.b === Infinity ? -1 : a.b - b.b));
        row.splice(0, row.length, ...order.map((o) => o.n));
      }
      // 枠（group）に入るノードを左に寄せてまとめる（枠の中に枠の外のノードが挟まらないように）
      if (g.groups.length) {
        const gi = (n) => { const k = g.groups.findIndex((gr) => gr.ids.includes(n.id)); return k < 0 ? Infinity : k; };
        const order = row.map((n, i) => ({ n, k: gi(n), i }));
        order.sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k));
        row.splice(0, row.length, ...order.map((o) => o.n));
      }
      row.forEach((n, i) => pos.set(n.id, { row: ri, idx: i - (row.length - 1) / 2 }));
    });
    const maxN = Math.max(1, ...rows.map((r) => r.length));
    // 層を 2 つ以上飛ばす矢印は、右端の通り道を通す（途中の層のノードを横切らないように）
    const rowOf = new Map(); rows.forEach((r, ri) => r.forEach((n) => rowOf.set(n.id, ri)));
    const skips = g.edges.filter((e) => Math.abs(rowOf.get(e.from) - rowOf.get(e.to)) > 1);
    // 通り道の幅（ラベルがあれば、通り道の上のラベルが切れない幅）
    const skipLabelW = Math.max(0, ...skips.filter((e) => e.label).map((e) => D.textW(e.label, 10.5) / 2 + 12));
    const channel = skips.length ? 20 + skips.length * 12 + skipLabelW : 0;
    const width = LABEL_W + 24 + maxN * NW + (maxN - 1) * GAP + 24 + channel;
    const cx0 = LABEL_W + (width - channel - LABEL_W) / 2;
    const geo = { title: g.title, width, height: 0, rows: [], nodes: [], edges: [], groups: [] };
    let y = TOP;
    rows.forEach((row, ri) => {
      // ノードの高さ：文字の行数と、添え書き
      const hs = row.map((n) => {
        const lines = D.wrap(n.label, NW - 20, FS, 3);
        const notes = n.notes.flatMap((t) => D.wrap(t, NW - 12, 10, 2));
        return { lines, notes, h: Math.max(46, lines.length * 16 + 22) + (n.shape === "person" ? 14 : 0) };
      });
      const rowH = Math.max(ROW_H, ...hs.map((x) => x.h + x.notes.length * 13 + 40));
      geo.rows.push({ label: g.layers[ri], y, h: rowH });
      row.forEach((n, i) => {
        const cx = cx0 + (i - (row.length - 1) / 2) * (NW + GAP);
        const h = hs[i].h;
        const cy = y + rowH / 2 - (hs[i].notes.length * 13) / 2;
        geo.nodes.push({ id: n.id, shape: n.shape, x: cx - NW / 2, y: cy - h / 2, w: NW, h, cx, cy, lines: hs[i].lines, notes: hs[i].notes, row: ri });
      });
      y += rowH;
    });
    geo.height = y + 16;
    const nb = new Map(geo.nodes.map((n) => [n.id, n]));
    // 矢印：層が違えば上下の辺の中央どうしを、途中で折れる線で結ぶ。同じ層なら左右の辺どうし
    const portUse = new Map();
    const shift = (id, side) => { const k = id + side; const c = portUse.get(k) || 0; portUse.set(k, c + 1); return c === 0 ? 0 : (c % 2 ? 1 : -1) * Math.ceil(c / 2) * 14; };
    const bandUse = new Map(); // 同じ帯で折れる線の高さをずらす（横の線が重ならないように）
    const band = (ri) => { const c = bandUse.get(ri) || 0; bandUse.set(ri, c + 1); return geo.rows[ri].y + 8 + (c % 4) * 6; };
    const right = Math.max(...geo.nodes.map((n) => n.x + n.w));
    let skipNo = 0;
    for (const e of g.edges) {
      const a = nb.get(e.from), b = nb.get(e.to);
      let pts;
      if (a.row === b.row) {
        const dir = b.cx > a.cx ? 1 : -1;
        const x1 = a.cx + dir * a.w / 2, x2 = b.cx - dir * b.w / 2;
        const y1 = a.cy + shift(a.id, dir > 0 ? "r" : "l"), y2 = b.cy;
        pts = [[x1, y1], [(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2], [x2, y2]];
      } else {
        const down = b.row > a.row;
        const x1 = a.cx + shift(a.id, down ? "b" : "t"), y1 = down ? a.y + a.h : a.y;
        const x2 = b.cx + shift(b.id, down ? "t" : "b"), y2 = down ? b.y : b.y + b.h;
        if (Math.abs(b.row - a.row) > 1) {
          // 2 層以上飛ばす：自分の帯の中で右へ出て、右端の通り道を下り（上り）、相手の帯で戻る
          const cxr = right + 24 + skipNo++ * 12;
          const ra = geo.rows[a.row], rb = geo.rows[b.row];
          const ya = down ? ra.y + ra.h - 8 : ra.y + 8, yb = down ? rb.y + 8 : rb.y + rb.h - 8;
          pts = [[x1, y1], [x1, ya], [cxr, ya], [cxr, yb], [x2, yb], [x2, y2]];
        } else {
          const ym = band(down ? b.row : a.row); // 下の層の上端の少し下で折る（帯の境目の近く）
          pts = Math.abs(x1 - x2) < 1 ? [[x1, y1], [x2, y2]] : [[x1, y1], [x1, ym], [x2, ym], [x2, y2]];
        }
      }
      geo.edges.push({ pts, dashed: e.dashed, label: e.label });
    }
    // 枠：層ごとに枠のノードを囲み、上下の層の枠は、間に枠の外のノードを含まないときだけ 1 つにつなぐ
    const inside = (r, n) => n.x < r.x2 && n.x + n.w > r.x1 && n.y < r.y2 && n.y + n.h > r.y1;
    for (const gr of g.groups) {
      const ns = gr.ids.map((id) => nb.get(id));
      if (!ns.length) continue;
      const rects = [];
      for (let ri = 0; ri < geo.rows.length; ri++) {
        const m = ns.filter((n) => n.row === ri);
        if (!m.length) continue;
        const r = { x1: Math.min(...m.map((n) => n.x)) - 14, y1: Math.min(...m.map((n) => n.y)) - 22, x2: Math.max(...m.map((n) => n.x + n.w)) + 14, y2: Math.max(...m.map((n) => n.y + n.h + n.notes.length * 13)) + 10, row: ri };
        const prev = rects[rects.length - 1];
        if (prev && prev.row === ri - 1) {
          const u = { x1: Math.min(prev.x1, r.x1), y1: prev.y1, x2: Math.max(prev.x2, r.x2), y2: r.y2, row: ri };
          if (!geo.nodes.some((n) => !gr.ids.includes(n.id) && inside(u, n))) { rects[rects.length - 1] = u; continue; }
        }
        rects.push(r);
      }
      rects.forEach((r, i) => geo.groups.push({ label: i === 0 ? gr.label : `${gr.label}（続き）`, x: r.x1, y: r.y1, w: r.x2 - r.x1, h: r.y2 - r.y1 }));
    }
    return geo;
  }

  function shapeSvg(n) {
    const C = D.C;
    const label = D.textLines(n.lines, n.cx, n.cy + (n.shape === "person" ? 7 : 0), { size: FS, color: C.ink });
    const notes = n.notes.length ? D.textLines(n.notes, n.cx, n.y + n.h + 8 + ((n.notes.length - 1) * 13) / 2, { size: 10, color: C.sub, lh: 13 }) : "";
    if (n.shape === "db") {
      const ry = 7;
      return `<g><path d="M${n.x},${n.y + ry} v${n.h - ry * 2} a${n.w / 2},${ry} 0 0 0 ${n.w},0 v${-(n.h - ry * 2)}" fill="${C.light}" stroke="${C.navy}" stroke-width="1.2"/><ellipse cx="${n.cx}" cy="${n.y + ry}" rx="${n.w / 2}" ry="${ry}" fill="#fff" stroke="${C.navy}" stroke-width="1.2"/>${label}${notes}</g>`;
    }
    if (n.shape === "person") {
      return `<g><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2 > 24 ? 24 : n.h / 2}" fill="${C.goldSoft}" stroke="${C.gold}" stroke-width="1.2"/><circle cx="${n.cx}" cy="${n.y + 11}" r="5" fill="${C.gold}"/><path d="M${n.cx - 8},${n.y + 24} q8,-10 16,0" fill="none" stroke="${C.gold}" stroke-width="2"/>${label}${notes}</g>`;
    }
    if (n.shape === "ext") return `<g><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="#fff" stroke="${C.sub}" stroke-width="1.2" stroke-dasharray="5 3"/>${label}<text x="${n.x + n.w - 6}" y="${n.y + 10}" font-size="9" fill="${C.sub}" text-anchor="end" dominant-baseline="central">社外</text>${notes}</g>`;
    return `<g><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="#fff" stroke="${C.navy}" stroke-width="1.2"/>${label}${notes}</g>`;
  }

  function toSVG(geo) {
    const C = D.C;
    const out = [];
    if (geo.title) out.push(`<text x="16" y="22" font-size="15" font-weight="bold" fill="${C.navy}" dominant-baseline="central">${D.esc(geo.title)}</text>`);
    geo.rows.forEach((r, i) => {
      out.push(`<rect x="8" y="${r.y}" width="${geo.width - 16}" height="${r.h}" fill="${i % 2 ? C.alt : "#fff"}" stroke="${C.line}" stroke-width="0.8"/>`);
      out.push(`<rect x="8" y="${r.y}" width="${LABEL_W - 8}" height="${r.h}" fill="${C.light}" stroke="${C.line}" stroke-width="0.8"/>`);
      out.push(D.textLines(D.wrap(r.label, LABEL_W - 24, 12, 3), 8 + (LABEL_W - 8) / 2, r.y + r.h / 2, { size: 12, color: C.navy, bold: true }));
    });
    for (const g of geo.groups) out.push(`<rect x="${D.r1(g.x)}" y="${D.r1(g.y)}" width="${D.r1(g.w)}" height="${D.r1(g.h)}" rx="10" fill="none" stroke="${C.gold}" stroke-width="1.4" stroke-dasharray="7 4"/>`);
    for (const e of geo.edges) {
      out.push(`<polyline points="${e.pts.map((p) => p.map(D.r1).join(",")).join(" ")}" fill="none" stroke="${C.sub}" stroke-width="1.3"${e.dashed ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#dg-arr)"/>`);
    }
    for (const n of geo.nodes) out.push(shapeSvg(n));
    // 枠の名前は線の上に、白い下地で描く（線が文字を横切らないように）
    for (const g of geo.groups) {
      const w = D.textW(g.label, 11) + 8;
      out.push(`<rect x="${D.r1(g.x + 6)}" y="${D.r1(g.y + 3)}" width="${D.r1(w)}" height="16" rx="3" fill="#fff"/><text x="${D.r1(g.x + 10)}" y="${D.r1(g.y + 11)}" font-size="11" fill="${C.gold}" font-weight="bold" dominant-baseline="central">${D.esc(g.label)}</text>`);
    }
    // ラベルは線とノードの上に描く（白い下地で読めるように）
    for (const e of geo.edges) {
      if (!e.label) continue;
      const p = e.pts;
      const mid = p.length === 6 ? [p[2][0], (p[2][1] + p[3][1]) / 2] : p.length === 4 ? [(p[1][0] + p[2][0]) / 2, p[1][1]] : [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
      const w = D.textW(e.label, 10.5) + 10;
      out.push(`<rect x="${D.r1(mid[0] - w / 2)}" y="${D.r1(mid[1] - 9)}" width="${D.r1(w)}" height="18" rx="3" fill="#fff" stroke="${C.line}" stroke-width="0.6"/>${D.textLines([e.label], mid[0], mid[1], { size: 10.5, color: C.sub })}`);
    }
    return D.svgDoc(geo.width, geo.height, out.join(""), geo.title || "構成図");
  }

  function render(src) {
    const graph = parse(src);
    if (graph.errors.length) return { graph, svg: "", geo: null };
    const geo = layout(graph);
    return { graph, geo, svg: toSVG(geo) };
  }

  GK.arch = { parse, layout, toSVG, render, SHAPES };
})(globalThis.GK = globalThis.GK || {});
