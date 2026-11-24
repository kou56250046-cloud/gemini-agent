---
id: fmt-slides
category: 図・スライドの書式
title: スライド JSON（Gemini に資料を書かせる）
use: 顧客提示資料
usage: 司令塔 Gem の知識ファイルに入れる。出力された JSON を gemini-agent の「スライド」タブ（または取り込みタブ）に貼ると、プレビューと PowerPoint 書き出しができる
---
スライドは次の JSON で出力してください。見た目（色・位置・フォント）は書かないでください。描画ツールが決めます。
JSON だけを1つのコードブロックで返し、説明文は付けないでください。

# 全体
```json
{
  "title": "資料の題名",
  "subtitle": "副題",
  "customer": "〇〇株式会社 御中",
  "date": "2026年11月",
  "author": "作成部署",
  "footer": "〇〇株式会社 御中｜社外秘",
  "slides": [ ... ]
}
```

# スライドの種類（type）
| type | 用途 | 項目 |
|---|---|---|
| `cover` | 表紙 | （全体の title などを使う。上書きも可） |
| `toc` | 目次 | **書かなくてよい。** 章扉が2つ以上あれば、表紙の次に自動で入る（章ごとにスライドの題名とページ番号を並べる）。項目を自分で決めたいときだけ `items` を書く |
| `summary` | エグゼクティブサマリ | `points`: [{`head`, `text`}]（4項目前後。text は文字列または配列） |
| `section` | 章扉 | `no`, `title`, `subtitle` |
| `content` | 本文 | `bullets`（配列。入れ子は {`text`, `sub`: [...]}）、`box`: {`title`, `items`}（右側の囲み、任意） |
| `compare` | 2案の比較 | `left` / `right`: {`head`, `items`}、`conclusion`（推奨の結論、任意） |
| `table` | 表 | `columns`, `rows`（配列の配列）、`widths`（列幅の比、任意）、`note` |
| `issues` | 課題と対応 | `rows`: [{`issue`, `cause`, `action`, `owner`, `due`}] |
| `flow` | フロー図 | `flow`（フロー記法の文字列。改行は \n）、`note` |
| `schedule` | スケジュール | `periods`（列の見出し）、`tasks`: [{`name` または `group`, `start`, `end`, `owner`}]、`milestones`: [{`at`, `label`}]。start / end / at は periods の番号（0から） |
| `conclusion` | まとめ | `points`、`next`（次のアクション） |

# すべてのスライド（cover / section 以外）に共通
- `title`：スライドの題名（20字以内）
- `lead`：**このスライドの結論を1文で**（60字以内）。言い切る
- `source`：出典（任意。数値を載せたら書く）
- `appendix`: true で Appendix の印が付く

# 文字の書き方
- 強調は `**太字**`
- 箇条書きは配列で書く。1項目60字以内
- 1枚に入れる量の目安：bullets は4〜6項目、表は6行×5列、issues は5行、schedule は periods 12列・tasks 10行まで。超える場合はスライドを分ける。2項目以下のように少なすぎるスライドは、近い内容とまとめる（詳しくは「配置と情報量」）
- 文字の大きさは描画ツールが量に合わせて決める（少なければ大きく、多ければ小さく）

# 守ること（守らないと描画できない・崩れる）
- **上の表にない type・項目は使わない**（chart・pie・kpi などのグラフは使えない。数値は table で書く）
- JSON に色・フォント・位置・文字の大きさを書かない（描画ツールが決める）
- 3案以上の比較は `compare` ではなく `table` で書く
- `flow` はフロー記法を **1つの文字列** で書き、行の区切りは `\n` にする。文字列の中の `"` は `\"` にする
- `schedule` の start / end / at は periods の**番号**（0から）で書く
- JSON にコメント（`//` や `/* */`）を書かない
- 資料全体を1つの JSON にする。スライドの一部だけを返さない
- スライド番号は slides 配列の順番で数える（表紙＝1）

# 例
```json
{
  "title": "受注業務の効率化に関するご提案",
  "slides": [
    { "type": "cover" },
    { "type": "summary", "title": "エグゼクティブサマリ", "lead": "受注の手作業を減らし、出荷までを1日短縮します",
      "points": [{ "head": "課題", "text": "転記に1件15分" }, { "head": "提案", "text": "取り込みと引当の自動化" }] },
    { "type": "compare", "title": "実現方式の比較", "lead": "費用と期間を優先し、案Aを推奨します",
      "left": { "head": "案A", "items": ["費用 1,200万円", "期間 6か月"] },
      "right": { "head": "案B", "items": ["費用 2,800万円", "期間 12か月"] },
      "conclusion": "案Aを推奨" }
  ]
}
```
