# Backward-Compatibility Test Harness

Issue: #608

## Purpose

The backward-compat harness verifies that `arbiter.json` configs produced by older arbiter versions continue to load without schema errors after an upgrade. Each fixture is a real snapshot taken before a release; the test loads each one through the current migration stack and asserts no exception is thrown.

## How the harness works

- `__tests__/fixtures/compat/MANIFEST.json` — index of all seeded fixtures.
- `__tests__/fixtures/compat/<version>-<archetype>/arbiter.json` — one directory per fixture.
- `__tests__/integrations/backward-compat.test.ts` — iterates MANIFEST, calls `loadConfig(fixturePath)` for each entry, asserts no throw.

An empty MANIFEST causes the test to pass vacuously. A single-entry MANIFEST proves the wiring.

## Release protocol

**Before bumping the package version** (MINOR or MAJOR, or any MINOR with a config-shape change):

1. Run the snapshot helper for each supported archetype:

   ```bash
   node scripts/snapshot-compat-fixture.mjs <new-version> <archetype>
   # Example:
   node scripts/snapshot-compat-fixture.mjs 0.2.0 ts-cli
   ```

2. Commit the new fixture directory and the updated `MANIFEST.json`.

3. Then bump the version and ship.

This creates a historical record that the _next_ release can load configs from the _current_ release.

## When to add a fixture

Add a fixture for every MAJOR or MINOR release that changes the `arbiter.json` schema. If only patch/docs change, a new fixture is optional but harmless.

## NEVER fake-pin historical data

Fixtures must be captured from real `arbiter init` output — not hand-crafted or copied from a later version. The harness is worthless if fixtures are invented after the fact.

The `snapshot-compat-fixture.mjs` script enforces this by running `arbiter init` in a temp directory and copying the output. Do not bypass it.

## Current fixture inventory

| Version | Archetype | Language   | Path          |
| ------- | --------- | ---------- | ------------- |
| 0.1.0   | ts-cli    | typescript | v0.1.0-ts-cli |

Update this table when adding new fixtures (or rely on `MANIFEST.json` as the machine-readable source of truth).
