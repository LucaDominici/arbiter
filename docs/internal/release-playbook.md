---
title: 'Release Playbook'
doc_version: '1.3.1'
status: active
last_review: '2026-09-12'
owner: 'Luca Dominici'
canonical_id: ''
tags: ['audience/dev', 'kind/internal']
related: ['../QUICKSTART.md']
---

# Release Playbook

Arbiter publishes through `.github/workflows/05-release.yml` on a pushed `v*` tag,
excluding `v0.0.0-verify-*`. The npm job publishes to **latest** with provenance.
Manual dispatch runs only a read-only authentication smoke, even when dispatched
at a tag. It cannot build, sign or publish.

## Qualify the release candidate

Changesets remains the version and changelog authority: use `npm run changeset`
for a release entry and `npm run changeset:version` to apply the reviewed version
change, channel tag and changelog synchronization. Land that change through the
normal task, review, local gates and green CI. Do not add a second version bot.

Before tagging, retain the exact merged source SHA, accepted package artifact,
independent review and required consumer/install receipts. M1 additionally needs
its four package-manager couplings and actual consumer adoptions; a local green
gate or authentication smoke does not replace that acceptance. Resolve blocking
document freshness findings by reviewing their content and source coupling.

The release workflow builds and packs once, checks the package surface, hashes
that tarball, and passes the same bytes through signing and attestations. The
publisher waits for cosign, SLSA, native provenance, SBOM attestation and document
freshness; mutation, secret history and Trivy are prerequisites of signing.
A failure prevents publication. Keep the retained artifact and run URL together.

## Package surface and size

What ships is pinned, its size is only reported (#2660). `package.json` `files` is a plain
whitelist: `dist`, the five shipped `scripts/*.mjs`, the five `scripts/lib` modules they
import, and the root documents. `npm run build` ends with `scripts/prune-dist-declarations.mjs`,
which keeps in `dist` only the `.d.ts` files tsc reaches from the four `exports` entry points
(19 declaration files) and deletes the rest, so no negation entry and no hand-kept list exist. `__tests__/scripts/pack-surface-2660.test.ts`
recomputes both closures on every run and fails when the shipped set drifts in either
direction; `__tests__/fixtures/pack-contract-2597.json` freezes the resulting roster.
`prepublishOnly` still runs `check-pack-size.mjs`, which prints the unpacked size and a WARN
line above 5,000,000 bytes but never fails: the hand-re-baselined budget (#511 → #1491 →
#2652) is gone. Measured at the re-pin: 4,362,750 bytes across 989 files (from 4,999,641 /
1,301).

## Configure npm authentication

The npm publisher uses a GitHub-hosted runner, Node from `.nvmrc`, and npm11.16.0.
Only this artifact-only job upgrades npm; the build retains its `packageManager`
pin. It downloads and verifies the signed tarball without rebuilding it.

For an existing npm package, configure a trusted publisher in its npm settings:
owner `LucaDominici`, repository `arbiter`, workflow filename `05-release.yml`.
The workflow grants `id-token: write` only where provenance/publication needs it.
No npm secret is inherited by the reusable SLSA workflow.

**(Round 2, #2679) OIDC only, no token in CI.** The trusted-publisher entry is
configured and `@getarbiter/cli` has already shipped a version through it
(0.5.0), so the earlier "initial publication may need `NPM_TOKEN`" case is
over. `publish-package` publishes exclusively via `npm publish --provenance`
under OIDC; there is no `NPM_TOKEN`/`NODE_AUTH_TOKEN` anywhere in the job or
step env, and no repo/org variable re-enables one — a settable-by-Write CI
variable gating a secret is not a control (a Write collaborator could flip it
without review). If OIDC publication ever fails (a broken trusted-publisher
binding, an npm outage), the recovery path is a **manual `npm publish`** run
by a maintainer from their own authenticated machine against the exact
retained, hash-verified `release-artifact.tgz` from the failed run — never a
CI-held token. Record that manual publish's `npm view` readback the same way
an automated one is recorded (see "Recovery" below).
See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).

## Restrict who can push a release tag

The in-workflow ancestry check (`build-superset`'s `ancestry-check` step) is
defense in depth only: a workflow executes at the content of the commit it was
triggered from, so a commit that is itself unreviewed can edit or delete that
exact step before its author pushes the tag. The check cannot be the
enforcing control against itself.

The enforcing control is a GitHub **tag ruleset** restricting who may create,
update, delete or force-push (non-fast-forward move) a `v*` tag, evaluated
server-side before any workflow runs. All four rules matter, not just
creation: `update`/`non_fast_forward` block re-pointing an already-pushed tag
to a different commit after the fact, and `deletion` blocks removing it to
push it again elsewhere — either would let someone route around a
correctly-created tag without ever triggering a new `creation` event.
Configure one (owner action, not something a workflow can set for itself; the
live ruleset on this repo is id `23168539`):

```bash
gh api --method POST repos/LucaDominici/arbiter/rulesets \
  -f name='release-tags' \
  -f target='tag' \
  -f enforcement='active' \
  -f 'conditions[ref_name][include][]=refs/tags/v*' \
  -f 'conditions[ref_name][exclude][]=refs/tags/v0.0.0-verify-*' \
  -f 'rules[][type]=creation' \
  -f 'rules[][type]=update' \
  -f 'rules[][type]=deletion' \
  -f 'rules[][type]=non_fast_forward' \
  -f 'bypass_actors[][actor_type]=RepositoryRole' \
  -f 'bypass_actors[][actor_id]=5' \
  -f 'bypass_actors[][bypass_mode]=always'
```

(`actor_id: 5` is the built-in "Admin" repository role; adjust to a specific
team/app id for a release team narrower than "admin".) A downstream project
generated from this template must configure the equivalent ruleset on its own
repository — the template cannot do this for a repo that does not exist yet.

**What the ruleset does NOT prevent:** it restricts _who_ can create/move/
delete a `v*` tag, not _which commit_ they point it at. An admin (or any
bypass actor) can still push a `v*` tag at a commit that never went through
review — the ruleset has no concept of "reachable from main". That gap is
exactly what `build-superset`'s in-workflow `ancestry-check` step catches
(defense in depth, per above): the ruleset stops an unauthorized _tag_, the
ancestry check stops an authorized tag pointed at the _wrong commit_. Neither
one alone is sufficient; both are required.

## Run the requested read-only smoke

```bash
gh workflow run 05-release.yml --ref main
gh run list --workflow 05-release.yml --event workflow_dispatch --limit 1
```

Inspect that exact run with `gh run view`. Authentication must succeed; the log
reports the authenticated username, scope visibility and only that user's role
when visible. `publicationAuthorization: NOT_PROVEN` is intentional: neither
whoami nor an organization role proves package publication permission or OIDC.
Missing/rejected authentication fails the smoke without exposing the token.

Every productive job, including the release aggregate, must be skipped. For a
manual-at-tag negative check, use a unique `v0.0.0-verify-*` tag at the qualified
commit: its push is excluded from release, and manual dispatch remains smoke-only.
Retain the run URL and all job conclusions, including an invalid-token failure.

## Publish and verify the installed bytes

Create the release tag only at the accepted merged SHA. Its name must exactly
match `v` plus `package.json.version`. The build checks checkout metadata; the
publisher reads the package manifest inside the retained tarball. Both refuse a
mismatch, including a version changed
by a prepack hook.
Pushing that tag starts the automatic release. The workflow publishes the retained
`release-artifact.tgz` using `npm publish --provenance --access public`, without
an alpha promotion step or a second local publish command. A prerelease tag is
also a `v*` trigger: do not use it as a publication-free rehearsal.

After the release run succeeds, inspect `npm view @getarbiter/cli dist-tags dist`,
install the exact published version in a fresh external directory, and execute
the documented quickstart and required consumer checks. Bind those receipts to
the version, registry integrity, release SHA and retained artifact. A successful
upload alone does not establish a successful consumer installation.

## Recovery

Do not retry publication with altered bytes under an already-published version.
For a failed job, fix its cause and retain the failed run before qualifying a new
candidate. If a published version is defective, deprecate that exact version,
restore the `latest` dist-tag to the previous qualified version and ship a new
version through the same pipeline. Record the affected version and recovery
receipts; do not report a rollback until registry readback confirms it.
