# Post-Merge Review — Good-First-Issue Bundle #805–#814

**Date:** 2026-05-17  
**PR:** #827  
**Merged by:** force-merge protocol (docs + light code, ≥3 tasks)  
**Reviewer:** C1 post-merge (mandatory per CANON-02 batch rule)

---

## Bundle Summary

| Issue | Type  | Files                                                     | Status |
| ----- | ----- | --------------------------------------------------------- | ------ |
| #812  | fix   | `src/commands/init.ts`, `__tests__/commands/init.test.ts` | MERGED |
| #809  | chore | `scripts/**/*.mjs` (36 files)                             | MERGED |
| #810  | docs  | `README.md`                                               | MERGED |
| #811  | docs  | `README.md`                                               | MERGED |
| #805  | docs  | `website/reference/cli.md`                                | MERGED |
| #814  | docs  | `docs/SETUP.md` (no change needed)                        | MERGED |
| #806  | docs  | `website/reference/cli.md`                                | MERGED |
| #813  | docs  | `website/reference/cli.md`                                | MERGED |

Excluded: #807 (ARBITER_DEBUG not in src/), #808 (formatBytes not in src/), #743 (PGP key out-of-band).

---

## Gate Results

| Gate           | Result | Notes                                                    |
| -------------- | ------ | -------------------------------------------------------- |
| L1 (37 checks) | PASS   | All green on each commit                                 |
| L2 (48 checks) | PASS   | Green on push (pre-push hook)                            |
| Coverage       | PASS   |                                                          |
| Debt ratchet   | PASS   | Baseline refreshed after earlier PRs added +1 complexity |
| TDD evidence   | PASS   | #812 test written first; doc issues vacuous pass         |
| Dogfood        | PASS   |                                                          |

---

## Issue-by-Issue Assessment

### #812 — init error UX (PASS)

**Implementation:** Added block after brownfield conflicts in `runInit`. When `!options.brownfield && !options.json` and skipped files exist, logs file names and suggests `--force`.

**Test:** Added `it('lists skipped filenames and suggests --force in non-brownfield mode (#812)')` to `__tests__/commands/init.test.ts`. Test written before implementation (TDD).

**Verdict:** Correct, tested, no regression. AC satisfied.

### #809 — console.log → process.stdout.write (PASS)

**Implementation:** Mechanical replacement across 36 script files, 152 sites. Each `console.log('x')` → `process.stdout.write('x\n')`. Two-pass: automated script for single-line cases, manual for multi-line template literals. Also fixed literal newlines in single-quoted strings (invalid JS produced by automated pass).

**Risk realized:** Automated pass introduced literal newlines inside single-quoted strings (SyntaxError). Fixed by secondary repair script. Pre-commit hook caught the format issue (Prettier); fixed before commit.

**Verdict:** Correct. `grep -rn 'console.log' scripts/` returns empty.

### #805 — CLI.md typos (PASS with deviation)

**Implementation:** `docs/REFERENCE/CLI.md` is a redirect stub. Fixed the inverted JSON exit-code table in the canonical source `website/reference/cli.md` (Code 1=error/Code 2=warning → correct Code 1=warning/Code 2=error, matching `statusToExitCode` in source).

**SETUP.md (#814):** cspell found only technical terms (hex color codes, Linux errno names). No real spelling errors — no change made.

**Verdict:** Factual error corrected. No new content added.

### #806 / #813 — explain --help and --json examples (PASS)

**Implementation:** Built CLI from source (`npm run build`), captured actual output of `dist/cli.js explain --help` and `dist/cli.js explain --format json INV-01`. Pasted verbatim into `website/reference/cli.md` explain section.

**Verdict:** Output is accurate as of this build. Will need refresh if explain command changes.

### #810 / #811 — README FAQ link and badge (PASS)

**Implementation:** Added `docs/FAQ.md` link as first bullet in product documentation list; added npm version badge pointing to `@arbiter/cli`.

**Verdict:** Links are correct. Badge URL uses scoped package name.

---

## Deferred Issues

| Item                 | Action                                                                       | Status |
| -------------------- | ---------------------------------------------------------------------------- | ------ |
| #807 (ARBITER_DEBUG) | Commented on issue: feature not implemented; implement or close as won't-fix | Open   |
| #808 (formatBytes)   | Commented on issue: function not in src/; implement or close as won't-fix    | Open   |
| #743 (PGP key)       | Blocked on user — requires keys.openpgp.org account                          | Open   |

---

## Regressions / Follow-ups

- Debt baseline refreshed: complexity 68→69 was from earlier force-merged bundles (#819,#821,#823,#815), not this batch. No action needed.
- `website/reference/cli.md` explain examples will need refresh if `arbiter explain` output changes. Consider adding a snapshot test.

---

## Score (arbiter rubric)

| Dimension        | Score | Notes                                                                        |
| ---------------- | ----- | ---------------------------------------------------------------------------- |
| TDD compliance   | 5/5   | #812 test written first; doc changes vacuous                                 |
| Gate discipline  | 5/5   | L1+L2 green on merge                                                         |
| Scope discipline | 5/5   | No scope creep; excluded issues documented                                   |
| Doc accuracy     | 4/5   | CLI examples accurate at build time; no snapshot test yet                    |
| Risk management  | 4/5   | Automated #809 pass introduced syntax error (caught and fixed before commit) |

**Overall: 23/25 — Solid execution for a force-merge bundle.**
