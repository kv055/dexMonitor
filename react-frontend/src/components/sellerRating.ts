import type { SellerRatingConfidence } from '../types';

const CLASS_GREEN = 'bg-[#1a3a2a99] text-green';
const CLASS_AMBER = 'bg-[#3a2a1a99] text-accent';
const CLASS_RED = 'bg-[#3a1a1a99] text-red';
export const CLASS_STAKE = 'bg-[#2a1a3a99] text-purple';
export const CLASS_UNSTAKED = 'bg-[#2a2a2a99] text-muted';

export type Bisq2ReputationRaw = {
  totalScore: number;
  fiveSystemScore: number;
  ranking: number;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Bisq 2 offerbook raw blob: `{ total_score, five_system_score, ranking }`. */
export function readBisq2ReputationRaw(raw?: Record<string, unknown> | null): Bisq2ReputationRaw | null {
  if (!raw) return null;
  const totalScore = asFiniteNumber(raw.total_score);
  const fiveSystemScore = asFiniteNumber(raw.five_system_score);
  if (totalScore == null || fiveSystemScore == null) return null;
  return {
    totalScore,
    fiveSystemScore,
    ranking: asFiniteNumber(raw.ranking) ?? 0,
  };
}

export function formatFiveSystemStars(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}★`;
}

export function formatBisq2ReputationDetail(rep: Bisq2ReputationRaw): string {
  const stars = formatFiveSystemStars(rep.fiveSystemScore);
  if (rep.totalScore <= 0) return `${stars} · unstaked`;
  const total = Math.round(rep.totalScore).toLocaleString('en-US');
  if (rep.ranking > 0) return `${stars} · ${total} total · rank #${rep.ranking}`;
  return `${stars} · ${total} total`;
}

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

/** Formats a counterparty-stake fraction (0.03) or percent (3) as "3% stake". */
export function formatBondChip(fraction: number): string {
  const pct = fraction <= 1 ? fraction * 100 : fraction;
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded}% stake`;
}

export function shouldShowBondChip(bondPct?: number | null): boolean {
  return bondPct != null && Number.isFinite(bondPct) && bondPct > 0;
}
