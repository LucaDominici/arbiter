---
generated: true
source: 'docs/PRODUCT/ENFORCEMENT-PHILOSOPHY.md'
source_sha: 'cc8eb9b95658cea4484ae53f9bdf4d413449c0dc'
last_updated: '2026-06-06'
---

# Arbiter — Enforcement Philosophy

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/ENFORCEMENT-PHILOSOPHY.md](../docs/PRODUCT/ENFORCEMENT-PHILOSOPHY.md)

# Arbiter — Enforcement Philosophy

**Status:** Active
**Last updated:** 2026-04-09

---

## Core Principle: Once Chosen, Enforced

Arbiter does not generate "suggestions" or "advisory" rules. Every governance decision selected by the user becomes a **hard gate** — the build fails, the CI blocks, the hook rejects.

There is no middle ground between "enabled" and "enforced."

---

## The Two Levels

Arbiter operates on two distinct planes:

| Level                           | What                                                            | Example                                                                          |
| ------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Level A: Arbiter-as-project** | The TypeScript CLI, its tests, its CI, its internal conventions | `scripts/check-all.mjs` that arbiter runs on itself                              |
| **Level B: Target project**     | What `arbiter init` GENERATES in the user's project             | `scripts/check-all.mjs.ejs` (EJS template), generated hooks, generated AGENTS.md |

Every feature has a double life:

- Level A: arbiter dog-foods it internally
- Level B: arbiter generates it for target projects

### The Implicit Third Level

Arbiter's invariants (INV-01..30) become the target project's invariants, but **filtered** by governance level and language. Not everything is mandatory everywhere — but once the user chooses a level, EVERYTHING that level requires is enforced with a hard gate.

---

## Three Categories

### 1. Arbiter Invariants (hardcoded, non-negotiable for ANY project)

These are enforced regardless of governance level:

- AGENTS.md as SSOT (canonical governance source)
- Gate system structure (L1 ⊂ L2 ⊂ L3)
- Language-specific type safety (INV-04)
- No orphan TODOs (INV-21)
- Commit convention (INV-22)
- Branch protection on main (INV-23)

### 2. Level-Enforced (once chosen, everything is a hard gate)

| Feature                       |  L1  |      L2       |              L3              |
| ----------------------------- | :--: | :-----------: | :--------------------------: |
| Lint + format + unit tests    | HARD |     HARD      |             HARD             |
| Coverage threshold            |  —   | HARD (70-80%) |        HARD (85-90%)         |
| Complexity limits             |  —   |     HARD      |             HARD             |
| Dead code detection           |  —   |     HARD      |             HARD             |
| Debt ratchet                  |  —   | HARD (--gate) | HARD (--require-improvement) |
| Architecture boundary checks  |  —   |     HARD      |             HARD             |
| Mutation testing              |  —   |       —       |         HARD (≥85%)          |
| Security scanning (dep audit) |  —   |     HARD      |             HARD             |
| Secrets scanning              |  —   |     HARD      |             HARD             |
| PII scan                      |  —   |     HARD      |             HARD             |
| Nightly pipeline              |  —   |       —       |             HARD             |
| Evidence harness              |  —   |       —       |             HARD             |

### 3. Project-Configurable (wizard or `/arbiter configure`)

These are chosen per-project but once enabled, enforced:

- AI tool selection (claude, codex, cursor, copilot)
- Coverage threshold override (default per level, can raise)
- Complexity limits override (default per level, can tighten)
- Contract testing (yes/no — depends on whether project has APIs)
- Database migration tool (Flyway, Alembic, Prisma...)
- E2E framework (Playwright, Cypress...)
- Frontend architecture boundaries (yes/no)

---

## Anti-Patterns

| Anti-pattern                            | Why it's wrong                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| "Generate a guide for mutation testing" | Guides get ignored. Generate the pitest plugin in build.gradle with a threshold that fails the build. |
| "Warn on security vulnerabilities"      | Warnings get ignored. CVSS ≥ 7.0 must fail the build.                                                 |
| "Advisory ArchUnit tests"               | If architecture boundaries matter, violations must block merge.                                       |
| "Configure but don't enforce"           | There is no "optional enforcement." If a feature is enabled, its gate is hard.                        |
| "Let the user decide whether to fail"   | Arbiter decides based on governance level. The user chose the level.                                  |

---

## Cross-Language Enforcement

For every mechanism, arbiter must generate the equivalent enforcement for ALL 5 supported languages. A mechanism that only works for Java is incomplete.

See `CROSS-LANGUAGE-MATRIX.md` for the full mapping.
