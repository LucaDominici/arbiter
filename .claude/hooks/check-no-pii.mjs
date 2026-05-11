#!/usr/bin/env node
// Arbiter hook: block PII patterns in edited files (INV-12)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from "node:fs";
import { findInlineSuppression } from "./lib.mjs";

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? "";
if (!file || !existsSync(file)) process.exit(0);

const SKIP_EXTENSIONS = [
  ".lock",
  ".lockb",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".wasm",
  ".bin",
  ".toml",
  ".json",
];
if (SKIP_EXTENSIONS.some((ext) => file.endsWith(ext))) process.exit(0);

let content;
try {
  content = readFileSync(file, "utf-8");
} catch {
  process.exit(0);
}

const PII_PATTERNS = [
  {
    label: "email address",
    re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
  },
  { label: "phone (E.164)", re: /\+\d{7,15}\b/ },
  {
    label: "credit card (Luhn-like)",
    re: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})\b/,
  },
];

const findings = [];
const lines = content.split("\n");
for (const { label, re } of PII_PATTERNS) {
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]) && !findInlineSuppression(content, i, "INV-12")) {
      findings.push(
        `  line ${i + 1} [${label}]: ${lines[i].trim().slice(0, 80)}`,
      );
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`[arbiter] INV-12: PII pattern detected in ${file}:\n`);
  findings.slice(0, 5).forEach((f) => process.stderr.write(`${f}\n`));
  process.stderr.write(
    `Add an allowlist entry to suppressions/pii-allowlist.json if this is a test fixture.\n`,
  );
  process.exit(1);
}
