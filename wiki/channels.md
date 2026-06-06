---
generated: true
source: 'docs/CHANNELS.md'
source_sha: 'adf513b05c1d5fb48928ab5ec7314612c4bde3af'
last_updated: '2026-06-06'
---

# Release Channels

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/CHANNELS.md](../docs/CHANNELS.md)

# Release Channels

**Issue:** #660 (R1.Q1)
**Package:** `@arbiter/cli`

arbiter is published to three npm dist-tags. Pick the channel that matches your tolerance for breakage.

---

## Channels

| Channel  | Install                     | Tag shape                        | When updated         | Stability expectation                                                           |
| -------- | --------------------------- | -------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `latest` | `npm i @arbiter/cli`        | `vX.Y.Z`                         | Tagged releases only | **Stable.** Passed full QA (EPIC R1.G) + release rehearsal (R1.G11). Use in CI. |
| `beta`   | `npm i @arbiter/cli@beta`   | `vX.Y.Z-rc.N` (or any `-suffix`) | Release candidates   | Feature-frozen, soak-testing. Breaking changes only between rc.N and rc.N+1.    |
| `canary` | `npm i @arbiter/cli@canary` | `v0.0.0-canary.<sha>`            | Every push to `main` | **HEAD of main.** May break at any time. No QA beyond standard PR gate.         |

---

## Default install behaviour

`npm install @arbiter/cli` (no channel suffix) resolves to whatever points at the `latest` dist-tag. This is the stable channel and the only one we recommend for unattended use.

---

## Publishing pipeline

| Channel  | Workflow                               | Trigger                   | Tag command (manual fallback)              |
| -------- | -------------------------------------- | ------------------------- | ------------------------------------------ |
| `latest` | `.github/workflows/npm-publish.yml`    | Push of `vX.Y.Z` tag      | `git tag v0.3.0 && git push origin v0.3.0` |
| `beta`   | `.github/workflows/npm-publish.yml`    | Push of `vX.Y.Z-rc.N` tag | `git tag v0.3.0-rc.1 && git push --tags`   |
| `canary` | `.github/workflows/canary-publish.yml` | Every push to `main`      | (automatic; no manual step)                |

Both workflows resolve the dist-tag from the tag shape:

```bash
case "$tag" in
  *-canary.*) channel=canary ;;
  *-rc.*)     channel=beta ;;
  *-*)        channel=beta ;;  # any other pre-release suffix → beta
  *)          channel=latest ;;
esac
```

OIDC provenance is attached to every publish (`npm publish --provenance`); no static `NPM_TOKEN` is required for the publish step itself.

---

## Channel switching

To move between channels:

```bash
# Pin to a specific channel
npm i @arbiter/cli@latest    # back to stable
npm i @arbiter/cli@beta      # opt into RCs
npm i @arbiter/cli@canary    # track main

# Pin to an exact version (ignores dist-tag)
npm i @arbiter/cli@0.3.0-rc.2
```

Downgrades behave the same — `npm i @arbiter/cli@latest` after a canary install will pull the most recent stable.

A user-facing rollback path (`arbiter --channel <name>` self-update) is tracked under #662 / R1.Q3.

### Per-direction risks (#663 / R1.Q4)

Channel switching is not symmetric. Both `npm install` and the project state can refuse a move; the table below names the failure modes by direction.

| Direction           | What can break                                                                                                                                                                     | Why                                                                                                                   | How to recover                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latest` → `beta`   | Almost nothing. Beta accepts everything stable can do plus new RC features.                                                                                                        | Beta is a superset of stable's surface.                                                                               | n/a — safe move.                                                                                                                                                       |
| `latest` → `canary` | Same as `latest` → `beta` but exposed to schema migrations that haven't soaked. `arbiter update` may rewrite `arbiter.json` to bump `$schemaVersion`.                              | Canary is HEAD of main; schema migrations land there first (#605 / R1.K7).                                            | Pin a known-good canary version: `npm i @arbiter/cli@<canary-sha>`. Or fall back via `latest` rollback below.                                                          |
| `beta` → `canary`   | Same as `latest` → `canary`.                                                                                                                                                       | Same reason.                                                                                                          | Same recovery.                                                                                                                                                         |
| `canary` → `beta`   | **May refuse.** If canary wrote `$schemaVersion: N+1` into `arbiter.json` and beta only understands `N`, `loadConfig` throws hard (#605: future versions are not silent-loadable). | The framework refuses to silently downgrade a config it doesn't understand.                                           | Restore `arbiter.json` from a pre-canary backup (git log `arbiter.json`). Then `arbiter doctor --repair-state` to re-derive `.arbiter-generated.json`.                 |
| `beta` → `latest`   | Same refusal possible if beta introduced experimental fields not in stable.                                                                                                        | Same reason as above.                                                                                                 | Same recovery, plus: revert any beta-only `feature.*` flags from `arbiter.json` before re-running stable.                                                              |
| `canary` → `latest` | Hardest direction — combines the two above.                                                                                                                                        | Schema delta + experimental feature flags + possibly a config field that doesn't exist in stable's `ArbiterConfigV2`. | Recover step-by-step: (1) restore `arbiter.json` to last stable commit; (2) `arbiter doctor --repair-state`; (3) restore `.arbiter-generated.json.bak.<ts>` if needed. |

### Rollback path

When a downgrade refuses, the recovery building blocks are already in the repo from R1.K9 / R1.L9 (PR #788):

1. **Pre-write snapshot backups.** Every `arbiter update` rotates `.arbiter-generated.json.bak.<iso-ts>` (cap 10). See [`docs/REFERENCE/state-file.md`](REFERENCE/state-file.md).
2. **`arbiter doctor --repair-state`.** Re-derives the snapshot from `arbiter.json` without touching the source config. Use after editing `arbiter.json` to bring the snapshot back in sync.
3. **Git history of `arbiter.json`.** `git log -- arbiter.json` lists every config edit; `git show <sha>:arbiter.json` retrieves the historical content.

End-to-end rollback recipe (canary → latest):

```bash
# 1. Locate the last "good" arbiter.json content (before the canary run).
git log --oneline -- arbiter.json | head

# 2. Restore that content (replace <sha> with the chosen commit).
git show <sha>:arbiter.json > arbiter.json

# 3. Re-derive the snap

*[content truncated — see source for full text]*
```
