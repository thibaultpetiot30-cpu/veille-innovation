#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const SOURCE_DIRS = ["data", "data/newsletters"];

for (const rel of SOURCE_DIRS) {
  const dir = path.join(root, rel);
  fs.mkdirSync(dir, { recursive: true });

  const files = fs.readdirSync(dir);
  const dates = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, ""))
    .sort()
    .reverse();

  const output = {
    generatedAt: new Date().toISOString(),
    dates,
  };

  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(output, null, 2) + "\n");
  console.log(`${rel}/index.json mis a jour : ${dates.length} briefing(s).`);
}
