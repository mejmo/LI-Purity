#!/usr/bin/env node
// Sanity checks before packaging:
//  - manifest.json parses and every file it references exists
//  - every extension JS file parses
//  - with a tag argument (e.g. `node scripts/check.js v0.3.0`), the manifest
//    version must match it
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const fail = (msg) => { console.error(`✗ ${msg}`); process.exitCode = 1; };

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const referenced = new Set([
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
].filter(Boolean));

for (const file of referenced) {
  if (!fs.existsSync(path.join(root, file))) fail(`manifest references missing file: ${file}`);
}

for (const file of fs.readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".js"))) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, "src", file)], { stdio: "pipe" });
  } catch (e) {
    fail(`syntax error in src/${file}\n${e.stderr}`);
  }
}

const tag = process.argv[2];
if (tag && tag.replace(/^v/, "") !== manifest.version) {
  fail(`tag ${tag} does not match manifest version ${manifest.version}`);
}

if (!process.exitCode) console.log(`✓ manifest ${manifest.version}: ${referenced.size} files present, sources parse`);
