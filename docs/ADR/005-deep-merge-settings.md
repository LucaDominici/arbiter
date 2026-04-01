# ADR-005: Deep merge for settings.json

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

`.claude/settings.json` contains both arbiter-managed configuration (hook wiring, default permissions) and user-managed configuration (custom permissions, project-specific deny rules). A simple overwrite would destroy user customizations; a simple skip would prevent arbiter from adding new hooks.

## Decision

Merge rules for existing `.claude/settings.json`:

- `permissions.allow` -- union, deduplicated by command string
- `permissions.deny` -- union, deduplicated by command string
- `hooks[].matcher` -- incoming hooks added only if matcher isn't already present
- All other keys -- incoming value wins

## Rationale

- Existing project hooks survive the merge.
- Arbiter's hooks (stop-dangerous, enforce-read-only, etc.) are added if missing.
- The merge is deterministic and idempotent -- running `arbiter init` twice produces the same result.

## Consequences

**Positive:**

- Users keep their custom permissions and deny rules across arbiter re-init.
- Arbiter can safely add new hooks without disrupting existing configuration.
- Idempotent: safe to run multiple times.

**Negative:**

- Merge logic adds complexity to the init code path.
- Edge cases in hook matcher deduplication may require careful testing.
- Removing an arbiter-managed hook requires manual editing of settings.json.
