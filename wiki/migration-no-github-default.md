---
generated: true
source: 'docs/MIGRATION/no-github-default.md'
source_sha: '0893553bd9e1d9c0612b08a56afc78cc6cdd76c5'
last_updated: '2026-06-07'
---

# Migration: `useGitHub` → `permitGitHub` and `--github` opt-in

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/MIGRATION/no-github-default.md](../docs/MIGRATION/no-github-default.md)

# Migration: `useGitHub` → `permitGitHub` and `--github` opt-in

## What changed

- **`useGitHub` is deprecated.** Config key renamed to `permitGitHub`.
- **`--github` flag is now required** to activate live GitHub API calls at runtime (project board creation, etc.). Without it, `permitGitHub: true` in stored config only controls _file emission_ (GitHub workflow generators), not live API calls.
- **`ARBITER_GITHUB=1`** env var is an alternative to `--github` for CI environments. Only the exact value `1` is accepted; other values emit a warning and are ignored.

## Stored config (`arbiter.json`)

Before:

```json
{ "useGitHub": true }
```

After:

```json
{ "permitGitHub": true }
```

`arbiter update` migrates `useGitHub` → `permitGitHub` automatically on first run. The old key is removed to prevent repeated deprecation warnings.

## CLI changes

| Command          | Before                                        | After                                              |
| ---------------- | --------------------------------------------- | -------------------------------------------------- |
| `arbiter init`   | Auto-enabled GitHub if `gh` was authenticated | Requires `--github` flag to enable                 |
| `arbiter update` | `--github` enabled live API calls             | Same — now also accepts `ARBITER_GITHUB=1` env var |

## Project board namespacing (F11)

Board titles now include the project name:

```
<projectName> Board · <owner>/<repo> · <YYYY-MM-DD>
```

Idempotence probe matches `title === prefix` or `title.startsWith(prefix + ' · ')`, so re-running `arbiter update --github` will reuse an existing board.

## Impact on generators

Generators that emit GitHub workflow files check `permitGitHub` (stored config), not the runtime `--github` flag. This means:

- **`permitGitHub: true`** → GitHub workflow files are generated, even without `--github`
- **`--github`** → live API calls are made (project board, etc.)

These two concerns are now independent.
