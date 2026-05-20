---
title: 'Engineering Defaults — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Engineering Defaults — arbiter

**Status:** NORMATIVE
**Location:** `docs/METHOD/ENGINEERING_DEFAULTS.md`
**Purpose:** SOLID-first engineering baseline. Principles trump patterns. Read before designing new modules.

---

## 1. SOLID-First Policy (Meta-Rule)

**Rule:** Do not apply design patterns unless they solve a specific problem justified by a variation axis or testability constraint.

Deliverables are: invariant compliance, testability, reduced coupling, deterministic behavior.
Deliverables are NOT: "using the Strategy Pattern" or "adding an Abstract Factory".

**Pattern admission test:**

- Does this pattern enable a concrete requirement? (e.g., swapping algorithms at runtime)
- Does this pattern enable testing? (e.g., mocking an external dependency)
- If NO → reject. Use simple composition or functions instead.

### SRP (Single Responsibility)

- No "God" services/classes. If a module has >5 public methods or >3 distinct dependencies, split it.
- Prefer composition over inheritance.

### OCP (Open/Closed)

- Design for extension only where variability is proven and required.
- Stable domain entities should be closed to modification.

### LSP (Liskov Substitution)

- Subtypes must never throw broader exceptions or weaken preconditions.
- Returning null where the parent contract forbids it is a violation.

### ISP (Interface Segregation)

- Interfaces should differ based on who uses them.
- Never force implementers to stub unused methods (`throw new UnsupportedOperationException()` is a smell).

### DIP (Dependency Inversion)

- High-level modules depend on abstractions, not details.
- Forbidden: static singletons, service locators, `new ConcreteService()` in high-level code.

---

## 2. Complexity Limits

### TypeScript / JavaScript

| Metric                            | Limit | Target |
| --------------------------------- | ----- | ------ |
| Cognitive complexity per function | 15    | <10    |
| Nesting depth                     | 3     | ≤2     |
| Parameters per function           | 5     | ≤3     |
| Lines per function                | 40    | <25    |
| Exported symbols per module       | 10    | ≤7     |

**Enforcement:** ESLint `complexity` rule + `max-depth` + `max-params`.

---

## 3. Naming Standards

- Functions/methods: verb-first, describe behavior (`getUserById`, `validateEmail`)
- Booleans: `is*`, `has*`, `can*` prefix (`isActive`, `hasPermission`)
- Constants: `SCREAMING_SNAKE_CASE`
- No abbreviations unless universally understood (`id`, `url`, `http`)

---

## 4. Clean Code Rules

- **No magic values:** Use named constants.
- **No dead code:** Delete unused fields, methods, or "what if" scaffolding.
- **No commented-out code:** Delete it. Git remembers.
- **Guard clauses:** Return early instead of nesting conditions.
- **Immutability by default:** Prefer immutable structures; mutate only when necessary and clearly named.

---

## 5. Null / Error Handling

- Prefer explicit error types over null/undefined returns.
- Never swallow exceptions silently — log or re-throw with context.
- Validate at system boundaries (user input, external APIs) — trust internal code.
