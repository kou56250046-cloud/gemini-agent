// run_js の実行場所（拡張の sandbox ページ。拡張の API にも、パネルの画面にも触れない。CSP で通信を止めている）。
// Worker で動かし、3 秒で打ち切る（無限ループでもパネルが固まらないように）。Worker が使えないときは、この中で直接動かす
(function () {
  "use strict";
  const LIMIT = 3000;
  const WORKER = `self.onmessage = (e) => {
    const send = (o) => { try { postMessage(o); } catch (err) { postMessage({ ok: false, error: "結果を返せません（関数や循環した値は返せません）" }); } };
    try {
      const f = new Function("input", e.data.code);
      Promise.resolve(f(e.data.input)).then((r) => send({ ok: true, result: r === undefined ? null : r }), (err) => send({ ok: false, error: String(err && err.message || err) }));
    } catch (err) { send({ ok: false, error: String(err && err.message || err) }); }
  };`;
  let workerUrl = null;
  try { workerUrl = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" })); } catch (e) { workerUrl = null; }

  function runDirect(code, input) {
    return new Promise((resolve) => {
      try {
        const f = new Function("input", code);
        Promise.resolve(f(input)).then((r) => resolve({ ok: true, result: r === undefined ? null : r, direct: true }), (err) => resolve({ ok: false, error: String(err && err.message || err) }));
      } catch (err) { resolve({ ok: false, error: String(err && err.message || err) }); }
    });
  }
  function run(code, input) {
    if (!workerUrl) return runDirect(code, input);
    return new Promise((resolve) => {
      let w;
      try { w = new Worker(workerUrl); } catch (e) { resolve(runDirect(code, input)); return; }
      const t = setTimeout(() => { w.terminate(); resolve({ ok: false, error: `${LIMIT / 1000} 秒を超えたので止めました（無限ループか、重すぎる計算です）` }); }, LIMIT);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); resolve(e.data); };
      w.onerror = (e) => { clearTimeout(t); w.terminate(); resolve({ ok: false, error: String(e.message || "実行できませんでした") }); };
      w.postMessage({ code, input });
    });
  }
  window.addEventListener("message", async (e) => {
    const d = e.data || {};
    if (d.type !== "ga-run") return;
    const r = await run(String(d.code || ""), d.input);
    e.source.postMessage({ type: "ga-result", id: d.id, result: r }, "*");
  });
  parent.postMessage({ type: "ga-sandbox-ready" }, "*");
})();
