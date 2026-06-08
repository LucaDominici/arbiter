---
generated: true
source: 'docs/internal/qa-checklist.md'
source_sha: '1b62b9c3ef469490873b6235ba48d4bb45a8bab4'
last_updated: '2026-06-08'
---

# Pre-Launch Manual QA Checklist

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/internal/qa-checklist.md](../docs/internal/qa-checklist.md)

# Pre-Launch Manual QA Checklist

Run before every public release (RC included). Target: ≤ 90 minutes per pass.

**Release version:** **\*\***\_\_\_**\*\***  
**Tester:** **\*\***\_\_\_**\*\***  
**Date:** **\*\***\_\_\_**\*\***

---

## 1 — Cold Install

| Step                                                             | Result              | Notes |
| ---------------------------------------------------------------- | ------------------- | ----- |
| Fresh install on Ubuntu container: `npm install -g @arbiter/cli` | [ ] Pass / [ ] Fail |       |
| Fresh install on macOS native: `npm install -g @arbiter/cli`     | [ ] Pass / [ ] Fail |       |
| Fresh install on WSL2 (Windows): `npm install -g @arbiter/cli`   | [ ] Pass / [ ] Fail |       |

---

## 2 — CLI Command Smoke

Each command must run at least once without crashing.

| Command                          | Result              | Notes |
| -------------------------------- | ------------------- | ----- |
| `arbiter --version`              | [ ] Pass / [ ] Fail |       |
| `arbiter --help`                 | [ ] Pass / [ ] Fail |       |
| `arbiter init --help`            | [ ] Pass / [ ] Fail |       |
| `arbiter init --yes` (fresh dir) | [ ] Pass / [ ] Fail |       |
| `arbiter update --help`          | [ ] Pass / [ ] Fail |       |
| `arbiter doctor --help`          | [ ] Pass / [ ] Fail |       |
| `arbiter explain --help`         | [ ] Pass / [ ] Fail |       |

---

## 3 — Every README Link

Open each link in `README.md` manually and verify it resolves (no 404).

| Section       | Links checked | Result                          |
| ------------- | ------------- | ------------------------------- |
| Hero / badges |               | [ ] All OK / [ ] Broken: \_\_\_ |
| Quick start   |               | [ ] All OK / [ ] Broken: \_\_\_ |
| Installation  |               | [ ] All OK / [ ] Broken: \_\_\_ |
| Documentation |               | [ ] All OK / [ ] Broken: \_\_\_ |
| Contributing  |               | [ ] All OK / [ ] Broken: \_\_\_ |

---

## 4 — Social Preview

| Platform                                                   | Check | Result              |
| ---------------------------------------------------------- | ----- | ------------------- |
| Twitter/X — paste repo URL, verify OG image + title render |       | [ ] Pass / [ ] Fail |
| LinkedIn — paste repo URL, verify OG image + title render  |       | [ ] Pass / [ ] Fail |

---

## 5 — Archetype Init Wizard

Walk every archetype through the interactive init flow.

| Archetype             | Governance level | Result              |
| --------------------- | ---------------- | ------------------- |
| TypeScript — standard |                  | [ ] Pass / [ ] Fail |
| TypeScript — full     |                  | [ ] Pass / [ ] Fail |
| Java — standard       |                  | [ ] Pass / [ ] Fail |
| Python — standard     |                  | [ ] Pass / [ ] Fail |
| Rust — standard       |                  | [ ] Pass / [ ] Fail |
| Go — standard         |                  | [ ] Pass / [ ] Fail |

---

## 6 — INV Violation Recovery

For each governance level, trigger the violation and verify recovery.

| INV                      | Violation                      | Recovery            | Result              |
| ------------------------ | ------------------------------ | ------------------- | ------------------- |
| INV-04 (`any` type)      | Add `const x: any = 1`         | Remove → gate green | [ ] Pass / [ ] Fail |
| INV-06 (orphan TODO)     | Add `// TODO: bare`            | Fix → gate green    | [ ] Pass / [ ] Fail |
| INV-12 (no direct spawn) | Add `child_process.spawn(...)` | Remove → gate green | [ ] Pass / [ ] Fail |
| INV-21 (no orphan TODO)  | Add `// TODO bare`             | Fix → gate green    | [ ] Pass / [ ] Fail |

---

## 7 — Docs Site Navigation

| Check                                         | Result              |
| --------------------------------------------- | ------------------- |
| Home page loads                               | [ ] Pass / [ ] Fail |
| Quickstart page loads                         | [ ] Pass / [ ] Fail |
| All nav links reach their pages (no 404)      | [ ] Pass / [ ] Fail |
| Search: query "init" returns results          | [ ] Pass / [ ] Fail |
| 404 page is styled correctly (not raw GH 404) | [ ] Pass / [ ] Fail |

---

## 8 — Mobile Responsiveness (360px viewport)

Set browser to 360×640, check each:

| Check                                                   | Result              |
| ------------------------------------------------------- | ------------------- |
| Docs site: navigation usable (hamburger / drawer works) | [ ] Pass / [ ] Fail |
| Code blocks scroll horizontally, do not break layout    | [ ] Pass / [ ] Fail |
| Search dialog opens and is usable                       | [ ] Pass / [ ] Fail |
| Dark mode toggle is reachable                           | [ ] Pass / [ ] Fail |

---

## Sign-off

All items above must be PASS or explicitly waived with justification.

| Tester | Signature | Date |
| ------ | --------- | ---- |
|        |           |      |

**Waived items (if any):**  
_List any failing items, waiver justification, and follow-up issue number._
