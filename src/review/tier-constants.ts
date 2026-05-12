/**
 * Single source of truth for review-pass counts per task tier (#235).
 *
 * `TIER_PASS_COUNT[tier]` = minimum number of distinct review passes
 * dispatched for a plan/code review of that tier.
 *
 * Other modules (commands/review.ts, templates) MUST import from here —
 * do not duplicate these numbers elsewhere.
 */

export const TIER_PASS_COUNT = {
  XS: 1,
  S: 3,
  Standard: 5,
} as const;

export type ReviewTier = keyof typeof TIER_PASS_COUNT;
