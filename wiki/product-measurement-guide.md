---
generated: true
source: 'docs/PRODUCT/MEASUREMENT-GUIDE.md'
source_sha: '4e0502abe9f8fbf473bcfd3cd6dffec23e743bdd'
last_updated: '2026-06-07'
---

# How to Measure arbiter Value Yourself

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/MEASUREMENT-GUIDE.md](../docs/PRODUCT/MEASUREMENT-GUIDE.md)

# How to Measure arbiter Value Yourself

**Issue:** #666

arbiter makes no ROI claims. If you want to know whether it has helped your team, here is a neutral methodology.

---

## Step 1: Establish a Baseline (Before arbiter)

Before running `arbiter init`, capture:

| Metric                                            | How to capture                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| CI pass rate on PRs                               | Export from your CI dashboard for the last 90 days                          |
| Average review cycle time (PR opened → merged)    | Export from GitHub/GitLab metrics                                           |
| Number of governance violations per sprint        | Count from review comments, retrospective notes, or existing linting output |
| Frequency of "we forgot to X" incidents in retros | Count retrospective action items tagged with process adherence              |
| Hook/gate failures per developer per week         | If you have pre-commit or CI hooks already                                  |

Capture these for at least one full delivery cycle before switching.

## Step 2: Run arbiter for at Least 90 Days

Shorter windows are confounded by onboarding and novelty effects. Use the same team, the same codebase, the same delivery cadence.

## Step 3: Measure the Same Metrics

Repeat the same measurement process. Compare.

## Step 4: Acknowledge Confounders

Before drawing conclusions, list what else changed during the period:

- New team members joined or left
- Major architectural refactor
- Change in delivery pressure (crunch vs. calm)
- Upgrade to a new language version or framework
- Other tooling changes

None of these invalidate the measurement; they just mean you cannot attribute the delta to arbiter alone.

## What to Track in arbiter Itself

Run `arbiter report` (once implemented — issue #639) to bundle gate logs, INV violation counts, and suppression trends for a given period.

## Honest Expectations

arbiter is governance infrastructure. Its effects are:

- **Slow to appear** — it prevents drift, which is only visible over time.
- **Hard to isolate** — governance and culture reinforce each other.
- **Asymmetric** — you will notice the absence of problems more than their presence.

If your gate pass rate improves and your retro action items about "we forgot to X" decline, that is a reasonable signal. It is not proof; it is evidence.

---

_For the positioning rationale behind this guide, see [POSITIONING.md](../POSITIONING.md)._
