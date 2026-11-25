"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPage, sleep, hiddenReasons, blockedTotal } = require("./helpers");

test("hides Promoted feed posts, keeps normal ones", async () => {
  const { document, sent } = loadPage(`<main><div class="feed">
    <div data-finite-scroll-hotkey-item><div class="feed-shared-update-v2" data-urn="urn:li:activity:1"><span>Promoted</span></div></div>
    <div data-finite-scroll-hotkey-item><div class="feed-shared-update-v2" data-urn="urn:li:activity:2"><p>I was promoted today!</p></div></div>
  </div></main>`);

  const hidden = [...document.querySelectorAll("[data-lip-hidden]")];
  assert.equal(hidden.length, 1);
  assert.ok(hidden[0].querySelector("[data-urn='urn:li:activity:1']"));

  // Posts loaded while scrolling, in another UI language.
  const more = document.createElement("div");
  more.setAttribute("data-finite-scroll-hotkey-item", "");
  more.innerHTML = '<div class="feed-shared-update-v2" data-urn="urn:li:activity:3"><span>Propagované</span></div>';
  document.querySelector(".feed").append(more);
  await sleep(100);

  assert.equal(document.querySelectorAll("[data-lip-hidden]").length, 2);
  assert.equal(blockedTotal(sent), 2);
});

test("new feed UI: hides the role=listitem post only", () => {
  const { document } = loadPage(`<main><section><div role="list" data-testid="mainFeed">
    <div role="listitem" id="ad"><p><span>Promoted</span></p></div>
    <div role="listitem" id="ok"><p>normal</p></div>
  </div></section></main>`);
  assert.ok(document.getElementById("ad").hasAttribute("data-lip-hidden"));
  assert.ok(!document.getElementById("ok").hasAttribute("data-lip-hidden"));
});

test("sidebar: hides ad card and puzzles card, keeps neighbours", () => {
  const { document, sent } = loadPage(`<main>
    <aside aria-label="Aside"><div>
      <div><div class="card"><div><div style="display:contents"><div id="feedRightNavGamesComponentRef"><p>Today’s puzzles</p></div></div></div></div><div><div class="add">Add to your feed</div></div></div>
      <div><div><div class="adwrap"><div class="adbox"><span>x</span><iframe title="advertisement" componentkey="MainFeedDesktopNav_feed_ad"></iframe><span>y</span></div></div><div><footer>About</footer></div></div></div>
    </div></aside></main>`);

  assert.deepEqual(hiddenReasons(document).sort(), ["puzzles", "sidebar-ad"]);
  assert.ok(!document.querySelector(".add").closest("[data-lip-hidden]"));
  assert.ok(!document.querySelector("footer").closest("[data-lip-hidden]"));
  assert.equal(blockedTotal(sent), 1, "puzzles card is not counted as an ad");
});

test("left sidebar: hides the Premium/Advertise upsell card, not the profile card", () => {
  const { document } = loadPage(`<main><aside aria-label="Sidebar"><div>
    <div class="profile"><a href="https://www.linkedin.com/in/someone/">Someone</a><a href="https://www.linkedin.com/premium/products/">Premium</a></div>
    <div class="upsell"><div>
      <div role="menu"><a role="menuitem" href="https://www.linkedin.com/premium/my-premium/">Your Premium features</a></div>
      <div><div role="menu"><a role="menuitem" href="https://www.linkedin.com/campaignmanager/accounts/">Advertise on LinkedIn</a></div>
      <div role="menu"><div role="menuitem">Try Premium Page</div></div></div>
    </div></div>
  </div></aside></main>`);

  assert.deepEqual(hiddenReasons(document), ["upsell"]);
  assert.ok(document.querySelector(".upsell").hasAttribute("data-lip-hidden"));
  assert.ok(!document.querySelector(".profile").closest("[data-lip-hidden]"));
});

test("messaging: deletes Sponsored conversations only", async () => {
  const item = (name, pill) => `<li class="msg-conversation-listitem" data-name="${name}"><div><span>${name}</span>
    ${pill ? `<span class="msg-conversation-card__pill">${pill}</span>` : ""}
    <div class="artdeco-dropdown"><button class="msg-thread-actions__control" aria-expanded="false"></button><div class="menu"></div></div></div></li>`;
  const deleted = [];

  // Emulates LinkedIn: menu button → options (async), Delete → dialog, confirm → removed.
  const { document, sent } = loadPage(`<ul>${item("Ad", "Sponsored")}${item("Recruiter", "InMail")}${item("Friend", "")}</ul>`, {
    beforeScript(window) {
      const d = window.document;
      d.addEventListener("click", (e) => {
        const t = e.target;
        if (t.matches(".msg-thread-actions__control")) {
          const li = t.closest("li");
          const open = t.getAttribute("aria-expanded") === "true";
          t.setAttribute("aria-expanded", String(!open));
          setTimeout(() => {
            li.querySelector(".menu").innerHTML = open ? "" : ["Archive", "Hide or report this ad", "Delete conversation"]
              .map((x) => `<div class="msg-thread-actions__dropdown-option">${x}</div>`).join("");
          }, 100);
        }
        if (t.matches(".msg-thread-actions__dropdown-option") && t.textContent === "Delete conversation") {
          const li = t.closest("li");
          setTimeout(() => {
            const m = d.createElement("div");
            m.className = "msg-cross-pillar-modal-delete-convo";
            m.innerHTML = "<button data-test-msg-cross-pillar-delete-conversation-modal-presenter__cancel>Cancel</button>" +
              "<button data-test-msg-cross-pillar-delete-conversation-modal-presenter__confirm>Delete</button>";
            m._li = li;
            d.body.append(m);
          }, 100);
        }
        if (t.matches("[data-test-msg-cross-pillar-delete-conversation-modal-presenter__confirm]")) {
          const m = t.closest(".msg-cross-pillar-modal-delete-convo");
          deleted.push(m._li.dataset.name);
          setTimeout(() => { m._li.remove(); m.remove(); }, 100);
        }
      }, true);
    },
  });

  assert.deepEqual(hiddenReasons(document, "data-lip-collapsed"), ["sponsored-message"]);
  await sleep(2000);

  assert.deepEqual(deleted, ["Ad"]);
  assert.deepEqual([...document.querySelectorAll("li")].map((l) => l.dataset.name), ["Recruiter", "Friend"]);
  assert.ok(!document.documentElement.hasAttribute("data-lip-busy"));
  assert.equal(blockedTotal(sent), 1);
});
