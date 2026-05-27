# ADR-001 — `--no-github` flag (default opt-out) + project board namespacing

> **Status**: Draft (Claude) · **Date**: 2026-05-26 · **Reviewer**: Luca
> **Maps to**: Wave 0 findings **F4** (silent remote side effects) + **F11** (152 orphan boards)
> **Evidence**: [`../wave0/haben-smoke-test.md`](../wave0/haben-smoke-test.md) §F4 §F11 · [`../wave0/evidence/gh-projects-snapshot.json`](../wave0/evidence/gh-projects-snapshot.json) · [`../wave0/evidence/cleanup-orphan-boards.sh`](../wave0/evidence/cleanup-orphan-boards.sh)

## Problem

`arbiter update` (and `arbiter init`) currently performs ~25+ `gh` API calls without warning, without dry-run preview, without confirmation. One of them (`gh project create`) succeeds even when the parent repo doesn't exist, materializing a new account-level project board every time. Over months of `arbiter init/update` invocations, this accumulated **152 orphan boards** on the operator's account (titles: 141× "arbiter Board", 10× "viafera Board", 1× "haben Board").

The current dry-run command (`arbiter diff`) does not surface remote operations at all — operators cannot consent to what they cannot see.

## Code anchors (light survey — full CANON-16 in implementation chat)

- `src/github/project-board.ts` — board creation entry point
- `src/commands/init.ts` — initial invocation of gh setup (grep "Creating project board" / "Project board created")
- `src/commands/update.ts` — re-invokes the same gh setup; needs symmetrical flag handling
- `src/templates/scripts/setup-repo.sh.ejs` — shell wrapper that issues gh calls; also needs flag plumbing

`commander` is the CLI framework (per `package.json`). Global options live in `src/cli.ts`.

## Options considered

**Option A — Add `--no-github` flag, default behavior unchanged**
- Smallest diff. `--no-github` skips the gh block.
- Pro: backward compatible for any external CI currently relying on `arbiter update` doing GH setup.
- Con: F4 stays the default. Trust violation persists unless user remembers to pass the flag. 152 orphan boards happened precisely because nobody remembered.

**Option B — Flip default: `--github` opt-in (RECOMMENDED)**
- `arbiter update` and `arbiter init` perform zero remote calls unless `--github` is passed.
- Stored config `useGitHub: true` no longer auto-triggers; it merely permits.
- Pro: safe-by-default. The dangerous case requires explicit opt-in.
- Con: breaking change for any caller that depended on auto-setup. Documented as MIGRATION in CHANGELOG.

**Option C — Two-phase confirmation**
- Default: print "would create board X, would create labels Y, …" and prompt for `y/N` before continuing.
- Pro: maximal informed-consent.
- Con: breaks CI/non-interactive use cases. Requires `--yes` flag to unblock automation, which devolves into the same opt-in/opt-out tension as A/B.

## Recommended: Option B + namespacing fix

The two findings (F4 and F11) share a root cause: arbiter treats remote side effects as routine. Fix it at the policy level (default off) AND at the implementation level (probe before create, name uniquely).

### B-1. Default opt-out

- New CLI flag: `--github` on `init` and `update`. Without it, no remote calls.
- `.arbiter.json` field `useGitHub` is **renamed** to `permitGitHub` to make semantics explicit (permission, not trigger).
- `useGitHub` accepted with deprecation warning for one minor version, removed after.

### B-2. Namespacing fix (F11)

Project board name template moves from hard-coded `<projectName> Board` to a deterministic-but-unique scheme:

```
<projectName> Board · <repoFullPath> · <YYYY-MM-DD>
```

Example: `haben Board · LucaDominici/haben · 2026-05-26`

Existence check:
```
gh project list --owner <owner> --format json | jq '.projects[] | select(.title startswith(<projectName> Board · <repoFullPath>))'
```

If any match, reuse the first. If none, create. **NEVER create silently when a same-name-different-date board exists** — print and skip.

### B-3. Label probing (F8)

Before issuing `gh label create`, fetch existing labels via `gh label list --json name` and only create the missing set. Reduces 25 calls/run to N where N = missing labels.

## Test plan

- Unit: `__tests__/github/project-board.test.ts` — mock gh CLI, verify (a) no calls without `--github`, (b) name template includes repo + date, (c) existence probe runs before create.
- Integration: `__tests__/fixtures/real-projects/` — add a fixture invocation with `--github false` and assert zero gh calls happen (process stub).
- Negative: invocation with `--github` but no gh auth → assert clean error message, exit non-zero (binds with ADR-002).

## File impact survey (preliminary — refine in chat)

| File | Change |
|---|---|
| `src/cli.ts` | Add `--github` global option |
| `src/commands/init.ts` | Gate gh block on flag; rename config field with deprecation |
| `src/commands/update.ts` | Same gating |
| `src/github/project-board.ts` | Implement existence probe + new name template |
| `src/github/labels.ts` (if exists) or `src/github/setup.ts` | Pre-list, create missing only |
| `src/config/schema.ts` | Rename `useGitHub` → `permitGitHub` with deprecation alias |
| `__tests__/github/*` | Add tests (3 new files suggested) |
| `docs/CHANGELOG.md` + `docs/MIGRATION.md` | Document breaking change |

Existing-code survey to confirm: does `useGitHub` appear in EJS templates, in JSON schemas distributed to clients, in `arbiter-cli-0.1.0.tgz` callers? If yes, deprecation strategy needs broader coverage.

## Acceptance criteria

- [ ] `arbiter update` without `--github` flag produces zero `gh` calls (verified via gh-CLI process stub in test)
- [ ] `arbiter update --github` on a repo without prior boards creates exactly one board named with the new template
- [ ] Second `arbiter update --github` on same repo same day reuses the existing board (no duplicate)
- [ ] `gh label create` failures (label exists) no longer fire — only missing labels are created
- [ ] CHANGELOG.md entry under `[Unreleased] Breaking` explaining the flag flip
- [ ] L1 + L2 green
- [ ] Reviewed by Claude before merge

## Open questions for the implementation chat

1. Does any existing user depend on auto-gh-setup? (Likely just Luca; if so breaking change is cheap.)
2. Should the deprecation of `useGitHub` be a warning only, or hard-error after a version? Suggest: warn one release, remove next.
3. Should namespacing include git SHA instead of date, to be truly unique per push? Probably overkill — date is human-readable + sufficient for de-dup.
4. Does `arbiter doctor` need a new sub-command `arbiter doctor orphan-boards` to detect F11-style accumulation in others' accounts? Defer to follow-up.
