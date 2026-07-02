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

// Short tag rendered next to the score when there is room.
const CONFIDENCE_SHORT: Record<SellerRatingConfidence, string> = {
  feedback_verified: 'feedback',
  feedback_new: 'new',
  stake_bonded: 'bond',
  reputation_bonded: 'reputation',
  account_signing: 'signing',
  unavailable: 'n/a',
};

// Colour band by score, reusing the translucent-pill style of ExchangeTag.
function scoreClass(score: number): string {
  if (score >= 70) return 'bg-[#1a3a2a99] text-green';
  if (score >= 40) return 'bg-[#3a2a1a99] text-accent';
  return 'bg-[#3a1a1a99] text-red';
}

interface Props {
  score?: number | null;
  confidence?: SellerRatingConfidence | null;
  // compact hides the methodology tag (for tight table cells).
  compact?: boolean;
  // withLabel appends the full methodology label (for detail panels).
  withLabel?: boolean;
}

export function SellerRatingBadge({ score, confidence, compact, withLabel }: Props) {
  const conf = confidence ?? 'unavailable';
  const label = CONFIDENCE_LABELS[conf] ?? 'Unknown';

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
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xl text-[0.7rem] font-semibold ${scoreClass(score)}`}>
        {rounded}
        {!compact && (
          <span className="text-[0.55rem] uppercase opacity-70 font-normal">{CONFIDENCE_SHORT[conf]}</span>
        )}
      </span>
      {withLabel && <span className="text-[0.6rem] uppercase tracking-wide text-muted">{label}</span>}
    </span>
  );
}
