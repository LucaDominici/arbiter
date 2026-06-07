---
generated: true
source: 'docs/i18n/CONTRIBUTING.md'
source_sha: '731753bad139ce85cd4dbae09fa91d48f85063a0'
last_updated: '2026-06-07'
---

# Contributing translations

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/i18n/CONTRIBUTING.md](../docs/i18n/CONTRIBUTING.md)

# Contributing translations

arbiter ships English (`en`) as its only locale. This document explains how
to contribute a translation.

---

## How the i18n system works

All user-facing strings live in `src/i18n/en.json`. The runtime loads the
appropriate locale file via:

```typescript
import { t } from './i18n/index.js'
t('cli.init.verify_hint') // returns the string for the active locale
```

Locale resolution order:

1. `ARBITER_LOCALE` environment variable (explicit override)
2. `LC_ALL`, `LC_MESSAGES`, `LANG` (POSIX precedence)
3. Lookup chain: `it_IT.UTF-8` → `it_IT` → `it` → `en`
4. Falls back to `en` if the resolved locale file does not exist

## Adding a new locale

1. **Fork** the repository and create a branch: `i18n/<locale>` (e.g., `i18n/it`)

2. **Copy** `src/i18n/en.json` to `src/i18n/<locale>.json`:

   ```bash
   cp src/i18n/en.json src/i18n/it.json
   ```

3. **Translate** the values. Keys must not be changed — only values:

   ```json
   {
     "errors": {
       "E_INIT_WIN32": "arbiter non supporta Windows nativo. ..."
     }
   }
   ```

4. **Add a test** in `__tests__/i18n/` verifying a few key strings load
   correctly for your locale.

5. **Open a PR** with the title `i18n(<locale>): add <Language> translation`.

## Style guide

- **Tone**: match the English tone — direct, technical, no filler words.
- **Length**: translations often expand 20–30% vs English (especially German
  and Italian). This is expected. Wrap at 80 chars in the JSON value if the
  string is long.
- **Placeholders**: `{var}` placeholders must be preserved exactly:
  ```json
  "E_INVALID_TOOL": "Strumento non valido: \"{tool}\". Validi: {valid}"
  ```
- **No machine translation**: machine-translated strings may be submitted as
  a starting point but must be reviewed by a fluent speaker before merge.
- **RTL languages**: if adding a right-to-left locale (Arabic, Hebrew), note
  it in the PR description. arbiter's CLI output does not currently handle RTL
  reordering — a separate issue will track that work.

## Maintenance SLA

- Maintainer review within 14 days of PR open, or the PR is marked `stale`.
- When new keys are added to `en.json`, existing locale files may become
  incomplete. Incomplete locales fall back to `en` for missing keys —
  partial translations are acceptable and will not break the build.
- PRs that translate ≥ 80% of keys are accepted. Below 50% will be asked
  to complete before merge.

## Key naming convention

Keys are hierarchical:

| Prefix            | Area                                     |
| ----------------- | ---------------------------------------- |
| `errors.E_*`      | Error messages (thrown to the user)      |
| `cli.<command>.*` | User-facing output in a specific command |
| `cli.shared.*`    | Strings shared across commands           |

Error codes (`E_*`) are stable across locales. Only the human-readable
`message` field is translated.
