# Self-Validation Protocol — A/B/C Drill

> **INV-47** | Governance | `scripts/check-exit-code-contract.mjs` (L1) + `scripts/self-validation.mjs` (L2)

## Purpose

A gate that cannot prove its own semantics is a trust liability.

Every enforcement script in Arbiter must:

1. Exit `0` when nothing is wrong (PASS)
2. Exit `1` when it detects a violation (FAIL)
3. Exit `2` when it cannot run (bad args, missing environment, invalid invocation)

The A/B/C drill proves each gate honors this contract by exercising all three paths
against controlled fixtures.

## The Three Phases

| Phase | Fixture condition               | Expected exit | What it proves                            |
| ----- | ------------------------------- | ------------- | ----------------------------------------- |
| A     | Clean project (no violations)   | `0`           | Gate does not produce false positives     |
| B     | Induced drift (known violation) | `1`           | Gate catches the class of problem it owns |
| C     | Hard error (bad invocation)     | `2`           | Gate distinguishes error from pass/fail   |

A gate that exits `1` on a clean baseline (A), or exits `0` on a known violation (B),
or crashes without an exit code on bad args (C), fails its proof.

## Rationale

Binary `0/1` gates are the norm, but they cannot distinguish "I checked and found nothing"
from "I couldn't run". Exit `2` fills that gap. Without it:

- A broken gate silently looks like a passing gate to orchestrators
- Callers cannot distinguish environment misconfiguration from a clean codebase
- CI pipelines may skip remediation because they see exit `0`

The `2=ERROR` code mirrors the POSIX convention (`bash` builtin errors), UNIX `grep`
(`0=match, 1=no match, 2=error`), and `curl` (`0=ok, N=specific error`).

## Running the Drill

```bash
node scripts/self-validation.mjs
```

Output per gate:

```
[DRILL] exit code contract
  ✓ PASS  A (clean)  → exit 0  (expected 0)
  ✓ PASS  B (drift)  → exit 1  (expected 1)
  ✓ PASS  C (error)  → exit 0  (expected 0)
```

Exit `0` if all phases pass all gates. Exit `1` if any phase fails.

Run as part of L2 gate:

```bash
node scripts/check-all.mjs L2
```

## Adding a Gate to the Drill

In `scripts/self-validation.mjs` (or the template `src/templates/scripts/self-validation.mjs.ejs`),
add an entry to the `GATES` array:

```js
{
  id: "my-check",
  label: "my check description",
  cmd: "node",
  argsA: (clean) => ["scripts/check-my.mjs", clean],  // clean dir → expect 0
  argsB: (drift) => {
    // write a known violation into `drift`
    writeFileSync(join(drift, "bad.mjs"), "process.exit(42);\n");
    return ["scripts/check-my.mjs", drift];
  },
  argsC: () => ["scripts/check-my.mjs", "--bogus-flag"],  // → expect 2 (or 0 if graceful skip)
  expectA: 0,
  expectB: 1,
  expectC: 2,
},
```

After editing the template, re-materialize:

```bash
cp src/templates/scripts/self-validation.mjs.ejs scripts/self-validation.mjs
```

Verify the dogfood invariant:

```bash
diff src/templates/scripts/self-validation.mjs.ejs scripts/self-validation.mjs
# must produce no output
```

## Staged Rollout

Initial coverage (shipped with INV-47, issue #258):

- `exit-code-contract` — checks the contract lint itself
- `pipe/tee-hazard` — advisory check, always exits 0

Future gates (separate issues):

- `orphan-todo`, `no-placeholders`, `bloat-ratchet`, `hardness-inventory`, etc.
- Full 18-gate coverage tracked in a follow-up issue.
