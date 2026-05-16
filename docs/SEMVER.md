# Semver Policy

**Issue:** #599

arbiter follows [Semantic Versioning 2.0.0](https://semver.org/). This document defines precisely what triggers each bump level, including non-code surfaces.

---

## What Counts as Breaking (MAJOR)

| Change                                                                                               | Bump  |
| ---------------------------------------------------------------------------------------------------- | ----- |
| CLI flag or command removed                                                                          | MAJOR |
| CLI flag renamed (old name no longer accepted)                                                       | MAJOR |
| Default behavior changes in a way that breaks existing users                                         | MAJOR |
| Generator output schema breaking change (field removed, renamed, reordered in a way tools depend on) | MAJOR |
| INV-NN ID removed without retire marker                                                              | MAJOR |
| Hook ABI change (env var names, stdin shape, exit codes)                                             | MAJOR |
| Plugin API `apiVersion` bump                                                                         | MAJOR |
| `arbiter.json` config schema field removed                                                           | MAJOR |
| `.arbiter-generated.json` schema field removed                                                       | MAJOR |
| Minimum Node.js version raised                                                                       | MAJOR |

**Experimental escape hatch:** A flag or behavior guarded by `--experimental.<feature>` may change without a MAJOR bump while in experimental status. Once promoted to stable, the stability guarantee applies.

## What Is Non-Breaking (MINOR)

| Change                                                                     | Bump  |
| -------------------------------------------------------------------------- | ----- |
| New CLI flag or command added                                              | MINOR |
| New generator added                                                        | MINOR |
| New invariant (INV-NN) added                                               | MINOR |
| INV-NN promoted from `warn` to `fail` with a documented deprecation window | MINOR |
| New archetype or language support added                                    | MINOR |
| New hook added to generated config                                         | MINOR |
| New field added to `arbiter.json` config schema (backward-compatible)      | MINOR |
| New `apiVersion` added as opt-in (old version still supported)             | MINOR |
| Performance improvements with no behavior change                           | MINOR |
| New `suppressions/` entry type added                                       | MINOR |

## Patch Bumps

All bug fixes and documentation corrections that do not match MAJOR or MINOR criteria are PATCH.

## INV-NN Deprecation Window

Promoting an invariant from warn → fail is treated as a MINOR bump only when:

1. The invariant was in warn mode for at least one MINOR release.
2. The release notes explicitly call out the promotion.
3. The change is documented in `CHANGELOG.md`.

Promoting without a warning period is a MAJOR bump.

## PR Checklist Integration

Every PR should answer:

> **Does this require a semver bump? If yes, which level and why?**

Add a `<!-- semver: patch|minor|major: <reason> -->` comment to your PR body, or `<!-- semver: none -->` for docs-only changes. The changeset file captures this automatically when running `npm run changeset`.

## References

- [CONTRIBUTING.md](../CONTRIBUTING.md) — contribution workflow
- [docs/REFERENCE/file-stability.md](REFERENCE/file-stability.md) — which generated files are stable vs evolving
- [docs/SYSTEM/ID-STABILITY.md](SYSTEM/ID-STABILITY.md) — INV-NN ID stability policy
