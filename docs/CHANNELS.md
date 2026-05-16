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

---

## Stability promises

- **Stable (`latest`)** — semver. Patch (`Z`) is bug-fix only; minor (`Y`) is additive; major (`X`) signals breaking change with a deprecation cycle (per docs/PLUGIN-API.md bump policy).
- **Beta (`beta`)** — feature-frozen at first `rc.1`. Subsequent `rc.N` ship only fixes for issues found during soak.
- **Canary (`canary`)** — no promise. May rev many times per day. Schema migrations are exercised but not stable; do not point production at canary.

---

## Yanking / unpublishing

We don't unpublish (npm policy + ecosystem trust). To pull a broken release:

1. Publish a fix release on the same channel (`vX.Y.Z+1`).
2. Move the dist-tag: `npm dist-tag add @arbiter/cli@X.Y.Z+1 latest`.
3. Document the broken version in `CHANGELOG.md` with the fix's version.

`canary` is exempt — point to whatever HEAD is; users on canary accept the breakage.
