// 会議の字幕 → 文字起こし（DOM を使わない）。Meet の字幕は話しながら書き換わって伸びるので、話者ごとに「確定」させてから 1 発言にする。
//   update(state, items, now)  画面に見えている字幕 [{ speaker, text }] を渡す（content-meet.js が 0.5 秒ごとに呼ぶ）
//   tick(state, now)           2 秒更新が無い発言を確定する
//   finish(state, now)         残りを全部確定する
//   transcript(state, meta)    [HH:MM:SS] 話者：発言 の文字起こし（clean.js がそのまま読める形）
//   speakerStats(lines)        発言者ごとの発言数・文字数・割合（議事録の末尾に付ける表。Gemini に数えさせない）
(function (GK) {
  "use strict";

  const QUIET_MS = 2000;
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  // 同じ発言の続き（伸びた・言い直された）とみなすか
  function sameUtterance(prev, next) {
    if (!prev || !next) return false;
    if (next.startsWith(prev) || prev.startsWith(next)) return true;
    const p = commonPrefix(prev, next);
    return p >= Math.min(prev.length, next.length) * 0.6 || (prev.length >= 8 && next.includes(prev.slice(0, 8)));
  }

  function create(startMs) {
    return { start: startMs ?? Date.now(), open: new Map(), lines: [], speakers: new Set() };
  }

  function close(state, cur) {
    const text = norm(cur.text);
    if (!text) return;
    // 同じ話者の最近の発言と同じ（または含まれる）文は重ねない。
    // 確定したあとも字幕が画面に残っていると、もう一度見えるため（相手が話した後でも）
    for (let i = state.lines.length - 1, k = 0; i >= 0 && k < 8; i--, k++) {
      const l = state.lines[i];
      if (l.speaker !== cur.speaker) continue;
      if (l.text === text || l.text.includes(text)) return;
      if (i === state.lines.length - 1 && text.startsWith(l.text)) { l.text = text; return; }
    }
    state.lines.push({ at: cur.since, speaker: cur.speaker, text });
  }

  function update(state, items, now) {
    const t = now || Date.now();
    const seen = new Set();
    // 同じ話者の枠が 2 つ見えるとき（前の枠＋話している枠）は、最後の枠だけを使う。
    // 前の枠と交互に照合すると、話している発言が確定と開き直しを繰り返して重なるため
    const last = new Map();
    for (const it of items || []) last.set(norm(it.speaker) || "（話者不明）", it);
    for (const it of last.values()) {
      const speaker = norm(it.speaker) || "（話者不明）";
      const text = norm(it.text);
      if (!text) continue;
      seen.add(speaker);
      state.speakers.add(speaker);
      const cur = state.open.get(speaker);
      if (cur && sameUtterance(cur.text, text)) {
        if (text !== cur.text) { cur.text = text.length >= cur.text.length || !cur.text.startsWith(text) ? text : cur.text; cur.updated = t; }
        continue;
      }
      if (cur) close(state, cur);
      state.open.set(speaker, { speaker, text, since: t, updated: t });
    }
    tick(state, t);
    return state;
  }

  function tick(state, now) {
    const t = now || Date.now();
    for (const [k, cur] of [...state.open]) if (t - cur.updated >= QUIET_MS) { close(state, cur); state.open.delete(k); }
    return state;
  }
  function finish(state, now) {
    for (const cur of [...state.open.values()].sort((a, b) => a.since - b.since)) close(state, cur);
    state.open.clear();
    state.end = now || Date.now();
    return state;
  }

  const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const p = (n) => String(n).padStart(2, "0"); return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`; };
  const stamp = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  function transcript(state, meta) {
    const m = meta || {};
    const lines = [...state.lines].sort((a, b) => a.at - b.at);
    const end = state.end || (lines.length ? lines[lines.length - 1].at : state.start);
    return [
      `# ${m.title || "会議"}：文字起こし`,
      "",
      `- 日時：${stamp(state.start)}（${Math.max(1, Math.round((end - state.start) / 60000))} 分）`,
      `- 参加者（字幕に出た話者）：${[...state.speakers].join("、") || "なし"}`,
      `- 取り方：Meet の字幕（gemini-agent）。字幕の聞き取り違いが含まれる`,
      "",
      ...lines.map((l) => `[${hms(l.at - state.start)}] ${l.speaker}：${l.text}`),
      "",
    ].join("\n");
  }

  // clean.js の lines（{ t, speaker, text, raw }）から、発言者ごとの数
  function speakerStats(lines) {
    const by = new Map();
    let total = 0;
    for (const l of lines || []) {
      if (l.raw || !l.speaker) continue;
      const s = by.get(l.speaker) || { speaker: l.speaker, count: 0, chars: 0 };
      s.count++; s.chars += l.text.length; total += l.text.length;
      by.set(l.speaker, s);
    }
    const list = [...by.values()].sort((a, b) => b.chars - a.chars).map((s) => Object.assign(s, { share: total ? Math.round((s.chars / total) * 1000) / 10 : 0 }));
    const md = list.length ? ["| 発言者 | 発言数 | 文字数 | 割合(%) |", "|---|---|---|---|", ...list.map((s) => `| ${s.speaker} | ${s.count} | ${s.chars} | ${s.share} |`)].join("\n") : "";
    return { list, total, md };
  }

  GK.meetlog = { QUIET_MS, create, update, tick, finish, transcript, speakerStats, sameUtterance, hms };
})(globalThis.GK = globalThis.GK || {});
