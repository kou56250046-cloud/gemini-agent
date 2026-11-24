// スライドのプレビュー（DOM）。gemini-kit の app.js の slideDom / textDom を写したもの。PPTX と同じ配置（slides.js）を使う
(function (GK) {
  "use strict";

  const h = (...a) => GK.dom.el(...a);
  function parseSvg(svgText) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.querySelector("parsererror") || doc.documentElement.nodeName !== "svg") return h("p", { class: "err", text: "図を描けませんでした（使えない文字が入っていないか確かめてください）" });
    return document.importNode(doc.documentElement, true);
  }

  function slideDom(page, L) {
    const s = h("div", { class: "slide" });
    s.style.width = L.W + "px";
    s.style.height = L.H + "px";
    const LH = GK.slides.LH;
    for (const el of page.els) {
      if (el.t === "rect") {
        const d = h("div", { class: "el" });
        Object.assign(d.style, { left: el.x + "px", top: el.y + "px", width: el.w + "px", height: el.h + "px", background: el.fill ? "#" + el.fill : "transparent" });
        if (el.line) d.style.border = `${el.lineW || 0.75}px solid #${el.line}`;
        if (el.shape === "roundRect") d.style.borderRadius = Math.min(el.w, el.h) * 0.2 + "px";
        if (el.shape === "diamond") d.style.clipPath = "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)";
        if (el.shape === "ellipse") d.style.borderRadius = "50%";
        s.append(d);
      } else if (el.t === "line") {
        const d = h("div", { class: "el" });
        const horiz = Math.abs(el.y2 - el.y1) < Math.abs(el.x2 - el.x1);
        // 線の太さの中心を座標に合わせる（PowerPoint の線と同じ位置）
        Object.assign(d.style, { left: Math.min(el.x1, el.x2) - (horiz ? 0 : el.w / 2) + "px", top: Math.min(el.y1, el.y2) - (horiz ? el.w / 2 : 0) + "px", width: (horiz ? Math.abs(el.x2 - el.x1) : 0) + "px", height: (horiz ? 0 : Math.abs(el.y2 - el.y1)) + "px" });
        d.style[horiz ? "borderTop" : "borderLeft"] = `${el.w}px ${el.dash ? "dashed" : "solid"} #${el.color}`;
        s.append(d);
      } else if (el.t === "text") {
        s.append(textDom(el, LH));
      } else if (el.t === "table") {
        let y = el.y;
        for (const r of el.rows) {
          let x = el.x;
          r.cells.forEach((c, ci) => {
            const cell = textDom({ x, y, w: el.colW[ci], h: r.h, paras: c.paras, size: el.size, color: c.color, bold: c.bold, align: c.align, valign: "ctr", inset: el.inset }, LH);
            cell.style.background = "#" + c.fill;
            cell.style.border = `0.5px solid #${el.lineColor}`;
            s.append(cell);
            x += el.colW[ci];
          });
          y += r.h;
        }
      } else if (el.t === "flow") {
        const svg = parseSvg(el.svg);
        svg.setAttribute("width", el.w);
        svg.setAttribute("height", el.h);
        const d = h("div", { class: "el" }, svg);
        Object.assign(d.style, { left: el.x + "px", top: el.y + "px", width: el.w + "px", height: el.h + "px" });
        s.append(d);
      }
    }
    return s;
  }
  function textDom(el, LH) {
    const d = h("div", { class: "el txt v-" + (el.valign || "t") });
    Object.assign(d.style, { left: el.x + "px", top: el.y + "px", width: el.w + "px", height: el.h + "px", padding: (el.inset ?? 4) + "px", fontSize: el.size + "px", lineHeight: (el.lh || LH), color: "#" + (el.color || "222222"), textAlign: { l: "left", ctr: "center", r: "right" }[el.align || "l"] });
    if (el.bold) d.style.fontWeight = "bold";
    if (el.overflow) d.classList.add("overflow");
    const inner = h("div");
    el.paras.forEach((p, i) => {
      const ind = p.bullet ? el.size * 1.1 : 0;
      const marL = (p.bullet ? p.level + 1 : p.level) * el.size * 1.1;
      const pd = h("div", { class: "p" });
      Object.assign(pd.style, { paddingLeft: marL + "px", textIndent: -ind + "px", marginTop: i ? el.size * (el.gap ?? 0.35) + "px" : "0" });
      if (p.bullet) pd.append(h("span", { class: "bu", style: `width:${ind}px`, text: p.level ? "–" : "•" }));
      for (const r of p.runs) {
        const sp = h("span", { text: r.t });
        if (r.b) sp.style.fontWeight = "bold";
        if (r.color) sp.style.color = "#" + r.color;
        pd.append(sp);
      }
      if (!p.runs.some((r) => r.t)) pd.append(" ");
      inner.append(pd);
    });
    d.append(inner);
    return d;
  }
  GK.preview = { parseSvg, slideDom, textDom };
})(globalThis.GK = globalThis.GK || {});
