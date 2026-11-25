// 開発用：GitHub Pages（kou56250046-cloud/gemini-agent の gh-pages ブランチ）へ出すファイルを、公開用フォルダに写す。
//   node build.mjs && node tools/publish.mjs [公開用フォルダ（既定 ../gemini-agent-pages）]
// 写すのは許可リストのファイルだけ（ソース・テスト・.claude・拡張のフォルダは出さない。拡張は HTML の中の zip で配る）。
// コミットとプッシュは公開用フォルダで行う
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.resolve(process.argv[2] || path.join(ROOT, "..", "gemini-agent-pages"));
// [元, 公開先の名前]。リンクで開く入口は index.html、名前で配る用に gemini-agent.html も置く
const ALLOW = [["output/gemini-agent.html", "index.html"], ["output/gemini-agent.html", "gemini-agent.html"]];

if (!fs.existsSync(path.join(dest, ".git"))) { console.error(`公開用フォルダ（git リポジトリ）がありません：${dest}`); process.exit(1); }
for (const [from, to] of ALLOW) {
  const src = path.join(ROOT, from);
  if (!fs.existsSync(src)) { console.error(`${from} がありません。先に node build.mjs を実行してください`); process.exit(1); }
  const html = fs.readFileSync(src, "utf8");
  // 念のため：外部へ出る書き方・手元のパス・拡張の zip が入っていないもの（古いビルド）を止める
  const bad = [/\bfetch\s*\(/, /XMLHttpRequest/, /[A-Za-z]:[\\/]Users[\\/]/].find((re) => re.test(html));
  if (bad) { console.error(`${from} に公開できない文字列があります：${bad}`); process.exit(1); }
  if (!html.includes('GK.EXT_ZIP = "')) { console.error(`${from} に拡張の zip が入っていません。node build.mjs で作り直してください`); process.exit(1); }
  fs.copyFileSync(src, path.join(dest, to));
  console.log(`${from} → ${path.join(dest, to)}（${Math.round(html.length / 1024)} KB）`);
}
fs.writeFileSync(path.join(dest, ".nojekyll"), "");
fs.writeFileSync(path.join(dest, "README.md"), `# Gemini エージェント（公開用）

https://kou56250046-cloud.github.io/gemini-agent/ で開けます。

- 画面の右上の「この HTML を保存」で、オフラインで使える 1 ファイルを保存できます
- 「Chrome 拡張をダウンロード」で拡張（zip）を保存し、展開して chrome://extensions →「デベロッパー モード」→「パッケージ化されていない拡張機能を読み込む」で gemini-agent-extension フォルダを選びます
- このリポジトリは公開用の HTML だけを置いています。ツールは通信しません（外部送信なし）。サンプルはすべてダミーです
`);
console.log(`次：cd "${dest}" && git add -A && git commit -m "更新" && git push`);
