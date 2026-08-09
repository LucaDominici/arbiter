#!/usr/bin/env node
// go-library — action SHA-pin gate (INV-76)
// Gate: verify all GitHub Actions references in .github/ are SHA-pinned.
// L1: tag references generate warnings but do not fail.
// L2/L3: any tag reference is a hard failure.
// Part of the anti-drift validator family (W6).
// Usage: node scripts/check-action-pins.mjs [--help]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write('Usage: node scripts/check-action-pins.mjs [--help]\nVerify all GitHub Actions references in .github/ are SHA-pinned.\n');
  process.exit(0);
}

const LEVEL = 'L1';
const CWD = process.cwd();

function collectYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Skip symlinks to avoid traversal outside the workflows tree.
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectYamlFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
      results.push(full);
    }
  }
  return results;
}

const yamlFiles = [
  ...collectYamlFiles(join(CWD, '.github', 'workflows')),
  ...collectYamlFiles(join(CWD, '.github', 'actions')),
];

// SHA-pinned: exactly 40 hex characters after @
// Tag-pinned / branch-pinned: anything else (v4, main, latest, etc.)
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
// Matches both YAML sequence members ('- uses: foo/bar@ref') and direct keys ('uses: foo/bar@ref').
// Captures action path (group 1) and ref (group 2). Quoted refs are unwrapped post-match.
const USES_PATTERN = /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([^\s#"']+)["']?/gm;
// Comment-truthfulness scan (#1666, mirrored from the self gate / #1614): a single immutable sha
// resolves to exactly ONE upstream release, so two pins of the SAME sha must not advertise
// DIFFERENT MAJOR versions. Captures action (1), 40-hex sha (2), and the `# vN…` label (3).
// `# v6` vs `# v6.0.3` is precision (same major), tolerated; `# v9` vs `# v7` for one sha lies.
const USES_WITH_COMMENT = /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([0-9a-fA-F]{40})["']?\s*#\s*(v\d+\S*)/gm;
const majorOf = (versionLabel) => {
  const m = /^v(\d+)/.exec(versionLabel);
  return m ? m[1] : null;
};

// Divergent-SHA scan (#1666, mirrored from the self gate). Captures action (1), 40-hex sha (2),
// and the OPTIONAL trailing comment (3). One immutable sha is ONE release: pinning an action to
// >1 distinct sha WITHIN one MAJOR is a dup-sha bug; a split ACROSS majors is allowed only when
// declared in CROSS_MAJOR_ALLOWLIST (the splits arbiter's own generated workflows legitimately ship).
const USES_WITH_OPTIONAL_COMMENT = /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([0-9a-fA-F]{40})["']?\s*(?:#\s*([^\n]+?))?\s*$/gm;
// `action -> { effectiveMajor -> exact 40-hex sha }`. For 0ver actions the effective major is
// `0.<minor>` (semver-0 treats the minor as the breaking axis). Within-major dups are never
// allowlistable; only an intentional cross-major split belongs here.
const CROSS_MAJOR_ALLOWLIST = {
  'actions/download-artifact': { 4: 'd3f86a106a0bac45b974a628896c90dbdf5c8093', 8: '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c' },
  'actions/github-script': { 7: 'f28e40c7f34bde8b3046d885e986cb6290c5673b', 9: '3a2844b7e9c422d3c10d287c895573f7108da1b3' },
  'actions/setup-node': { 4: '39370e3970a6d050c480ffad4ff0ed4d3fdee5af', 7: '820762786026740c76f36085b0efc47a31fe5020' },
  'actions/upload-artifact': { 4: 'ea165f8d65b6e75b540449e92b4886f43607fa02', 7: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' },
  'gradle/actions/setup-gradle': { 3: 'd9c87d481d55275bb5441eef3fe0e46805f9ef70', 4: 'ed408507eac070d1f99cc633dbcf757c94c7933a', 6: '9c971963bec38e04b3d30dcc455b5382be2fdbfb' },
  'anchore/sbom-action': { '0.9': 'f6c3d0fe42c3cf876e3462574e4c9416b5e0f07a', '0.24': 'e22c389904149dbc22b58101806040fa8d37a610' },
};
const effectiveMajor = (label) => {
  const m = /^v(\d+)(?:\.(\d+))?/.exec(label);
  if (!m) return null;
  if (m[1] === '0') return m[2] !== undefined ? `0.${m[2]}` : '0';
  return m[1];
};
// Bucket per-SHA (not per-occurrence) so the same sha seen with and without a comment is one bucket.
const bucketOfSha = (labels) => {
  for (const l of labels) {
    const major = effectiveMajor(l);
    if (major !== null) return major;
  }
  for (const l of labels) return `ref:${l.replace(/^branch:/, '')}`;
  return 'unlabeled';
};

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

const violations = [];
// action@sha -> Map<versionLabel, Set<file>>; populated across the whole scanned set so a
// contradiction split across two workflow files is still caught.
const shaComments = new Map();
// action -> Map<sha, Set<label>>; tracks every distinct sha pinned for an action (#1666).
const actionPins = new Map();
for (const file of yamlFiles) {
  const content = readFileSync(file, 'utf-8');
  for (const match of content.matchAll(USES_PATTERN)) {
    const action = stripQuotes(match[1]);
    const ref = stripQuotes(match[2]);
    if (action.startsWith('.')) continue;   // local composite actions
    if (action.startsWith('docker://')) continue;
    if (!SHA_PATTERN.test(ref)) {
      violations.push({ file: file.replace(CWD + '/', ''), action, ref });
    }
  }
  for (const match of content.matchAll(USES_WITH_COMMENT)) {
    const action = match[1];
    if (action.startsWith('.') || action.startsWith('docker://')) continue;
    const key = `${action}@${match[2]}`;
    const versionLabel = match[3];
    if (!shaComments.has(key)) shaComments.set(key, new Map());
    const labels = shaComments.get(key);
    if (!labels.has(versionLabel)) labels.set(versionLabel, new Set());
    labels.get(versionLabel).add(file.replace(CWD + '/', ''));
  }
  for (const match of content.matchAll(USES_WITH_OPTIONAL_COMMENT)) {
    const action = match[1];
    if (action.startsWith('.') || action.startsWith('docker://')) continue;
    const sha = match[2].toLowerCase();
    const lbl = (match[3] ?? '').trim();
    if (!actionPins.has(action)) actionPins.set(action, new Map());
    const shaMap = actionPins.get(action);
    if (!shaMap.has(sha)) shaMap.set(sha, new Set());
    if (lbl) shaMap.get(sha).add(lbl);
  }
}

// A sha whose pins disagree on the MAJOR version is mislabelled — exactly one label is false.
// Differing patch/minor precision on a shared major is not a contradiction.
const commentViolations = [];
for (const [key, labels] of shaComments) {
  const majors = new Set([...labels.keys()].map(majorOf).filter((v) => v !== null));
  if (majors.size > 1) commentViolations.push({ key, labels });
}

// #1666 — divergent-sha: bucket each action's distinct shas by effective major.
//   RULE A: >1 sha WITHIN one major = dup-sha bug, NON-allowlistable.
//   RULE B: a split ACROSS majors is allowed only when declared (exact sha) in CROSS_MAJOR_ALLOWLIST.
const divergentSameMajor = [];
const undeclaredCrossMajor = [];
for (const [action, shaMap] of actionPins) {
  const buckets = new Map();
  for (const [sha, labels] of shaMap) {
    const bucket = bucketOfSha(labels);
    if (!buckets.has(bucket)) buckets.set(bucket, new Set());
    buckets.get(bucket).add(sha);
  }
  for (const [bucket, shas] of buckets) {
    if (shas.size > 1) divergentSameMajor.push({ action, bucket, shas: [...shas] });
  }
  if (buckets.size > 1) {
    const allow = CROSS_MAJOR_ALLOWLIST[action];
    for (const [bucket, shas] of buckets) {
      if (shas.size !== 1) continue;
      const [sha] = [...shas];
      if (!allow || allow[bucket] !== sha) {
        undeclaredCrossMajor.push({ action, bucket, sha, declared: allow ? allow[bucket] : null });
      }
    }
  }
}

if (
  violations.length === 0 &&
  commentViolations.length === 0 &&
  divergentSameMajor.length === 0 &&
  undeclaredCrossMajor.length === 0
) {
  console.log('  check-action-pins: all action references are SHA-pinned with truthful version comments');
  process.exit(0);
}

const label = LEVEL === 'L1' ? 'WARN' : 'FAIL';
if (violations.length > 0) {
  console.log(`  check-action-pins: ${violations.length} non-SHA action reference(s) [${label}]:`);
  for (const v of violations) {
    console.log(`    ${v.file}: ${v.action}@${v.ref}`);
  }
}
if (commentViolations.length > 0) {
  console.log(`  check-action-pins: ${commentViolations.length} action SHA(s) with contradictory version comments [${label}] — a sha maps to ONE release:`);
  for (const v of commentViolations) {
    const detail = [...v.labels.entries()]
      .map(([versionLabel, files]) => `# ${versionLabel} (${[...files].join(', ')})`)
      .join(' vs ');
    console.log(`    ${v.key}: ${detail}`);
  }
}
if (divergentSameMajor.length > 0) {
  console.log(`  check-action-pins: ${divergentSameMajor.length} action(s) with divergent SHAs within one major [${label}] — unify to a single sha:`);
  for (const v of divergentSameMajor) {
    console.log(`    ${v.action} (major ${v.bucket}): ${v.shas.join(' vs ')}`);
  }
}
if (undeclaredCrossMajor.length > 0) {
  console.log(`  check-action-pins: ${undeclaredCrossMajor.length} undeclared cross-major action pin(s) [${label}] — add to CROSS_MAJOR_ALLOWLIST or unify:`);
  for (const v of undeclaredCrossMajor) {
    console.log(`    ${v.action}@${v.sha} (major ${v.bucket}) — ${v.declared ? `declared ${v.declared}` : 'not in allowlist'}`);
  }
}

if (LEVEL === 'L1') {
  console.log('  check-action-pins: violations are warnings at L1 — fix before upgrading to L2/L3');
  process.exit(0);
}

process.exit(1);
