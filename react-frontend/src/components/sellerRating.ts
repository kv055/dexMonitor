import type { SellerRatingConfidence } from '../types';

const CLASS_GREEN = 'bg-[#1a3a2a99] text-green';
const CLASS_AMBER = 'bg-[#3a2a1a99] text-accent';
const CLASS_RED = 'bg-[#3a1a1a99] text-red';

/** Methodology-aware colour bands. feedback_new is never green. */
export function sellerRatingScoreClass(score: number, confidence: SellerRatingConfidence): string {
  switch (confidence) {
    case 'feedback_new':
      return score < 40 ? CLASS_RED : CLASS_AMBER;
    case 'feedback_verified':
      if (score >= 75) return CLASS_GREEN;
      if (score >= 50) return CLASS_AMBER;
      return CLASS_RED;
    case 'account_signing':
      if (score === 0) return CLASS_RED;
      if (score < 45) return CLASS_AMBER;
      return CLASS_GREEN;
    case 'reputation_bonded':
      if (score >= 72) return CLASS_GREEN;
      if (score >= 50) return CLASS_AMBER;
      return CLASS_RED;
    default:
      if (score >= 70) return CLASS_GREEN;
      if (score >= 40) return CLASS_AMBER;
      return CLASS_RED;
  }
}

/** Formats a deposit/bond fraction (0.03) or percent (3) as "3% bond". */
export function formatBondChip(fraction: number): string {
  const pct = fraction <= 1 ? fraction * 100 : fraction;
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded}% bond`;
}

export function shouldShowBondChip(
  score: number | null | undefined,
  confidence: SellerRatingConfidence,
  bondPct?: number | null,
): boolean {
  if (confidence === 'stake_bonded') return true;
  if (score != null && Number.isFinite(score)) return false;
  return bondPct != null && Number.isFinite(bondPct) && bondPct > 0;
}
