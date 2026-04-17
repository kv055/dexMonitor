import type { Offer } from '../types';

function baseOfferKey(offer: Offer): string {
  return [
    offer.exchange,
    offer.offer_id ?? `id:${offer.id}`,
    offer.direction,
    offer.payment_method ?? 'no-payment',
    offer.first_seen ?? 'no-first-seen',
    offer.last_seen ?? (offer.is_live ? 'live' : 'no-last-seen'),
    offer.price,
    offer.btc_min ?? 'no-btc-min',
    offer.btc_max ?? 'no-btc-max',
    offer.price_type ?? 'no-price-type',
    offer.is_live ? 'live' : 'closed',
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
