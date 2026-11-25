"use strict";
// Loads src/content.js into a jsdom page with a fake `chrome` API.

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const CONTENT_JS = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");

function loadPage(html, { beforeScript } = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const sent = [];
  dom.window.chrome = {
    runtime: {
      sendMessage: async (msg) => { sent.push(msg); },
      onMessage: { addListener() {} },
    },
  };
  if (beforeScript) beforeScript(dom.window);
  dom.window.eval(CONTENT_JS);
  return { window: dom.window, document: dom.window.document, sent };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hiddenReasons = (document, attr = "data-lip-hidden") =>
  [...document.querySelectorAll(`[${attr}]`)].map((e) => e.getAttribute(attr));

const blockedTotal = (sent) =>
  sent.filter((m) => m.type === "lip:blocked").reduce((n, m) => n + m.n, 0);

module.exports = { loadPage, sleep, hiddenReasons, blockedTotal };
