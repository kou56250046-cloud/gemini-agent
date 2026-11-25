// ファイルの編集（DOM を使わない）。テキストの部分置き換え・文字コードの書き戻し（UTF-8・Shift_JIS）・差分の塊・
// xlsx のセルの値の書き換え・docx の文の置き換え。書く前の許可・控え・元に戻すは runnerui.js が行う
(function (GK) {
  "use strict";

  const enc = new TextEncoder();

  // ---------- テキスト ----------
  // 読み込み：文字コード（utf8 / utf8bom / sjis）と改行（\r\n / \n）を覚えておき、書き戻しで同じにする
  function decode(u8) {
    const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return withEol(new TextDecoder("utf-8").decode(b.subarray(3)), "utf8bom");
    try { return withEol(new TextDecoder("utf-8", { fatal: true }).decode(b), "utf8"); }
    catch (e) { return withEol(new TextDecoder("shift_jis").decode(b), "sjis"); }
  }
  const withEol = (text, encName) => ({ text, enc: encName, eol: /\r\n/.test(text) ? "\r\n" : "\n" });

  // Shift_JIS の書き出し表（ブラウザに書き出しの仕組みが無いので、読み込みの仕組みで逆引きを作る。最初の 1 回だけ）
  let SJIS = null;
  function sjisTable() {
    if (SJIS) return SJIS;
    const d = new TextDecoder("shift_jis");
    const m = new Map();
    for (let b = 0; b < 0x80; b++) m.set(String.fromCharCode(b), [b]);
    for (let b = 0xa1; b <= 0xdf; b++) { const c = d.decode(new Uint8Array([b])); if (c !== "�" && !m.has(c)) m.set(c, [b]); }
    for (let hi = 0x81; hi <= 0xfc; hi++) {
      if (hi > 0x9f && hi < 0xe0) continue;
      for (let lo = 0x40; lo <= 0xfc; lo++) {
        if (lo === 0x7f) continue;
        const c = d.decode(new Uint8Array([hi, lo]));
        if (c.length === 1 && c !== "�" && !m.has(c)) m.set(c, [hi, lo]);
      }
    }
    SJIS = m;
    return m;
  }
  function encodeSjis(text) {
    const t = sjisTable();
    const out = [];
    for (const ch of String(text)) {
      const b = t.get(ch);
      if (!b) throw new Error(`「${ch}」（U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}）は Shift_JIS で書けません。この字を使わないか、ファイルを UTF-8 で保存し直してください`);
      out.push(...b);
    }
    return new Uint8Array(out);
  }
  function encodeLike(text, encName) {
    if (encName === "sjis") return encodeSjis(text);
    const body = enc.encode(text);
    if (encName !== "utf8bom") return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]); out.set(body, 3);
    return out;
  }

  // 部分の置き換え。old が 0 件、または all でないのに 2 件以上なら失敗。old・new の改行はファイルの改行に合わせる
  function applyEdit(text, oldS, newS, all, eol) {
    const e = eol || (/\r\n/.test(text) ? "\r\n" : "\n");
    const fix = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/\n/g, e);
    const o = fix(oldS), n = fix(newS);
    if (!o) throw new Error("old（置き換える前の文）が空です。ファイルの中の文をそのまま写してください");
    let count = 0, at = text.indexOf(o);
    while (at >= 0) { count++; at = text.indexOf(o, at + o.length); }
    if (!count) throw new Error("old の文がファイルに見つかりません。read_file で読み直し、空白・改行も含めてそのまま写してください");
    if (count > 1 && !all) throw new Error(`old の文がファイルに ${count} か所あります。前後の文を足して 1 か所に絞るか、全部置き換えるなら all: true にしてください`);
    return { text: text.split(o).join(n), count };
  }

  // 差分の塊（前後 ctx 行）。[{ op: " "|"+"|"-"|"…", text }]
  function hunks(before, after, ctx) {
    const c = ctx == null ? 2 : ctx;
    const d = GK.model.diffLines(String(before).replace(/\r\n/g, "\n"), String(after).replace(/\r\n/g, "\n"));
    const keep = new Array(d.length).fill(false);
    d.forEach((x, i) => { if (x.op !== "same") for (let k = Math.max(0, i - c); k <= Math.min(d.length - 1, i + c); k++) keep[k] = true; });
    const out = [];
    let gap = false;
    d.forEach((x, i) => {
      if (!keep[i]) { gap = true; return; }
      if (gap && out.length) out.push({ op: "…", text: "" });
      gap = false;
      out.push({ op: x.op === "add" ? "+" : x.op === "del" ? "-" : " ", text: x.text });
    });
    return out;
  }

  // ---------- zip（xlsx・docx の入れ替え用。中央ディレクトリから、圧縮したままの中身と CRC を取る） ----------
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  function zipRead(b) {
    if (b.length < 22 || u32(b, 0) !== 0x04034b50) throw new Error("zip（xlsx・docx）として読めません");
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("zip の終わりが見つかりません");
    const count = u16(b, e + 10);
    let p = u32(b, e + 16);
    const list = [];
    for (let k = 0; k < count; k++) {
      if (u32(b, p) !== 0x02014b50) throw new Error("zip の目次が壊れています");
      const flag = u16(b, p + 8), method = u16(b, p + 10), time = u16(b, p + 12), date = u16(b, p + 14), crc = u32(b, p + 16), csize = u32(b, p + 20), usize = u32(b, p + 24);
      const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), local = u32(b, p + 42);
      const nameBytes = b.slice(p + 46, p + 46 + nlen);
      if (flag & 1) throw new Error("パスワード付きのファイルは書き換えられません");
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      list.push({ name: new TextDecoder().decode(nameBytes), nameBytes, flag, method, time, date, crc, csize, usize, data: b.slice(start, start + csize) });
      p += 46 + nlen + xlen + clen;
    }
    return list;
  }
  // 書き出し。replaced（名前 → 新しい中身）は無圧縮で入れ、ほかは圧縮したまま写す。drop の名前は外す
  function zipWrite(list, replaced, drop) {
    const parts = [], central = [];
    let offset = 0, n = 0;
    for (const f of list) {
      if (drop && drop.has(f.name)) continue;
      const rep = replaced.get(f.name);
      const data = rep ? (typeof rep === "string" ? enc.encode(rep) : rep) : f.data;
      const method = rep ? 0 : f.method, crc = rep ? GK.pptx.crc32(data) : f.crc, usize = rep ? data.length : f.usize;
      const flag = (f.flag & 0x0800) | 0; // 名前の UTF-8 の印だけ残す（データ記述子は使わない）
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, flag, true); lh.setUint16(8, method, true);
      lh.setUint16(10, f.time, true); lh.setUint16(12, f.date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, usize, true); lh.setUint16(26, f.nameBytes.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), f.nameBytes, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, flag, true); ch.setUint16(10, method, true);
      ch.setUint16(12, f.time, true); ch.setUint16(14, f.date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, usize, true); ch.setUint16(28, f.nameBytes.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), f.nameBytes);
      offset += 30 + f.nameBytes.length + data.length;
      n++;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, n, true); end.setUint16(10, n, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
    let o = 0;
    for (const c of all) { out.set(c, o); o += c.length; }
    return out;
  }
  async function entryText(list, name) {
    const f = list.find((x) => x.name === name);
    if (!f) return null;
    return GK.xlsx.entryText(new Map([[name, { method: f.method, data: f.data }]]), name);
  }

  // ---------- xlsx：セルの値だけを書き換える ----------
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const CELL_RE = /^([A-Z]{1,3})([1-9]\d{0,6})$/;
  function cellXml(ref, style, value) {
    const s = style ? ` s="${style}"` : "";
    if (value === null || value === undefined || value === "") return `<c r="${ref}"${s}/>`;
    if (typeof value === "number" && isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
    if (typeof value === "boolean") return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  }
  // sheetData の XML に cells（{ "B3": 値 }）を入れる。→ { xml, formulas: [上書きした数式のセル], changed: [{ref, before}] }
  function setCellsXml(xml, cells, overwriteFormula) {
    const col = (ref) => GK.xlsx.colIndex(ref.match(/^[A-Z]+/)[0]);
    const formulas = [], changed = [];
    let out = xml.replace(/<sheetData\s*\/>/, "<sheetData></sheetData>");
    if (!/<sheetData[^>]*>/.test(out)) throw new Error("シートの中身（sheetData）が見つかりません");
    for (const [ref0, value] of Object.entries(cells)) {
      const ref = String(ref0).toUpperCase().trim();
      const m = ref.match(CELL_RE);
      if (!m) throw new Error(`セルの番地「${ref0}」が読めません（例：B3）`);
      const rowN = +m[2];
      const rowRe = new RegExp(`<row\\b[^>]*\\br="${rowN}"[^>]*?(?:/>|>([\\s\\S]*?)</row>)`);
      const rm = out.match(rowRe);
      if (!rm) {
        // 行が無い：行番号の順に差し込む
        const rows = [...out.matchAll(/<row\b[^>]*\br="(\d+)"/g)];
        const after = rows.filter((x) => +x[1] > rowN)[0];
        const newRow = `<row r="${rowN}">${cellXml(ref, "", value)}</row>`;
        out = after ? out.slice(0, after.index) + newRow + out.slice(after.index) : out.replace("</sheetData>", newRow + "</sheetData>");
        changed.push({ ref, before: "" });
        continue;
      }
      let rowXml = rm[0];
      if (/\/>$/.test(rowXml) && rm[1] === undefined) rowXml = rowXml.replace(/\s*\/>$/, "></row>");
      const cellRe = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      const cm = rowXml.match(cellRe);
      if (cm) {
        if (/<f[\s>/]/.test(cm[0])) { if (!overwriteFormula) throw new Error(`${ref} には数式があります。値で上書きするなら overwrite_formula: true にしてください`); formulas.push(ref); }
        const style = (cm[0].match(/\bs="(\d+)"/) || [])[1] || "";
        const before = (cm[0].match(/<v>([\s\S]*?)<\/v>/) || cm[0].match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || "";
        rowXml = rowXml.replace(cm[0], cellXml(ref, style, value));
        changed.push({ ref, before: GK.xlsx.unesc(before) });
      } else {
        // 列の順に差し込む
        const cs = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)];
        const next = cs.find((x) => GK.xlsx.colIndex(x[1]) > col(ref));
        const cx = cellXml(ref, "", value);
        rowXml = next ? rowXml.slice(0, next.index) + cx + rowXml.slice(next.index) : rowXml.replace("</row>", cx + "</row>");
        changed.push({ ref, before: "" });
      }
      out = out.replace(rm[0], rowXml);
    }
    return { xml: out, formulas, changed };
  }
  // シート名 → zip の中の場所（workbook.xml と その rels）
  async function sheetPath(list, sheet) {
    const wb = await entryText(list, "xl/workbook.xml");
    const rels = await entryText(list, "xl/_rels/workbook.xml.rels");
    if (!wb || !rels) throw new Error("xlsx の目次（workbook.xml）が読めません");
    const sheets = [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({ name: GK.xlsx.unesc((m[1].match(/\bname="([^"]*)"/) || [])[1] || ""), rid: (m[1].match(/\br:id="([^"]*)"/) || [])[1] }));
    const s = sheet ? sheets.find((x) => x.name === sheet) : sheets[0];
    if (!s) throw new Error(`シート「${sheet}」がありません（あるシート：${sheets.map((x) => x.name).join("・")}）`);
    const t = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => new RegExp(`\\bId="${s.rid}"`).test(a));
    const target = t && (t.match(/\bTarget="([^"]*)"/) || [])[1];
    if (!target) throw new Error(`シート「${s.name}」の場所が見つかりません`);
    return { name: s.name, path: target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "") };
  }
  async function xlsxSetCells(u8, sheet, cells, overwriteFormula) {
    const list = zipRead(u8);
    const sp = await sheetPath(list, sheet);
    const xml = await entryText(list, sp.path);
    const r = setCellsXml(xml, cells, overwriteFormula);
    const replaced = new Map([[sp.path, r.xml]]);
    const drop = new Set();
    // 数式を値で上書きしたら、計算の順番の表（calcChain）を外す（古い表が残ると Excel が修復を求める。Excel が開くときに作り直す）
    if (r.formulas.length && list.some((f) => f.name === "xl/calcChain.xml")) {
      drop.add("xl/calcChain.xml");
      const ct = await entryText(list, "[Content_Types].xml");
      replaced.set("[Content_Types].xml", ct.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
      const rels = await entryText(list, "xl/_rels/workbook.xml.rels");
      replaced.set("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship\b[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, ""));
    }
    return { data: zipWrite(list, replaced, drop), sheet: sp.name, changed: r.changed, formulas: r.formulas };
  }

  // ---------- docx：1 つの文字の塊（w:t）に収まる文だけを置き換える ----------
  async function docxReplace(u8, oldS, newS, all) {
    const o = String(oldS ?? ""), n = String(newS ?? "");
    if (!o) throw new Error("old（置き換える前の文）が空です");
    if (/[\r\n]/.test(o) || /[\r\n]/.test(n)) throw new Error("docx の置き換えは 1 段落の中だけです（改行を含められません）");
    const list = zipRead(u8);
    const name = "word/document.xml";
    const xml = await entryText(list, name);
    if (!xml) throw new Error("docx の本文（word/document.xml）が読めません");
    const T_RE = /(<w:t\b[^>]*>)([^<]*)(<\/w:t>)/g;
    let count = 0;
    for (const m of xml.matchAll(T_RE)) count += GK.xlsx.unesc(m[2]).split(o).length - 1;
    if (!count) {
      const plain = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => [...p[0].matchAll(T_RE)].map((m) => GK.xlsx.unesc(m[2])).join(""));
      if (plain.some((p) => p.includes(o))) throw new Error("その文は書式（太字・色など）の境目をまたいでいるため、置き換えられません。境目の手前までに短くするか、Word で直してください");
      throw new Error("old の文が docx に見つかりません。read_file で読み直して、そのまま写してください");
    }
    if (count > 1 && !all) throw new Error(`old の文が docx に ${count} か所あります。前後の文を足して 1 か所に絞るか、all: true にしてください`);
    const out = xml.replace(T_RE, (s, open, body, close) => {
      const t = GK.xlsx.unesc(body);
      if (!t.includes(o)) return s;
      const nt = t.split(o).join(n);
      const op = /^\s|\s$/.test(nt) && !/xml:space=/.test(open) ? open.replace(/^<w:t\b/, '<w:t xml:space="preserve"') : open;
      return op + esc(nt).replace(/&quot;/g, '"') + close;
    });
    return { data: zipWrite(list, new Map([[name, out]])), count };
  }

  GK.edit = { decode, encodeLike, encodeSjis, applyEdit, hunks, zipRead, zipWrite, setCellsXml, xlsxSetCells, docxReplace };
})(globalThis.GK = globalThis.GK || {});
