---
title: 'Experimental Features'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Experimental Features

arbiter ships experimental features behind explicit opt-in flags. Each experiment has a defined lifecycle and promotion criteria.

## Enabling an Experiment

Pass `--experimental.<name>` on the command line:

```bash
arbiter --experimental.my-feature init
```

Multiple experiments can be enabled simultaneously:

```bash
arbiter --experimental.feature-a --experimental.feature-b init
```

Unknown experiment names cause an immediate error — arbiter does not silently ignore unrecognized flags.

## Promotion Criteria

An experiment graduates to stable when all of the following are met:

- **Active for ≥ 6 months** since first shipped
- **≥ 3 user reports** confirming the feature works correctly in real projects
- **Zero P0 issues** open against the experiment at review time

Graduation is tracked in the experiment's `plannedReviewDate` field. The arbiter core team reviews experiments on the scheduled date and either promotes or extends the review window.

## Stability Guarantee

| Stability target | Guarantee                                                                       |
| ---------------- | ------------------------------------------------------------------------------- |
| `beta`           | API may change between minor versions. Breaking changes announced in changelog. |
| `stable`         | Full semver guarantees. Breaking changes only in major versions.                |

## Active Experiments

<!-- TODO(#1838): this section is hand-maintained and can drift from
     src/experimental/registry.ts — wire a generator or a freshness gate that
     diffs this table against the registry, then drop this TODO. -->

The authoritative list is the registry in `src/experimental/registry.ts`;
experiments are opted in per-invocation via the `--experimental.<name>` flag
(e.g. `arbiter --experimental.kit kit list`). Currently active:

| Experiment | Stability target | Added in | Planned review | Promotion criteria                                            |
| ---------- | ---------------- | -------- | -------------- | ------------------------------------------------------------- |
| `kit`      | beta             | 0.1.0    | 2026-11-18     | ≥6 months active + ≥3 user reports + zero P0 issues + Phase F |

## Adding a New Experiment

1. Add an entry to `EXPERIMENTS` in `src/experimental/registry.ts`:

```ts
{
  name: 'my-feature',
  stabilityTarget: 'beta',
  addedIn: '0.2.0',
  promotionCriteria: 'Collect ≥3 user reports and run 6-month active window',
  plannedReviewDate: '2026-11-01',
}
```

2. Call `warnExperimental(name)` at the feature entry point (one-time stderr notice).
3. Check `isEnabled(name, flags)` where `flags` is parsed from `ARBITER_EXPERIMENTAL` env var.
4. Document the experiment in the changelog entry.
