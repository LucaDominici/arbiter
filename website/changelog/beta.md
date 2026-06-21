---
title: Beta Releases
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Beta Releases

Beta releases include RC (`-rc.N`), beta (`-beta.N`), and alpha (`-alpha.N`) pre-release builds.

These are filtered from the root `CHANGELOG.md` by the `**Channel:** beta` label.

## RC lifecycle

1. A beta release is cut from `main` when a feature set is ready for broader testing.
2. Issues found during beta → patch RC (`-rc.2`, `-rc.3`, …).
3. Once stable, the version is promoted to a plain `X.Y.Z` stable release.

## Using beta builds

```bash
# Install a specific beta tag from npm
npm install -g @arbiter/cli@beta
```

Or configure your `arbiter.json`:

```json
{
  "$schemaVersion": 2,
  "channel": "beta"
}
```

Or use the CLI flag for a single invocation:

```bash
arbiter --channel beta doctor
```

See [CHANNELS.md](https://github.com/LucaDominici/arbiter/blob/main/docs/CHANNELS.md) for the full downgrade-warn matrix.
