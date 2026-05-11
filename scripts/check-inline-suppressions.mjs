#!/usr/bin/env node
// Scans source files for arbiter-suppress directives and validates them.
// Directive form: arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason="...", owner=@user)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkExpiry,
  validateEntry,
  parseArgs,
} from "./lib/suppressions-shared.mjs";

const DIRECTIVE_RE = /\/\/\s*arbiter-suppress\(([^)]+)\)/g;
const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".java",
  ".kt",
  ".rs",
  ".py",
  ".rb",
  ".go",
]);
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__tests__",
]);

function loadKnownInvIds() {
  const catalogPath = fileURLToPath(
    new URL("../src/invariants/catalog.ts", import.meta.url),
  );
  try {
    const text = readFileSync(catalogPath, "utf-8");
    const ids = new Set();
    for (const m of text.matchAll(/"(INV-\d+)"/g)) ids.add(m[1]);
    return ids;
  } catch {
    return null;
  }
}

function parseDirective(argsStr) {
  const parts = parseArgs(argsStr);
  if (parts.length === 0) return null;

  const result = {};

  const firstPart = parts[0];
  if (/^INV-\d+$/.test(firstPart)) {
    result.invId = firstPart;
  } else if (!firstPart.includes("=")) {
    result.invId = firstPart;
  }

  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf("=");
    if (eqIdx === -1) continue;
    const key = parts[i].slice(0, eqIdx).trim();
    let val = parts[i].slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }

  return result;
}

function scanFile(filePath, knownIds, counters) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    DIRECTIVE_RE.lastIndex = 0;
    const match = DIRECTIVE_RE.exec(line);
    if (!match) continue;

    const label = `${filePath}:${i + 1}`;
    const argsStr = match[1];
    const parsed = parseDirective(argsStr);

    if (!parsed || !parsed.invId) {
      process.stderr.write(
        `[FAIL] ${label} — missing or malformed INV-NN identifier\n`,
      );
      counters.failed++;
      continue;
    }

    if (knownIds && !knownIds.has(parsed.invId)) {
      process.stderr.write(
        `[FAIL] ${label} — unknown invariant ID: ${parsed.invId}\n`,
      );
      counters.failed++;
      continue;
    }

    const entry = {
      reason: parsed.reason,
      owner: parsed.owner,
      expiresAt: parsed.until,
    };

    validateEntry(entry, label, filePath, counters, [
      "reason",
      "owner",
      "expiresAt",
    ]);
  }
}

function walkDir(dir, knownIds, counters) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, knownIds, counters);
    } else if (stat.isFile()) {
      const ext = entry.slice(entry.lastIndexOf("."));
      if (SCANNED_EXTENSIONS.has(ext)) {
        scanFile(fullPath, knownIds, counters);
      }
    }
  }
}

const targetDir = process.argv[2] ?? ".";
const knownIds = loadKnownInvIds();
const counters = { failed: 0, warnings: 0 };

walkDir(targetDir, knownIds, counters);

if (counters.warnings > 0) {
  process.stderr.write(
    `[WARN] ${counters.warnings} suppression(s) expiring within 30 days\n`,
  );
}

process.exit(counters.failed > 0 ? 1 : 0);
