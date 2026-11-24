// Gemini・NotebookLM の画面に描かれた応答（HTML）を Markdown に戻す。コードブロックは言語名つきの囲みにする。
// content script から使う（ページの DOM を読むだけで、書き換えない）
(function (G) {
  "use strict";

  const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "UL", "OL", "TABLE", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "HR"]);
  const fenceFor = (code) => { let n = 3; const runs = code.match(/`{3,}/g) || []; for (const r of runs) n = Math.max(n, r.length + 1); return "`".repeat(n); };

  function inline(node) {
    let out = "";
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { out += c.nodeValue.replace(/\s+/g, " "); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === "BR") out += "\n";
      else if (t === "STRONG" || t === "B") { const s = inline(c).trim(); out += s ? `**${s}**` : ""; }
      else if (t === "EM" || t === "I") { const s = inline(c).trim(); out += s ? `*${s}*` : ""; }
      else if (t === "CODE") out += "`" + c.textContent + "`";
      else if (t === "SUP" && /^\s*\d+\s*$/.test(c.textContent)) out += `[${c.textContent.trim()}]`; // 出典番号
      else if (t === "BUTTON" || t === "MAT-ICON" || t === "SVG") continue;
      else out += inline(c);
    }
    return out;
  }

  // コードブロック：Gemini は <code-block> の中に言語名の札と <code> を置く
  function codeBlock(el, sel) {
    const codeEl = el.querySelector("code") || el.querySelector("pre") || el;
    const code = codeEl.textContent.replace(/\n$/, "");
    let lang = "";
    const label = sel && sel.codeLang ? el.querySelector(sel.codeLang) : null;
    if (label) lang = label.textContent.trim();
    if (!lang) { const m = (codeEl.className || "").match(/language-([\w-]+)/); if (m) lang = m[1]; }
    lang = lang.toLowerCase().replace(/[^\w-]/g, "");
    const f = fenceFor(code);
    return `${f}${lang}\n${code}\n${f}`;
  }

  function list(el, depth, sel) {
    const ordered = el.tagName === "OL";
    let i = +(el.getAttribute("start") || 1);
    const lines = [];
    for (const li of el.children) {
      if (li.tagName !== "LI") continue;
      const sub = [];
      let text = "";
      for (const c of li.childNodes) {
        if (c.nodeType === 1 && (c.tagName === "UL" || c.tagName === "OL")) sub.push(list(c, depth + 1, sel));
        else if (c.nodeType === 1 && c.tagName === "P") text += inline(c) + " ";
        else if (c.nodeType === 1) text += inline(c);
        else if (c.nodeType === 3) text += c.nodeValue.replace(/\s+/g, " ");
      }
      lines.push(`${"  ".repeat(depth)}${ordered ? `${i++}.` : "-"} ${text.trim()}`);
      lines.push(...sub);
    }
    return lines.join("\n");
  }

  function table(el) {
    const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => inline(td).trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
    if (!rows.length) return "";
    const n = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(n - r.length).fill("")];
    return [`| ${pad(rows[0]).join(" | ")} |`, `|${" --- |".repeat(n)}`, ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`)].join("\n");
  }

  function blocks(node, sel) {
    const out = [];
    let buf = "";
    const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ""; };
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { buf += c.nodeValue.replace(/\s+/g, " "); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (sel && sel.codeBlock && c.matches(sel.codeBlock)) { flush(); out.push(codeBlock(c, sel)); continue; }
      if (t === "PRE") { flush(); out.push(codeBlock(c, sel)); continue; }
      if (/^H[1-6]$/.test(t)) { flush(); out.push(`${"#".repeat(+t[1])} ${inline(c).trim()}`); continue; }
      if (t === "UL" || t === "OL") { flush(); out.push(list(c, 0, sel)); continue; }
      if (t === "TABLE") { flush(); out.push(table(c)); continue; }
      if (t === "BLOCKQUOTE") { flush(); out.push(blocks(c, sel).split("\n").map((l) => `> ${l}`).join("\n")); continue; }
      if (t === "HR") { flush(); out.push("---"); continue; }
      if (t === "P") { flush(); out.push(inline(c).trim()); continue; }
      if (t === "BUTTON" || t === "MAT-ICON" || t === "SVG" || t === "STYLE" || t === "SCRIPT") continue;
      // 入れ物の要素：中にブロックがあれば潜る。無ければ行内として扱う
      if ([...c.querySelectorAll("*")].some((d) => BLOCK.has(d.tagName) || (sel && sel.codeBlock && d.matches(sel.codeBlock)))) { flush(); const inner = blocks(c, sel); if (inner) out.push(inner); }
      else buf += inline(c);
    }
    flush();
    return out.filter(Boolean).join("\n\n");
  }

  G.gaDomToMd = (el, sel) => blocks(el, sel || {});
})(globalThis);
