// Gemini の画面を操作する content script。拡張のサイドパネルからの依頼で、入力欄に文を入れて送り、応答が終わるのを待って Markdown で返す。
// 通信はしない（Gemini の画面そのものが Gemini と通信する）。画面の作りが変わったら、パネルの設定でセレクタを直す
(function () {
  "use strict";
  if (window.__gaGemini) return;
  window.__gaGemini = true;

  const DEFAULT = {
    input: 'rich-textarea .ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"], textarea',
    send: 'button.send-button, button[aria-label*="送信"], button[aria-label*="Send"], button[data-test-id="send-button"]',
    stop: 'button[aria-label*="停止"], button[aria-label*="Stop"], .stop-icon, button.stop',
    response: "model-response, .model-response, [data-test-id=\"model-response\"]",
    content: "message-content .markdown, .model-response-text .markdown, message-content, .markdown",
    codeBlock: "code-block, .code-block",
    codeLang: ".code-block-decoration span, .code-block-decoration, .code-lang, [data-lang]",
    // Gem の編集画面の「指示」欄
    gemInstructions: 'textarea[aria-label*="指示"], textarea[aria-label*="Instructions" i], textarea[formcontrolname="instructions"], [contenteditable="true"][aria-label*="指示"], [data-ga-gem-instructions]',
  };
  let SEL = Object.assign({}, DEFAULT);
  const loadSel = () => new Promise((res) => {
    try { chrome.storage.local.get("selectors", (v) => { SEL = Object.assign({}, DEFAULT, (v && v.selectors && v.selectors.gemini) || {}); res(); }); } catch (e) { res(); }
  });
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0;

  function selftest() {
    const r = { input: !!q(SEL.input), send: !!q(SEL.send), responses: qa(SEL.response).length, url: location.href, title: document.title };
    r.ok = r.input;
    return r;
  }

  // 入力欄に文を入れる。contenteditable（Quill）には insertText、textarea には value＋input イベント
  async function fill(text) {
    const box = q(SEL.input);
    if (!box) throw new Error("入力欄が見つかりません（設定のセレクタ input を確かめてください）");
    box.focus();
    if (box.tagName === "TEXTAREA") {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(box, text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      const ok = document.execCommand("insertText", false, text);
      if (!ok || !box.textContent.trim()) { box.textContent = text; box.dispatchEvent(new InputEvent("input", { bubbles: true })); }
    }
    await sleep(150);
  }

  async function clickSend() {
    for (let i = 0; i < 40; i++) {
      const b = qa(SEL.send).find((x) => visible(x) && !x.disabled && x.getAttribute("aria-disabled") !== "true");
      if (b) { b.click(); return; }
      await sleep(100);
    }
    throw new Error("送信ボタンが押せません（設定のセレクタ send を確かめてください）");
  }

  const lastResponse = () => { const rs = qa(SEL.response); return rs[rs.length - 1] || null; };
  function toMd(resp) {
    if (!resp) return "";
    const content = resp.querySelector(SEL.content) || resp;
    return globalThis.gaDomToMd(content, SEL);
  }

  // 送って、応答が終わるのを待つ。終わりの判定：応答が 1 つ増え、停止ボタンが消え、本文が 1.5 秒変わらない
  async function ask(text, timeoutMs) {
    await loadSel();
    const before = qa(SEL.response).length;
    await fill(text);
    await clickSend();
    const t0 = Date.now();
    const limit = timeoutMs || 300000;
    let last = "", stableSince = 0, started = false;
    while (Date.now() - t0 < limit) {
      await sleep(500);
      const n = qa(SEL.response).length;
      if (n > before) started = true;
      if (!started) continue;
      const generating = qa(SEL.stop).some(visible);
      const md = toMd(lastResponse());
      if (md !== last) { last = md; stableSince = Date.now(); continue; }
      if (!generating && md && Date.now() - stableSince >= 1500) return { ok: true, text: md, ms: Date.now() - t0 };
    }
    return { ok: false, error: started ? "応答が終わりません（時間切れ）" : "応答が始まりません（送信できたか画面で確かめてください）", text: last };
  }

  // 欄の中身を置き換える（textarea は value＋input イベント、contenteditable は insertText）
  function setField(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      if (!document.execCommand("insertText", false, text)) { el.textContent = text; el.dispatchEvent(new InputEvent("input", { bubbles: true })); }
    }
  }

  // スラッシュコマンド：入力欄が「/仕様」などだけのとき Tab で決まった文にする。一覧はパネルが chrome.storage.local「commands」に入れる
  let COMMANDS = {};
  const loadCommands = () => { try { chrome.storage.local.get("commands", (v) => { COMMANDS = (v && v.commands) || {}; }); } catch (e) { /* 無視 */ } };
  loadCommands();
  try { chrome.storage.onChanged.addListener((ch) => { if (ch.commands) COMMANDS = ch.commands.newValue || {}; }); } catch (e) { /* 無視 */ }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.isComposing) return;
    const box = q(SEL.input);
    if (!box || !(box === e.target || box.contains(e.target))) return;
    const cur = (box.tagName === "TEXTAREA" ? box.value : box.innerText).trim();
    const m = cur.match(/^\/(\S+)$/);
    if (!m || !COMMANDS[m[1]]) return;
    e.preventDefault();
    e.stopPropagation();
    const v = COMMANDS[m[1]];
    // 案件メモの要約が要るもの（/引き継ぎ）は、storage に入れず、その場でサイドパネルに問い合わせる
    if (/^@@gemini-agent:/.test(v)) {
      chrome.runtime.sendMessage({ type: "ga-handover" }).then((r) => setField(box, r && r.ok ? r.text : "（サイドパネルを開いてから、もう一度 /引き継ぎ を使ってください）"), () => setField(box, "（サイドパネルを開いてから、もう一度 /引き継ぎ を使ってください）"));
      return;
    }
    setField(box, v);
  }, true);

  // Gem の編集画面の指示欄に流し込む。保存ボタンは押さない（人が確かめて押す）
  function gemFill(text) {
    const box = q(SEL.gemInstructions);
    if (!box) return { ok: false, error: "Gem の指示の欄が見つかりません（Gem の編集画面を開いてください。または設定のセレクタ gemInstructions を確かめてください）" };
    setField(box, text);
    const now = box.tagName === "TEXTAREA" ? box.value : box.innerText;
    return { ok: now.replace(/\s+/g, "") === String(text).replace(/\s+/g, ""), chars: now.length };
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.to !== "gemini") return false;
    (async () => {
      try {
        await loadSel();
        if (msg.op === "ping") return reply({ ok: true });
        if (msg.op === "selftest") return reply(selftest());
        if (msg.op === "last") return reply({ ok: true, text: toMd(lastResponse()) });
        if (msg.op === "ask") {
          // 2 つ目の依頼は断る（入力欄を書き換えて、前の依頼の応答を取り違えないように）
          if (window.__gaAsking) return reply({ ok: false, error: "前の依頼の応答を待っています。終わってから送ってください" });
          window.__gaAsking = true;
          try { return reply(await ask(String(msg.text || ""), msg.timeoutMs)); } finally { window.__gaAsking = false; }
        }
        if (msg.op === "gemfill") return reply(gemFill(String(msg.text || "")));
        reply({ ok: false, error: "知らない依頼です：" + msg.op });
      } catch (e) { reply({ ok: false, error: e.message }); }
    })();
    return true; // 非同期で返す
  });
})();
