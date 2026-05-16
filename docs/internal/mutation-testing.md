# Mutation Testing

Stryker is configured to run nightly on critical paths. See `.github/workflows/mutation.yml`.

## Targets

| Path | Rationale |
|------|-----------|
| `src/generators/**` | Core code generation — logic errors here affect all users |
| `src/commands/init.ts` | CLI entry point — wrong defaults or arg handling breaks init flow |
| `scripts/check-all.mjs` | Gate orchestration — missed checks = silent governance failures |
| `src/invariants/catalog.ts` | Invariant definitions — wrong IDs or severity = false negatives |

## Threshold

- **Break at:** < 60% mutation score on targeted paths
- **Warn at:** < 50%

Initial target is 60% for v1; ratchet upward in subsequent releases.

## Running Locally

```bash
npx stryker run
```

First run is slow (downloads Stryker on-demand). Results written to `reports/mutation/`.

## Triaging Surviving Mutants

For each surviving mutant (i.e., a test that should have caught it but didn't):

1. **Add a test** that catches the mutation — preferred.
2. **Exclude with justification** — add a `// won't-test-because: <reason>` comment on the line and add the exclusion to `stryker.config.json`:

```json
{
  "mutate": [
    "src/generators/**",
    "!src/generators/some-file.ts"
  ]
}
```

Acceptable justifications:
- "Dead code path: unreachable in practice because X"
- "Trivially correct: mutation changes a constant string with no semantic effect"
- "Coverage deferred to integration tests (see #NNN)"

## Reports

Nightly CI publishes the HTML report as a workflow artifact. If the mutation score drops below threshold, CI opens a GH issue with the failing paths.
