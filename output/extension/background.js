// 拡張の裏方（service worker）。通信しない。案件フォルダも読まない（フォルダはサイドパネルだけが扱う）
//  - アイコンを押すとサイドパネルを開く
//  - 右クリック「このページを案件の資料に保存」：表示中のページの本文を取り出し、パネルに渡す（パネルが保存する）
//  - 朝の確認：決めた時刻（既定 平日 9:00）に通知する。中身はパネルを開いたときに組み立てる
const MENU = "ga-save-page";
const ALARM = "ga-morning";

function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: MENU, title: "このページを案件の資料に保存（Gemini エージェント）", contexts: ["page", "selection"] }));
  schedule();
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

// ---------- ページの取り込み ----------
const notify = (id, title, message) => chrome.notifications.create(id, { type: "basic", iconUrl: "icon128.png", title, message, priority: 1 });
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU || !tab || tab.id == null) return;
  let page = null;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      // ページを書き換えない。本文・題名・URL・選んだ文字だけを読む
      func: () => ({ title: document.title, url: location.href, text: (document.body && document.body.innerText) || "", selection: String(getSelection() || "") }),
    });
    page = r && r.result;
  } catch (e) {
    notify("ga-page-err", "このページは取り込めません", "Chrome の設定画面や拡張のページなどは読めません");
    return;
  }
  if (!page) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: "ga-page", page });
    if (!res || !res.ok) notify("ga-page-ng", "取り込めませんでした", (res && res.error) || "サイドパネルで案件フォルダを選んでから、もう一度押してください");
  } catch (e) {
    notify("ga-page-closed", "サイドパネルが開いていません", "拡張のアイコンを押してパネルを開いてから、もう一度右クリックで保存してください");
  }
});

// ---------- 朝の確認 ----------
async function schedule() {
  const { morning } = await chrome.storage.local.get("morning");
  const m = Object.assign({ on: true, time: "09:00", weekdays: true }, morning || {});
  await chrome.alarms.clear(ALARM);
  if (!m.on) return;
  const [hh, mm] = String(m.time).split(":").map(Number);
  const next = new Date();
  next.setHours(hh || 0, mm || 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  chrome.alarms.create(ALARM, { when: next.getTime(), periodInMinutes: 24 * 60 });
}
chrome.storage.onChanged.addListener((ch) => { if (ch.morning) schedule(); });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARM) return;
  const { morning } = await chrome.storage.local.get("morning");
  const m = Object.assign({ weekdays: true }, morning || {});
  const day = new Date().getDay();
  if (m.weekdays && (day === 0 || day === 6)) return;
  notify("ga-morning", "案件の確認の時間です", "Gemini エージェントのパネルを開くと、期限の近い質問・止まっている作業・返事待ちが出ます");
});
chrome.notifications.onClicked.addListener((id) => { chrome.notifications.clear(id); });
