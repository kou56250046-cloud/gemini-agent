// 弾4：監査ログ・会議（字幕 → 文字起こし → 議事録）・質問箱の自動化・スラッシュコマンド。ダミーだけを使う
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadGK, readItems, manifest, ROOT } from "../build.mjs";

const GK = loadGK();
const A = GK.audit, ML = GK.meetlog, MI = GK.minutes, QF = GK.qaflow;
const fx = (f) => fs.readFileSync(path.join(ROOT, "tests", "fixtures", f), "utf8");

// ---------- 監査ログ ----------
async function chainOf(events) {
  const rows = [];
  let prev = "";
  for (const [i, e] of events.entries()) { const r = await A.seal(prev, Object.assign({ seq: i + 1 }, e)); rows.push(r); prev = r.hash; }
  return rows;
}

test("監査：残してよい項目だけになり、本文は入らない。ハッシュチェーンが検証に通る", async () => {
  const e = A.entry({ time: "2026-11-24T00:00:00Z", actor: "Gemini", action: "受信", chars: 120, sha256: "ab", text: "締め日は月末（本文）", body: "本文", note: "x".repeat(200) });
  assert.deepEqual(Object.keys(e).sort(), ["action", "actor", "chars", "note", "sha256", "time"]);
  assert.equal(e.note.length, 80);
  assert.equal(A.entry({ actor: "誰か" }).actor, "拡張");
  const rows = await chainOf([
    { time: "2026-11-24T09:00:00Z", run: "r1", step: 1, actor: "拡張", action: "開始" },
    { time: "2026-11-24T09:01:00Z", run: "r1", step: 1, actor: "Gemini", action: "受信", stage: 1, sha256: await A.sha256("応答1"), chars: 3 },
    { time: "2026-11-24T09:05:00Z", run: "r1", step: 2, actor: "拡張", action: "道具", tool: "read_file", target: "資料/a.txt", result: "成功" },
    { time: "2026-11-24T09:20:00Z", run: "r1", step: 3, actor: "Gemini", action: "受信", stage: 3 },
    { time: "2026-11-24T10:00:00Z", run: "r1", step: 4, actor: "人", action: "人の返事", result: "承認" },
    { time: "2026-11-24T10:01:00Z", run: "r1", step: 4, actor: "Gemini", action: "受信", stage: 4 },
    { time: "2026-11-24T10:02:00Z", run: "r1", step: 4, actor: "拡張", action: "終了", result: "完了" },
  ]);
  const text = A.toJsonl(rows);
  assert.doesNotMatch(text, /締め日|本文/);
  assert.equal(await A.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const v = await A.verify(text);
  assert.deepEqual([v.ok, v.count, v.errors], [true, 7, []]);
  const p = A.progress(rows);
  assert.deepEqual(p.stages.map((s) => [s.stage, s.minutes]), [[1, 19], [3, 41], [4, null]]);
  assert.deepEqual(p.runs.map((r) => [r.run, r.steps, r.tools, r.result]), [["r1", 4, 1, "完了"]]);
  assert.match(A.toCsv(rows), /^﻿time,run,seq/);
});

test("監査：書き換え・削除・入れ替え・壊れた行を見つける", async () => {
  const rows = await chainOf([{ action: "開始" }, { action: "受信", chars: 10 }, { action: "道具", tool: "list_dir" }, { action: "終了" }]);
  const t = (r) => A.toJsonl(r);
  const edited = rows.map((r) => Object.assign({}, r)); edited[1].chars = 999;
  assert.match((await A.verify(t(edited))).errors[0].message, /書き換えられた/);
  const removed = rows.filter((_, i) => i !== 1);
  const vr = await A.verify(t(removed));
  assert.ok(vr.errors.some((e) => /つながりが切れて/.test(e.message)) && vr.errors.some((e) => /順番が飛んで/.test(e.message)));
  const swapped = [rows[0], rows[2], rows[1], rows[3]];
  assert.equal((await A.verify(t(swapped))).ok, false);
  assert.match((await A.verify(t(rows) + "{壊れた行\n")).errors[0].message, /JSON として読めない/);
  // 先頭の行を消すと（残りはつながっていても）分かる
  assert.match((await A.verify(t(rows.slice(1)))).errors[0].message, /始まりの行がありません/);
  // 途中から確かめるときは、前の行の hash を渡す
  assert.equal((await A.verify(t(rows.slice(2)), { prev: rows[1].hash })).ok, true);
});

// ---------- 会議 ----------
test("字幕：伸びる字幕を 1 発言に確定し、話者の替わり目と 2 秒の無音で区切り、重複を入れない", () => {
  const s = ML.create(0);
  ML.update(s, [{ speaker: "山田", text: "本日は" }], 500);
  ML.update(s, [{ speaker: "山田", text: "本日は受注の" }], 1000);
  ML.update(s, [{ speaker: "山田", text: "本日は受注の見直しです" }], 1500);
  ML.update(s, [{ speaker: "山田", text: "本日は受注の見直しです" }, { speaker: "佐藤", text: "締め日は" }], 2000);
  ML.update(s, [{ speaker: "佐藤", text: "締め日は月末ですか" }], 2500);
  ML.tick(s, 5000); // 2 秒更新なし → 両方確定
  ML.update(s, [{ speaker: "佐藤", text: "締め日は月末ですか" }], 5200); // 画面に残った同じ字幕は重ねない
  ML.update(s, [{ speaker: "山田", text: "はい月末です" }], 6000);
  ML.tick(s, 8500);
  ML.update(s, [{ speaker: "山田", text: "はい月末です" }, { speaker: "佐藤", text: "締め日は月末ですか" }], 8600); // 相手が話した後に残った字幕も重ねない
  ML.finish(s, 9000);
  assert.deepEqual(s.lines.map((l) => [l.at, l.speaker, l.text]), [[500, "山田", "本日は受注の見直しです"], [2000, "佐藤", "締め日は月末ですか"], [6000, "山田", "はい月末です"]]);
  const tr = ML.transcript(s, { title: "定例（ダミー）" });
  assert.match(tr, /^# 定例（ダミー）：文字起こし/);
  assert.match(tr, /- 参加者（字幕に出た話者）：山田、佐藤/);
  assert.match(tr, /\[00:00:00\] 山田：本日は受注の見直しです\n\[00:00:02\] 佐藤：締め日は月末ですか\n\[00:00:06\] 山田：はい月末です/);
  // 文字起こしは clean.js でそのまま読める
  const c = GK.clean.clean(tr.split("\n").filter((l) => l.startsWith("[")).join("\n"));
  assert.equal(c.stats.utterances, 3);
});

test("字幕：同じ話者の枠が 2 つ見えていて、間に相づちが確定しても、話している発言を重ねない", () => {
  const s = ML.create(0);
  const X = { speaker: "A", text: "今日は予算の話をします" }, B = { speaker: "B", text: "はい" };
  ML.update(s, [X], 0);
  ML.update(s, [X, B], 500);
  ML.update(s, [X, B, { speaker: "A", text: "まず営業" }], 1000);
  ML.update(s, [X, B, { speaker: "A", text: "まず営業部から" }], 1500);
  ML.update(s, [X, B, { speaker: "A", text: "まず営業部から報告します" }], 2500);
  ML.update(s, [X, B, { speaker: "A", text: "まず営業部から報告します。売上は" }], 3000);
  ML.finish(s, 6000);
  assert.deepEqual(s.lines.map((l) => `${l.speaker}:${l.text}`), ["A:今日は予算の話をします", "B:はい", "A:まず営業部から報告します。売上は"]);
});

test("議事録：VTT を読み、発言量を数え、長ければ時刻の境目で分けて依頼文を作る", () => {
  const prep = MI.prepare(fx("meeting.vtt"));
  assert.equal(prep.format, "Teams（VTT）");
  assert.equal(prep.parts.length, 1);
  assert.deepEqual(prep.stats.list.map((s) => [s.speaker, s.count]), [["山田 太郎", 2], ["佐藤 花子", 2]], "文字数の多い順");
  assert.ok(prep.stats.list[0].chars > prep.stats.list[1].chars);
  assert.equal(prep.stats.list.reduce((a, s) => a + s.share, 0).toFixed(0), "100");
  assert.doesNotMatch(prep.parts[0].text, /えーと/, "つなぎ言葉は消す");
  const one = MI.requests(prep, { title: "定例" });
  assert.equal(one.length, 1);
  assert.match(one[0].text, /^【議事録：まとめ】\n会議名：定例/);
  const long = MI.prepare(fx("meeting.vtt"), { max: 80 });
  assert.ok(long.parts.length >= 3);
  const rq = MI.requests(long, { title: "定例" });
  assert.equal(rq.length, long.parts.length + 1);
  assert.match(rq[0].text, /^【議事録の部分 1\/\d+】（00:00:05〜/);
  assert.equal(rq[rq.length - 1].kind, "final");
  assert.match(MI.withNotes(rq[rq.length - 1].text, ["要点 A", "要点 B"]), /### 部分 2 の要点\n要点 B/);
});

test("議事録：応答から議事録・memo・宿題を取り出し、発言量の表を足す。足りないものを知らせる", () => {
  const prep = MI.prepare(fx("meeting.vtt"));
  const reply = ["````markdown", "# 定例 議事録", "## 3. 決定事項", "| No | 決定 | 決めた人・根拠の時刻 |", "|---|---|---|", "| 1 | 締め日は月末 | 山田 [00:00:17] |", "````", "```memo", "D-01 締め日は月末", "Q-01 上限金額は？（決める人：【要確認】／期限：【要確認】）", "```", "```table", "| No | 内容 | 担当 | 期限 | 状態 |", "|---|---|---|---|---|", "| 1 | ポータルの画面案 | 佐藤 | 2026-12-05 | 未着手 |", "```"].join("\n");
  const r = MI.assemble(reply, prep, { title: "定例" });
  assert.deepEqual(r.missing, []);
  assert.equal(r.title, "定例 議事録");
  assert.match(r.md, /## 発言の量（gemini-agent が文字起こしから数えた値）\n\n\| 発言者 \| 発言数 \| 文字数 \| 割合\(%\) \|/);
  assert.match(r.memo, /^D-01 締め日は月末/);
  assert.match(r.table, /ポータルの画面案/);
  assert.deepEqual(MI.assemble("ふつうの文", prep).missing, ["議事録（````markdown）", "案件メモ（```memo）", "宿題（```table）"]);
  const it = readItems().find((x) => x.id === "gem-minutes");
  for (const w of ["文字起こしに無いことは書きません", "【議事録の部分 n/N】", "【議事録：まとめ】", "```memo", "```table", "発言の量・割合は数えない"]) assert.ok(it.body.includes(w), w);
});

test("議事録の memo：案件メモの続きの番号に振り直して、既にある D・Q を上書きしない", () => {
  let n = GK.note.merge(GK.note.empty("x"), GK.note.parseMemo("D-01 ポータルで入力\nQ-01 締め日は？")).note;
  const items = GK.note.renumber(n, GK.note.parseMemo("D-01 締め日は月末（会議）\nQ-01 画面案の期限は？\nQ-01 回答済：12 月 5 日\nF-01 受注は月 300 件"));
  assert.deepEqual(items.map((x) => x.id), ["D-02", "Q-02", "Q-02", "F-01"]);
  n = GK.note.merge(n, items).note;
  assert.deepEqual(n.decisions.map((d) => d.id + " " + d.text), ["D-01 ポータルで入力", "D-02 締め日は月末（会議）"]);
  assert.deepEqual(n.questions.map((q) => q.id + ":" + q.status), ["Q-01:未回答", "Q-02:回答済"]);
});

// ---------- 質問箱 ----------
const block = (id, q, status, ans) => `## ${id}\n案件: ダミー\n分類: 業務\n状態: ${status}\n根拠: 資料A.pdf\n要確認の理由: ${status === "確定" ? "" : "資料に無い"}\n### 質問\n${q}\n### 回答\n${ans}\n`;
const reply = (...blocks) => "```markdown\n" + blocks.join("\n") + "```";

test("質問箱：質問の分け方と、3000 字ごとの送る文（回答の形の指示を頭に付けるときも）", () => {
  assert.deepEqual(QF.questions("締め日は？\n- 上限は？\n2. 承認者は？"), ["締め日は？", "上限は？", "承認者は？"]);
  assert.deepEqual(QF.questions("1 行目\n続き\n\n2 問目"), ["1 行目\n続き", "2 問目"]);
  const qs = Array.from({ length: 30 }, (_, i) => `質問${i}：` + "あ".repeat(150));
  const c = QF.compose(qs);
  assert.ok(c.parts.length >= 2);
  for (const p of c.parts) assert.ok(p.length <= GK.model.INPUT_MAX, p.length);
  assert.equal(c.parts.join("").split("質問 ").length - 1 >= 30, true);
  const prompt = readItems().find((x) => x.id === "qa-prompt").body;
  const w = QF.compose(["締め日は？"], { prompt });
  assert.ok(w.parts[0].startsWith(prompt.trim()));
  assert.equal(QF.compose(["あ".repeat(4000)]).warnings.length, 1);
});

test("質問箱：新しい質問は自動で入り、更新は保留して選んで入れる。案件メモへは二重に入れない", () => {
  const db = GK.model.empty();
  const t1 = QF.triage(db, reply(block("新規", "締め日は？", "要確認", "資料に無い"), block("新規", "上限は？", "確定", "10 万円")));
  assert.deepEqual([t1.fresh.length, t1.updates.length], [2, 0]);
  assert.deepEqual(QF.applyNew(db, t1).added, ["Q-001", "Q-002"]);
  // 同じ質問の回答が変わった（更新）＋新しい質問
  const t2 = QF.triage(db, reply(block("Q-001", "締め日は？", "確定", "月末"), block("新規", "承認者は？", "未確定", "部長の案")));
  assert.deepEqual([t2.fresh.length, t2.updates.length], [1, 1]);
  assert.deepEqual(QF.applyNew(db, t2).added, ["Q-003"]);
  assert.equal(GK.model.find(db, "Q-001").status, "要確認", "更新は選ぶまで入らない");
  const d = QF.applyChosen(db, t2, { [t2.updates[0]]: "apply" });
  assert.deepEqual(d.updated, ["Q-001"]);
  assert.equal(GK.model.find(db, "Q-001").status, "確定");
  const memo = QF.toMemo(db, ["Q-001", "Q-002", "Q-003"], GK.note.empty("x"));
  assert.match(memo, /^F-01 締め日は？ → 月末（質問箱 Q-001）\nF-02 上限は？ → 10 万円（質問箱 Q-002）\nQ-01 承認者は？（未確定：資料に無い）（質問箱 Q-003）$/);
  const note = GK.note.merge(GK.note.empty("x"), GK.note.parseMemo(memo)).note;
  assert.equal(QF.toMemo(db, ["Q-001", "Q-003"], note), "", "入っているものは足さない");
  assert.match(QF.confirmedMd(db, "ダミー"), /## Q-001 締め日は？\n\n月末\n\n- 根拠：資料A\.pdf/);
  // qa-box の控え（JSON）を読み込める
  const back = GK.model.fromJson(GK.model.toJson(db));
  assert.equal(back.items.length, 3);
});

test("拡張：弾4 で足した権限と host は計画どおりだけ", () => {
  const m = manifest();
  assert.deepEqual(m.permissions, ["sidePanel", "storage", "scripting", "alarms", "notifications", "contextMenus", "activeTab"]);
  assert.deepEqual(m.host_permissions, ["https://gemini.google.com/*", "https://notebooklm.google.com/*", "https://notebook.google.com/*", "https://meet.google.com/*"]);
  assert.match(m.content_security_policy.extension_pages, /connect-src 'none'/);
});
