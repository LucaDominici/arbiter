---
generated: true
source: 'docs/internal/release-playbook.md'
source_sha: '0b77ed888c87f896b4a07bc4ac1f38977066b068'
last_updated: '2026-06-06'
---

# Release Playbook

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/internal/release-playbook.md](../docs/internal/release-playbook.md)

# Release Playbook

> **IMPORTANT:** At least one full rehearsal MUST precede v0.1.0 public release.
> Revise this document FROM the rehearsal experience — not from theory.

## Pre-requisites

| Check                                                            | Owner           | Done |
| ---------------------------------------------------------------- | --------------- | ---- |
| All Tier 1 (P0) issues closed                                    | Release manager | [ ]  |
| All Tier 2 (P1) issues closed or deferred with justification     | Release manager | [ ]  |
| L2 gate green locally                                            | Dev             | [ ]  |
| Full CI green on `main`                                          | Dev             | [ ]  |
| `CHANGELOG.md` updated                                           | Dev             | [ ]  |
| Manual QA checklist signed off (`docs/internal/qa-checklist.md`) | QA              | [ ]  |

---

## Step 1 — Cut RC branch

```bash
git checkout main && git pull
git checkout -b release/vX.Y.Z-rc.N
git push -u origin release/vX.Y.Z-rc.N
```

| Owner | Sign-off | Date |
| ----- | -------- | ---- |
|       |          |      |

---

## Step 2 — Full CI green

Wait for all CI jobs to pass on the RC branch.

```bash
gh pr create --base main --head release/vX.Y.Z-rc.N --title "chore: release vX.Y.Z-rc.N"
gh pr checks
```

| Owner | Sign-off | Date |
| ----- | -------- | ---- |
|       |          |      |

---

## Step 3 — Tag RC

```bash
git tag vX.Y.Z-rc.N
git push origin vX.Y.Z-rc.N
```

| Owner | Sign-off | Date |
| ----- | -------- | ---- |
|       |          |      |

---

## Step 4 — Publish to `alpha` tag

```bash
npm publish --tag alpha --access public
```

Verify: `npm view @arbiter/cli dist-tags` shows `alpha: X.Y.Z-rc.N`.

| Owner | Sign-off | Date |
| ----- | -------- | ---- |
|       |          |      |

---

## Step 5 — Smoke install × 3 environments

For each environment below, run the smoke sequence:

```bash
npm install -g @arbiter/cli@alpha
arbiter --version
mkdir /tmp/smoke-project && cd /tmp/smoke-project
arbiter init --yes
cat AGENTS.md
node scripts/check-all.mjs L1
```

| Environment               | Status | Tester | Date |
| ------------------------- | ------ | ------ | ---- |
| Ubuntu container (docker) |        |        |      |
| macOS native              |        |        |      |
| WSL2 (Windows)            |        |        |      |

---

## Step 6 — Cold quickstart run

Follow the published quickstart docs verbatim from a fresh shell with no env state:

```bash
npm install -g @arbiter/cli@alpha
arbiter init
# follow interactive prompts
```

Log any friction points. Fix blockers before promoting. Document non-blockers as follow-up issues.

| Owner | Sign-off | Date |
| ----- | -------- | ---- |
|       |          |      |

---

## Step 7 — Promote to `latest`

```bash
npm dist-tag add @arbiter/cli@X.Y.Z-rc.N latest
```

Verify: `npm install -g @arbiter/cli` installs the correct version.

| Owner | Sign-off | Date |
| ----- | -------- | ---- |
|       |          |      |

---

## Step 8 — Publish GitHub Release

```bash
gh release create vX.Y.Z --notes-file RELEASE_NOTES_X.Y.Z.md --latest
```

Release notes must include:

- Summary of changes since last release
- New deprecations (ref: `docs/DEPRECATIONS.md`)
- Breaking changes with migration guidance
- Upgrade instructions

| Owner | Sign-off | Date |
| ----- | -------- | ---- |
|       |          |      |

---

## Step 9 — Announce

- [ ] GH Discussions Announcement posted
- [ ] Discord `#announcements` posted

---

## Rollback Procedure

If a critical issue is found post-publish:

```bash
# Deprecate the bad version
npm deprecate @arbiter/cli@X.Y.Z "Critical issue — use X.Y.(Z-1) instead"

# Roll back latest tag to previous good version
npm dist-tag add @arbiter/cli@X.Y.(Z-1) latest
```

Communicate via:

- [ ] GH Discussions Announcements post (include fix ETA)
- [ ] Discord `#announcements` post

---

## Post-Release

- [ ] Open follow-up issues for any friction found during rehearsal
- [ ] Update this playbook from rehearsal learnings
- [ ] Archive smoke-test logs in `docs/internal/smoke-logs/vX.Y.Z/`
