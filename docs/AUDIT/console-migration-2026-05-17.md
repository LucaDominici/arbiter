# console.\* → logger / process.std{out,err}.write Migration

**Date:** 2026-05-17
**Origin:** #820 — "complete console.\* → logger migration"

## Summary

All 139 `console.log` / `console.warn` / `console.error` sites previously
present across 18 source files in `src/` have been migrated to one of:

- **Structured logger** (`src/utils/logger.ts`, #635): `getLogger().warn(event, attrs, msg)` for diagnostic / progress / failure-mode output. Writes to stderr in text or JSON format depending on logger config.
- **Direct stream write**: `process.stdout.write(...)` for user-facing CLI payload (preserves `--json` cleanliness), `process.stderr.write(...)` for user-facing errors that should never appear on stdout.

The two remaining `console.*` matches in `src/` are content strings, not function calls:

- `src/invariants/catalog.ts:256` — the INV title text that names the rule itself
- `src/context-pack/track-mapping.ts:55` — a code-comment quote of the rule

## Enforcement

- **`no-console: 'error'`** added to the `src/**/*.ts` ESLint block in `eslint.config.js`. Any reintroduction now fails lint, which is wired into the L1 gate via `npm run lint`.

## Test-suite compatibility shim

A transitional shim in `vitest.setup.ts` tees `process.stdout.write` and `process.stderr.write` into `console.log` / `console.warn`, so existing tests that spy on `console.*` continue to fire without modification. Remove the shim once the ~75 affected tests are migrated to spy on the stream writes directly (#820 follow-up).

## Event naming

Migrated `logger.*` calls follow the `<module>.<action>` convention:

| Module             | Examples                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `safe_read`        | `safe_read.read_failed`, `safe_read.parse_failed`                                                                                 |
| `run_cli`          | `run_cli.retry_succeeded`, `run_cli.retries_exhausted`                                                                            |
| `fs`               | `fs.settings_merge_preserved`                                                                                                     |
| `config`           | `config.snapshot_unreadable`, `config.snapshot_envelope_failed`, `config.snapshot_migration_failed`                               |
| `debt_gates`       | `debt_gates.inject_test_scripts_parse_failed`, `debt_gates.inject_depcruiser_parse_failed`                                        |
| `registry`         | `registry.generator_failed`                                                                                                       |
| `contract_testing` | `contract_testing.unknown_contract_type`                                                                                          |
| `update`           | `update.adverse_git_state`                                                                                                        |
| `init`             | `init.plugin_invalid_result`, `init.plugin_conflict`, `init.adverse_git_state`, `init.dirty_tree`, `init.baseline_capture_failed` |

## Re-audit cadence

The `no-console` ESLint rule guarantees no regression by default. Re-audit if any allow-list exception is ever added.
