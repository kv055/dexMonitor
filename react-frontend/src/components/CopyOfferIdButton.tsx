import { useState } from 'react';

export function CopyOfferIdButton({ offerId }: { offerId: string }) {
  const [copied, setCopied] = useState(false);

  const copyOfferId = async () => {
    try {
      await navigator.clipboard.writeText(offerId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copyOfferId()}
      title={copied ? 'Copied' : 'Copy the offer ID to find it in the Bisq app'}
      aria-label={copied ? 'Offer ID copied' : 'Copy offer ID'}
      data-testid="copy-offer-id"
      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.7rem] font-semibold text-muted transition-colors hover:bg-accent/10 hover:text-accent"
    >
      {copied ? '✓ Copied' : 'Copy offer ID'}
    </button>
  );
}
