import type { SellerRatingConfidence } from '../types';
import { CLASS_STAKE, formatBondChip, sellerRatingScoreClass, shouldShowBondChip } from './sellerRating';

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

interface Props {
  score?: number | null;
  confidence?: SellerRatingConfidence | null;
  // compact still shows the methodology tag (table cells); kept for call-site compat.
  compact?: boolean;
  // withLabel appends the full methodology label (for detail panels).
  withLabel?: boolean;
  // Maker's lock as a fraction (e.g. 0.03), shown independently of the score.
  bondPct?: number | null;
}

export function SellerRatingBadge({ score, confidence, compact, withLabel, bondPct }: Props) {
  const conf = confidence ?? 'unavailable';
  const label = CONFIDENCE_LABELS[conf] ?? 'Unknown';
  const showStake = shouldShowBondChip(bondPct);
  const showScore = score != null && Number.isFinite(score);

  if (!showScore && !showStake) {
    return (
      <span className="text-muted text-[0.7rem]" title={label}>
        —{withLabel ? <span className="ml-1 text-[0.6rem] uppercase tracking-wide">{label}</span> : null}
      </span>
    );
  }

  const rounded = showScore ? Math.round(score) : null;
  const stakeText = showStake && bondPct != null ? formatBondChip(bondPct) : null;
  const titleParts = [
    rounded != null ? `${rounded}/100 · ${label}` : null,
    stakeText != null ? `${stakeText} · Counterparty stake` : null,
  ].filter(Boolean);

  return (
    <span className="inline-flex items-center gap-1" title={titleParts.join(' · ')}>
      {showScore && score != null && (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xl text-[0.7rem] font-semibold ${sellerRatingScoreClass(score, conf)}`}>
          {rounded}
          <span className="text-[0.55rem] uppercase opacity-70 font-normal">{CONFIDENCE_SHORT[conf]}</span>
        </span>
      )}
      {stakeText != null && (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xl text-[0.7rem] font-semibold ${CLASS_STAKE}`}>
          {stakeText}
          {!compact && (
            <span className="text-[0.55rem] uppercase opacity-70 font-normal">stake</span>
          )}
        </span>
      )}
      {withLabel && <span className="text-[0.6rem] uppercase tracking-wide text-muted">{label}</span>}
    </span>
  );
}

export function CounterpartyStakeBadge({ pct }: { pct: number | null }) {
  if (!shouldShowBondChip(pct) || pct == null) {
    return (
      <span className="text-muted text-[0.7rem]" title="No counterparty stake">
        —
      </span>
    );
  }
  const text = formatBondChip(pct);
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xl text-[0.7rem] font-semibold ${CLASS_STAKE}`}
      title={`${text} · Counterparty stake`}
    >
      {text}
    </span>
  );
}
