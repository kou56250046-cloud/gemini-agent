// Markdown → 構造 → DOM。Gemini が出す範囲（見出し・段落・表・入れ子の箇条書き・チェック・引用・コード・区切り線）に対応する。
// DOM は createElement / textContent で組む（貼られた文字列を HTML として解釈しない）。
// 描画の途中で差し込める口（text / inlineCode / code / heading / table）を用意し、文書ビューが ID や図を足す。
(function (GK) {
  "use strict";

  // ---------- パース ----------
  const RE = {
    fence: /^\s*(```|~~~)\s*([\w-]*)\s*$/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    tableRow: /^\s*\|.*\|\s*$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
    list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    quote: /^\s*>\s?(.*)$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
  };

  function splitRow(line) {
    let s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (s[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
      cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }

  // 戻り値：[{type, line, ...}]。line は 1 始まりの開始行
  function parse(src) {
    const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const start = i + 1;
      let m;
      if ((m = line.match(RE.fence))) {
        const mark = m[1];
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(mark)) buf.push(lines[i++]);
        i++;
        blocks.push({ type: "code", lang: m[2].toLowerCase(), text: buf.join("\n"), line: start, end: i });
        continue;
      }
      if ((m = line.match(RE.heading))) {
        blocks.push({ type: "heading", level: m[1].length, text: m[2], line: start, end: start });
        i++;
        continue;
      }
      if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        const head = splitRow(line);
        const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
        i += 2;
        const rows = [];
        while (i < lines.length && RE.tableRow.test(lines[i])) rows.push(splitRow(lines[i++]));
        blocks.push({ type: "table", head, align, rows, line: start, end: i });
        continue;
      }
      if (RE.list.test(line)) {
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const lm = l.match(RE.list);
          if (lm) {
            let text = lm[3];
            let check = null;
            const cb = text.match(/^\[( |x|X)\]\s*/);
            if (cb) { check = cb[1] !== " "; text = text.slice(cb[0].length); }
            items.push({ indent: lm[1].replace(/\t/g, "    ").length, ordered: /\d/.test(lm[2]), num: parseInt(lm[2], 10) || null, text, check, line: i + 1 });
            i++;
            continue;
          }
          // 箇条書きの続きの行（字下げされた文）は直前の項目につなげる
          if (l.trim() && /^\s{2,}/.test(l) && items.length) { items[items.length - 1].text += "\n" + l.trim(); i++; continue; }
          break;
        }
        blocks.push({ type: "list", items: nest(items), line: start, end: i });
        continue;
      }
      if (RE.quote.test(line)) {
        const buf = [];
        while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].match(RE.quote)[1]);
        blocks.push({ type: "quote", text: buf.join("\n"), line: start, end: i });
        continue;
      }
      if (RE.hr.test(line)) { blocks.push({ type: "hr", line: start, end: start }); i++; continue; }
      if (!line.trim()) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !RE.fence.test(lines[i]) && !RE.heading.test(lines[i]) && !RE.list.test(lines[i]) && !RE.quote.test(lines[i]) && !(RE.tableRow.test(lines[i]) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]))) buf.push(lines[i++]);
      blocks.push({ type: "para", text: buf.join("\n"), line: start, end: i });
    }
    return blocks;
  }

  // 字下げの深さで入れ子にする。{text, check, ordered, line, children:[]}
  function nest(flat) {
    const root = { children: [], indent: -1 };
    const stack = [root];
    for (const it of flat) {
      const node = Object.assign({}, it, { children: [] });
      while (stack.length > 1 && it.indent <= stack[stack.length - 1].indent) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    return root.children;
  }

  // ---------- 描画 ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 行内：**太字**、`コード`、{{変数}}、表の中の <br>
  const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\{\{[^}]+\}\}|<br\s*\/?>)/i;
  function inlineDefault(text, parent, hooks) {
    const lines = String(text).split("\n");
    lines.forEach((ln, li) => {
      if (li) parent.append(document.createElement("br"));
      for (const part of ln.split(new RegExp(INLINE.source, "gi"))) {
        if (!part) continue;
        if (/^<br\s*\/?>$/i.test(part)) parent.append(document.createElement("br"));
        else if (/^\*\*[^*]+\*\*$/.test(part)) { const b = el("strong"); inlineDefault(part.slice(2, -2), b, hooks); parent.append(b); }
        else if (/^`[^`]+`$/.test(part)) {
          // inlineCode が true を返したら、フックの側で描いたものとして <code> を作らない
          if (!(hooks && hooks.inlineCode && hooks.inlineCode(part.slice(1, -1), parent))) parent.append(el("code", null, part.slice(1, -1)));
        }
        else if (/^\{\{[^}]+\}\}$/.test(part)) parent.append(el("span", "var", part));
        else inlineText(part, parent, hooks);
      }
    });
    return parent;
  }
  function inlineText(text, parent, hooks) {
    if (hooks && hooks.text) hooks.text(text, parent);
    else parent.append(document.createTextNode(text));
  }

  function render(src, hooks) {
    const hk = hooks || {};
    const blocks = Array.isArray(src) ? src : parse(src);
    const root = el("div", "md");
    const inl = (text, parent) => inlineDefault(text, parent, hk);
    const listDom = (items) => {
      const ordered = items[0] && items[0].ordered;
      const list = el(ordered ? "ol" : "ul");
      if (ordered && items[0].num && items[0].num !== 1) list.start = items[0].num;
      for (const it of items) {
        const li = el("li");
        if (it.check != null) { li.className = "task"; li.append(el("span", "cb" + (it.check ? " on" : ""), it.check ? "☑" : "☐")); }
        inl(it.text, li);
        if (it.children.length) li.append(listDom(it.children));
        list.append(li);
      }
      return list;
    };
    for (const b of blocks) {
      let node = null;
      switch (b.type) {
        case "heading": {
          node = el("h" + Math.min(6, b.level + 1));
          inl(b.text, node);
          if (hk.heading) node = hk.heading(node, b) || node;
          break;
        }
        case "para": node = inl(b.text, el("p")); break;
        case "quote": node = inl(b.text, el("blockquote")); break;
        case "hr": node = el("hr"); break;
        case "list": node = listDom(b.items); break;
        case "code": {
          if (hk.code) node = hk.code(b);
          if (!node) { const pre = el("pre"); pre.append(el("code", null, b.text)); node = pre; }
          break;
        }
        case "table": {
          const t = el("table");
          const n = Math.max(b.head.length, ...b.rows.map((r) => r.length));
          // 数値だけの列は右寄せにする（指定があればそれを優先）
          const numeric = Array.from({ length: n }, (_, c) => b.rows.length > 0 && b.rows.every((r) => !r[c] || /^[\s\-+*]*[\d,.]+\s*(%|円|万円|件|名|時間|日|分|秒)?[\s*]*$/.test(r[c])));
          const align = (c) => b.align[c] || (numeric[c] ? "right" : "");
          // 列の最小幅（em）：その列でいちばん長いセルの見た目の長さ。ただし 10 字まで。
          // 短い列（ID・状態・数値）は折り返さず、長い文の列だけが残りの幅で折り返す。全列の最小幅が画面より広ければ表の中だけ横に流れる
          const visW = (s) => [...String(s).replace(/\*\*|`|\\\|/g, "")].reduce((w, ch) => w + (ch.codePointAt(0) < 0x80 ? 0.55 : 1), 0);
          const colMin = Array.from({ length: n }, (_, c) => Math.round(Math.min(10, Math.max(0, ...b.rows.map((r) => visW(r[c] || "")))) * 10) / 10 + 0.3);
          const thead = el("thead"), tr = el("tr");
          // 見出しも折り返してよい。ただし 6 字までと、その列の最小幅までは 1 行に保つ
          for (let c = 0; c < n; c++) {
            const th = el("th"), cell = inl(b.head[c] || "", el("div", "cell"));
            cell.style.minWidth = Math.max(colMin[c], Math.min(6, visW(b.head[c] || "")) + 0.3) + "em";
            th.append(cell);
            if (align(c)) th.style.textAlign = align(c);
            tr.append(th);
          }
          thead.append(tr);
          const tbody = el("tbody");
          for (const r of b.rows) {
            const row = el("tr");
            // 中身は div.cell に入れ、列ごとの最小幅を付ける（td の min-width は効かないが、div の幅は列幅の計算に効く）
            for (let c = 0; c < n; c++) {
              const td = el("td"), cell = inl(r[c] || "", el("div", "cell"));
              cell.style.minWidth = colMin[c] + "em";
              td.append(cell);
              if (align(c)) td.style.textAlign = align(c);
              row.append(td);
            }
            if (hk.row) hk.row(row, r, b);
            tbody.append(row);
          }
          t.append(thead, tbody);
          const wrap = el("div", "tablewrap");
          wrap.append(t);
          node = wrap;
          if (hk.table) node = hk.table(node, b) || node;
          break;
        }
      }
      if (node) {
        if (hk.block) hk.block(node, b);
        root.append(node);
      }
    }
    return root;
  }

  GK.md = { parse, render, inline: inlineDefault };
})(globalThis.GK = globalThis.GK || {});
