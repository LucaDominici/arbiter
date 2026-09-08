#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// check-todo-max-age.mjs — INV-133 (generated, Track-B).
//
// A TODO(#NNN) whose LINKED ISSUE was created more than MAX_AGE_DAYS ago FAILS the gate.
// Age is derived from the issue `created_at` ONLY — never from line/blame/git metadata.
// Graceful-skip when gh is missing / token absent / offline: the gate exits 0 (SKIP) and
// NEVER false-fails on a network or auth problem.
//
// Usage: node scripts/check-todo-max-age.mjs [dir...]
//   env TODO_MAX_AGE_DAYS  override the 180-day default
//
// Exit codes (INV-53):
//   0  PASS / SKIP (no over-age TODO, or created_at unresolvable — offline)
//   1  FAIL — one or more linked issues are older than MAX_AGE_DAYS
//   2  ERROR — invocation error
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkRepo } from './lib/glob-walk.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MAX_AGE_DAYS = 180;

const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.go', '.py', '.java', '.kt', '.rs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'target', '.git', 'vendor']);
const TODO_ISSUE = /TODO\(#(\d+)\)/g;

// ── Pure logic ────────────────────────────────────────────────────────────────

export function isOverAge(createdAtIso, nowMs, maxAgeDays) {
  if (!createdAtIso || typeof createdAtIso !== 'string') return false;
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return false;
  const ageDays = (nowMs - created) / (24 * 60 * 60 * 1000);
  return ageDays > maxAgeDays;
}

export function parseTodoIssueRefs(content) {
  const refs = [];
  const lines = String(content ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let m;
    TODO_ISSUE.lastIndex = 0;
    while ((m = TODO_ISSUE.exec(lines[i])) !== null) {
      refs.push({ issueNumber: Number(m[1]), line: i + 1 });
    }
  }
  return refs;
}

export function classifyOverAge(refs, createdAtMap, nowMs, maxAgeDays) {
  let anyResolved = false;
  const overAge = [];
  for (const ref of refs) {
    const createdAt = createdAtMap.get(ref.issueNumber);
    if (createdAt === undefined || createdAt === '') continue;
    anyResolved = true;
    if (isOverAge(createdAt, nowMs, maxAgeDays)) overAge.push(ref);
  }
  const skipped = refs.length > 0 && !anyResolved;
  return { skipped, overAge };
}

// ── gh / fs helpers ───────────────────────────────────────────────────────────

export function resolveOwnerRepo() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' });
  if (r.status !== 0 || !r.stdout) return null;
  const url = r.stdout.trim();
  const m = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

function fetchCreatedAt(ownerRepo, issueNumber) {
  const r = spawnSync(
    'gh',
    ['api', `repos/${ownerRepo}/issues/${issueNumber}`, '--jq', '.created_at'],
    { encoding: 'utf-8', env: process.env },
  );
  if (r.status !== 0 || !r.stdout) return '';
  return r.stdout.trim();
}

/**
 * Walk `dir` for TODO(#NNN) refs, appending hits to `acc`. Returns the number of source files
 * actually opened — the caller sums this across scanDirs to tell "found nothing" apart from
 * "looked at nothing" (CANON-24; #2561).
 */
function scan(dir, baseDir, acc) {
  // Cycle-safe walk via the shared helper (#1521): walkRepo prunes vendor trees and never recurses
  // into a symlinked directory. Re-apply this script's own SKIP_DIRS as a path-segment filter so the
  // visited set is identical, minus the symlink-cycle bug.
  let filesScanned = 0;
  for (const rel of walkRepo(dir)) {
    if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue;
    const full = join(dir, rel);
    if (!EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) continue;
    filesScanned++;
    const content = readFileSync(full, 'utf-8');
    for (const ref of parseTodoIssueRefs(content)) {
      acc.push({ file: relative(baseDir, full), issueNumber: ref.issueNumber, line: ref.line });
    }
  }
  return filesScanned;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function main(exitFn = process.exit) {
  const maxAgeDays = Number(process.env.TODO_MAX_AGE_DAYS) || DEFAULT_MAX_AGE_DAYS;
  const baseDir = process.cwd();
  const scanDirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['src', 'lib', 'app'];

  const refs = [];
  let filesScanned = 0;
  for (const dir of scanDirs) {
    // #2561 (mirrors arbiter's own #2526 fix for this same gate): resolve(), not join(), against
    // baseDir. join('/repo', dir) does NOT reset on an absolute `dir` — join('/repo',
    // '/tmp/fixture/src') silently becomes '/repo/tmp/fixture/src', a path that (almost certainly)
    // does not exist, so the gate scanned nothing and exited 0: a green that means "I looked
    // nowhere", not "there is nothing to find". resolve() has POSIX/Node's documented right-to-left
    // semantics: an absolute segment discards everything to its left, so an absolute `dir` is used
    // as-is and a relative one is still joined under baseDir exactly as before.
    filesScanned += scan(resolve(baseDir, dir), baseDir, refs);
  }

  process.stdout.write(
    `check-todo-max-age: scanned ${filesScanned} file(s) across ${scanDirs.length} dir(s): ${scanDirs.join(', ')}\n`,
  );

  // Programme-membership assertion (CANON-24): "nothing found" and "nothing looked at" must
  // never produce the same green. A resolved scan set of zero files — an empty directory, a
  // typo'd path, or (pre-fix) an absolute argument silently mis-resolved under baseDir — means
  // the gate proved nothing, so it fails loudly instead of falling through to the vacuous
  // "no TODO(#NNN) references — PASS" this defect used to produce. This is distinct from the
  // case right below: a NON-ZERO scan set with zero refs in it is a legitimate clean state for
  // this gate (a project can simply have no TODO(#NNN) markers yet), so only an empty FILE SET
  // aborts — an empty REF set does not.
  if (filesScanned === 0) {
    process.stdout.write(
      `\ncheck-todo-max-age: ABORT — resolved scan set is empty — 0 files found under ${scanDirs.join(', ')}. ` +
        `A gate that finds nothing must first prove it looked somewhere (CANON-24).\n\n`,
    );
    return exitFn(1);
  }

  if (refs.length === 0) {
    process.stdout.write('check-todo-max-age: no TODO(#NNN) references — PASS\n');
    return exitFn(0);
  }

  const ownerRepo = resolveOwnerRepo();
  if (!ownerRepo) {
    process.stdout.write(
      'check-todo-max-age: SKIP — could not resolve OWNER/REPO from git origin (offline?)\n',
    );
    return exitFn(0);
  }

  const createdAtMap = new Map();
  for (const ref of refs) {
    if (createdAtMap.has(ref.issueNumber)) continue;
    createdAtMap.set(ref.issueNumber, fetchCreatedAt(ownerRepo, ref.issueNumber));
  }

  const { skipped, overAge } = classifyOverAge(refs, createdAtMap, Date.now(), maxAgeDays);

  if (skipped) {
    process.stdout.write(
      'check-todo-max-age: SKIP — no issue created_at could be resolved (gh missing / token absent / offline)\n',
    );
    return exitFn(0);
  }

  if (overAge.length > 0) {
    process.stdout.write(
      `check-todo-max-age: FAIL — ${overAge.length} TODO(#NNN) link issue(s) older than ${maxAgeDays} days:\n`,
    );
    for (const ref of overAge) {
      process.stdout.write(`  ${ref.file}:${ref.line}  TODO(#${ref.issueNumber})\n`);
    }
    process.stdout.write(
      '  Resolve the linked issue or split the work — an over-age TODO is stale debt.\n',
    );
    return exitFn(1);
  }

  process.stdout.write(
    `check-todo-max-age: PASS — ${createdAtMap.size} linked issue(s) within ${maxAgeDays} days\n`,
  );
  return exitFn(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    process.stderr.write(
      `check-todo-max-age: ERROR — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }
}
