"use strict";

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString();

function dayKey(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function lastDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}

function renderStats(stats) {
  const byDay = stats?.byDay || {};
  const days = lastDays(7);
  const counts = days.map((d) => byDay[dayKey(d)] || 0);

  $("total").textContent = fmt(stats?.total);
  $("since").textContent = stats?.since
    ? `since ${new Date(stats.since + "T00:00").toLocaleDateString()}`
    : "";
  $("today").textContent = fmt(counts[counts.length - 1]);
  $("week").textContent = fmt(counts.reduce((a, b) => a + b, 0));

  const max = Math.max(1, ...counts);
  const chart = $("chart");
  chart.replaceChildren(
    ...days.map((d, i) => {
      const day = document.createElement("div");
      day.className = "day";
      day.title = `${d.toLocaleDateString()}: ${counts[i]} blocked`;

      const wrap = document.createElement("div");
      wrap.className = "bar-wrap";
      const bar = document.createElement("div");
      bar.className = "bar" + (counts[i] ? "" : " zero");
      bar.style.height = `${(counts[i] / max) * 100}%`;
      wrap.append(bar);

      const label = document.createElement("div");
      label.className = "day-label";
      label.textContent = d.toLocaleDateString(undefined, { weekday: "narrow" });

      day.append(wrap, label);
      return day;
    })
  );
}

async function loadTabCount() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { type: "lip:getTabCount" });
    $("tab").textContent = fmt(res?.tabCount);
  } catch {
    $("tab").textContent = "–"; // not a LinkedIn tab
  }
}

async function load() {
  const { stats } = await chrome.storage.local.get("stats");
  renderStats(stats);
}

$("reset").addEventListener("click", async () => {
  if (!confirm("Reset all LI Purity stats?")) return;
  await chrome.runtime.sendMessage({ type: "lip:reset" });
  load();
});

// Live update while the popup is open and the feed is scrolling.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.stats) {
    renderStats(changes.stats.newValue);
    loadTabCount();
  }
});

load();
loadTabCount();
