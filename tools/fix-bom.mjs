// 開発用：ソースに紛れ込んだ見えない文字（U+FEFF・U+2028・U+2029）を \uXXXX のエスケープに置き換える
//   node tools/fix-bom.mjs src/js
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const CODES = [0xfeff, 0x2028, 0x2029];
for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f);
  if (!fs.statSync(p).isFile()) continue;
  let s = fs.readFileSync(p, "utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  let n = 0;
  for (const c of CODES) {
    const ch = String.fromCharCode(c);
    n += s.split(ch).length - 1;
    s = s.split(ch).join("\\u" + c.toString(16).toUpperCase().padStart(4, "0"));
  }
  if (n) { fs.writeFileSync(p, s, "utf8"); console.log(f, n); }
}
