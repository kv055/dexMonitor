import type { SellerRatingConfidence } from '../types';
import { formatBondChip, sellerRatingScoreClass, shouldShowBondChip } from './sellerRating';

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

const CLASS_BOND = 'bg-[#2a1a3a99] text-purple';

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
