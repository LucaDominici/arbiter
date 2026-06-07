---
generated: true
source: 'docs/GOVERNANCE/GOOD-FIRST-ISSUE-CURATION.md'
source_sha: 'f562e22e8e6604ada60f6067ce0d3d8cf2de434c'
last_updated: '2026-06-07'
---

# Good First Issue Curation — Launch Batch

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/GOVERNANCE/GOOD-FIRST-ISSUE-CURATION.md](../docs/GOVERNANCE/GOOD-FIRST-ISSUE-CURATION.md)

# Good First Issue Curation — Launch Batch

10 issues curated at the v1 public launch. Each is filed using `docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md`.
Run the `gh issue create` commands below after the PR containing this file merges.

---

## 1 — Fix typos in CLI reference

**File:** `docs/REFERENCE/CLI.md`
**AC:** All identified typos corrected; `node scripts/check-docs.mjs` passes.

```bash
gh issue create \
  --title "chore: fix typos in docs/REFERENCE/CLI.md" \
  --label "good first issue,size/XS,documentation" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 2 — Add --help example for arbiter explain

**File:** `docs/REFERENCE/CLI.md` (explain section)
**AC:** A `--help` example block added matching actual CLI output.

```bash
gh issue create \
  --title "docs: add --help example for arbiter explain in CLI reference" \
  --label "good first issue,size/XS,documentation" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 3 — Document ARBITER_DEBUG=1 env var

**File:** `docs/REFERENCE/api.md`
**AC:** `ARBITER_DEBUG=1` env var documented with example output.

```bash
gh issue create \
  --title "docs: document ARBITER_DEBUG=1 env var in api.md" \
  --label "good first issue,size/XS,documentation" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 4 — Add unit test for formatBytes util

**File:** `src/utils/` (find formatBytes), `__tests__/utils/`
**AC:** New test file with ≥5 cases; `npx vitest run` passes.

```bash
gh issue create \
  --title "test: add unit tests for formatBytes util" \
  --label "good first issue,size/S,enhancement" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 5 — Replace remaining console.log in scripts

**Files:** `scripts/` (grep for `console.log`)
**AC:** All `console.log` replaced with `process.stdout.write`; `check-anti-telemetry.mjs` passes.

```bash
gh issue create \
  --title "chore: replace console.log with process.stdout.write in scripts/" \
  --label "good first issue,size/S,enhancement" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 6 — Link README to FAQ

**Files:** `README.md`, `docs/FAQ.md`
**AC:** README has a "FAQ" link in the navigation section; link resolves.

```bash
gh issue create \
  --title "docs: add FAQ link to README navigation" \
  --label "good first issue,size/XS,documentation" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 7 — Add npm version badge to README

**File:** `README.md`
**AC:** `[![npm version](https://img.shields.io/npm/v/@arbiter/cli)](https://www.npmjs.com/package/@arbiter/cli)` badge present and renders.

```bash
gh issue create \
  --title "docs: add npm version badge to README" \
  --label "good first issue,size/XS,documentation" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 8 — Improve error message for arbiter init in non-empty dir

**File:** `src/commands/init.ts`
**AC:** When run in a non-empty dir without `--force`, error message names the conflicting files and suggests `--force`.

```bash
gh issue create \
  --title "fix: improve arbiter init error message for non-empty directory" \
  --label "good first issue,size/S,enhancement" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 9 — Add arbiter explain --json example to docs

**File:** `docs/REFERENCE/CLI.md` (explain section)
**AC:** A fenced JSON block showing actual `--json` output is present.

```bash
gh issue create \
  --title "docs: add arbiter explain --json output example to CLI reference" \
  --label "good first issue,size/XS,documentation" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```

---

## 10 — Spell-check pass on docs/SETUP.md

**File:** `docs/SETUP.md`
**AC:** All spelling errors corrected; no new content added.

```bash
gh issue create \
  --title "docs: spell-check pass on docs/SETUP.md" \
  --label "good first issue,size/XS,documentation" \
  --body "$(cat docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md)"
```
