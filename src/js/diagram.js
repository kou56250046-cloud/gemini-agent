// 図の共通部品（構成図・論点マップ・WBS のガント・解説ページで使う）。SVG は文字列で組み、文字はすべてエスケープする（DOM を使わない）
(function (GK) {
  "use strict";

  // 色はスライド（slides.js の DEFAULT_THEME）と同じ紺と金。強調は金だけ、ほかは紺の濃淡
  const C = {
    navy: "#1F3A5F", gold: "#B8892B", ink: "#222222", sub: "#5A6573", line: "#C9D1DC",
    light: "#EEF2F7", alt: "#F6F8FB", white: "#FFFFFF", goldSoft: "#FFF1D6", red: "#B3261E", redSoft: "#FDECEA", green: "#1A6B35", greenSoft: "#E6F2EC",
  };
  const FONT = "Arial, 'メイリオ', Meiryo, sans-serif";
  const esc = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const r1 = (n) => Math.round(n * 10) / 10;

  // 文字の幅と折り返しは flow.js と同じ計り方
  const textW = (s, size) => GK.flow.textW(s, size);
  function wrap(text, maxW, size, maxLines) {
    let lines = GK.flow.wrap(String(text ?? ""), maxW, size);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      let last = lines[maxLines - 1];
      while (last && textW(last + "…", size) > maxW) last = [...last].slice(0, -1).join("");
      lines[maxLines - 1] = last + "…";
    }
    return lines;
  }
  // 複数行の文字（中心 x・最初の行の中心 y）
  function textLines(lines, x, y, o) {
    const s = o.size || 12, lh = o.lh || s * 1.35;
    const top = y - ((lines.length - 1) * lh) / 2;
    return lines.map((l, i) => `<text x="${r1(x)}" y="${r1(top + i * lh)}" font-size="${s}" fill="${o.color || C.ink}"${o.bold ? ' font-weight="bold"' : ""} text-anchor="${o.anchor || "middle"}" dominant-baseline="central">${esc(l)}</text>`).join("");
  }
  function svgDoc(w, h, body, title) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" font-family="${FONT}" role="img"${title ? ` aria-label="${esc(title)}"` : ""}>` +
      `<defs><marker id="dg-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.sub}"/></marker></defs>` +
      `<rect x="0" y="0" width="${Math.ceil(w)}" height="${Math.ceil(h)}" fill="#fff"/>${body}</svg>`;
  }
  // 行ごとのエラー・警告を集める（flow.js と同じ形：{ line, message }）
  const issues = () => ({ errors: [], warnings: [] });

  GK.diagram = { C, FONT, esc, r1, textW, wrap, textLines, svgDoc, issues };
})(globalThis.GK = globalThis.GK || {});
