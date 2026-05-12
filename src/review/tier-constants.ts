/**
 * Single source of truth for review-pass counts and reviewer-agent counts
 * per task tier (#235, #236).
 *
 * `TIER_PASS_COUNT[tier]` = minimum number of distinct review passes
 * dispatched for a plan review of that tier.
 *
 * `TIER_REVIEWER_COUNT[tier]` = number of parallel review-agent personas
 * dispatched for a multi-agent code review of that tier (#236).
 *
 * Other modules (commands/review.ts, templates, etc.) MUST import from
 * here — do not duplicate these numbers elsewhere.
 */

export const TIER_PASS_COUNT = {
  XS: 1,
  S: 3,
  Standard: 5,
} as const;

export const TIER_REVIEWER_COUNT = {
  XS: 3,
  S: 3,
  Standard: 5,
} as const;

export type ReviewTier = keyof typeof TIER_PASS_COUNT;
