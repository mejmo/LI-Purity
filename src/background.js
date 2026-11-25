/*
 * LI Purity — background service worker.
 *
 * Keeps the persistent block statistics in chrome.storage.local and shows the
 * per-tab count on the toolbar badge.
 *
 * Stored shape (key "stats"):
 *   { total: number, since: "YYYY-MM-DD", byDay: { "YYYY-MM-DD": number }, byType: { promoted: number } }
 */
"use strict";

const KEEP_DAYS = 90;

function dayKey(d = new Date()) {
  // Local date, not UTC, so "today" matches the user's clock.
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function emptyStats() {
  return { total: 0, since: dayKey(), byDay: {}, byType: {} };
}

// Serialize read-modify-write so bursts of blocks don't lose increments.
let queue = Promise.resolve();
function recordBlocks(type, n) {
  queue = queue.then(async () => {
    const { stats = emptyStats() } = await chrome.storage.local.get("stats");
    const today = dayKey();
    stats.total += n;
    stats.byDay[today] = (stats.byDay[today] || 0) + n;
    stats.byType[type] = (stats.byType[type] || 0) + n;

    const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * 864e5));
    for (const day of Object.keys(stats.byDay)) {
      if (day < cutoff) delete stats.byDay[day];
    }
    await chrome.storage.local.set({ stats });
  }).catch((e) => console.error("[LI Purity] stats", e));
  return queue;
}

function setBadge(tabId, count) {
  if (tabId == null) return;
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeBackgroundColor({ color: "#0a66c2" });
  chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
  const { stats } = await chrome.storage.local.get("stats");
  if (!stats) await chrome.storage.local.set({ stats: emptyStats() });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  switch (msg?.type) {
    case "lip:hello": // content script (re)started in a tab
      setBadge(tabId, msg.tabCount);
      break;
    case "lip:blocked":
      setBadge(tabId, msg.tabCount);
      recordBlocks(msg.reason || "promoted", msg.n || 1);
      break;
    case "lip:reset":
      queue = queue.then(() => chrome.storage.local.set({ stats: emptyStats() }));
      queue.then(() => sendResponse({ ok: true }));
      return true; // async response
  }
});
