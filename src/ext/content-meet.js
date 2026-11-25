// Meet の画面の字幕を読む content script。記録中は 0.5 秒ごとに「見えている字幕（話者と文）」を時刻つきで貯め、
// サイドパネルが取りに来たら渡す（確定させるのはパネルの meetlog.js）。音声は扱わない。通信しない。画面は書き換えない
(function () {
  "use strict";
  if (window.__gaMeet) return;
  window.__gaMeet = true;

  const DEFAULT = {
    region: '[role="region"][aria-label*="字幕"], [role="region"][aria-label*="Captions" i], .a4cQT, [data-ga-captions]',
    item: ".nMcdL, [data-ga-caption]",
    speaker: ".NWpY1d, .KcIKyf, [data-speaker]",
    text: ".bh44bd, .iOzk7, [data-text]",
  };
  let SEL = Object.assign({}, DEFAULT);
  const loadSel = () => new Promise((res) => {
    try { chrome.storage.local.get("selectors", (v) => { SEL = Object.assign({}, DEFAULT, (v && v.selectors && v.selectors.meet) || {}); res(); }); } catch (e) { res(); }
  });
  const MAX = 4000; // パネルが閉じていても貯めておく数（0.5 秒ごとで約 30 分）
  let timer = null, buf = [], started = 0, lastKey = "";

  function read() {
    const region = document.querySelector(SEL.region);
    if (!region) return null;
    const items = [];
    for (const it of region.querySelectorAll(SEL.item)) {
      const sp = it.querySelector(SEL.speaker);
      const tx = it.querySelector(SEL.text);
      const text = (tx ? tx.textContent : it.textContent.replace(sp ? sp.textContent : "", "")).replace(/\s+/g, " ").trim();
      if (text) items.push({ speaker: sp ? sp.textContent.replace(/\s+/g, " ").trim() : "", text });
    }
    return items;
  }
  function sample() {
    const items = read();
    if (!items || !items.length) return;
    const key = JSON.stringify(items);
    if (key === lastKey) return; // 変わらない間は貯めない
    lastKey = key;
    buf.push({ t: Date.now(), items });
    if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.to !== "meet") return false;
    (async () => {
      await loadSel();
      if (msg.op === "ping") return reply({ ok: true });
      if (msg.op === "selftest") return reply({ ok: true, captions: !!document.querySelector(SEL.region), recording: !!timer, title: document.title });
      if (msg.op === "start") {
        if (!timer) { buf = []; lastKey = ""; started = Date.now(); timer = setInterval(sample, 500); }
        return reply({ ok: true, started, captions: !!document.querySelector(SEL.region) });
      }
      if (msg.op === "pull") { const out = buf; buf = []; return reply({ ok: true, snapshots: out, recording: !!timer, captions: !!document.querySelector(SEL.region) }); }
      if (msg.op === "stop") { if (timer) { sample(); clearInterval(timer); timer = null; } const out = buf; buf = []; return reply({ ok: true, snapshots: out }); }
      reply({ ok: false, error: "知らない依頼です：" + msg.op });
    })();
    return true;
  });
})();
