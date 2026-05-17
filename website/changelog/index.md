---
title: Changelog
---

# Changelog

arbiter publishes releases across three channels. Each page below tracks one channel.

| Channel                     | Stability                 | When to use                             |
| --------------------------- | ------------------------- | --------------------------------------- |
| [Stable](/changelog/stable) | Production-ready          | Default — all projects                  |
| [Beta](/changelog/beta)     | RC and pre-release builds | Early adopters, CI preview environments |
| [Canary](/changelog/canary) | Per-commit builds         | Bleeding-edge testing only              |

## How channel labels work

Every `## [version]` section in the root `CHANGELOG.md` carries a `**Channel:** <name>` line injected by `scripts/changeset-channel-tag.mjs` after each version bump. These pages are filtered views of that single source of truth.

See [CHANNELS.md](https://github.com/LucaDominici/arbiter/blob/main/docs/CHANNELS.md) for configuration and CLI reference.
