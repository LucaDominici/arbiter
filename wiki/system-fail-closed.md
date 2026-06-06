---
generated: true
source: 'docs/SYSTEM/FAIL_CLOSED.md'
source_sha: '31a28b6ba19f796dfe4a6b57f6099e955fb53509'
last_updated: '2026-06-06'
---

# arbiter — Fail-Closed Doctrine

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SYSTEM/FAIL_CLOSED.md](../docs/SYSTEM/FAIL_CLOSED.md)

# arbiter — Fail-Closed Doctrine

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
// WRONG — error is silently dropped
try {
  await maybeFail()
} catch {}
```

Same allowlist marker is required for justified swallowing. The marker must
appear on the **line above** the `catch` keyword (the audit scans the
previous non-blank line, not the catch body):

```ts
// FAIL-OPEN-INTENT: probe for process existence; absence is non-error
try {
  process.kill(pid, 0)
} catch {}
```

Note: a `catch` block that contains anything other than whitespace (a
comment, a log line, a re-throw) is **not** classified as swallowed by
the audit. The detector only fires on truly empty `catch {}` /
`catch (e) {}` constructs.

### Default-true booleans without explicit fallback

```ts
// WRONG — silent reversal of intent when env var is absent
const enabled = process.env.STRICT !== 'false'
```

If the default is "active", say so explicitly and document it:

```ts
// Default ON: STRICT=false to disable explicitly.
const enabled = process.env.STRICT === 'false' ? false : true
```

### Missing `set -euo pipefail`

```bash
#!/usr/bin/env bash
# WRONG — script continues past failing commands
do-thing-one
do-thing-two
```

Every bash entry script must start with `set -euo pipefail` (or document
the explicit exception with FAIL-OPEN-INTENT).

---

## The `FAIL-OPEN-INTENT` allowlist marker

The audit gate honours a single allowlist comment:

```
# FAIL-OPEN-INTENT: <reason>     (bash)
// FAIL-OPEN-INTENT: <reason>    (node / ts)
```

The marker must appear on the **previous non-blank line** immediately
above the fail-open construct. The reason is free-text but should explain
**why** the fail-open is correct here (e.g. "best-effort cleanup",
"probe for existence", "tolerated drift during bootstrap").

The audit does **not** validate the reason text. The marker is a peer
review signal, not a magic incantation. Reviewers must read the reason
and challenge it if it does not hold up.

---

## Enforcement

| Layer       | Mechanism                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------- |
| INV-96      | `scripts/check-fail-closed-audit.mjs` (L2 gate) — fails when a NEW script violates the contract |
| Baseline    | `scripts/data/fail-closed-baseline.json` — grandfathers historical files until each is fixed    |
| Templates   | `src/templates/root/docs/SYSTEM/FAIL_CLOSED.md.ejs` (L2+) — ships doctrine into target projects |
| Self-config | This document — read by humans and AI agents working on arbiter                                 |

The gate is **dual-track** (CANON-13): Track A (this repo's `scripts/`)
and Track B (the `src/templates/scripts/check-fail-closed-audit.mjs.ejs`
template) must remain in sync. The companion template ships at
governance L2+.

---

## Bypass

There is no `--skip` flag for INV-96. The only way to permit a fail-open
construct is to add a `FAIL-OPEN-INTENT:` comment and have a reviewer
sign off on the reason. The baseline file is **not** a bypass — it is a
debt ledger. Files in the baseline must be cleaned up over time; the
baseline is regenerated only by `--update-baseline` after the violating
files have been fixed or explicitly allowlisted.
