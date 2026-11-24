// 論点マップ・選択肢の木（```map）→ 配置 → SVG。字下げの箇条書きを、左から右へ広がる木にする。
//
//   title 受注業務の論点
//   受注を速くする                  ← 最初の「- 」の無い行が根（無ければ title が根）
//   - 入力を減らす [課題]
//     - OCR で読み取る [案]
//     - 取引先に入力してもらう [案] [推奨]
//   - 確認を減らす [要確認]
//
// 印：[課題] [案] [推奨] [要確認] [リスク] [済]。色だけでなく文字の札でも示す
(function (GK) {
  "use strict";

  const D = GK.diagram;
  const TAGS = {
    課題: { fill: "#FDECEA", stroke: "#B3261E", text: "#8E1B15" },
    案: { fill: "#E8EEF6", stroke: "#1F3A5F", text: "#1F3A5F" },
    推奨: { fill: "#FFF1D6", stroke: "#B8892B", text: "#6E4B00" },
    要確認: { fill: "#FFF6E0", stroke: "#8A5A00", text: "#8A5A00" },
    リスク: { fill: "#FDECEA", stroke: "#B3261E", text: "#8E1B15" },
    済: { fill: "#E6F2EC", stroke: "#1A6B35", text: "#1A6B35" },
  };

  function parse(src) {
    const g = { title: "", root: null, ...D.issues() };
    const lines = String(src ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n");
    const stack = [];
    let unit = 0;
    lines.forEach((raw, i) => {
      const no = i + 1;
      if (!raw.trim() || /^\s*```/.test(raw) || /^\s*#/.test(raw)) return;
      let m;
      if ((m = raw.match(/^\s*title\s+(.+)$/))) { g.title = m[1].trim(); return; }
      if (!(m = raw.match(/^(\s*)[-*・]\s+(.+)$/))) {
        if (g.root) { g.warnings.push({ line: no, message: `根は 1 つだけです。「${raw.trim().slice(0, 20)}」は無視しました（子にするなら行頭に - を付けてください）` }); return; }
        g.root = node(raw.trim(), no, 0);
        return;
      }
      const indent = m[1].length;
      if (!g.root) g.root = node(g.title || "テーマ", 0, 0);
      if (indent > 0 && !unit) unit = indent;
      const depth = unit ? Math.round(indent / unit) + 1 : 1;
      const n = node(m[2].trim(), no, depth);
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : g.root;
      if (depth - parent.depth > 1) g.warnings.push({ line: no, message: "字下げが 2 段以上深くなっています。1 段の子として描きます" });
      n.depth = parent.depth + 1;
      parent.children.push(n);
      stack.push(n);
    });
    if (!g.root) g.errors.push({ line: 1, message: "項目がありません（根の行と「- 」の行を書いてください）" });
    function node(text, line, depth) {
      const tags = [];
      const label = text.replace(/\[([^\]]+)\]/g, (s, t) => { if (TAGS[t.trim()]) { tags.push(t.trim()); return ""; } g.warnings.push({ line, message: `印「[${t}]」は使えません（使える印：${Object.keys(TAGS).map((k) => `[${k}]`).join(" ")}）` }); return ""; }).trim();
      return { label: label || "（空）", tags, children: [], depth, line };
    }
    return g;
  }

  const NW = 188, COL = 236, ROW = 54, FS = 12, PAD = 16, TOP = 40;

  function layout(g) {
    const nodes = [];
    let cursor = TOP; // 葉を上から順に置く。親は子の上下の中央
    const place = (n) => {
      const lines = D.wrap(n.label, NW - 20, FS, 3);
      const h = Math.max(34, lines.length * 16 + (n.tags.length ? 30 : 14));
      const item = { n, lines, h, x: PAD + n.depth * COL, y: 0, w: n.depth === 0 ? NW + 12 : NW, kids: [] };
      if (!n.children.length) { item.cy = cursor + h / 2; cursor += h + (ROW - 34); }
      else { item.kids = n.children.map(place); item.cy = (item.kids[0].cy + item.kids[item.kids.length - 1].cy) / 2; }
      item.y = item.cy - h / 2;
      nodes.push(item);
      return item;
    };
    const root = place(g.root);
    const depth = Math.max(...nodes.map((x) => x.n.depth));
    // 親が子の中央に来て上にはみ出すことがあるので、全体を下げる
    const minY = Math.min(...nodes.map((x) => x.y));
    if (minY < TOP) for (const x of nodes) { x.y += TOP - minY; x.cy += TOP - minY; }
    return { title: g.title, root, nodes, width: PAD * 2 + depth * COL + NW + 12, height: Math.max(...nodes.map((x) => x.y + x.h)) + 16 };
  }

  function toSVG(geo) {
    const C = D.C;
    const out = [];
    if (geo.title) out.push(`<text x="${PAD}" y="20" font-size="15" font-weight="bold" fill="${C.navy}" dominant-baseline="central">${D.esc(geo.title)}</text>`);
    for (const p of geo.nodes) for (const k of p.kids) {
      const x1 = p.x + p.w, y1 = p.cy, x2 = k.x, y2 = k.cy, mx = (x1 + x2) / 2;
      out.push(`<path d="M${D.r1(x1)},${D.r1(y1)} C${D.r1(mx)},${D.r1(y1)} ${D.r1(mx)},${D.r1(y2)} ${D.r1(x2)},${D.r1(y2)}" fill="none" stroke="${C.line}" stroke-width="1.6"/>`);
    }
    for (const p of geo.nodes) {
      const isRoot = p.n.depth === 0;
      const t = p.n.tags.length ? TAGS[p.n.tags[0]] : null;
      const fill = isRoot ? C.navy : t ? t.fill : "#fff";
      const stroke = isRoot ? C.navy : t ? t.stroke : C.navy;
      out.push(`<rect x="${D.r1(p.x)}" y="${D.r1(p.y)}" width="${p.w}" height="${D.r1(p.h)}" rx="${isRoot ? 8 : 6}" fill="${fill}" stroke="${stroke}" stroke-width="${p.n.tags.includes("推奨") ? 2.4 : 1.2}"/>`);
      const textY = p.n.tags.length ? p.y + 10 + (p.h - 24) / 2 + 2 : p.cy;
      out.push(D.textLines(p.lines, p.x + p.w / 2, p.n.tags.length ? p.y + (p.h - 18) / 2 + 2 : textY, { size: isRoot ? 13 : FS, color: isRoot ? "#fff" : C.ink, bold: isRoot }));
      // 札（印の文字）：色が分からなくても読めるように
      let bx = p.x + 8;
      for (const tag of p.n.tags) {
        const tc = TAGS[tag];
        const w = D.textW(tag, 10) + 10;
        out.push(`<rect x="${D.r1(bx)}" y="${D.r1(p.y + p.h - 18)}" width="${D.r1(w)}" height="14" rx="7" fill="#fff" stroke="${tc.stroke}" stroke-width="0.8"/>${D.textLines([tag], bx + w / 2, p.y + p.h - 11, { size: 10, color: tc.text })}`);
        bx += w + 4;
      }
    }
    return D.svgDoc(geo.width, geo.height, out.join(""), geo.title || "論点マップ");
  }

  function render(src) {
    const graph = parse(src);
    if (graph.errors.length) return { graph, svg: "", geo: null };
    const geo = layout(graph);
    return { graph, geo, svg: toSVG(geo) };
  }

  GK.map = { parse, layout, toSVG, render, TAGS };
})(globalThis.GK = globalThis.GK || {});
