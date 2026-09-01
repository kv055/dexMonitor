import type { SellerRatingConfidence } from '../types';

// Human-readable description of each normalization methodology, shown on hover
// so a bond-derived proxy is never mistaken for verified peer feedback.
const CONFIDENCE_LABELS: Record<SellerRatingConfidence, string> = {
  feedback_verified: 'Verified peer feedback',
  feedback_new: 'Peer feedback (few trades yet)',
  stake_bonded: 'Fidelity bond (stake)',
  reputation_bonded: 'Bonded reputation score',
  account_signing: 'Account signing + age',
  unavailable: 'No rating available',
};

// Short tag rendered next to the score, including in compact table cells.
const CONFIDENCE_SHORT: Record<SellerRatingConfidence, string> = {
  feedback_verified: 'feedback',
  feedback_new: 'new',
  stake_bonded: 'bond',
  reputation_bonded: 'reputation',
  account_signing: 'signing',
  unavailable: 'n/a',
};

const CLASS_GREEN = 'bg-[#1a3a2a99] text-green';
const CLASS_AMBER = 'bg-[#3a2a1a99] text-accent';
const CLASS_RED = 'bg-[#3a1a1a99] text-red';
const CLASS_BOND = 'bg-[#2a1a3a99] text-purple';

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

interface Props {
  score?: number | null;
  confidence?: SellerRatingConfidence | null;
  // compact still shows the methodology tag (table cells); kept for call-site compat.
  compact?: boolean;
  // withLabel appends the full methodology label (for detail panels).
  withLabel?: boolean;
  // Taker-facing fidelity bond as a fraction (e.g. 0.03), for RoboSats / leftover stake_bonded.
  bondPct?: number | null;
}

export function SellerRatingBadge({ score, confidence, compact, withLabel, bondPct }: Props) {
  const conf = confidence ?? 'unavailable';
  const label = CONFIDENCE_LABELS[conf] ?? 'Unknown';

  if (shouldShowBondChip(score, conf, bondPct)) {
    const text = bondPct != null && bondPct > 0 ? formatBondChip(bondPct) : 'bond';
    return (
      <span className="inline-flex items-center gap-1" title={`${text} · ${label}`}>
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xl text-[0.7rem] font-semibold ${CLASS_BOND}`}>
          {text}
          {!compact && (
            <span className="text-[0.55rem] uppercase opacity-70 font-normal">{CONFIDENCE_SHORT.stake_bonded}</span>
          )}
        </span>
        {withLabel && <span className="text-[0.6rem] uppercase tracking-wide text-muted">{label}</span>}
      </span>
    );
  }

  if (score == null) {
    return (
      <span className="text-muted text-[0.7rem]" title={label}>
        —{withLabel ? <span className="ml-1 text-[0.6rem] uppercase tracking-wide">{label}</span> : null}
      </span>
    );
  }

  const rounded = Math.round(score);
  const title = `${rounded}/100 · ${label}`;
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xl text-[0.7rem] font-semibold ${sellerRatingScoreClass(score, conf)}`}>
        {rounded}
        <span className="text-[0.55rem] uppercase opacity-70 font-normal">{CONFIDENCE_SHORT[conf]}</span>
      </span>
      {withLabel && <span className="text-[0.6rem] uppercase tracking-wide text-muted">{label}</span>}
    </span>
  );
}
