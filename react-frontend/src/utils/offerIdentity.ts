import type { Offer } from '../types';
import { getBtcMax, getBtcMin, getFirstSeen, getLastSeen, getPriceType, isOfferLive } from './offerAccess';

function baseOfferKey(offer: Offer): string {
  return [
    offer.exchange,
    offer.offer_id ?? `id:${offer.id}`,
    offer.direction,
    offer.payment_methods?.join(',') ?? 'no-payment',
    getFirstSeen(offer) ?? 'no-first-seen',
    getLastSeen(offer) ?? (isOfferLive(offer) ? 'live' : 'no-last-seen'),
    offer.pricing?.offer_price ?? offer.price ?? 0,
    getBtcMin(offer) ?? 'no-btc-min',
    getBtcMax(offer) ?? 'no-btc-max',
    getPriceType(offer) ?? 'no-price-type',
    isOfferLive(offer) ? 'live' : 'closed',
  ].join('|');
}

export function buildOfferKeys(offers: Offer[]): string[] {
  const seen = new Map<string, number>();

  return offers.map((offer) => {
    const baseKey = baseOfferKey(offer);
    const occurrence = seen.get(baseKey) ?? 0;
    seen.set(baseKey, occurrence + 1);
    return occurrence === 0 ? baseKey : `${baseKey}|dup:${occurrence}`;
  });
}

/**
 * Identity for the chart-visibility checkbox. Unlike `buildOfferKeys`,
 * this deliberately omits `last_seen` (which the backend bumps to "now" on
 * every snapshot cycle for live offers) so a user's checkbox choice
 * survives polling instead of resetting every ~15s.
 */
export function buildStableOfferKey(offer: Pick<Offer, 'exchange' | 'offer_id' | 'id' | 'direction'>): string {
  return [offer.exchange, offer.offer_id ?? `id:${offer.id}`, offer.direction].join('|');
}
