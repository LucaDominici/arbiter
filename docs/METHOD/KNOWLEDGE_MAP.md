# Knowledge Map — arbiter

**Purpose:** Index of documentation files with section descriptions for context-efficient agent navigation. Read this before opening large docs — it tells you exactly where to look.
**Maintenance:** Update this file whenever a new canonical document is added or a section's line range shifts significantly.

---

## AGENTS.md

**Location:** `AGENTS.md`
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
**Purpose:** Authoritative inventory of all SSOT documents. Start here to discover what documentation exists.

| Section    | Description                       |
| ---------- | --------------------------------- |
| Governance | Agent governance documents        |
| Method     | Process and standards documents   |
| System     | Architecture and decision records |

---

## docs/METHOD/ENGINEERING_DEFAULTS.md

**Location:** `docs/METHOD/ENGINEERING_DEFAULTS.md`
**Purpose:** SOLID principles, coding standards, complexity limits. Read before designing new modules or reviewing code.

| Section            | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| SOLID-First Policy | Principles over patterns — when to apply each SOLID principle    |
| Complexity Limits  | Per-language max cognitive complexity, nesting, parameter counts |
| Naming Standards   | Module, interface, and type naming conventions                   |
| Clean Code Rules   | Constants, dead code, immutability conventions                   |

---

## How to Use This Map

1. Identify what you need (architecture? invariants? standards?)
2. Find the matching document above
3. Use the section table to jump to the relevant part
4. **Do not read entire documents** — use line ranges or section headers to stay focused

> When you add a new canonical document, add an entry here with its section breakdown.
