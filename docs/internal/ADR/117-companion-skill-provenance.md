---
title: 'ADR-117: Companion Skill Provenance — Detected, Never Bundled'
doc_version: '1.0.0'
status: active
last_review: '2026-08-29'
owner: ''
canonical_id: '117'
tags: ['audience/dev', 'kind/adr']
related: ['docs/internal/ADR/100-companion-plugin-awareness.md', 'docs/INTEGRATIONS.md']
---

# ADR-117: Companion Skill Provenance — Detected, Never Bundled

**Project:** arbiter
**Date:** 2026-08-29
**Status:** Accepted

## Context

arbiter's repository became public. A public repo puts every authored file under outside
scrutiny, including the question a licence reader asks first about a project that recognises
and composes with Superpowers (obra/superpowers) and ponytail (DietrichGebert/ponytail, ADR-100):
did arbiter copy any of their skill text?

A provenance audit run 2026-08-29 answered that empirically, comparing every arbiter-authored
skill/command file against the full upstream Superpowers corpus:

- **Scope:** 48 local files — `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, and their
  emitted `src/templates/claude/**` twins.
- **Compared against:** all 14 skills of `obra/superpowers` (MIT): brainstorming,
  dispatching-parallel-agents, executing-plans, finishing-a-development-branch,
  receiving-code-review, requesting-code-review, subagent-driven-development,
  systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers,
  verification-before-completion, writing-plans, writing-skills.
- **Result:** maximum overlap was 3 trivial shared lines (`brainstorming`), well under any
  plausible copy threshold. arbiter's `epic-decompose` skill has no upstream Superpowers
  counterpart at all. The synthetic test fixtures under
  `__tests__/fixtures/skill-trees/with-superpowers*` are 8-line stubs, not authored prose, and
  were excluded from the audit's local-corpus scope.
- A re-run of the same comparison via the gate this ADR introduces (line-hash overlap, not a
  human line-by-line read) independently found a maximum of 1 shared substantive line across the
  current corpus — consistent with "no copying happened," not identical methodology.

What was missing was not the _fact_ of independence — the audit already established it — but
the _statement_ of it in the two places a licence reader and a future contributor actually look:
the NOTICE/THIRD_PARTY_LICENSES.md attribution files, and a durable, mechanically-reproducible
gate that keeps the claim true as the skill corpus grows. A one-time audit is a snapshot; without
a gate it silently expires the next time someone pastes a paragraph from a companion's SKILL.md
"just to get the wording right."

Separately, the audit surfaced one real defect: `src/compatibility/skills-matrix.json`'s
`referenceUrl` for every `superpowers:*` entry pointed at
`https://github.com/PotentialSuperpowers/superpowers` — a fork name, not the actual upstream
repo (`https://github.com/obra/superpowers`). Attribution that links to the wrong repository is
itself a provenance defect, independent of the text-copying question.

## Decision

| Rule                                                                                     | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| State the policy where it's read                                                         | NOTICE and the generated `THIRD_PARTY_LICENSES.md` carry a "Companion plugins — detected at runtime, never bundled" section naming every companion in `src/compatibility/skills-matrix.json` (Superpowers, ponytail, pr-review-toolkit, frontend-design) with its license and source URL. `docs/INTEGRATIONS.md` links to it. The section is generated from the skills-matrix `pluginOwner`/`referenceUrl` fields (`scripts/gen-third-party-licenses.mjs`) — the same fields the stale-URL bug lived in — so a future URL fix there is reflected here automatically instead of drifting a second hardcoded copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Fix the attribution defect                                                               | `src/compatibility/skills-matrix.json`: every `superpowers:*` entry's `referenceUrl` now reads `https://github.com/obra/superpowers`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Ideas may be adapted, text is never copied                                               | Standing policy (unchanged, now stated explicitly): arbiter's own skills may take inspiration from a companion's _approach_ (e.g. TDD discipline, worktree hygiene) but never reproduce its prose. `docs/INTEGRATIONS.md`'s existing "detect-and-reference" policy already forbade copying; this ADR is the provenance half of enforcing it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A companion is a suggested dependency, detected at runtime                               | Already the architecture (ADR-100 `resolveCompanions`, HOME-only detection — the target repo is never scanned, so a hostile project cannot spoof activation). This ADR does not change detection; it only closes the loop on what happens when arbiter's OWN skill corpus starts to resemble a detected companion's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Overlap is deferred through the existing `replaces` mechanism, not a new frontmatter key | `src/compatibility/skills-matrix.json` entries already carry `replaces: string[]` — the set of arbiter's own built-in `SKILL_NAMES` a detected companion supersedes (e.g. `superpowers:test-driven-development` → `replaces: ["tdd"]`). `src/generators/skills.ts:98` (`if (!entry?.replaces.includes(skillName)) continue`) already skips generating arbiter's own `tdd` skill when Superpowers' `test-driven-development` is detected. A grep of every `SKILL.md` frontmatter and of `src/integrations/types.ts`/`companions.ts` confirms no `companion:` key exists anywhere in the skill schema today — `entry.companion` in `companions.ts` is the ADR-100 `CompanionPolicy` attached to a _matrix_ entry, not a frontmatter field on a skill file. Inventing a new `companion:` SKILL.md key would duplicate `replaces` with a second, less-precise mechanism (a skill _name_ vs. a specific companion _skill id_) for the same defer-when-detected behavior. Decision: **reuse `replaces`**; a future skill whose purpose genuinely overlaps a companion's is wired through the existing generator skip, not a new key. |
| The overlap claim is mechanically checked, not just audited once                         | `scripts/check-skill-provenance.mjs` (wired at L2, `scripts/check-all.mjs`): computes sha256 hashes of normalized (trimmed, lowercased, ≥25-char) substantive lines for every local `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, and their `src/templates/claude/**` twins, and compares against `scripts/data/companion-line-hashes.json` — a committed file of upstream LINE HASHES ONLY, never upstream text. Fails when any single (local file, upstream skill) pair shares ≥ 8 hashed lines. `--refresh-hashes` fetches the upstream `SKILL.md` files listed in `scripts/data/companion-sources.json` via `gh api` and re-derives the hash file; it fails CLOSED (non-zero, clear message, no partial write) when `gh` or the network is unavailable — unlike `check-todo-max-age.mjs`'s graceful offline-skip, there is no "skip" state for a legal-provenance gate (INV-96). The default (non-refresh) gate invocation never touches the network; it only reads the committed hash file, so CI and every contributor's machine see the same result.                                                            |

## Consequences

### Positive

- The "did arbiter copy Superpowers?" question now has a durable, machine-checked "no" instead of
  a one-time audit result buried in an issue comment.
- The stale `PotentialSuperpowers` URL — a real, independently-discovered defect — is fixed and
  now sourced from a single field the new gate's companion section also reads, closing the class
  of bug (a hardcoded URL going stale) rather than only the one instance.
- `scripts/check-skill-provenance.mjs` is cheap (~59 files × 14 upstream skills, sha256 hash-set
  intersection, no network in the common path) and catches regression at commit time, not at the
  next public audit.
- No new frontmatter schema, no new companion-declaration mechanism, no additional field for
  every future skill author to remember — the existing `replaces` array already does this job.

### Negative

- `scripts/data/companion-line-hashes.json` is a second artifact to keep fresh; if Superpowers
  substantially rewrites a skill, `--refresh-hashes` must be re-run by a human (or a future
  scheduled job) — there is deliberately no silent auto-refresh, since a legal-attribution
  snapshot changing unattended is exactly the failure mode INV-96 forbids.
- The 8-line overlap threshold is a judgment call, not a legal bright line; it is chosen to sit
  well above the audit's observed maximum (1–3 lines) so it fails on genuine copying without
  false-positiving on short shared imperative phrasing ("run the failing test first") that any
  two TDD-flavored skills would independently produce.
- `scripts/check-skill-provenance.mjs` is declared self-only in `scripts/canon01-self-only.json`
  (permanent, no `expires`): its subject is arbiter's own authored skill/command corpus. A
  project arbiter generates for a consumer has no authored-skill corpus of its own to audit for
  provenance against a companion — the gate would have no subject there. This was a deliberate
  choice point (the alternative — emitting it as a generated check for every governed target) was
  considered and rejected below.

## Alternatives rejected

- **Add a `companion:` key to the SKILL.md YAML frontmatter schema.** Rejected: no such key
  exists today (grepped every `.claude/skills/*/SKILL.md` and the skill/companion TypeScript
  types before writing this ADR), and the exact behavior it would provide — "this skill defers
  when this companion is detected" — is already provided by `replaces` in
  `src/compatibility/skills-matrix.json`, keyed the other direction (companion entry → arbiter
  skill names it supersedes) and already wired into the generator (`src/generators/skills.ts`).
  Adding a second, skill-side key for the same relationship would be two SSOTs for one fact.
- **Emit `check-skill-provenance.mjs` as a generated check for consumer targets (CANON-01).**
  Rejected: a project arbiter generates does not author its own Claude Code skills the way
  arbiter's own repo does — it receives arbiter's generated `.claude/skills/` verbatim. There is
  no "did the CONSUMER copy a companion's skill text" question for a corpus the consumer didn't
  write. If a future consumer-authored-skill feature changes that premise, this decision should
  be revisited; today the gate's subject is arbiter's own authored corpus, full stop.
- **Store upstream SKILL.md text as a vendored fixture for exact-diff comparison.** Rejected:
  this is the exact "arbiter ships no third-party skill text" policy the NOTICE section states.
  Committing upstream prose — even for comparison purposes — would itself be the provenance
  violation this ADR closes. Hashes only, never text, per `scripts/data/companion-line-hashes.json`.
- **Graceful-skip `--refresh-hashes` offline, mirroring `check-todo-max-age.mjs`.** Rejected: that
  gate's subject (issue age) is advisory housekeeping; missing data there safely defaults to "not
  overdue." This gate's subject is legal-attribution provenance; a missing or stale hash file must
  never silently pass as "no data available" (INV-96) — it must fail loud enough that a human
  re-runs `--refresh-hashes` with connectivity, or the committed file stays authoritative and
  unchanged.

## Links

- Related ADRs: ADR-100 (companion-plugin awareness in `/ship`)
- `docs/INTEGRATIONS.md` (detect-and-reference policy)
- Issue: #2428
