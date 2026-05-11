# Repository Setup (CANON-01)

Arbiter generates `scripts/setup-repo.sh` for target projects. This document covers the equivalent steps for the **arbiter repo itself**.

## One-time GitHub setup

These steps are idempotent — safe to re-run.

### Prerequisites

- `gh` CLI installed and authenticated (`gh auth login`)
- Admin access to the `arbiter` repository

### Labels

```bash
gh label create "task"        --color "0075ca" --description "Tracked work item"      --force
gh label create "bug"         --color "d73a4a" --description "Something isn't working" --force
gh label create "enhancement" --color "a2eeef" --description "New feature or request"  --force
gh label create "docs"        --color "0052cc" --description "Documentation only"      --force
gh label create "in-progress" --color "fbca04" --description "Work in progress"        --force
gh label create "in-review"   --color "e4e669" --description "Under review"            --force
```

### Branch protection

```bash
gh api \
  --method PUT \
  "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/branches/main/protection" \
  --field "required_status_checks[strict]=true" \
  --field "required_status_checks[contexts][]=ci" \
  --field "enforce_admins=false" \
  --field "required_pull_request_reviews[required_approving_review_count]=1" \
  --field "restrictions=null" \
  --field "allow_force_pushes=false" \
  --field "allow_deletions=false"
```

### CI runner

The self-hosted runner `docker-ci-build` must be registered and online for CI jobs to run (see INV-13 in `AGENTS.md`).
