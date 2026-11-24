// Google への出口。Markdown と表を、Google ドキュメント・スプレッドシート・スライド・NotebookLM が読める形にする（DOM を使わない）。
//   docx(md)        Markdown → .docx（Drive にアップロードすると Google ドキュメントで開ける）
//   richHTML(md)    Markdown → 貼り付け用の HTML（インラインの style。Docs に貼ると見出し・表が保たれる）
//   parseTable(t)   Markdown の表・TSV・CSV → 行の配列
//   tsv(rows) / tableHTML(rows)  スプレッドシートに貼る形
//   xlsx(sheets)    行の配列 → .xlsx（見出しの固定・列幅・罫線・数値・数式）
//   notebookMd(md)  NotebookLM のソース用 .md（先頭に案内）
//   slidesCheck(deck, layout)  Google スライドで開くときの点検
// zip は pptx.js のもの（GK.pptx.zip）を使う。
(function (GK) {
  "use strict";

  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const LATIN = "Arial", EA = "メイリオ";
  const x = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const h = x; // HTML のエスケープも同じ
  const rels = (items) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  // ---------- 行内の書式（**太字** *斜体* `コード`） ----------
  function inline(s) {
    const out = [];
    const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*?)\*)/g;
    let last = 0, m;
    const t = String(s ?? "");
    while ((m = re.exec(t))) {
      if (m.index > last) out.push({ t: t.slice(last, m.index) });
      if (m[2] != null || m[3] != null) out.push({ t: m[2] ?? m[3], b: true });
      else if (m[4] != null) out.push({ t: m[4], code: true });
      else out.push({ t: m[5], i: true });
      last = re.lastIndex;
    }
    if (last < t.length) out.push({ t: t.slice(last) });
    // [文字](URL) はリンクにせず「文字（URL）」にする（外へのリンクを作らない）
    return out.map((r) => (r.code ? r : Object.assign(r, { t: r.t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1（$2）") })));
  }
  const plain = (s) => inline(s).map((r) => r.t).join("");

  // ---------- docx ----------
  function run(r, extra) {
    const pr = [];
    if (r.b) pr.push("<w:b/>");
    if (r.i) pr.push("<w:i/>");
    if (r.code) pr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="EEF1F5"/>');
    if (extra) pr.push(extra);
    const parts = String(r.t).split("\n");
    const body = parts.map((p, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${x(p)}</w:t>`).join("");
    return `<w:r>${pr.length ? `<w:rPr>${pr.join("")}</w:rPr>` : ""}${body}</w:r>`;
  }
  const para = (text, ppr, extra) => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${inline(text).map((r) => run(r, extra)).join("")}</w:p>`;

  function docxBody(md) {
    const blocks = GK.md.parse(String(md ?? ""));
    const out = [];
    const nums = []; // 番号つきの箇条書きごとに 1 から振り直す
    for (const b of blocks) {
      if (b.type === "heading") out.push(para(plain(b.text), `<w:pStyle w:val="Heading${Math.min(b.level, 4)}"/>`));
      else if (b.type === "para") out.push(para(b.text.replace(/\n/g, " ")));
      else if (b.type === "quote") out.push(para(b.text, '<w:pStyle w:val="Quote"/>'));
      else if (b.type === "hr") out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9D2DE"/></w:pBdr></w:pPr></w:p>');
      else if (b.type === "code") {
        if (b.lang === "flow") out.push(para("フロー図（記法）：gemini-agent のフロー図タブに貼ると図になります", '<w:pStyle w:val="Caption"/>'));
        for (const line of String(b.text).split("\n")) out.push(`<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${run({ t: line })}</w:p>`);
      } else if (b.type === "list") {
        // 番号つきが始まるたびに番号の組を新しく作る（箇条書きと番号つきが 1 つの塊に混ざることがある）。
        // 箇条書きは組 1。段ごとの書式は numbering.xml の段で決まる
        const walk = (items, lvl) => {
          let numId = 1, prevOrdered = false;
          for (const it of items) {
            if (it.ordered && !prevOrdered) { nums.push(it.num || 1); numId = 1 + nums.length; }
            if (!it.ordered) numId = 1;
            prevOrdered = it.ordered;
            const mark = it.check == null ? "" : it.check ? "☑ " : "☐ ";
            out.push(para(mark + it.text, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${Math.min(lvl, 2)}"/><w:numId w:val="${numId}"/></w:numPr>`));
            if (it.children && it.children.length) walk(it.children, lvl + 1);
          }
        };
        walk(b.items, 0);
      } else if (b.type === "table") {
        const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length));
        const W = 9638, cw = Math.floor(W / Math.max(1, cols));
        const cell = (text, head, al) => `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EDF4"/>' : ""}</w:tcPr>${para(text, al === "right" ? '<w:jc w:val="right"/>' : al === "center" ? '<w:jc w:val="center"/>' : "", head ? "<w:b/>" : "")}</w:tc>`;
        const row = (cells, head) => `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${[...Array(cols).keys()].map((i) => cell(cells[i] ?? "", head, b.align && b.align[i])).join("")}</w:tr>`;
        const bd = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="B7C2D0"/>`;
        out.push(`<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(bd).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${[...Array(cols)].map(() => `<w:gridCol w:w="${cw}"/>`).join("")}</w:tblGrid>${row(b.head, true)}${b.rows.map((r) => row(r, false)).join("")}</w:tbl>`);
        out.push("<w:p/>");
      }
    }
    return { xml: out.join(""), orderedLists: nums };
  }

  function numberingXml(starts) {
    const lvl = (i, fmt, text, ind) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr>${fmt === "bullet" ? `<w:rPr><w:rFonts w:ascii="${LATIN}" w:hAnsi="${LATIN}"/></w:rPr>` : ""}</w:lvl>`;
    const bullet = `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, "bullet", "•", 420)}${lvl(1, "bullet", "◦", 840)}${lvl(2, "bullet", "▪", 1260)}</w:abstractNum>`;
    const dec = `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, "decimal", "%1.", 420)}${lvl(1, "decimal", "%2)", 840)}${lvl(2, "lowerRoman", "%3.", 1260)}</w:abstractNum>`;
    const nums = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>', ...starts.map((s, i) => `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${s}"/></w:lvlOverride></w:num>`)];
    return `${HEAD}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${bullet}${dec}${nums.join("")}</w:numbering>`;
  }

  function stylesXml() {
    const fonts = (f) => `<w:rFonts w:ascii="${f || LATIN}" w:hAnsi="${f || LATIN}" w:eastAsia="${EA}" w:cs="${LATIN}"/>`;
    const heading = (n, sz, before) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/>${n === 1 ? '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="1F3A5F"/></w:pBdr>' : ""}</w:pPr><w:rPr><w:b/><w:color w:val="1F3A5F"/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
    return `${HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:docDefaults><w:rPrDefault><w:rPr>${fonts()}<w:sz w:val="21"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3A5F"/><w:sz w:val="40"/></w:rPr></w:style>` +
      heading(1, 32, 360) + heading(2, 27, 280) + heading(3, 23, 200) + heading(4, 21, 160) +
      `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="B8892B"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:color w:val="4A5563"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F5F8"/><w:spacing w:after="0" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr>${fonts("Consolas")}<w:sz w:val="18"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="5A6573"/><w:sz w:val="18"/></w:rPr></w:style>` +
      `</w:styles>`;
  }

  // md → Uint8Array（.docx）。opts.title は文書のプロパティと、先頭に見出しが無いときの表題
  function docx(md, opts) {
    const o = opts || {};
    const body = docxBody(md);
    const title = o.title || (String(md).match(/^#\s+(.+)$/m) || [])[1] || "文書";
    const iso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const doc = `${HEAD}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.xml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const files = [
      { name: "[Content_Types].xml", data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
      { name: "_rels/.rels", data: rels([["rId1", `${R}/officeDocument`, "word/document.xml"], ["rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"]]) },
      { name: "docProps/core.xml", data: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>${x(o.author || "")}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>` },
      { name: "word/_rels/document.xml.rels", data: rels([["rId1", `${R}/styles`, "styles.xml"], ["rId2", `${R}/numbering`, "numbering.xml"]]) },
      { name: "word/document.xml", data: doc },
      { name: "word/styles.xml", data: stylesXml() },
      { name: "word/numbering.xml", data: numberingXml(body.orderedLists) },
    ];
    return GK.pptx.zip(files);
  }

  // ---------- 貼り付け用の HTML（Google ドキュメント） ----------
  const FONT = `font-family:Arial,'メイリオ',Meiryo,sans-serif`;
  const ST = {
    h1: `${FONT};font-size:20pt;font-weight:bold;color:#1F3A5F;margin:18pt 0 6pt;border-bottom:2px solid #1F3A5F`,
    h2: `${FONT};font-size:15pt;font-weight:bold;color:#1F3A5F;margin:14pt 0 6pt`,
    h3: `${FONT};font-size:12.5pt;font-weight:bold;color:#1F3A5F;margin:10pt 0 4pt`,
    h4: `${FONT};font-size:11pt;font-weight:bold;color:#1F3A5F;margin:8pt 0 4pt`,
    p: `${FONT};font-size:10.5pt;line-height:1.6;margin:0 0 6pt`,
    li: `${FONT};font-size:10.5pt;line-height:1.6`,
    table: `border-collapse:collapse;width:100%;margin:4pt 0 10pt`,
    th: `${FONT};font-size:10pt;font-weight:bold;background:#E8EDF4;border:1px solid #B7C2D0;padding:4px 6px;text-align:left;vertical-align:top`,
    td: `${FONT};font-size:10pt;border:1px solid #B7C2D0;padding:4px 6px;vertical-align:top`,
    pre: `font-family:Consolas,monospace;font-size:9pt;background:#F3F5F8;padding:6px 8px;white-space:pre-wrap;margin:0 0 8pt`,
    quote: `${FONT};font-size:10.5pt;color:#4A5563;border-left:4px solid #B8892B;padding-left:10px;margin:0 0 8pt`,
    code: `font-family:Consolas,monospace;background:#EEF1F5`,
    cap: `${FONT};font-size:9pt;color:#5A6573;margin:0 0 4pt`,
  };
  const inlineHTML = (s) => inline(s).map((r) => (r.code ? `<code style="${ST.code}">${h(r.t)}</code>` : r.b ? `<b>${h(r.t)}</b>` : r.i ? `<i>${h(r.t)}</i>` : h(r.t))).join("");

  // opts.images: フロー図の画像（data:image/png;base64,…）を、文書の中の flow ブロックの順に並べた配列。無ければ記法のまま
  function richHTML(md, opts) {
    const o = opts || {};
    const blocks = GK.md.parse(String(md ?? ""));
    const out = [];
    let flowNo = 0;
    const list = (items) => {
      const ordered = items[0] && items[0].ordered;
      const tag = ordered ? "ol" : "ul";
      return `<${tag}${ordered && items[0].num > 1 ? ` start="${items[0].num}"` : ""} style="margin:0 0 6pt;padding-left:22pt">${items.map((it) => `<li style="${ST.li}">${it.check == null ? "" : it.check ? "☑ " : "☐ "}${inlineHTML(it.text)}${it.children && it.children.length ? list(it.children) : ""}</li>`).join("")}</${tag}>`;
    };
    for (const b of blocks) {
      if (b.type === "heading") { const n = Math.min(b.level, 4); out.push(`<h${n} style="${ST["h" + n]}">${inlineHTML(b.text)}</h${n}>`); }
      else if (b.type === "para") out.push(`<p style="${ST.p}">${inlineHTML(b.text.replace(/\n/g, " "))}</p>`);
      else if (b.type === "quote") out.push(`<blockquote style="${ST.quote}">${inlineHTML(b.text)}</blockquote>`);
      else if (b.type === "hr") out.push('<hr style="border:0;border-top:1px solid #C9D2DE">');
      else if (b.type === "list") out.push(list(b.items));
      else if (b.type === "table") {
        const th = b.head.map((c, i) => `<th style="${ST.th}${b.align && b.align[i] ? `;text-align:${b.align[i]}` : ""}">${inlineHTML(c)}</th>`).join("");
        const rows = b.rows.map((r) => `<tr>${b.head.map((_, i) => `<td style="${ST.td}${b.align && b.align[i] ? `;text-align:${b.align[i]}` : ""}">${inlineHTML(r[i] ?? "")}</td>`).join("")}</tr>`).join("");
        out.push(`<table style="${ST.table}"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`);
      } else if (b.type === "code") {
        if (b.lang === "flow" && o.images && o.images[flowNo]) {
          const img = o.images[flowNo];
          out.push(`<p style="${ST.p}"><img src="${h(img.src)}" width="${Math.round(img.w)}" height="${Math.round(img.h)}" alt="フロー図"></p>`);
        } else {
          if (b.lang === "flow") out.push(`<p style="${ST.cap}">フロー図（記法）：gemini-agent のフロー図タブに貼ると図になります</p>`);
          out.push(`<pre style="${ST.pre}">${h(b.text)}</pre>`);
        }
        if (b.lang === "flow") flowNo++;
      }
    }
    return `<meta charset="utf-8"><div style="${FONT}">${out.join("\n")}</div>`;
  }
  // 文書の中の flow ブロックの記法（画像にするため、画面側で SVG → PNG にする）
  const flowSources = (md) => GK.md.parse(String(md ?? "")).filter((b) => b.type === "code" && b.lang === "flow").map((b) => b.text);

  // ---------- 表 ----------
  function parseCsv(t, sep) {
    const rows = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) {
        if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"' && cur === "") q = true;
      else if (c === sep) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  }
  // Markdown の表・TSV・CSV → { rows（1 行目が見出し）, from }
  function parseTable(text) {
    const t = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!t) return { rows: [], from: "" };
    const md = GK.md.parse(t).find((b) => b.type === "table");
    if (md && /^\s*\|/.test(t)) return { rows: [md.head, ...md.rows].map((r) => r.map((c) => plain(c))), from: "markdown" };
    const first = t.split("\n")[0];
    if (first.includes("\t")) return { rows: parseCsv(t, "\t"), from: "tsv" };
    return { rows: parseCsv(t, ","), from: "csv" };
  }
  const tsvCell = (c) => { const s = String(c ?? ""); return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const tsv = (rows) => rows.map((r) => r.map(tsvCell).join("\t")).join("\n");
  function tableHTML(rows) {
    if (!rows.length) return "";
    const [head, ...body] = rows;
    return `<meta charset="utf-8"><table style="${ST.table}"><thead><tr>${head.map((c) => `<th style="${ST.th}">${h(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${head.map((_, i) => `<td style="${ST.td}">${h(r[i] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  // ---------- xlsx ----------
  const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // 表示幅（全角は 2）
  const dispW = (s) => [...String(s ?? "")].reduce((n, c) => n + (/[\u0000-ÿ｡-ﾟ]/.test(c) ? 1 : 2), 0);
  const NUM = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/;
  const NUM_COMMA = /^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/;
  // セルの塗り（WBS のガント）：{ v: "", style: "bar" | "crit" | "parent" | "off" }
  const CELL_STYLE = { bar: 4, crit: 5, parent: 6, off: 7 };
  function cellXml(ref, v, head) {
    if (v && typeof v === "object") {
      const st = CELL_STYLE[v.style];
      if (st != null && (v.v == null || v.v === "")) return `<c r="${ref}" s="${st}"/>`;
      v = v.v;
    }
    const s = String(v ?? "");
    if (head) return `<c r="${ref}" s="2" t="inlineStr"><is><t xml:space="preserve">${x(s)}</t></is></c>`;
    if (s === "") return `<c r="${ref}" s="1"/>`;
    if (s.startsWith("=") && s.length > 1) return `<c r="${ref}" s="1"><f>${x(s.slice(1))}</f></c>`;
    if (NUM.test(s)) return `<c r="${ref}" s="1"><v>${s}</v></c>`;
    if (NUM_COMMA.test(s)) return `<c r="${ref}" s="3"><v>${s.replace(/,/g, "")}</v></c>`;
    return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${x(s)}</t></is></c>`;
  }
  // opt.widths：列幅（無ければ文字数から）。opt.freeze：{ row, col } 固定する行・列の数（既定は見出しの 1 行）
  function sheetXml(rows, opt) {
    const o = opt || {};
    const val = (c) => (c && typeof c === "object" ? c.v : c);
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const widths = [...Array(cols).keys()].map((i) => (o.widths && o.widths[i]) || Math.min(60, Math.max(6, ...rows.slice(0, 500).map((r) => dispW(val(r[i])))) + 2));
    const last = `${colName(cols - 1)}${Math.max(1, rows.length)}`;
    const data = rows.map((r, ri) => `<row r="${ri + 1}">${[...Array(cols).keys()].map((ci) => cellXml(`${colName(ci)}${ri + 1}`, r[ci], ri === 0)).join("")}</row>`).join("");
    const fr = o.freeze || { row: 1, col: 0 };
    const pane = rows.length > 1 && (fr.row || fr.col)
      ? `<pane${fr.col ? ` xSplit="${fr.col}"` : ""}${fr.row ? ` ySplit="${fr.row}"` : ""} topLeftCell="${colName(fr.col || 0)}${(fr.row || 0) + 1}" activePane="${fr.col && fr.row ? "bottomRight" : fr.row ? "bottomLeft" : "topRight"}" state="frozen"/>`
      : "";
    return `${HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}">` +
      `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="16"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
      `<sheetData>${data}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ""}</worksheet>`;
  }
  const stylesXlsx = () => `${HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts>` +
    `<fonts count="2"><font><sz val="10"/><name val="${EA}"/><family val="3"/><charset val="128"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="${EA}"/><family val="3"/><charset val="128"/></font></fonts>` +
    `<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill>` +
    ["FF3B5B85", "FFB8892B", "FF9AAAC0", "FFEEF2F7"].map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`).join("") + `</fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB7C2D0"/></left><right style="thin"><color rgb="FFB7C2D0"/></right><top style="thin"><color rgb="FFB7C2D0"/></top><bottom style="thin"><color rgb="FFB7C2D0"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>` +
    // 4〜7：ガントの塗り（作業・余裕のない作業・親・土日）
    [3, 4, 5, 6].map((f) => `<xf numFmtId="0" fontId="0" fillId="${f}" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>`).join("") + `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  function sheetNames(list) {
    const used = new Set();
    return list.map((s, i) => {
      let base = String(s.name || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || `Sheet${i + 1}`;
      let n = base, k = 2;
      while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)}(${k++})`;
      used.add(n.toLowerCase());
      return n;
    });
  }
  // sheets: [{ name, rows }]（rows の 1 行目は見出し）→ Uint8Array
  function xlsx(sheets) {
    const list = (Array.isArray(sheets) ? sheets : [sheets]).filter(Boolean);
    if (!list.length) throw new Error("表がありません");
    const names = sheetNames(list);
    const CT = "application/vnd.openxmlformats-officedocument.spreadsheetml";
    const files = [
      { name: "[Content_Types].xml", data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join("")}</Types>` },
      { name: "_rels/.rels", data: rels([["rId1", `${R}/officeDocument`, "xl/workbook.xml"]]) },
      { name: "xl/workbook.xml", data: `${HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${list.some((s) => s.rows.length > 1) ? `<definedNames>${list.map((s, i) => (s.rows.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(names[i]).replace(/'/g, "''")}'!$A$1:$${colName(Math.max(1, ...s.rows.map((r) => r.length)) - 1)}$${s.rows.length}</definedName>` : "")).join("")}</definedNames>` : ""}</workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: rels([...list.map((_, i) => [`rId${i + 1}`, `${R}/worksheet`, `worksheets/sheet${i + 1}.xml`]), [`rId${list.length + 1}`, `${R}/styles`, "styles.xml"]]) },
      { name: "xl/styles.xml", data: stylesXlsx() },
      ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows.map((r) => r.map((c) => (c == null ? "" : typeof c === "object" ? c : String(c)))), { widths: s.widths, freeze: s.freeze }) })),
    ];
    return GK.pptx.zip(files);
  }

  // ---------- NotebookLM ----------
  // ソース用の .md。先頭に「何のファイルか」「入れ直し方」を書く（tableprep の案内と同じ考え方）
  function notebookMd(md, opts) {
    const o = opts || {};
    const title = o.title || (String(md).match(/^#\s+(.+)$/m) || [])[1] || "文書";
    const head = [
      `# ${title}（NotebookLM のソース）`,
      "",
      `> このファイルは gemini-agent から ${o.date || today()} に書き出した${o.kind || "文書"}です${o.version ? `（案件カルテ v${o.version} が元）` : ""}。`,
      "> 同じ名前の古いソースがノートブックにあれば、削除してからこのファイルを入れてください（古い版と新しい版が混ざると、回答が食い違います）。",
      "> 件数・合計はこのファイルの表の値を使い、NotebookLM で数え直さないでください。",
      "",
      "---",
      "",
    ].join("\n");
    return head + String(md ?? "").replace(/^\s+/, "") + (String(md ?? "").endsWith("\n") ? "" : "\n");
  }

  // ---------- Google スライドで開くときの点検 ----------
  // layout は GK.slides.layout の結果。deck はスライド JSON
  function slidesCheck(deck, layout) {
    const out = [];
    for (const w of (layout && layout.warnings) || []) out.push({ slide: w.slide, level: "warn", message: w.message });
    const slides = (deck && Array.isArray(deck.slides) && deck.slides) || [];
    slides.forEach((s, i) => {
      const texts = [];
      const walk = (v) => { if (typeof v === "string") texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.entries(v).forEach(([k, w]) => { if (k !== "type" && k !== "flow") walk(w); }); };
      walk(s);
      const chars = texts.join("").length;
      if (chars > 420) out.push({ slide: i + 1, level: "warn", message: `文字が多い（${chars} 字）。Google スライドでは字幅が変わり、あふれやすくなります。300 字以内を目安に分けてください` });
      const longLine = texts.find((t) => t.length > 90);
      if (longLine) out.push({ slide: i + 1, level: "info", message: `1 つの文が長い（${longLine.length} 字）。折り返し位置が PowerPoint と変わります` });
    });
    out.push({ slide: 0, level: "info", message: "Google スライドにはメイリオがありません。「Google スライド向け」で保存すると、日本語を Noto Sans JP にして書き出します（PowerPoint で使うなら通常の保存）" });
    return out;
  }

  GK.gexport = { inline, docx, richHTML, flowSources, parseTable, tsv, tableHTML, xlsx, notebookMd, slidesCheck, colName, dispW };
})(globalThis.GK = globalThis.GK || {});
