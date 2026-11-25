// 開発用：GitHub Pages（main ブランチの docs/）へ出すファイルを、docs/ に写す。
//   node build.mjs && node tools/publish.mjs
// 写すのは許可リストのファイルだけ（ソース・テスト・.claude・拡張のフォルダは出さない。拡張は HTML の中の zip で配る）。
// あとは main をコミットして push すれば公開される（GitHub の Settings → Pages を main / /docs にしておく）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(ROOT, "docs");
// [元, 公開先の名前]。リンクで開く入口は index.html だけ（同じ中身を 2 つ置くと、履歴が倍の速さで重くなる）
const ALLOW = [["output/gemini-agent.html", "index.html"]];

fs.mkdirSync(dest, { recursive: true });
for (const [from, to] of ALLOW) {
  const src = path.join(ROOT, from);
  if (!fs.existsSync(src)) { console.error(`${from} がありません。先に node build.mjs を実行してください`); process.exit(1); }
  const html = fs.readFileSync(src, "utf8");
  // 念のため：外部へ出る書き方・手元のパス・拡張の zip が入っていないもの（古いビルド）を止める
  const bad = [/\bfetch\s*\(/, /XMLHttpRequest/, /[A-Za-z]:[\\/]Users[\\/]/].find((re) => re.test(html));
  if (bad) { console.error(`${from} に公開できない文字列があります：${bad}`); process.exit(1); }
  if (!html.includes('GK.EXT_ZIP = "')) { console.error(`${from} に拡張の zip が入っていません。node build.mjs で作り直してください`); process.exit(1); }
  fs.copyFileSync(src, path.join(dest, to));
  console.log(`${from} → docs/${to}（${Math.round(html.length / 1024)} KB）`);
}
// Jekyll を通さない（ファイルをそのまま配る）
fs.writeFileSync(path.join(dest, ".nojekyll"), "");
console.log("次：git add docs && git commit && git push（https://kou56250046-cloud.github.io/gemini-agent/ に出ます）");
