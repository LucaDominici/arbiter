import { execFileSync } from "node:child_process";

export interface BranchProtectionResult {
  applied: boolean;
  error: string | null;
}

/**
 * Apply standard branch protection to main via gh api.
 * Requires repo admin access.
 */
export function applyBranchProtection(
  owner: string,
  repo: string,
): BranchProtectionResult {
  const payload = JSON.stringify({
    required_status_checks: {
      strict: true,
      contexts: ["CI Required"],
    },
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: true,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  });

  try {
    execFileSync(
      "gh",
      [
        "api",
        `repos/${owner}/${repo}/branches/main/protection`,
        "--method",
        "PUT",
        "--input",
        "-",
      ],
      {
        input: payload,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return { applied: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { applied: false, error: msg };
  }
}
