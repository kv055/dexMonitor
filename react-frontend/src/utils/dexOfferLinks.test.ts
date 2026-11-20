import { describe, expect, it } from 'vitest';

import { getDexOfferLink } from './dexOfferLinks';

describe('getDexOfferLink', () => {
  it('links HodlHodl offers directly by offer id', () => {
    expect(getDexOfferLink({ exchange: 'hodlhodl', offer_id: 'OWR5pgmymAJDmYRG' })).toEqual({
      url: 'https://hodlhodl.com/offers/OWR5pgmymAJDmYRG',
      label: 'View on HodlHodl',
      title: 'Opens offer OWR5pgmymAJDmYRG on HodlHodl in a new tab',
    });
  });

  it('matches exchange names case-insensitively', () => {
    expect(getDexOfferLink({ exchange: 'HodlHodl', offer_id: 'abc' })?.url).toBe('https://hodlhodl.com/offers/abc');
    expect(getDexOfferLink({ exchange: 'RoboSats', offer_id: '7' })?.url).toBe('https://robosats.com/offers');
  });

  it('returns null for HodlHodl offers without an id', () => {
    expect(getDexOfferLink({ exchange: 'hodlhodl', offer_id: null })).toBeNull();
    expect(getDexOfferLink({ exchange: 'hodlhodl', offer_id: '  ' })).toBeNull();
  });

  it('links RoboSats orders directly when the coordinator alias is known', () => {
    expect(getDexOfferLink({ exchange: 'robosats', offer_id: '123', venue_node_name: 'temple' })).toEqual({
      url: 'https://robosats.com/order/temple/123',
      label: 'View on RoboSats',
      title: 'Opens order 123 on RoboSats in a new tab (requires Tor Browser + a RoboSats robot)',
    });

    expect(getDexOfferLink({ exchange: 'robosats', offer_id: '123' })?.title).toBe(
      'Opens the RoboSats order book in a new tab (requires Tor Browser + a RoboSats robot)',
    );
  });

  it('reads the coordinator from scoped alias:id offer ids', () => {
    expect(getDexOfferLink({ exchange: 'robosats', offer_id: 'lake:456' })).toEqual({
      url: 'https://robosats.com/order/lake/456',
      label: 'View on RoboSats',
      title: 'Opens order 456 on RoboSats in a new tab (requires Tor Browser + a RoboSats robot)',
    });
  });

  it('falls back to the RoboSats book when coordinator or numeric id is missing', () => {
    expect(getDexOfferLink({ exchange: 'robosats', offer_id: '123' })?.url).toBe('https://robosats.com/offers');
    expect(getDexOfferLink({ exchange: 'robosats', offer_id: 'offer-1', venue_node_name: 'temple' })?.url)
      .toBe('https://robosats.com/offers');
    expect(getDexOfferLink({ exchange: 'robosats', offer_id: null })?.url).toBe('https://robosats.com/offers');
  });

  it('links Mostro orders via their Nostr source event', () => {
    const eventId = 'a'.repeat(64);
    expect(getDexOfferLink({ exchange: 'mostro', direction: 'ask', offer_id: 'order-1', source_event_id: eventId })).toEqual({
      url: `https://njump.me/${eventId}`,
      label: 'View on Mostro',
      title: 'Opens Mostro order order-1 (Nostr event) in a new tab',
    });
  });

  it('returns null for Mostro offers without a valid event id', () => {
    expect(getDexOfferLink({ exchange: 'mostro', direction: 'ask', offer_id: 'order-1', source_event_id: null })).toBeNull();
    expect(getDexOfferLink({ exchange: 'mostro', direction: 'ask', offer_id: 'order-1', source_event_id: 'not-an-event' })).toBeNull();
  });

  it('links Noones offers by their public offer hash', () => {
    expect(getDexOfferLink({ exchange: 'noones', offer_id: 'Agq1Bpw7oX9' })).toEqual({
      url: 'https://noones.com/offer/Agq1Bpw7oX9',
      label: 'View on Noones',
      title: 'Opens offer Agq1Bpw7oX9 on Noones in a new tab',
    });
  });

  it('returns null for Noones rows that only carry a numeric offer id', () => {
    expect(getDexOfferLink({ exchange: 'noones', offer_id: '12345' })).toBeNull();
    expect(getDexOfferLink({ exchange: 'noones', offer_id: null })).toBeNull();
  });

  it('returns null for local-app and app-only venues', () => {
    expect(getDexOfferLink({ exchange: 'bisq', offer_id: 'x' })).toBeNull();
    expect(getDexOfferLink({ exchange: 'bisq2', offer_id: 'x' })).toBeNull();
    expect(getDexOfferLink({ exchange: 'peachbitcoin', offer_id: 'x' })).toBeNull();
    expect(getDexOfferLink({ exchange: 'unknown', offer_id: 'x' })).toBeNull();
  });

  it('encodes unsafe characters in ids', () => {
    expect(getDexOfferLink({ exchange: 'hodlhodl', offer_id: 'a/b c' })?.url)
      .toBe('https://hodlhodl.com/offers/a%2Fb%20c');
  });
});
