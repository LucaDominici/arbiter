#!/usr/bin/env node
// bloat-lib.mjs — helpers for file-count and LOC measurement (CANON-16, INV-46)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const TEST_RE = /(?:^|\/)__tests__(?:\/|$)|\.(test|spec)\.[cm]?[jt]s$/;

/**
 * Recursively count files matching exts under dir, excluding test paths.
 * @param {string} dir
 * @param {string[]} exts e.g. ['.ts', '.mjs']
 * @param {boolean} recursive
 */
export function countFiles(dir, exts, recursive = true) {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (TEST_RE.test(full)) continue;
    if (entry.isDirectory() && recursive) {
      count += countFiles(full, exts, true);
    } else if (entry.isFile() && exts.includes(extname(entry.name))) {
      count++;
    }
  }
  return count;
}

/**
 * Recursively count lines across files matching exts under dir, excluding test paths.
 * @param {string} dir
 * @param {string[]} exts
 * @param {boolean} recursive
 */
export function countLOC(dir, exts, recursive = true) {
  let loc = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (TEST_RE.test(full)) continue;
    if (entry.isDirectory() && recursive) {
      loc += countLOC(full, exts, true);
    } else if (entry.isFile() && exts.includes(extname(entry.name))) {
      try {
        loc += readFileSync(full, "utf8").split("\n").length;
      } catch {
        // skip unreadable files
      }
    }
  }
  return loc;
}

/**
 * Count only direct-child files of dir (non-recursive), excluding test paths.
 * @param {string} dir
 * @param {string[]} exts
 */
export function countFilesShallow(dir, exts) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter(
    (e) =>
      e.isFile() && exts.includes(extname(e.name)) && !TEST_RE.test(e.name),
  ).length;
}
