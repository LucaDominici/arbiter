---
title: Canary Releases
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Canary Releases

Canary builds are published automatically on every merge to `main`. Each build is tagged `v0.0.0-canary.<short-sha>`.

Canary entries are **not** included in `CHANGELOG.md` — they are git-derived. Follow GitHub releases with the filter below.

**[Browse canary releases on GitHub →](https://github.com/LucaDominici/arbiter/releases?q=canary&expanded=true)**

## Using canary builds

```bash
npm install -g @arbiter/cli@canary
```

Or configure your `arbiter.json`:

```json
{
  "$schemaVersion": 2,
  "channel": "canary"
}
```

> **Note:** Canary builds may contain breaking changes without notice. Not recommended for production use.

## Self-upgrader

A dedicated `arbiter upgrade` command that resolves the latest matching npm tag is planned as a separate future feature. The current `arbiter update` command regenerates governance files — it does not perform npm self-upgrade.
