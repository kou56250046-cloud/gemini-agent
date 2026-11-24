// スライド JSON → 要素の配置（単位は pt、16:9 = 960 × 540）。
// プレビュー（HTML）と PPTX 書き出しは、どちらもここで決めた座標をそのまま使う。
// 配布して読ませる資料が前提。各スライドの上部に結論文（lead）を置き、本文は説明なしで読める密度にする。
(function (GK) {
  "use strict";

  const W = 960, H = 540, MX = 36, CW = W - MX * 2;
  const LH = 1.3; // 行送り（フォントサイズに対する倍率）。PPTX でも同じ値を固定値で指定する
  const INSET = 4;
  const DEFAULT_THEME = { primary: "1F3A5F", accent: "B8892B", text: "222222", sub: "5A6573", light: "EEF2F7", line: "C9D1DC", alt: "F6F8FB", footer: "" };
  const TYPES = ["cover", "toc", "summary", "section", "content", "compare", "table", "flow", "schedule", "issues", "conclusion"];
  const TYPE_LABEL = { cover: "表紙", toc: "目次", summary: "サマリ", section: "章扉", content: "本文", compare: "比較", table: "表", flow: "フロー図", schedule: "スケジュール", issues: "課題と対応", conclusion: "まとめ" };

  // ---------- 文字 ----------
  // "**太字**" を run に分ける
  function runs(s, base) {
    const out = [];
    String(s ?? "").split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (!part) return;
      const m = part.match(/^\*\*([^*]+)\*\*$/);
      out.push(Object.assign({}, base, m ? { t: m[1], b: true } : { t: part }));
    });
    return out.length ? out : [Object.assign({}, base, { t: "" })];
  }
  const plain = (p) => p.runs.map((r) => r.t).join("");
  // 文字列 / 配列 / {text, sub} を段落の配列にする
  function paras(input, opt) {
    const o = Object.assign({ bullet: true }, opt);
    const out = [];
    const push = (v, level) => {
      if (v == null || v === "") return;
      if (Array.isArray(v)) { v.forEach((x) => push(x, level)); return; }
      if (typeof v === "object") {
        const head = v.text ?? v.head ?? v.title ?? "";
        if (head !== "") out.push({ runs: runs(head), bullet: o.bullet, level });
        if (v.sub) push(v.sub, level + 1);
        return;
      }
      String(v).split("\n").forEach((line) => {
        const m = line.match(/^(\s*)[-・•]\s+(.*)$/);
        if (m) out.push({ runs: runs(m[2]), bullet: true, level: level + (m[1].length >= 2 ? 1 : 0) });
        else if (line.trim()) out.push({ runs: runs(line), bullet: o.bullet, level });
      });
    };
    if (typeof input === "string") {
      input.split("\n").forEach((line) => {
        const m = line.match(/^(\s*)[-・•]\s+(.*)$/);
        if (m) out.push({ runs: runs(m[2]), bullet: true, level: m[1].length >= 2 ? 1 : 0 });
        else if (line.trim()) out.push({ runs: runs(line), bullet: false, level: 0 });
      });
    } else push(input, 0);
    return out;
  }
  const indentOf = (p, size) => (p.bullet ? (p.level + 1) * size * 1.1 : p.level * size * 1.1);
  // gap：段落の間隔（文字サイズに対する倍率）。PPTX の段落前の間隔とプレビューの余白も同じ値を使う
  const GAP = 0.35;
  function textHeight(ps, w, size, inset, gap = GAP) {
    let h = 0;
    ps.forEach((p, i) => {
      const avail = Math.max(size * 2, w - inset * 2 - indentOf(p, size));
      const n = GK.flow.wrap(plain(p), avail, size).length;
      h += n * size * LH + (i ? size * gap : 0);
    });
    return h + inset * 2;
  }
  // 箱に収まる最大の文字サイズを探す
  function fit(ps, w, h, size, minSize, inset = INSET) {
    let s = size;
    while (s > minSize && textHeight(ps, w, s, inset) > h) s -= 0.5;
    return { size: s, overflow: textHeight(ps, w, s, inset) > h + 0.5 };
  }
  // 空白を作りすぎない：文字が少なくて箱が余るときは、文字を maxSize まで大きくし、それでも余れば段落の間隔を広げる
  function grow(ps, w, h, size, maxSize, inset) {
    // 文字の大きさは段落の間隔を詰めた状態で決め、そのあと余りで間隔を広げる
    const TIGHT = 0.2;
    let s = size;
    while (s + 0.5 <= maxSize && textHeight(ps, w, s + 0.5, inset, TIGHT) <= h * 0.92) s += 0.5;
    let gap = textHeight(ps, w, s, inset, GAP) <= h * 0.92 ? GAP : TIGHT;
    if (ps.length > 1) {
      while (gap + 0.05 <= 1.6 && textHeight(ps, w, s, inset, gap + 0.05) <= h * 0.92) gap += 0.05;
    }
    return { size: s, gap: Math.round(gap * 100) / 100 };
  }

  // 同じスライドの中で並ぶ箱（サマリの行、比較の左右、カード）は文字の大きさをそろえる（いちばん小さいものに合わせる）
  function sameSize(els) {
    const list = els.filter(Boolean);
    if (list.length < 2) return;
    const s = Math.min(...list.map((el) => el.size));
    for (const el of list) {
      el.size = s;
      el.gap = GAP;
      if (el.maxSize && el.paras.length > 1) el.gap = grow(el.paras, el.w, el.h, s, s, el.inset).gap;
    }
  }

  // ---------- 要素 ----------
  function rect(x, y, w, h, o) { return Object.assign({ t: "rect", x, y, w, h, shape: "rect" }, o); }
  function text(x, y, w, h, ps, o) {
    const el = Object.assign({ t: "text", x, y, w, h, paras: ps, size: 12, color: DEFAULT_THEME.text, align: "l", valign: "t", inset: INSET, gap: GAP }, o);
    if (el.minSize) {
      const f = fit(ps, w, h, el.size, el.minSize, el.inset);
      el.size = f.size;
      el.overflow = f.overflow;
      if (!f.overflow && el.maxSize && el.size >= (o.size || 12)) Object.assign(el, grow(ps, w, h, el.size, el.maxSize, el.inset));
    }
    return el;
  }
  const line = (x1, y1, x2, y2, color, w = 0.75, dash = false) => ({ t: "line", x1, y1, x2, y2, color, w, dash });

  // ---------- 共通の枠（タイトル・結論文・フッター） ----------
  function chrome(s, ctx, th) {
    const els = [];
    els.push(rect(MX, 24, 5, 30, { fill: th.accent }));
    els.push(text(MX + 12, 20, CW - 12 - (s.appendix ? 80 : 0), 38, [{ runs: runs(s.title || "（タイトルなし）"), level: 0 }], { size: 22, minSize: 16, bold: true, color: th.primary, valign: "ctr" }));
    if (s.appendix) {
      els.push(rect(W - MX - 70, 28, 70, 20, { fill: "FFFFFF", line: th.sub, lineW: 0.75 }));
      els.push(text(W - MX - 70, 28, 70, 20, [{ runs: runs("Appendix"), level: 0 }], { size: 9, color: th.sub, align: "ctr", valign: "ctr", inset: 1 }));
    }
    let top = 70;
    if (s.lead) {
      const ps = [{ runs: runs(s.lead), level: 0 }];
      const need = Math.min(62, Math.max(32, textHeight(ps, CW - 16, 13.5, 8)));
      els.push(rect(MX, 66, CW, need, { fill: th.light }));
      els.push(rect(MX, 66, 4, need, { fill: th.primary }));
      els.push(text(MX + 10, 66, CW - 14, need, ps, { size: 13.5, minSize: 11, bold: true, color: th.primary, valign: "ctr", inset: 6 }));
      top = 66 + need + 14;
    }
    const bottom = s.source ? 474 : 494;
    if (s.source) els.push(text(MX, 478, CW, 16, [{ runs: runs("出典：" + s.source), level: 0 }], { size: 8, color: th.sub, minSize: 6.5, inset: 1 }));
    els.push(line(MX, 504, W - MX, 504, th.line));
    if (th.footer) els.push(text(MX, 508, CW - 80, 18, [{ runs: runs(th.footer), level: 0 }], { size: 8, color: th.sub, inset: 1, valign: "ctr" }));
    els.push(text(W - MX - 80, 508, 80, 18, [{ runs: runs(`${ctx.no} / ${ctx.total}`), level: 0 }], { size: 9, color: th.sub, align: "r", inset: 1, valign: "ctr" }));
    return { els, area: { x: MX, y: top, w: CW, h: bottom - top } };
  }

  // ---------- 表 ----------
  function tableEl(x, y, w, hMax, columns, rows, th, opt) {
    const o = Object.assign({ size: 14, minSize: 7.5, maxSize: 16, ratios: null, header: true, stretch: 2.4 }, opt);
    const nCol = Math.max(columns.length, ...rows.map((r) => r.length), 1);
    let ratios = o.ratios && o.ratios.length === nCol ? o.ratios.slice() : null;
    if (!ratios) {
      // 列幅：各列の長さの平方根に比例。極端に細い列は作らない
      ratios = Array.from({ length: nCol }, (_, c) => {
        const lens = [columns[c] || "", ...rows.map((r) => r[c] ?? "")].map((v) => GK.flow.textW(String(v), 1));
        const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
        return Math.sqrt(Math.max(2, Math.max(GK.flow.textW(String(columns[c] || ""), 1), avg)));
      });
    }
    const sum = ratios.reduce((a, b) => a + b, 0);
    let colW = ratios.map((r) => Math.max(w * 0.07, (w * r) / sum));
    const k = w / colW.reduce((a, b) => a + b, 0);
    colW = colW.map((c) => c * k);
    const cellIn = 5;
    const build = (size) => {
      const out = [];
      const all = o.header ? [columns, ...rows] : rows;
      all.forEach((r, ri) => {
        const isHead = o.header && ri === 0;
        const cells = colW.map((cw, c) => {
          const v = r[c] ?? "";
          const ps = paras(String(v), { bullet: false });
          return { paras: ps.length ? ps : [{ runs: runs(""), level: 0 }], fill: isHead ? th.primary : (ri % 2 ? "FFFFFF" : th.alt), color: isHead ? "FFFFFF" : th.text, bold: isHead, align: "l" };
        });
        const h = Math.max(size * LH + cellIn * 2, ...cells.map((cell, c) => textHeight(cell.paras, colW[c], size, cellIn)));
        out.push({ h, cells });
      });
      return out;
    };
    let size = o.size, built = build(size);
    const sumH = (b) => b.reduce((a, r) => a + r.h, 0);
    while (size > o.minSize && sumH(built) > hMax) { size -= 0.5; built = build(size); }
    // 行が少なくて下が空くときは、まず文字を大きくする（最大 maxSize）
    while (size + 0.5 <= o.maxSize && sumH(built) < hMax * 0.75) {
      const next = build(size + 0.5);
      if (sumH(next) > hMax * 0.95) break;
      size += 0.5;
      built = next;
    }
    let total = sumH(built);
    // それでも余白が大きいときは行の高さを広げて埋める（最大 stretch 倍）
    if (total < hMax && o.stretch > 1) {
      const k = Math.min(o.stretch, hMax / total);
      built.forEach((r) => (r.h *= k));
      total *= k;
    }
    return { t: "table", x, y, w, h: total, colW, rows: built, size, lineColor: th.line, inset: cellIn, overflow: total > hMax + 0.5 };
  }

  // ---------- レイアウト ----------
  // 箇条書きの本文。量が少なければ文字を大きくして枠を埋める（空白を作りすぎない）
  function bulletsBox(area, items, size) {
    const ps = paras(items, { bullet: true });
    return text(area.x, area.y, area.w, area.h, ps, { size, minSize: 9, maxSize: Math.round(size * 1.3) });
  }

  const LAYOUTS = {
    cover(s, ctx, th, deck) {
      const els = [rect(0, 0, W, H, { fill: th.primary }), rect(0, H - 8, W, 8, { fill: th.accent })];
      els.push(text(60, 100, 840, 140, [{ runs: runs(s.title || deck.title || ""), level: 0 }], { size: 32, minSize: 22, bold: true, color: "FFFFFF", valign: "b" }));
      els.push(rect(62, 254, 80, 4, { fill: th.accent }));
      const sub = s.subtitle || deck.subtitle;
      if (sub) els.push(text(60, 268, 840, 70, paras(sub, { bullet: false }), { size: 16, minSize: 12, color: "FFFFFF" }));
      const meta = [s.customer || deck.customer, s.date || deck.date, s.author || deck.author].filter(Boolean);
      if (meta.length) els.push(text(60, 420, 840, 70, meta.map((m) => ({ runs: runs(m), level: 0 })), { size: 13, minSize: 10, color: "DCE3EC", valign: "b" }));
      if (th.footer) els.push(text(60, 500, 840, 20, [{ runs: runs(th.footer), level: 0 }], { size: 9, color: "B8C4D4", align: "r", inset: 1 }));
      return els;
    },
    section(s, ctx, th) {
      const els = [rect(0, 0, 330, H, { fill: th.primary }), rect(330, 0, 6, H, { fill: th.accent })];
      if (s.no != null && s.no !== "") els.push(text(40, 180, 260, 140, [{ runs: runs(String(s.no)), level: 0 }], { size: 80, bold: true, color: "FFFFFF", valign: "ctr", align: "ctr" }));
      els.push(text(380, 190, 540, 90, [{ runs: runs(s.title || ""), level: 0 }], { size: 28, minSize: 18, bold: true, color: th.primary, valign: "b" }));
      if (s.subtitle || s.lead) els.push(text(380, 290, 540, 120, paras(s.subtitle || s.lead, { bullet: false }), { size: 14, minSize: 10, color: th.sub }));
      els.push(text(W - MX - 80, 508, 80, 18, [{ runs: runs(`${ctx.no} / ${ctx.total}`), level: 0 }], { size: 9, color: th.sub, align: "r", inset: 1 }));
      return els;
    },
    // 目次：章ごとに、その章に含まれるスライドの題名とページ番号を並べる（配布資料で目的のページを探せるように）
    toc(s, ctx, th, deck) {
      const c = chrome(Object.assign({ title: "目次" }, s), ctx, th);
      const els = c.els;
      const groups = tocGroups(deck.slides, s.items);
      // 行の一覧（見出し行と項目行）
      const rows = [];
      for (const g of groups) {
        if (g.head) rows.push({ kind: "head", no: g.no, title: g.title, page: g.page, group: g });
        for (const it of g.items) rows.push({ kind: "item", title: it.title, page: it.page, group: g, loose: !g.head });
      }
      if (!rows.length) return els;
      const HEAD = 34, ITEM = 24, GAPG = 8;
      const hOf = (r, i) => (r.kind === "head" ? HEAD + (i ? GAPG : 0) : ITEM);
      const total = rows.reduce((a, r, i) => a + hOf(r, i), 0);
      // 1列に入らなければ、章の切れ目で2列に分ける
      let cols = [rows];
      if (total > c.area.h) {
        let acc = 0, cut = rows.length;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].kind === "head" && acc >= total / 2) { cut = i; break; }
          acc += hOf(rows[i], i);
        }
        if (cut === rows.length) cut = Math.ceil(rows.length / 2);
        cols = [rows.slice(0, cut), rows.slice(cut)];
      }
      const colH = (list) => list.reduce((a, r, i) => a + hOf(r, i), 0);
      // 空白を作りすぎない：行の高さと文字を、枠に合わせて広げる（最大 1.45 倍）。入らなければ縮める
      const k = Math.max(0.6, Math.min(1.45, c.area.h / Math.max(...cols.map(colH))));
      const gapC = 28;
      const colW = cols.length === 2 ? (c.area.w - gapC) / 2 : c.area.w;
      cols.forEach((list, ci) => {
        const x0 = c.area.x + ci * (colW + gapC);
        let y = c.area.y;
        list.forEach((r, i) => {
          if (r.kind === "head") {
            if (i) y += GAPG * k;
            const h = HEAD * k;
            const box = Math.min(h - 6, 28 * k);
            els.push(rect(x0, y + (h - box) / 2, box, box, { fill: th.primary }));
            els.push(text(x0, y + (h - box) / 2, box, box, [{ runs: runs(String(r.no)), level: 0 }], { size: 13 * k, bold: true, color: "FFFFFF", align: "ctr", valign: "ctr", inset: 0 }));
            els.push(text(x0 + box + 10, y, colW - box - 70, h, [{ runs: runs(r.title), level: 0 }], { size: 16 * k, minSize: 9, bold: true, color: th.primary, valign: "ctr", inset: 2 }));
            if (r.page) els.push(text(x0 + colW - 56, y, 56, h, [{ runs: runs(String(r.page)), level: 0 }], { size: 14 * k, bold: true, color: th.primary, align: "r", valign: "ctr", inset: 2 }));
            els.push(line(x0, y + h, x0 + colW, y + h, th.primary, 1));
            y += h;
          } else {
            const h = ITEM * k;
            const ind = r.loose ? 4 : 38 * Math.min(1, k);
            const size = 12.5 * k;
            const tw = Math.min(colW - ind - 60, GK.flow.textW(r.title, size) + 10);
            els.push(text(x0 + ind, y, colW - ind - 50, h, [{ runs: runs(r.title), level: 0 }], { size, minSize: 8, color: th.text, valign: "ctr", inset: 2 }));
            // 題名とページ番号を点線でつなぐ
            if (r.page) {
              els.push(line(x0 + ind + tw, y + h * 0.62, x0 + colW - 40, y + h * 0.62, th.line, 0.75, true));
              els.push(text(x0 + colW - 40, y, 40, h, [{ runs: runs(String(r.page)), level: 0 }], { size: 12 * k, color: th.sub, align: "r", valign: "ctr", inset: 2 }));
            }
            y += h;
          }
        });
      });
      return els;
    },
    summary(s, ctx, th) {
      const c = chrome(s, ctx, th);
      const pts = (s.points || []).map((p) => (typeof p === "string" ? { head: "", text: p } : p));
      const n = Math.max(pts.length, 1), gap = 8;
      // 行の高さは中身の量に合わせて配分する。全行で同じ文字の大きさのまま、できるだけ大きくする（空白を作りすぎない）
      const bodyW = (p) => c.area.w - (p.head ? 218 : 0);
      const ps = pts.map((p) => paras(p.text ?? p.items ?? "", { bullet: Array.isArray(p.text ?? p.items) }));
      const need = (size) => pts.map((p, i) => Math.max(size * LH * 2, textHeight(ps[i], bodyW(p), size, 10, 0.3)));
      const room = c.area.h - gap * (n - 1);
      let size = 18;
      while (size > 9 && need(size).reduce((a, b) => a + b, 0) > room) size -= 0.5;
      const needs = need(size);
      const extra = Math.max(0, room - needs.reduce((a, b) => a + b, 0)) / n;
      let y = c.area.y;
      const heads = [];
      pts.forEach((p, i) => {
        const rowH = needs[i] + extra;
        if (p.head) {
          c.els.push(rect(c.area.x, y, 210, rowH, { fill: th.primary }));
          const t = text(c.area.x, y, 210, rowH, [{ runs: runs(p.head), level: 0 }], { size: 15, minSize: 10, maxSize: 17, bold: true, color: "FFFFFF", valign: "ctr", align: "ctr", inset: 8 });
          c.els.push(t);
          heads.push(t);
        }
        const x = p.head ? c.area.x + 218 : c.area.x;
        c.els.push(rect(x, y, c.area.x + c.area.w - x, rowH, { fill: th.alt, line: th.line, lineW: 0.5 }));
        c.els.push(text(x, y, c.area.x + c.area.w - x, rowH, ps[i], { size, minSize: 9, valign: "ctr", inset: 10, gap: 0.3 }));
        y += rowH + gap;
      });
      sameSize(heads);
      return c.els;
    },
    content(s, ctx, th) {
      const c = chrome(s, ctx, th);
      const box = s.box;
      const a = Object.assign({}, c.area);
      if (box) {
        const bw = 290;
        a.w = c.area.w - bw - 16;
        const bx = c.area.x + a.w + 16;
        c.els.push(rect(bx, a.y, bw, 28, { fill: th.primary }));
        c.els.push(text(bx, a.y, bw, 28, [{ runs: runs(box.title || "ポイント"), level: 0 }], { size: 12, bold: true, color: "FFFFFF", valign: "ctr", inset: 8 }));
        c.els.push(rect(bx, a.y + 28, bw, a.h - 28, { fill: th.light }));
        c.els.push(text(bx, a.y + 28, bw, a.h - 28, paras(box.items ?? box.text ?? "", { bullet: true }), { size: 14, minSize: 9, maxSize: 17, inset: 10 }));
      }
      const body = s.bullets ?? s.body ?? s.items ?? "";
      c.els.push(bulletsBox(a, body, 16));
      return c.els;
    },
    compare(s, ctx, th) {
      const c = chrome(s, ctx, th);
      const concl = s.conclusion;
      const ch = concl ? 46 : 0;
      const colW = (c.area.w - 16) / 2;
      const h = c.area.h - (concl ? ch + 12 : 0);
      const bodies = [];
      [s.left || {}, s.right || {}].forEach((col, i) => {
        const x = c.area.x + i * (colW + 16);
        const color = i === 0 ? th.primary : th.accent;
        c.els.push(rect(x, c.area.y, colW, 34, { fill: color }));
        c.els.push(text(x, c.area.y, colW, 34, [{ runs: runs(col.head || col.title || (i ? "案B" : "案A")), level: 0 }], { size: 14, minSize: 10, bold: true, color: "FFFFFF", valign: "ctr", align: "ctr", inset: 6 }));
        c.els.push(rect(x, c.area.y + 34, colW, h - 34, { fill: "FFFFFF", line: color, lineW: 1 }));
        const t = text(x + 4, c.area.y + 38, colW - 8, h - 42, paras(col.items ?? col.text ?? "", { bullet: true }), { size: 15, minSize: 9, maxSize: 19, inset: 8 });
        c.els.push(t);
        bodies.push(t);
      });
      sameSize(bodies);
      if (concl) {
        const y = c.area.y + h + 12;
        c.els.push(rect(c.area.x, y, c.area.w, ch, { fill: th.light }));
        c.els.push(rect(c.area.x, y, 4, ch, { fill: th.accent }));
        c.els.push(text(c.area.x + 10, y, c.area.w - 14, ch, [{ runs: runs(concl), level: 0 }], { size: 13, minSize: 10, bold: true, color: th.primary, valign: "ctr", inset: 6 }));
      }
      return c.els;
    },
    table(s, ctx, th) {
      const c = chrome(s, ctx, th);
      const noteH = s.note ? 30 : 0;
      const cols = s.columns || [];
      const rows = (s.rows || []).map((r) => (Array.isArray(r) ? r : cols.map((k) => r[k] ?? "")));
      const t = tableEl(c.area.x, c.area.y, c.area.w, c.area.h - noteH, cols, rows, th, { ratios: s.widths });
      c.els.push(t);
      if (s.note) c.els.push(text(c.area.x, c.area.y + Math.min(t.h, c.area.h - noteH) + 4, c.area.w, noteH - 4, paras(s.note, { bullet: false }), { size: 10, minSize: 8, color: th.sub }));
      return c.els;
    },
    issues(s, ctx, th) {
      const c = chrome(s, ctx, th);
      const cols = s.columns || ["課題", "原因", "対応方針", "担当", "期限"];
      const keys = ["issue", "cause", "action", "owner", "due"];
      const rows = (s.rows || []).map((r) => (Array.isArray(r) ? r : keys.map((k) => r[k] ?? "")));
      c.els.push(tableEl(c.area.x, c.area.y, c.area.w, c.area.h, cols, rows, th, { ratios: s.widths || [24, 22, 32, 11, 11] }));
      return c.els;
    },
    flow(s, ctx, th) {
      const c = chrome(s, ctx, th);
      const noteH = s.note ? 28 : 0;
      const aw = c.area.w, ah = c.area.h - noteH;
      // 箱の幅を変えて何通りか配置し、文字が一番大きく見えるものを選ぶ（横長の図は箱を細くして縦に伸ばす）
      // 題名はスライドのタイトルで示すので、図の中の title 行は使わない
      // 行の配列で書かれていても1つの文字列にする
      const flowSrc = (Array.isArray(s.flow) ? s.flow.join("\n") : String(s.flow || "")).replace(/^\s*(title|タイトル)(\s|[:：]).*$/gim, "");
      let r = null, best = -1;
      for (const nw of [128, 112, 98, 86]) {
        const cand = GK.flow.render(flowSrc, { nodeW: nw, decisionW: nw + 16, fontSize: 12, lineH: 15.5, gapMin: 28, laneHeaderW: 72, margin: 4, slotGap: 24, theme: { primary: "#" + th.primary, accent: "#" + th.accent } });
        if (!cand.geo) { r = cand; break; }
        const sc = Math.min(aw / cand.geo.width, ah / cand.geo.height, 1.45);
        if (sc > best + 0.01) { best = sc; r = cand; }
      }
      if (!r.geo) {
        const msg = r.graph.errors.map((e) => `${e.line} 行目：${e.message}`).slice(0, 8);
        c.els.push(text(c.area.x, c.area.y, c.area.w, c.area.h, [{ runs: runs("フロー記法のエラー"), level: 0 }, ...msg.map((m) => ({ runs: runs(m), level: 0, bullet: true }))], { size: 12, color: "C0392B" }));
        return c.els;
      }
      // タイトルはスライド側にあるので図の中には描かない
      const geo = r.geo;
      const scale = Math.min(aw / geo.width, ah / geo.height, 1.45);
      const w = geo.width * scale, h = geo.height * scale;
      c.els.push({ t: "flow", x: c.area.x + (aw - w) / 2, y: c.area.y + (ah - h) / 2, w, h, scale, geo, svg: r.svg, small: geo.fontSize * scale < 7.5 });
      if (s.note) c.els.push(text(c.area.x, c.area.y + ah + 2, c.area.w, noteH - 2, paras(s.note, { bullet: false }), { size: 10, minSize: 8, color: th.sub }));
      return c.els;
    },
    schedule(s, ctx, th) {
      const c = chrome(s, ctx, th);
      const periods = s.periods || [];
      const tasks = s.tasks || [];
      const ms = s.milestones || [];
      const hasOwner = tasks.some((t) => t.owner);
      const nameW = 210, ownerW = hasOwner ? 80 : 0;
      const gx = c.area.x + nameW + ownerW;
      const pw = periods.length ? (c.area.x + c.area.w - gx) / periods.length : 0;
      const headH = 28;
      const msH = ms.length ? 30 : 0;
      // 行の高さは枠いっぱいまで広げる（空白を作りすぎない）。文字も行に合わせて大きくする
      const rowH = Math.min(44, (c.area.h - headH - msH) / Math.max(tasks.length, 1));
      const idx = (v) => (typeof v === "number" ? v : Math.max(0, periods.indexOf(String(v))));
      const size = Math.max(8, Math.min(13, rowH * 0.42));
      c.els.push(rect(c.area.x, c.area.y, c.area.w, headH, { fill: th.primary }));
      c.els.push(text(c.area.x, c.area.y, nameW, headH, [{ runs: runs("タスク"), level: 0 }], { size: 11, bold: true, color: "FFFFFF", valign: "ctr", inset: 6 }));
      if (hasOwner) c.els.push(text(c.area.x + nameW, c.area.y, ownerW, headH, [{ runs: runs("担当"), level: 0 }], { size: 11, bold: true, color: "FFFFFF", valign: "ctr", align: "ctr" }));
      periods.forEach((p, i) => c.els.push(text(gx + i * pw, c.area.y, pw, headH, [{ runs: runs(p), level: 0 }], { size: 10, minSize: 7, bold: true, color: "FFFFFF", valign: "ctr", align: "ctr", inset: 1 })));
      const y0 = c.area.y + headH;
      const bodyH = rowH * tasks.length + msH;
      tasks.forEach((t, i) => {
        const y = y0 + i * rowH;
        if (i % 2 === 0) c.els.push(rect(c.area.x, y, c.area.w, rowH, { fill: th.alt }));
        const isGroup = !!t.group;
        const ind = isGroup ? 2 : 12;
        c.els.push(text(c.area.x + ind, y, nameW - ind, rowH, [{ runs: runs(t.name || t.group || ""), level: 0 }], { size, minSize: 7, bold: isGroup, color: isGroup ? th.primary : th.text, valign: "ctr" }));
        if (hasOwner) c.els.push(text(c.area.x + nameW, y, ownerW, rowH, [{ runs: runs(t.owner || ""), level: 0 }], { size: size - 0.5, minSize: 7, color: th.sub, valign: "ctr", align: "ctr", inset: 2 }));
        if (t.start != null && periods.length) {
          const a = idx(t.start), b = idx(t.end ?? t.start);
          const bx = gx + a * pw + 3, bw = Math.max(6, (b - a + 1) * pw - 6);
          c.els.push(rect(bx, y + rowH * 0.25, bw, rowH * 0.5, { fill: isGroup ? th.primary : th.accent, shape: "roundRect" }));
        }
      });
      for (let i = 0; i <= periods.length; i++) c.els.push(line(gx + i * pw, y0, gx + i * pw, y0 + bodyH, th.line, 0.5));
      c.els.push(line(c.area.x, y0 + bodyH, c.area.x + c.area.w, y0 + bodyH, th.line, 0.75));
      if (ms.length) {
        const my = y0 + rowH * tasks.length;
        c.els.push(text(c.area.x, my, nameW, msH, [{ runs: runs("マイルストーン"), level: 0 }], { size: 10, bold: true, color: th.primary, valign: "ctr", inset: 6 }));
        ms.forEach((m) => {
          const cx = gx + (idx(m.at) + 0.5) * pw;
          c.els.push(rect(cx - 6, my + 4, 12, 12, { fill: "C0392B", shape: "diamond" }));
          c.els.push(text(cx - 60, my + 15, 120, 12, [{ runs: runs(m.label || ""), level: 0 }], { size: 9, minSize: 6.5, color: th.text, align: "ctr", inset: 0 }));
        });
      }
      return c.els;
    },
    conclusion(s, ctx, th) {
      const c = chrome(Object.assign({ title: "まとめ" }, s), ctx, th);
      const next = s.next || s.actions;
      const a = Object.assign({}, c.area);
      if (next) {
        const bw = 330;
        a.w = c.area.w - bw - 16;
        const bx = c.area.x + a.w + 16;
        c.els.push(rect(bx, a.y, bw, 30, { fill: th.accent }));
        c.els.push(text(bx, a.y, bw, 30, [{ runs: runs(s.nextTitle || "次のアクション"), level: 0 }], { size: 13, bold: true, color: "FFFFFF", valign: "ctr", inset: 8 }));
        // 次のアクションも1件ずつのカードにして、枠の高さいっぱいに並べる
        const acts = paras(next, { bullet: false }).filter((p) => p.level === 0);
        const gap = 8, top = a.y + 38, n = Math.max(1, acts.length);
        const rh = (a.y + a.h - top - gap * (n - 1)) / n;
        const cards = acts.map((p, i) => {
          const y = top + i * (rh + gap);
          c.els.push(rect(bx, y, bw, rh, { fill: "FFFBF0", line: "E9D3A3", lineW: 0.5 }));
          c.els.push(rect(bx, y, 5, rh, { fill: th.accent }));
          const t = text(bx + 12, y, bw - 16, rh, [Object.assign({}, p, { bullet: false })], { size: 14, minSize: 9, maxSize: 18, valign: "ctr", inset: 6 });
          c.els.push(t);
          return t;
        });
        sameSize(cards);
      }
      // 要点は番号付きのカードを縦に並べ、枠いっぱいに広げる（空白を作りすぎない）
      const pts = paras(s.points ?? s.bullets ?? "", { bullet: false }).filter((p) => p.level === 0);
      if (pts.length && pts.length <= 6) {
        const gap = 10, n = pts.length;
        const rowH = (a.h - gap * (n - 1)) / n;
        sameSize(pts.map((p, i) => {
          const y = a.y + i * (rowH + gap);
          c.els.push(rect(a.x, y, a.w, rowH, { fill: th.alt, line: th.line, lineW: 0.5 }));
          c.els.push(rect(a.x, y, 46, rowH, { fill: th.primary }));
          c.els.push(text(a.x, y, 46, rowH, [{ runs: runs(String(i + 1)), level: 0 }], { size: 20, bold: true, color: "FFFFFF", align: "ctr", valign: "ctr", inset: 0 }));
          const t = text(a.x + 58, y, a.w - 66, rowH, [Object.assign({}, p, { bullet: false })], { size: 16, minSize: 10, maxSize: 21, valign: "ctr", inset: 6 });
          c.els.push(t);
          return t;
        }));
      } else {
        c.els.push(bulletsBox(a, s.points ?? s.bullets ?? "", 17));
      }
      return c.els;
    },
  };

  // ---------- 入口 ----------
  // Gemini の出力をそのまま貼れるように、```json の囲みと末尾のカンマを許す
  function parseDeck(src) {
    let s = String(src || "").trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    s = s.replace(/,\s*([}\]])/g, "$1");
    try {
      const v = JSON.parse(s);
      const deck = Array.isArray(v) ? { slides: v } : v;
      if (!deck || !Array.isArray(deck.slides)) return { error: "「slides」の配列がありません" };
      return { deck };
    } catch (e) {
      const m = String(e.message).match(/position (\d+)/);
      if (m) {
        const pos = +m[1];
        const before = s.slice(0, pos);
        const ln = before.split("\n").length;
        return { error: `JSON の書き方に誤りがあります（${ln} 行目付近）：${e.message}` };
      }
      return { error: "JSON の書き方に誤りがあります：" + e.message };
    }
  }

  // 目次の中身。章扉ごとに、次の章扉までのスライドをまとめる。Appendix は最後にまとめる
  function tocGroups(slides, explicit) {
    if (explicit && explicit.length) {
      // items が書かれていれば、それを章として並べる（ページ番号なし）
      return explicit.map((it, i) => ({ head: true, no: i + 1, title: typeof it === "object" ? it.text || it.title || "" : String(it), page: null, items: [] }));
    }
    const titleOf = (sl) => sl.title || { summary: "エグゼクティブサマリ", conclusion: "まとめ" }[sl.type] || "";
    const loose = { head: false, items: [] };
    const groups = [loose];
    const appendix = { head: true, no: "A", title: "Appendix", page: null, items: [] };
    let cur = null;
    slides.forEach((sl, i) => {
      if (!sl || typeof sl !== "object" || sl.type === "cover" || sl.type === "toc") return;
      const page = i + 1;
      if (sl.appendix) { if (!appendix.page) appendix.page = page; appendix.items.push({ title: titleOf(sl), page }); return; }
      if (sl.type === "section") {
        cur = { head: true, no: sl.no != null && sl.no !== "" ? sl.no : groups.length, title: sl.title || "", page, items: [] };
        groups.push(cur);
        return;
      }
      (cur || loose).items.push({ title: titleOf(sl), page });
    });
    if (appendix.items.length) groups.push(appendix);
    return groups.filter((g) => g.head || g.items.length);
  }

  function layoutDeck(deckIn, themeIn) {
    const th = Object.assign({}, DEFAULT_THEME, themeIn || {});
    if (deckIn.footer && !th.footer) th.footer = deckIn.footer;
    // 目次がなく章扉が2つ以上あれば、表紙の次に目次を自動で入れる
    let slides = deckIn.slides.slice();
    const isObj = (x) => x && typeof x === "object";
    if (!slides.some((x) => isObj(x) && x.type === "toc") && slides.filter((x) => isObj(x) && x.type === "section").length >= 2) {
      const at = isObj(slides[0]) && slides[0].type === "cover" ? 1 : 0;
      slides.splice(at, 0, { type: "toc", auto: true });
    }
    const deck = Object.assign({}, deckIn, { slides });
    const total = slides.length;
    const warnings = [];
    const pages = slides.map((s0, i) => {
      const s = s0 && typeof s0 === "object" ? s0 : { type: "content", bullets: String(s0) };
      let type = s.type || "content";
      if (!LAYOUTS[type]) { warnings.push({ slide: i + 1, message: `type「${type}」は使えません。本文（content）として表示します` }); type = "content"; }
      const warn = (message) => warnings.push({ slide: i + 1, message });
      const els = LAYOUTS[type](s, { no: i + 1, total, warn }, th, deck);
      for (const el of els) {
        if (el.overflow) { warnings.push({ slide: i + 1, message: "文字が枠からあふれています。文章を短くするか、スライドを分けてください" }); break; }
      }
      if (els.some((el) => el.t === "flow" && el.small)) warnings.push({ slide: i + 1, message: "フロー図の文字が小さすぎます（7.5pt 未満）。段を減らすか、図を分けてください" });
      return { type, els, notes: s.notes || "" };
    });
    return { W, H, pages, warnings, theme: th };
  }

  GK.slides = { parseDeck, layoutDeck, TYPES, TYPE_LABEL, W, H, LH, DEFAULT_THEME, runs, paras };
})(globalThis.GK = globalThis.GK || {});
