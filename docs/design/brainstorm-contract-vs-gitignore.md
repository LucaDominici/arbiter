---
title: 'Brainstorm Contract versus .gitignore — the committed design doc that is not committed'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['.claude/skills/brainstorming/SKILL.md', '.gitignore']
---

# Brainstorm Contract versus .gitignore — the committed design doc that is not committed

The `brainstorming` skill prescribes a committed design doc; `.gitignore` deliberately excludes it.

## Problem statement

`.claude/skills/brainstorming/SKILL.md` declares a terminal state with exactly two artifacts, the first being:

> A committed design doc under `.arbiter/design/<topic-slug>.md`

`.gitignore:28` ignores `.arbiter/**` and carries explicit negations for the things that _are_ meant to be committed — `hooks-manifest.json`, `plan/PLAN.json`, `evidence/tdd/*.json`, `evidence/*/tech-debt.json`, `workflow-exemptions.json`, `ship/supervisor.sh`, `wave*/**`, `evidence/ac-fit/*.json`, `rework/ledger.jsonl`. There is **no negation for `design/`**. Worse, `.gitignore:58` states the exclusion is deliberate:

> `#1770 (T1): manager state (MILESTONES, DONE, chat-protocol), design notes, redteam evidence, and other internal-only artifacts stay untracked+ignored ahead of the repo going public. Kept on disk, never re-added by `git add -A`.`

So the skill's contract and the repository's policy are **both stated, and they contradict each other**. Verified empirically: `git check-ignore -v .arbiter/design/test.md` → `.gitignore:28`.

The practical consequence is not cosmetic. An agent that follows the skill believes it has produced a durable artifact and has not: `git add -A` silently drops it, and the design doc dies with the working tree. The only durable container is the GitHub issue body — which the skill also produces, which is why the failure is invisible until someone looks for the doc later.

This is a live instance of the class arbiter polices everywhere else: a declared mechanism that does not actually bite. It was found by dogfooding the skill.

## Chosen approach

Resolve the contradiction by making exactly one of the two statements true, and record which:

**(a) Make the path committable** — add a targeted negation (`!.arbiter/design/`, `!.arbiter/design/**`) exactly as was done for `ac-fit`, `tdd` and `rework/ledger.jsonl`. Cheapest; keeps the skill unchanged. Conflicts with the stated intent of #1770.

**(b) Correct the skill** — the design doc is explicitly ephemeral scratch, and the GitHub issue body is the _sole_ durable artifact. Requires editing SKILL.md's terminal-state clause and removing the word "committed".

**(c) Move design docs to a versioned path** (e.g. `docs/specs/`) — a design doc is product documentation, not runtime state, and `.arbiter/` is by definition local state. This is the right long-term answer but is properly the subject of the durable-spec-artifact work, not of this fix.

Recommendation: **(b) now**, because it makes the repository honest immediately at near-zero cost and does not pre-empt #1770's rationale; then (c) as part of the spec-artifact issue, which supersedes this if it lands. If (c) lands first, this issue closes as resolved-by.

## Key decisions and rejected alternatives

**D1 — Do not silently pick (a).**
Adding the negation is a two-line change and superficially the obvious fix, but #1770 excluded design notes **on purpose**, ahead of the repo going public. Overriding a deliberate policy because a skill's prose disagrees with it is backwards: the decision belongs to the maintainer, and the reason (public-repo exposure of internal design notes) has not gone away.

**D2 — Do not leave both statements standing.**
This is the actual defect. A contract that the toolchain silently defeats is worse than no contract, because agents act on it. Whichever option is chosen, the other side must be edited in the same PR.

**D3 — Fix the contract, not the symptom.**
Option (b) is not "giving up": if the durable artifact is genuinely the issue body, then saying so is the accurate contract, and the skill's step 5 (`gh issue create --body "$(cat …)"`) already guarantees durability. The word "committed" is the only false part.

**D4 — Check for sibling instances.**
`.gitignore:58` names "manager state (MILESTONES, DONE, chat-protocol), design notes, redteam evidence". `redteam evidence` is worth checking: `.claude/commands/ship.md:244` declares an evidence path `.arbiter/evidence/redteam/<task-id>.json`, and if any gate or contract expects that file to be committed, the same contradiction exists there. This issue should verify and report, even if the fix is separate.

## Open questions

- Is #1770's rationale (repo going public) still binding, or has it lapsed now that the repo is public? That single answer decides between (a) and (b).
- Does any gate or hook currently _read_ `.arbiter/design/` and therefore silently no-op in CI? A grep would settle whether this contradiction has a second victim.
- Should `check-hook-doc-parity` / `check-hook-contracts`-style parity checking be extended to skills, so a SKILL.md contract that names a path is verified against `.gitignore`? That would close the class rather than this instance.

---

## Acceptance Criteria

- [ ] AC-1: an explicit decision between (a), (b) and (c) is recorded, with the rationale against #1770's stated intent written down.
- [ ] AC-2: the contradiction no longer exists — either `.arbiter/design/**` is committable, or `.claude/skills/brainstorming/SKILL.md` no longer claims the design doc is committed. Both statements are not left standing.
- [ ] AC-3: a test or gate check proves the resolution mechanically: if (a), a file under `.arbiter/design/` is not ignored (`git check-ignore` exits non-zero); if (b), SKILL.md contains no claim that the artifact is committed.
- [ ] AC-4: the sibling instances named at `.gitignore:58` — in particular `.arbiter/evidence/redteam/` referenced by `.claude/commands/ship.md:244` — are checked for the same contradiction and the result is reported in the issue (fix may be separate).
- [ ] AC-5: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No introduction of a durable spec artifact or a `docs/specs/` path: that is the spec-artifact issue, which supersedes this one if it lands first.
- No reversal of #1770's broader policy on manager state and internal-only artifacts beyond the design-doc path.
- No new skill, no change to the brainstorming workflow itself (steps 1-5 stay as they are).
- No extension of parity checking to all skills (raised as an open question, not scoped here).

## Files / contracts touched

- `.claude/skills/brainstorming/SKILL.md` — terminal-state clause (if option b)
- `.gitignore` — targeted negation for `.arbiter/design/**` (if option a)
- `docs/internal/ADR/` — the recorded decision, if the maintainer treats it as architectural
- `__tests__/` — the mechanical proof for AC-3
- Contract: the `brainstorming` skill's terminal-state contract; no runtime behaviour changes

## Wave placement

Lane **E (spec chain)**, runs first in that lane. `conflicts-with:#2359` — both touch `.claude/skills/brainstorming/SKILL.md` and `.gitignore`; serial lane, same worktree.
