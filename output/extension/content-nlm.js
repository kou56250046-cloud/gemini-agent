// NotebookLM の画面を操作する content script。質問を入れて送り、回答が終わるのを待って Markdown（出典番号つき）で返す。
// 通信はしない。画面の作りが変わったら、パネルの設定でセレクタを直す
(function () {
  "use strict";
  if (window.__gaNlm) return;
  window.__gaNlm = true;

  const DEFAULT = {
    input: 'textarea.query-box-input, textarea[aria-label*="クエリ"], textarea[aria-label*="query" i], textarea',
    send: 'button.submit-button, button[aria-label*="送信"], button[aria-label*="Submit" i], button[type="submit"]',
    response: ".to-user-container, chat-message .to-user-message, .response-container, [data-test-id=\"response\"]",
    content: ".message-text-content, .markdown, .message-content",
    codeBlock: "pre",
    codeLang: "",
  };
  let SEL = Object.assign({}, DEFAULT);
  const loadSel = () => new Promise((res) => {
    try { chrome.storage.local.get("selectors", (v) => { SEL = Object.assign({}, DEFAULT, (v && v.selectors && v.selectors.notebooklm) || {}); res(); }); } catch (e) { res(); }
  });
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0;

  async function ask(text, timeoutMs) {
    const box = q(SEL.input);
    if (!box) throw new Error("NotebookLM の質問欄が見つかりません（ノートブックを開いてください。または設定のセレクタを確かめてください）");
    const before = qa(SEL.response).length;
    box.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    set.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(200);
    let sent = false;
    for (let i = 0; i < 30 && !sent; i++) {
      const b = qa(SEL.send).find((x) => visible(x) && !x.disabled);
      if (b) { b.click(); sent = true; } else await sleep(100);
    }
    if (!sent) box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const t0 = Date.now();
    let last = "", since = 0;
    while (Date.now() - t0 < (timeoutMs || 180000)) {
      await sleep(600);
      const rs = qa(SEL.response);
      if (rs.length <= before) continue;
      const el = rs[rs.length - 1];
      const md = globalThis.gaDomToMd(el.querySelector(SEL.content) || el, SEL);
      if (md !== last) { last = md; since = Date.now(); continue; }
      if (md && Date.now() - since >= 2000) return { ok: true, text: md };
    }
    return { ok: false, error: "NotebookLM の回答が終わりません（時間切れ）", text: last };
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.to !== "notebooklm") return false;
    (async () => {
      try {
        await loadSel();
        if (msg.op === "ping") return reply({ ok: true });
        if (msg.op === "selftest") return reply({ ok: !!q(SEL.input), input: !!q(SEL.input), responses: qa(SEL.response).length, title: document.title });
        if (msg.op === "ask") {
          // 2 つ目の依頼は断る（入力欄を書き換えて、前の依頼の応答を取り違えないように）
          if (window.__gaAsking) return reply({ ok: false, error: "前の依頼の応答を待っています。終わってから送ってください" });
          window.__gaAsking = true;
          try { return reply(await ask(String(msg.text || ""), msg.timeoutMs)); } finally { window.__gaAsking = false; }
        }
        reply({ ok: false, error: "知らない依頼です：" + msg.op });
      } catch (e) { reply({ ok: false, error: e.message }); }
    })();
    return true;
  });
})();
