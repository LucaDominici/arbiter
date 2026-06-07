---
generated: true
source: 'docs/METHOD/KNOWLEDGE_MAP.md'
source_sha: '472ae970cc1c9c26a0be2f215711fcd1b1007150'
last_updated: '2026-06-07'
---

# Knowledge Map — arbiter

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/KNOWLEDGE_MAP.md](../docs/METHOD/KNOWLEDGE_MAP.md)

# Knowledge Map — arbiter

**Purpose:** Index of documentation files with section descriptions for context-efficient agent navigation. Read this before opening large docs — it tells you exactly where to look.
**Maintenance:** Run `node scripts/knowledge-map-update.mjs` after adding or significantly editing a canonical document to keep line counts current.

---

## AGENTS.md

**Location:** `AGENTS.md`
**Lines:** 430
**Purpose:** Canonical agent governance — invariants, coding standards, commit convention, gate commands.

| Section           | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| Invariants        | Non-negotiable constraints (INV-XX). Read before any change. |
| Coding Standards  | Language-specific rules for this project.                    |
| Testing Policy    | Coverage requirements, test realism rules.                   |
| Commit Convention | Type, scope, summary format.                                 |

---

## docs/METHOD/SSOT_CORE_SET.md

**Location:** `docs/METHOD/SSOT_CORE_SET.md`
**Lines:** 117
**Purpose:** Authoritative inventory of all SSOT documents. Start here to discover what documentation exists.

| Section    | Description                       |
| ---------- | --------------------------------- |
| Governance | Agent governance documents        |
| Method     | Process and standards documents   |
| System     | Architecture and decision records |

---

## docs/METHOD/CANONICAL_PATHS.md

**Location:** `docs/METHOD/CANONICAL_PATHS.md`
**Lines:** 38
**Purpose:** Aliasing registry for moved/renamed documents. Check before reporting a broken link.

| Section | Description                                    |
| ------- | ---------------------------------------------- |
| Aliases | Table of old path → current path redirects     |
| Usage   | How to add new redirects when moving documents |

---

## docs/METHOD/ENGINEERING_DEFAULTS.md

**Location:** `docs/METHOD/ENGINEERING_DEFAULTS.md`
**Lines:** 99
**Purpose:** SOLID principles, coding standards, complexity limits. Read before designing new modules or reviewing code.

| Section            | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| SOLID-First Policy | Principles over patterns — when to apply each SOLID principle    |
| Complexity Limits  | Per-language max cognitive complexity, nesting, parameter counts |
| Naming Standards   | Module, interface, and type naming conventions                   |
| Clean Code Rules   | Constants, dead code, immutability conventions                   |

---

## docs/METHOD/CONTEXT_PACK_SPEC.md

**Location:** `docs/METHOD/CONTEXT_PACK_SPEC.md`
**Lines:** 226
**Purpose:** Deterministic context-bundle spec. Read before consuming or producing a CONTEXT_PACK artifact.

| Section               | Description                                             |
| --------------------- | ------------------------------------------------------- |
| Authority Chain       | INV → KNOWLEDGE_MAP → SPEC → runtime slice precedence   |
| Key Properties        | Deterministic, traceable, self-contained, minimal       |
| Schema                | Section order, sort rules, hash rule                    |
| Routing Resolution    | Explicit rule → spec default → baseline merge           |
| Verbatim Extract Rule | Byte-for-byte rule for arbiter-internal source extracts |
| CLI                   | `scripts/emit-context-pack.mjs` arguments               |

---

## docs/METHOD/TRACK_MODEL.md

**Location:** `docs/METHOD/TRACK_MODEL.md`
**Lines:** 152
**Purpose:** Work-scope taxonomy (core/templates/kit/docs/ci/meta). Read before tagging a task with its track.

| Section            | Description                                            |
| ------------------ | ------------------------------------------------------ |
| Tracks             | Per-track scope, owners, CI gate subset, dispatch hint |
| Tagging a Task     | Required label + plan frontmatter convention           |
| Coverage Invariant | Per-track label + CODEOWNERS + CI subset requirements  |

---

## How to Use This Map

1. Identify what you need (architecture? invariants? standards?)
2. Find the matching document above
3. Use the section table to jump to the relevant part
4. **Do not read entire documents** — use line ranges or section headers to stay focused

> When you add a new canonical document, add an entry here with its section breakdown.
