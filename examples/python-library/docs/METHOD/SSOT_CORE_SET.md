# SSOT Core Set — python-library

**Status:** ENFORCED
**Archetype:** `library`

**Location:** `docs/METHOD/SSOT_CORE_SET.md`
**Purpose:** Authoritative inventory of all Single Source of Truth documents in this project. Every canonical document governing product, system, or process MUST be listed here.

---

## Governance (HOW Agents Must Behave)

- `AGENTS.md` — Canonical agent governance: invariants, coding standards, commit convention, gate commands

## Method (HOW We Execute)

- `docs/METHOD/KNOWLEDGE_MAP.md` — Navigation index for heavy documentation; read this before opening large docs
- `docs/METHOD/SSOT_CORE_SET.md` — This file (authoritative SSOT inventory)
- `docs/METHOD/CANONICAL_PATHS.md` — Aliasing registry for moved/renamed documents; check before reporting broken links

## System (HOW We Build It)

> Add architecture, ADR, and decision records here as the project grows.
>
> Examples:
> - `docs/SYSTEM/ARCHITECTURE.md` — Technical architecture overview
> - `docs/SYSTEM/DECISIONS.md` — Architectural Decision Records


---

## Maintenance Rules

1. Every canonical document added to the project MUST get an entry in this file.
2. Entries must include the path and a one-line purpose description.
3. Removed documents must be removed from this index.
4. Run a SSOT integrity check when the index and filesystem diverge.
