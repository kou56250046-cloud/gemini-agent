// slides.js の配置結果 → .pptx（Office Open XML）。ライブラリを使わず、XML を組んで無圧縮の zip に詰める。
// テキスト・表・図形はネイティブ要素で出すので、PowerPoint で編集できる。
// フォント：英数字 Arial、日本語 メイリオ。
(function (GK) {
  "use strict";

  const EMU = 12700; // 1pt
  const e = (pt) => Math.round(pt * EMU);
  const LATIN = "Arial", EA_DEFAULT = "メイリオ";
  // 日本語のフォント。meta.eaFont で替えられる（Google スライド向けは Noto Sans JP。Google スライドにメイリオが無いため）
  let EA = EA_DEFAULT;
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const CT = "application/vnd.openxmlformats-officedocument.presentationml";

  // XML に入れられない制御文字を除いてからエスケープする
  const x = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const hex = (c) => String(c || "000000").replace(/^#/, "").toUpperCase();
  const solid = (c) => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`;

  // ---------- zip（無圧縮） ----------
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files, date) {
    const enc = new TextEncoder();
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((s, c) => s + c.length, 0));
    let p = 0;
    for (const c of parts) { out.set(c, p); p += c.length; }
    return out;
  }

  // ---------- 図形 ----------
  function Ctx() { this.id = 1; }
  Ctx.prototype.next = function () { return ++this.id; };

  function rPr(size, o) {
    return `<a:rPr lang="ja-JP" altLang="en-US" sz="${Math.max(100, Math.round(size * 100))}"${o.b ? ' b="1"' : ' b="0"'} dirty="0">${solid(o.color)}<a:latin typeface="${LATIN}"/><a:ea typeface="${EA}"/><a:cs typeface="${LATIN}"/></a:rPr>`;
  }
  function parasXml(paras, size, color, bold, align, lh, gap) {
    const LH = GK.slides.LH;
    return paras.map((p, i) => {
      const ind = p.bullet ? size * 1.1 : 0;
      const marL = (p.bullet ? (p.level + 1) : p.level) * size * 1.1;
      const algn = { l: "l", ctr: "ctr", r: "r" }[p.align || align || "l"];
      const bu = p.bullet ? `<a:buFont typeface="Arial"/><a:buChar char="${p.level ? "–" : "•"}"/>` : "<a:buNone/>";
      const pPr = `<a:pPr marL="${e(marL)}" indent="${-e(ind)}" algn="${algn}"><a:lnSpc><a:spcPts val="${Math.round(size * (lh || LH) * 100)}"/></a:lnSpc><a:spcBef><a:spcPts val="${i ? Math.round(size * (gap ?? 0.35) * 100) : 0}"/></a:spcBef>${bu}</a:pPr>`;
      const rs = p.runs.filter((r) => r.t !== "").map((r) => `<a:r>${rPr(size, { b: r.b || bold, color: r.color || color })}<a:t>${x(r.t)}</a:t></a:r>`).join("");
      return `<a:p>${pPr}${rs}<a:endParaRPr lang="ja-JP" altLang="en-US" sz="${Math.round(size * 100)}" dirty="0"/></a:p>`;
    }).join("") || `<a:p><a:endParaRPr lang="ja-JP" sz="${Math.round(size * 100)}"/></a:p>`;
  }
  function txBody(el, wrap) {
    const ins = e(el.inset ?? 4);
    const anchor = { t: "t", ctr: "ctr", b: "b" }[el.valign || "t"];
    return `<p:txBody><a:bodyPr wrap="${wrap || "square"}" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${parasXml(el.paras, el.size, el.color, el.bold, el.align, el.lh, el.gap)}</p:txBody>`;
  }
  function lnXml(color, w, dash, arrow) {
    if (!color) return "<a:ln><a:noFill/></a:ln>";
    return `<a:ln w="${e(w || 0.75)}">${solid(color)}${dash ? '<a:prstDash val="dash"/>' : ""}${arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ""}</a:ln>`;
  }
  function sp(ctx, name, geom, el, extra) {
    const id = ctx.next();
    const fill = el.fill ? solid(el.fill) : "<a:noFill/>";
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${x(name)} ${id}"/><p:cNvSpPr${extra && extra.txBox ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${e(el.x)}" y="${e(el.y)}"/><a:ext cx="${Math.max(1, e(el.w))}" cy="${Math.max(1, e(el.h))}"/></a:xfrm>${geom}${fill}${lnXml(el.line, el.lineW, el.dash, el.arrow)}</p:spPr>` +
      `${extra && extra.body ? extra.body : ""}</p:sp>`;
  }
  const prst = (name) => `<a:prstGeom prst="${name}"><a:avLst/></a:prstGeom>`;

  function rectXml(ctx, el) {
    const shape = { rect: "rect", roundRect: "roundRect", diamond: "diamond", ellipse: "ellipse" }[el.shape] || "rect";
    return sp(ctx, "Shape", prst(shape), el);
  }
  function textXml(ctx, el) {
    return sp(ctx, "Text", prst("rect"), Object.assign({}, el, { line: el.lineColor }), { txBox: true, body: txBody(el) });
  }
  function lineXml(ctx, el) {
    const id = ctx.next();
    const xx = Math.min(el.x1, el.x2), yy = Math.min(el.y1, el.y2);
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${e(xx)}" y="${e(yy)}"/><a:ext cx="${e(Math.abs(el.x2 - el.x1))}" cy="${e(Math.abs(el.y2 - el.y1))}"/></a:xfrm>${prst("line")}${lnXml(el.color, el.w, el.dash)}</p:spPr></p:cxnSp>`;
  }
  function tableXml(ctx, el) {
    const id = ctx.next();
    const ins = e(el.inset);
    const border = (tag) => `<a:${tag} w="${e(0.5)}">${solid(el.lineColor)}</a:${tag}>`;
    const rows = el.rows.map((r) => `<a:tr h="${e(r.h)}">` + r.cells.map((c) =>
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${parasXml(c.paras, el.size, c.color, c.bold, c.align)}</a:txBody>` +
      `<a:tcPr marL="${ins}" marR="${ins}" marT="${ins}" marB="${ins}" anchor="ctr">${border("lnL")}${border("lnR")}${border("lnT")}${border("lnB")}${solid(c.fill)}</a:tcPr></a:tc>`).join("") + "</a:tr>").join("");
    return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="${e(el.x)}" y="${e(el.y)}"/><a:ext cx="${e(el.w)}" cy="${e(el.h)}"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${el.colW.map((w) => `<a:gridCol w="${e(w)}"/>`).join("")}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  }

  // フロー図：flow.js の座標を拡大縮小してネイティブ図形にする。まとめて動かせるようグループにする
  const NODE_GEOM = { start: "flowChartTerminator", end: "flowChartTerminator", task: "rect", decision: "flowChartDecision", data: "flowChartInputOutput", doc: "flowChartDocument", sub: "flowChartPredefinedProcess" };
  function flowXml(ctx, el, th) {
    const g = el.geo, s = el.scale;
    const X = (v) => el.x + v * s, Y = (v) => el.y + v * s;
    const parts = [];
    const one = (txt, size, color, bold) => [{ runs: [{ t: txt, b: bold, color }], level: 0 }];
    // 色はプレビューの SVG と同じ表から取る（レーン＝役割ごとの色、分岐の線の色）
    const P = GK.flow.palette(g, { primary: "#" + th.primary, accent: "#" + th.accent });
    const hx = (c) => String(c).replace(/^#/, "");
    g.lanes.forEach((ln, i) => {
      parts.push(rectXml(ctx, { x: X(g.left), y: Y(ln.y), w: (g.right - g.left) * s, h: ln.h * s, fill: hx(P.laneBand[i]), line: hx(P.laneLine), lineW: 0.5 }));
      const bar = GK.flow.LANE_BAR * s;
      parts.push(rectXml(ctx, { x: X(g.left), y: Y(ln.y), w: g.laneHeaderW * s, h: ln.h * s, fill: hx(P.laneFill[i]), line: hx(P.laneLine), lineW: 0.5 }));
      parts.push(rectXml(ctx, { x: X(g.left), y: Y(ln.y), w: bar, h: ln.h * s, fill: hx(P.laneStroke[i]) }));
      parts.push(sp(ctx, "Lane", prst("rect"), { x: X(g.left) + bar, y: Y(ln.y), w: g.laneHeaderW * s - bar, h: ln.h * s },
        { body: txBody({ paras: ln.lines.map((l) => ({ runs: [{ t: l }], level: 0 })), size: 13 * s, color: hx(P.laneText[i]), bold: true, align: "ctr", valign: "ctr", inset: 1 }, "none") }));
    });
    // 白い縁取りを下に敷き、交差した線を見分けられるようにする。分岐の色付きの線を後に描く
    const order = g.edges.slice().sort((a, b) => (a.tone == null ? 0 : 1) - (b.tone == null ? 0 : 1));
    for (const ed of order) {
      const xs = ed.points.map((p) => X(p[0])), ys = ed.points.map((p) => Y(p[1]));
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const w = Math.max(0.1, Math.max(...xs) - x0), h = Math.max(0.1, Math.max(...ys) - y0);
      const path = ed.points.map((p, k) => `<a:${k ? "lnTo" : "moveTo"}><a:pt x="${e(X(p[0]) - x0)}" y="${e(Y(p[1]) - y0)}"/></a:${k ? "lnTo" : "moveTo"}>`).join("");
      const geom = `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${Math.max(1, e(w))}" h="${Math.max(1, e(h))}" fill="none">${path}</a:path></a:pathLst></a:custGeom>`;
      parts.push(sp(ctx, "Halo", geom, { x: x0, y: y0, w, h, line: "FFFFFF", lineW: 3.5 }));
      parts.push(sp(ctx, "Arrow", geom, { x: x0, y: y0, w, h, line: hx(P.edge(ed)), lineW: ed.tone == null ? 1.25 : 1.5, dash: ed.dashed, arrow: true }));
    }
    for (const n of g.nodes) {
      const c = P.node(n);
      parts.push(sp(ctx, "Node", prst(NODE_GEOM[n.type] || "rect"), { x: X(n.x), y: Y(n.y), w: n.w * s, h: n.h * s, fill: hx(c.fill), line: hx(c.stroke), lineW: GK.flow.nodeLineW(n) },
        { body: txBody({ paras: n.lines.map((l) => ({ runs: [{ t: l }], level: 0 })), size: g.fontSize * s, lh: g.lineH / g.fontSize, color: hx(c.text), bold: n.type === "decision", align: "ctr", valign: "ctr", inset: 1 }, "none") }));
      if (n.notes.length) {
        const label = n.notes.map((v) => "※" + v).join(" ");
        const sz = 10 * s;
        parts.push(sp(ctx, "Note", prst("rect"), { x: X(n.x + n.w) - sz * 4, y: Y(n.y) - sz * 1.5, w: sz * 4, h: sz * 1.4 }, { txBox: true, body: txBody({ paras: one(label, sz, th.accent, true), size: sz, color: th.accent, bold: true, align: "r", valign: "b", inset: 0 }, "none") }));
      }
      // 区分の名前（AI・ルール判定など）を箱の左上に。SVG と同じ位置
      const rl = GK.flow.roleLabel(n);
      if (rl) {
        const sz = 10 * s, rc = hx(P.roleColor(n.role)), p = GK.flow.roleLabelPos(n);
        // SVG の文字の下端（p.y）に合わせる。分岐は箱の下、それ以外は箱の上
        const top = p.below ? Y(n.y + n.h) + 1 * s : Y(n.y) - sz * 1.5;
        parts.push(sp(ctx, "Role", prst("rect"), { x: X(p.x), y: top, w: GK.flow.textW(rl, sz) + sz, h: sz * 1.4 }, { txBox: true, body: txBody({ paras: one(rl, sz, rc, true), size: sz, color: rc, bold: true, align: "l", valign: p.below ? "t" : "b", inset: 0 }, "none") }));
      }
    }
    for (const ed of g.edges) {
      if (!ed.label || !ed.labelPos) continue;
      const sz = g.labelSize * s;
      const w = GK.flow.textW(ed.label, sz) + 4;
      const lx = ed.labelPos.anchor === "end" ? X(ed.labelPos.x) - w : X(ed.labelPos.x);
      parts.push(sp(ctx, "Label", prst("rect"), { x: lx, y: Y(ed.labelPos.y) - sz * 1.15, w, h: sz * 1.4, fill: "FFFFFF" }, { txBox: true, body: txBody({ paras: one(ed.label, sz, hx(P.edgeLabel(ed)), true), size: sz, color: hx(P.edgeLabel(ed)), bold: true, align: ed.labelPos.anchor === "end" ? "r" : "l", valign: "ctr", inset: 0 }, "none") }));
    }
    const lsz = 12 * s;
    // 区分の凡例：色見本＋名前を1行に。SVG と同じ座標
    if (g.roles && g.roles.length) {
      let lx = g.left;
      const head = "区分：";
      parts.push(sp(ctx, "RoleLegend", prst("rect"), { x: X(lx), y: Y(g.roleY) - 1.5 * s, w: (GK.flow.textW(head, 12) + 4) * s, h: 17 * s }, { txBox: true, body: txBody({ paras: one(head, lsz, "1E2530"), size: lsz, color: "1E2530", valign: "ctr", inset: 0 }, "none") }));
      lx += GK.flow.textW(head, 12) + 4;
      for (const r of g.roles) {
        const rc = hx(P.roleColor(r.key));
        parts.push(rectXml(ctx, { x: X(lx), y: Y(g.roleY), w: 14 * s, h: 14 * s, fill: hx(P.roleFill(r.key)), line: rc, lineW: 1.25 }));
        const tw = GK.flow.textW(r.name, 12) + 6;
        parts.push(sp(ctx, "RoleLegend", prst("rect"), { x: X(lx + 19), y: Y(g.roleY) - 1.5 * s, w: tw * s, h: 17 * s }, { txBox: true, body: txBody({ paras: one(r.name, lsz, rc, true), size: lsz, color: rc, bold: true, valign: "ctr", inset: 0 }, "none") }));
        lx += 19 + GK.flow.textW(r.name, 12) + 18;
      }
    }
    let ly = g.legendY;
    for (const nt of g.notes) for (const l of nt.text) {
      parts.push(sp(ctx, "Legend", prst("rect"), { x: X(g.left), y: Y(ly + 4), w: (g.right - g.left) * s, h: 17 * s }, { txBox: true, body: txBody({ paras: one(l, lsz, "1E2530"), size: lsz, color: "1E2530", valign: "ctr", inset: 0 }, "none") }));
      ly += 17;
    }
    const id = ctx.next();
    const off = `<a:off x="${e(el.x)}" y="${e(el.y)}"/><a:ext cx="${e(el.w)}" cy="${e(el.h)}"/>`;
    return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Flow ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm>${off}<a:chOff x="${e(el.x)}" y="${e(el.y)}"/><a:chExt cx="${e(el.w)}" cy="${e(el.h)}"/></a:xfrm></p:grpSpPr>${parts.join("")}</p:grpSp>`;
  }

  function slideXml(page, th) {
    const ctx = new Ctx();
    const body = page.els.map((el) => {
      switch (el.t) {
        case "rect": return rectXml(ctx, el);
        case "text": return textXml(ctx, el);
        case "line": return lineXml(ctx, el);
        case "table": return tableXml(ctx, el);
        case "flow": return flowXml(ctx, el, th);
        default: return "";
      }
    }).join("");
    return `${HEAD}<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  // ---------- パッケージ ----------
  function themeXml(th) {
    const c = (name, v) => `<a:${name}><a:srgbClr val="${hex(v)}"/></a:${name}>`;
    const font = (tag) => `<a:${tag}><a:latin typeface="${LATIN}"/><a:ea typeface="${EA}"/><a:cs typeface=""/></a:${tag}>`;
    const three = (s) => s + s + s;
    return `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="GeminiKit"><a:themeElements>` +
      `<a:clrScheme name="GeminiKit">${c("dk1", "000000")}${c("lt1", "FFFFFF")}${c("dk2", th.primary)}${c("lt2", th.light)}${c("accent1", th.primary)}${c("accent2", th.accent)}${c("accent3", "5A6573")}${c("accent4", "2E7D5B")}${c("accent5", "C0392B")}${c("accent6", "6B5B95")}${c("hlink", "1F5FA8")}${c("folHlink", "6B5B95")}</a:clrScheme>` +
      `<a:fontScheme name="GeminiKit">${font("majorFont")}${font("minorFont")}</a:fontScheme>` +
      `<a:fmtScheme name="GeminiKit"><a:fillStyleLst>${three('<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>')}</a:fillStyleLst>` +
      `<a:lnStyleLst>${three('<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>')}</a:lnStyleLst>` +
      `<a:effectStyleLst>${three("<a:effectStyle><a:effectLst/></a:effectStyle>")}</a:effectStyleLst>` +
      `<a:bgFillStyleLst>${three('<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>')}</a:bgFillStyleLst></a:fmtScheme>` +
      `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
  }
  const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
  const rels = (items) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;

  function build(layout, meta) {
    EA = (meta && meta.eaFont) || EA_DEFAULT;
    const th = layout.theme;
    const n = layout.pages.length;
    if (!n) throw new Error("スライドがありません");
    const now = new Date();
    const iso = now.toISOString().replace(/\.\d+Z$/, "Z");
    const files = [];
    const add = (name, data) => files.push({ name, data });
    const slideIdx = [...Array(n).keys()];
    add("[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.slideMaster+xml"/>` +
      `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.slideLayout+xml"/>` +
      slideIdx.map((i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT}.slide+xml"/>`).join("") +
      `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
      `<Override PartName="/ppt/presProps.xml" ContentType="${CT}.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="${CT}.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="${CT}.tableStyles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
    add("_rels/.rels", rels([["rId1", `${R}/officeDocument`, "ppt/presentation.xml"], ["rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"], ["rId3", `${R}/extended-properties`, "docProps/app.xml"]]));
    add("docProps/core.xml", `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(meta && meta.title)}</dc:title><dc:creator>${x(meta && meta.author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`);
    add("docProps/app.xml", `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office PowerPoint</Application><Slides>${n}</Slides></Properties>`);
    add("ppt/presentation.xml", `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIdx.map((i) => `<p:sldId id="${256 + i}" r:id="rId${6 + i}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    add("ppt/_rels/presentation.xml.rels", rels([
      ["rId1", `${R}/slideMaster`, "slideMasters/slideMaster1.xml"], ["rId2", `${R}/presProps`, "presProps.xml"], ["rId3", `${R}/viewProps`, "viewProps.xml"],
      ["rId4", `${R}/theme`, "theme/theme1.xml"], ["rId5", `${R}/tableStyles`, "tableStyles.xml"],
      ...slideIdx.map((i) => [`rId${6 + i}`, `${R}/slide`, `slides/slide${i + 1}.xml`]),
    ]));
    add("ppt/presProps.xml", `${HEAD}<p:presentationPr ${NS}/>`);
    add("ppt/viewProps.xml", `${HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
    add("ppt/tableStyles.xml", `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
    add("ppt/theme/theme1.xml", themeXml(th));
    const lvl = (sz) => `<a:lvl1pPr><a:defRPr sz="${sz}"><a:latin typeface="${LATIN}"/><a:ea typeface="${EA}"/></a:defRPr></a:lvl1pPr>`;
    add("ppt/slideMasters/slideMaster1.xml", `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${lvl(2800)}</p:titleStyle><p:bodyStyle>${lvl(1800)}</p:bodyStyle><p:otherStyle>${lvl(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`);
    add("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([["rId1", `${R}/slideLayout`, "../slideLayouts/slideLayout1.xml"], ["rId2", `${R}/theme`, "../theme/theme1.xml"]]));
    add("ppt/slideLayouts/slideLayout1.xml", `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="白紙">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", `${R}/slideMaster`, "../slideMasters/slideMaster1.xml"]]));
    layout.pages.forEach((page, i) => {
      add(`ppt/slides/slide${i + 1}.xml`, slideXml(page, th));
      add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([["rId1", `${R}/slideLayout`, "../slideLayouts/slideLayout1.xml"]]));
    });
    return zip(files, now);
  }

  GK.pptx = { build, zip, crc32 };
})(globalThis.GK = globalThis.GK || {});
