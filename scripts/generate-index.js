#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const indexPath = path.join(dataDir, "index.json");

const files = fs.readdirSync(dataDir);
const dates = files
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  .map((f) => f.replace(/\.md$/, ""))
  .sort()
  .reverse();

const output = {
  generatedAt: new Date().toISOString(),
  dates,
};

fs.writeFileSync(indexPath, JSON.stringify(output, null, 2) + "\n");
console.log(`data/index.json mis a jour : ${dates.length} briefing(s).`);
