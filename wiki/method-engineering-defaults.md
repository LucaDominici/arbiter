---
generated: true
source: 'docs/METHOD/ENGINEERING_DEFAULTS.md'
source_sha: 'cea593fadf81cee4112598fde75a623c817c8871'
last_updated: '2026-06-10'
---

# Engineering Defaults — arbiter

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/ENGINEERING_DEFAULTS.md](../docs/METHOD/ENGINEERING_DEFAULTS.md)

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

---

## Detector Error Policy

## Rule

All file reads in `src/detectors/` MUST go through the shared helpers in
`src/utils/safe-read.ts`. Direct `readFileSync` calls are forbidden in detectors.

## Helpers

| Helper                     | Returns on ENOENT | Returns on other error |
| -------------------------- | ----------------- | ---------------------- |
| `readFileSafe(path)`       | `''` (silent)     | `''` + `console.warn`  |
| `readPackageJsonSafe(dir)` | `{}` (silent)     | `{}` + `console.warn`  |

## Rationale

Detectors run against arbitrary target projects. A missing file is normal and
expected — silently returning a neutral value keeps the UX clean. Any other
read failure (permissions, corrupt FS) is unexpected and should surface to the
operator via a warning, not silently degrade or crash.

Prior to this policy, detectors used bare `readFileSync` inside try/catch blocks
that swallowed all errors uniformly. This masked non-ENOENT problems that
operators need to see (#684).

## Scope

Applies to: `src/detectors/build.ts`, `src/detectors/framework.ts`,
`src/detectors/modules.ts`, and any future detector added under `src/detectors/`.

Does NOT apply to test helpers or scripts.

---

## arbiter — Fail-Closed Doctrine

> Doctrine: every gate, hook, check, and generator in arbiter — and every
> equivalent shipped to projects arbiter governs — defaults to **block on
> uncertainty**, never **skip on uncertainty**. Silence is failure.

---

## What "fail-closed" means in arbiter

A gate is **fail-closed** when its default reaction to an unrecognised state
is `exit ≠ 0`. A gate is **fail-open** when its default is `exit 0`. Fail-open
gates produce false confidence: a green run that never actually executed the
check.

Concretely:

| Situation                          | Fail-closed reaction                   | Fail-open anti-pattern                      |
| ---------------------------------- | -------------------------------------- | ------------------------------------------- |
| Required input file missing        | `exit 1` with diagnostic               | `exit 0`, "nothing to do"                   |
| Helper binary not installed (CI)   | `exit 1` (use `runToolCheck`)          | Silently skip, log nothing                  |
| Unhandled exception in entry block | `catch → exit 1`                       | Crash to stderr with non-deterministic exit |
| Bash pipeline element fails        | `set -o pipefail` propagates the error | First-stage failure swallowed by tee        |
| Bypass requested by operator       | Requires loud env var + reason         | Implicit env var defaults to "skip"         |

The default reaction in arbiter is to **stop the gate, surface the cause,
and let the human decide** — not to "let it slide" because the situation
was unfamiliar.

---

## Contract

Every gate/hook/check/generator emitted under `scripts/`, `.githooks/`,
`.claude/hooks/`, and the equivalent EJS templates under `src/templates/`
**must**:

1. **Translate every unhandled error to a non-zero exit.** Node scripts:
   wrap the top-level entry in `try { … } catch (err) { … process.exit(1) }`
   or consume `runCheck` / `runWarnCheck` / `runToolCheck` from
   `scripts/lib/run-helpers.mjs` (the helpers exit on failure).
   Bash scripts: start with `set -euo pipefail`.

2. **Treat missing inputs as failure.** If a required config file, fixture,
   or upstream artifact is absent, exit 1 with a diagnostic line that
   names the missing path. Do not "no-op" to keep CI green.

3. **Reject silent bypass.** If the gate accepts an environment variable
   to skip itself, the variable name **must** be loud (e.g.
   `ARBITER_<SCOPE>_BYPASS=1`), accompanied by a reason captured in the
   gate log, and must be the only way to skip. (See Port #10 "loud-bypass
   contract" for the canonical helper once it lands; until then,
   open-code the env-var + reason logging.)

4. **Use the right shell directives.**
   - Bash: `set -euo pipefail` at the top.
   - Node: `try/catch` around the entry block OR `runCheck` family helpers.
   - Exit codes follow INV-53: `0 = PASS`, `1 = FAIL`, `2 = ERROR`.

---

## Anti-patterns

The following constructs are forbidden on critical paths (any path whose
failure should fail the gate). Each is detected by
`scripts/check-fail-closed-audit.mjs` (INV-96).

### `|| true` swallowing on critical commands

```bash
# WRONG — failure is silently dropped
some-check || true
```

If the result of `some-check` matters for the gate verdict, the failure
must propagate. Legitimate exceptions (e.g. cleanup steps that may not
have artefacts to clean) require an explicit allowlist marker on the
preceding line:

```bash
# FAIL-OPEN-INTENT: cleanup is best-effort; missing dir is normal
rm -rf .tmp/scratch || true
```

### Swallowed `catch` blocks

```ts
// WRONG — error is silently dropp

*[content truncated — see source for full text]*
```
