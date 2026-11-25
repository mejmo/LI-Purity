/*
 * LI Purity — content script.
 *
 * LinkedIn's class names change often (and the newer UI uses obfuscated ones),
 * so detection is text-based: find a short text node that says "Promoted"
 * (or its localized equivalent), then hide the feed post that contains it.
 *
 * Debug: run `localStorage.lipDebug = 1` in the LinkedIn tab and reload —
 * hidden posts are then shown outlined in red instead of removed.
 */
(() => {
  "use strict";

  const DEBUG = (() => {
    try { return !!localStorage.getItem("lipDebug"); } catch { return false; }
  })();
  if (DEBUG) document.documentElement.setAttribute("data-lip-debug", "");

  const log = (...args) => DEBUG && console.log("[LI Purity]", ...args);

  // The label LinkedIn puts under the author name of a sponsored post,
  // in the UI languages people are most likely to use.
  const PROMOTED_LABELS = [
    "promoted", "sponsored",
    "propagováno", "sponzorováno", // cs
    "propagované", "sponzorované", // sk
    "gesponsert",                  // de
    "sponsorisé", "post sponsorisé", // fr
    "promocionado", "patrocinado", // es / pt
    "sponsorizzato",               // it
    "gepromoot", "gesponsord",     // nl
    "promowane", "sponsorowane",   // pl
    "sponsrad", "sponset",         // sv / no / da
  ];
  // Matches "Promoted" alone or "Promoted by …".
  const PROMOTED_RE = new RegExp(
    `^(?:${PROMOTED_LABELS.join("|")})(?:\\s+(?:by|von|par|por|da|door|przez|av)\\b.*)?$`,
    "iu"
  );

  // Outermost wrappers of a single feed post, most specific first.
  const POST_SELECTORS = [
    "div[data-finite-scroll-hotkey-item]",       // feed list item wrapper
    "div.feed-shared-update-v2",
    "[data-id^='urn:li:activity']",
    "[data-urn^='urn:li:activity']",
    "[data-urn^='urn:li:sponsoredContent']",
    "[data-view-name='feed-full-update']",
    "li.feed-item",
    "[role='listitem']",                          // newer obfuscated feed
  ].join(",");

  const MAX_LABEL_LENGTH = 60;

  function isPromotedText(text) {
    if (!text) return false;
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > 0 && t.length <= MAX_LABEL_LENGTH && PROMOTED_RE.test(t);
  }

  // True if `outer` wraps only `inner` (no other, unrelated post wrappers),
  // i.e. it is still the same single post and not a list of posts.
  function wrapsOnly(outer, inner) {
    for (const p of outer.querySelectorAll(POST_SELECTORS)) {
      if (!inner.contains(p) && !p.contains(inner)) return false;
    }
    return true;
  }

  function findPost(el) {
    // Climb to the outermost wrapper of this one post, so the whole card
    // (incl. its spacing) disappears — but never past a list of posts.
    let post = el.closest(POST_SELECTORS);
    if (!post) return null;
    for (let up = post.parentElement?.closest(POST_SELECTORS); up; up = up.parentElement?.closest(POST_SELECTORS)) {
      if (!wrapsOnly(up, post)) break;
      post = up;
    }
    // Safety net: never hide something that is clearly bigger than one post.
    if (post.matches("main, body, html") || post.querySelector("main")) return null;
    return post;
  }

  let hiddenCount = 0;   // posts hidden in this tab since it was loaded
  let unreported = 0;    // hidden but not yet sent to the background worker

  function send(msg) {
    // Throws "Extension context invalidated" after the extension is reloaded
    // while this tab stays open — nothing useful to do then.
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {}
  }

  function report() {
    if (!unreported) return;
    send({ type: "lip:blocked", reason: "promoted", n: unreported, tabCount: hiddenCount });
    unreported = 0;
  }

  // `count: false` hides without adding to the blocked-ads stats.
  // `attr` picks the hiding style (see content.css).
  function hidePost(post, reason, { count = true, attr = "data-lip-hidden" } = {}) {
    if (post.hasAttribute("data-lip-hidden") || post.hasAttribute("data-lip-collapsed")) return;
    post.setAttribute(attr, reason);
    if (count) {
      hiddenCount++;
      unreported++;
    }
    log(`hid ${reason}`, post);
  }

  // ---- Right sidebar ("Aside") --------------------------------------------

  // Anchors inside a sidebar card. The card itself has no stable marker, so we
  // start here and climb (see sidebarCard).
  const SIDEBAR_AD_SELECTORS = [
    "iframe[title='advertisement']",
    "iframe[componentkey$='_feed_ad']",
  ].join(",");
  const SIDEBAR_AD_CONTAINERS = ".ad-banner-container"; // older LinkedIn UI
  const PUZZLES_SELECTOR = "#feedRightNavGamesComponentRef, [componentkey='feedRightNavGamesComponentRef']";
  const PUZZLES_TITLE_RE = /^today[’']s (?:puzzles|games)$/i; // older UI fallback

  // Climb from `el` through wrappers that hold nothing else, stopping right
  // below the first ancestor that also holds other sidebar content. That is the
  // whole card, including its outer spacing, but never the sidebar itself.
  function sidebarCard(el) {
    const aside = el.closest("aside");
    if (!aside) return null;
    let card = el;
    while (card.parentElement && card.parentElement !== aside && card.parentElement.children.length === 1) {
      card = card.parentElement;
    }
    return card === aside ? null : card;
  }

  // Left sidebar upsell card: "Your Premium features", "Advertise on LinkedIn",
  // "Try Premium Page". Anchored on its menu links; the card is their lowest
  // common ancestor, widened by sidebarCard.
  const UPSELL_LINKS = "a[href*='/campaignmanager/'], a[href*='/premium/']";
  const UPSELL_TEXT_RE = /^try premium/i;

  function hideUpsellCard() {
    const anchors = [...document.querySelectorAll(`aside ${UPSELL_LINKS.split(", ").join(", aside ")}, aside [role='menuitem']`)]
      .filter((a) => !a.closest("[data-lip-hidden]") && a.closest("[role='menu'], .artdeco-card"))
      .filter((a) => a.matches(UPSELL_LINKS) || UPSELL_TEXT_RE.test(a.textContent.trim()));
    // Wait for at least two items, so a half-rendered card isn't hidden piecemeal.
    if (anchors.length < 2) return;

    let common = anchors[0];
    for (const a of anchors) while (common && !common.contains(a)) common = common.parentElement;
    if (!common || !common.closest("aside")) return;

    const card = sidebarCard(common);
    // Safety net: never take the profile card (or the whole column) with it.
    if (!card || card.matches("aside") || card.querySelector("a[href*='/in/']")) return;
    hidePost(card, "upsell", { count: false });
  }

  // ---- Sponsored messages (Messaging) --------------------------------------
  //
  // Conversation list items carry a pill ("Sponsored", "InMail", …). Sponsored
  // ones are hidden at once, then deleted on LinkedIn through its own UI:
  // options menu → "Delete conversation" → confirm dialog. One at a time; the
  // menu and dialog are made invisible while that runs (html[data-lip-busy]).
  // InMail and normal conversations are never touched.

  const CONVO_ITEM = "li.msg-conversation-listitem";
  const CONVO_PILL = ".msg-conversation-card__pill";
  const CONVO_MENU_BUTTON = ".msg-thread-actions__control";
  const CONVO_MENU_OPTION = ".msg-thread-actions__dropdown-option";
  const DELETE_OPTION_RE = /^(?:delete conversation|delete|odstrániť konverzáciu|odstranit konverzaci|smazat konverzaci|unterhaltung löschen|supprimer la conversation|eliminar conversación|elimina conversazione)$/i;
  const DELETE_DIALOG = ".msg-cross-pillar-modal-delete-convo";
  const DELETE_CONFIRM = "[data-test-msg-cross-pillar-delete-conversation-modal-presenter__confirm]";
  const DELETE_CANCEL = "[data-test-msg-cross-pillar-delete-conversation-modal-presenter__cancel]";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout = 4000) {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(100)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  }

  function isSponsoredConvo(li) {
    const pill = li.querySelector(CONVO_PILL);
    return !!pill && isPromotedText(pill.textContent);
  }

  const deleteQueue = [];
  let deleting = false;

  function scanMessages() {
    for (const li of document.querySelectorAll(CONVO_ITEM)) {
      if (li.hasAttribute("data-lip-collapsed") || !isSponsoredConvo(li)) continue;
      // Collapsed rather than display:none — LinkedIn doesn't render the
      // options menu of an element that isn't rendered, and we need it.
      hidePost(li, "sponsored-message", { attr: "data-lip-collapsed" });
      deleteQueue.push(li);
    }
    if (deleteQueue.length && !deleting) processDeleteQueue();
  }

  async function processDeleteQueue() {
    deleting = true;
    document.documentElement.setAttribute("data-lip-busy", "");
    try {
      while (deleteQueue.length) {
        const li = deleteQueue.shift();
        if (!li.isConnected) continue;
        const ok = await deleteConversation(li);
        li.setAttribute("data-lip-delete", ok ? "done" : "failed");
        log(ok ? "deleted sponsored conversation" : "could not delete sponsored conversation", li);
        await sleep(500);
      }
    } finally {
      document.documentElement.removeAttribute("data-lip-busy");
      deleting = false;
    }
  }

  async function deleteConversation(li) {
    const button = li.querySelector(CONVO_MENU_BUTTON);
    if (!button) return false;
    if (button.getAttribute("aria-expanded") !== "true") button.click();

    const option = await waitFor(() =>
      [...li.querySelectorAll(CONVO_MENU_OPTION)].find((o) => DELETE_OPTION_RE.test(o.textContent.trim()))
    );
    if (!option) {
      if (button.getAttribute("aria-expanded") === "true") button.click(); // close menu
      return false;
    }
    option.click();

    const dialog = await waitFor(() => document.querySelector(DELETE_DIALOG));
    const confirm = dialog?.querySelector(DELETE_CONFIRM);
    if (!confirm) {
      dialog?.querySelector(DELETE_CANCEL)?.click();
      return false;
    }
    confirm.click();
    return !!(await waitFor(() => !document.querySelector(DELETE_DIALOG)));
  }

  function scanSidebar() {
    scanMessages();
    hideUpsellCard();
    for (const iframe of document.querySelectorAll(SIDEBAR_AD_SELECTORS)) {
      if (iframe.closest("[data-lip-hidden]")) continue;
      // The iframe sits in a bordered ad box together with its labels.
      const card = sidebarCard(iframe.parentElement || iframe);
      if (card) hidePost(card, "sidebar-ad");
    }
    for (const box of document.querySelectorAll(SIDEBAR_AD_CONTAINERS)) {
      if (!box.closest("[data-lip-hidden]")) hidePost(box, "sidebar-ad");
    }
    for (const el of document.querySelectorAll(PUZZLES_SELECTOR)) {
      if (el.closest("[data-lip-hidden]")) continue;
      const card = sidebarCard(el);
      if (card) hidePost(card, "puzzles", { count: false });
    }
    for (const h of document.querySelectorAll("aside h2, aside h3, aside p")) {
      if (h.closest("[data-lip-hidden]") || !PUZZLES_TITLE_RE.test(h.textContent.trim())) continue;
      const card = h.closest(".artdeco-card, section");
      if (card && !card.matches("aside")) hidePost(card, "puzzles", { count: false });
    }
  }

  // The popup asks for this tab's count.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "lip:getTabCount") sendResponse({ tabCount: hiddenCount });
    });
  } catch {}

  function scan(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const v = node.nodeValue;
        return v && v.length <= MAX_LABEL_LENGTH * 2 && isPromotedText(v)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || el.closest("[data-lip-hidden]")) continue;
      const post = findPost(el);
      if (post) hidePost(post, "promoted");
    }
  }

  // Batch mutations and scan once per frame — the feed mutates a lot.
  const pending = new Set();
  let scheduled = false;
  function flush() {
    scheduled = false;
    for (const node of pending) {
      if (node.isConnected) scan(node);
    }
    pending.clear();
    scanSidebar();
    report();
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") {
        if (m.target.parentElement) pending.add(m.target.parentElement);
      } else {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) pending.add(n);
          else if (n.nodeType === Node.TEXT_NODE && n.parentElement) pending.add(n.parentElement);
        }
      }
    }
    if (pending.size && !scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  });

  send({ type: "lip:hello", tabCount: 0 }); // clear a stale badge from the previous page
  scan(document.body);
  scanSidebar();
  report();
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  log("running");
})();
