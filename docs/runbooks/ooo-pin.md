# Runbook: Maintainer OOO Pin

Use this runbook when the primary maintainer is out-of-office (OOO) to set and clear a pinned notice on the GitHub repo.

## Prerequisites

- `gh` CLI installed and authenticated with write access to the repo.
- (Optional) trigger the GitHub Actions workflow from the UI — see "Automated" below.

---

## Manual steps

### 1 — Pin OOO notice

```bash
# Adjust dates and message to taste.
gh issue create \
  --title "Maintainer OOO: <start>–<end>" \
  --body "Primary maintainer is OOO from <start> to <end>. Response times will be slower than usual. PRs and issues will be triaged when back. For urgent security issues email ulfwerenar@gmail.com." \
  --label "maintainer-notice" \
  --pin
```

Note the issue number for the unpin step.

### 2 — Unpin on return

```bash
gh issue close <issue-number>
gh issue unpin <issue-number>
```

---

## Automated (GitHub Actions)

The workflow `.github/workflows/holiday-pin.yml` automates the create step. Trigger it from the repo's **Actions** tab:

1. Click **Run workflow**.
2. Fill in:
   - `start`: ISO date, e.g. `2026-07-01`
   - `end`: ISO date, e.g. `2026-07-14`
   - `message`: optional custom body text
3. Click **Run workflow**.

The workflow creates and pins the issue automatically. Unpin manually (step 2 above) on return.

---

## Notes

- Pin lasts until explicitly unpinned — do not rely on issue closure alone.
- Update the pinned issue rather than creating a new one for minor date changes.
- Check `CONTRIBUTING.md` § Response expectations for the SLA text to reference.
