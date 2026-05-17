# Recipe: Brownfield Onboarding with Existing CI/CD

**Issue:** #649

## Context

Most arbiter adoptions happen on projects with an existing CI pipeline (GitHub Actions, GitLab CI, Jenkins, CircleCI). This recipe covers how to slot arbiter gates in alongside existing jobs without disrupting running pipelines.

## Three Integration Patterns

### Pattern A: Gradual — arbiter L1 only (no disruption)

Add arbiter's L1 gate as an optional (informational) check first. No required checks. Observe output for one sprint before making it required.

**When:** Existing pipeline is stable; team needs confidence before enforcing.

```yaml
# GitHub Actions example
- name: arbiter L1 gate (informational)
  run: node scripts/check-all.mjs L1
  continue-on-error: true # Remove this line when ready to enforce
```

### Pattern B: Parallel — arbiter alongside existing CI

arbiter jobs run concurrently with existing jobs. arbiter L1 is required; arbiter L2 is optional until team is ready.

**When:** Existing pipeline has its own test/lint steps you want to keep. arbiter supplements rather than replaces.

```yaml
jobs:
  existing-build:
    # ... your current build steps unchanged ...

  arbiter-l1:
    name: arbiter L1 gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: node scripts/check-all.mjs L1
```

### Pattern C: Replace — arbiter L2 substitutes existing gate

arbiter L2 runs your test command, lint, coverage, and integration checks. Existing redundant jobs are removed.

**When:** Existing pipeline is fragmented or inconsistent; team wants one canonical gate.

```yaml
jobs:
  gate:
    name: arbiter L2 gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: node scripts/check-all.mjs L2
```

## Per-CI System Guidance

### GitHub Actions

```yaml
# Require arbiter as a branch protection check:
# Settings → Branches → Require status checks → add "arbiter L1 gate"
```

```yaml
# .github/workflows/arbiter.yml
name: arbiter gate
on: [push, pull_request]
jobs:
  l1:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: node scripts/check-all.mjs L1
```

### GitLab CI

```yaml
# .gitlab-ci.yml
arbiter:l1:
  stage: test
  image: node:22
  script:
    - npm ci
    - node scripts/check-all.mjs L1
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

### Jenkins

```groovy
// Jenkinsfile
stage('arbiter L1') {
  steps {
    sh 'npm ci'
    sh 'node scripts/check-all.mjs L1'
  }
}
```

Mark as a required stage in your pipeline configuration. Jenkins Pipeline `input` steps are not needed — arbiter is non-interactive.

### CircleCI

```yaml
# .circleci/config.yml
jobs:
  arbiter-l1:
    docker:
      - image: node:22
    steps:
      - checkout
      - run: npm ci
      - run: node scripts/check-all.mjs L1

workflows:
  main:
    jobs:
      - arbiter-l1
      - your-existing-job:
          requires: [arbiter-l1] # enforce ordering
```

## Keeping Existing Build Jobs + Adding arbiter as Required Check

The safest migration: keep all existing jobs unchanged. Add a new `arbiter-l1` job with `continue-on-error: false`. Set it as a required status check in your branch protection rules. Remove `continue-on-error` after one week of green runs.

```
Week 1: informational (continue-on-error: true)
Week 2: required but not blocking merge (required check added, team monitors)
Week 3: full enforcement (required check blocks merge on failure)
```

## Rollback Plan

If arbiter gates cause unexpected failures:

1. Set `continue-on-error: true` on the arbiter job (immediate, no code change).
2. Run `arbiter doctor` locally to diagnose the issue.
3. Check `AGENTS.md` — a misconfigured invariant or hook path causes most gate failures.
4. Fix the root cause; re-enable enforcement after verification.

Do not disable the gate permanently. A failing gate signals a real invariant violation.
