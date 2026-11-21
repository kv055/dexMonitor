export interface DexOfferRef {
  exchange: string;
  direction?: string | null;
  offer_id?: string | null;
  venue_node_name?: string | null;
  source_event_id?: string | null;
}

export interface DexOfferLink {
  url: string;
  /** Button label, e.g. "View on RoboSats". */
  label: string;
  /** Tooltip describing where the link leads. */
  title: string;
}

const ROBOSATS_BOOK_URL = 'https://robosats.com/offers';

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

/**
 * Native deep link for a live offer on its own DEX platform.
 *
 * Returns null when the exchange has no public web page for the offer:
 * Bisq 1 / Bisq 2 are local GUI apps (out of scope), and Peach Bitcoin is
 * app-only — its web companion requires pairing, so no per-offer URL exists.
 */
export function getDexOfferLink(offer: DexOfferRef): DexOfferLink | null {
  const exchange = offer.exchange.trim().toLowerCase();
  switch (exchange) {
    case 'hodlhodl': {
      // Offer pages are addressable by the public offer id, e.g.
      // https://hodlhodl.com/offers/66KxDgQtBMnNaJVB
      const id = trimmed(offer.offer_id);
      if (!id) return null;
      return {
        url: `https://hodlhodl.com/offers/${encodeURIComponent(id)}`,
        label: 'View on HodlHodl',
        title: `Opens offer ${id} on HodlHodl in a new tab`,
      };
    }
    case 'robosats': {
      // Order pages live under /order/:coordinatorAlias/:orderId. The
      // snapshot stores order ids scoped as "alias:id" (order numbers are
      // per-coordinator sequences) plus the alias in venue_node_name; either
      // half identifies the coordinator. Legacy bare numeric ids without a
      // known alias fall back to the federated order book.
      // RoboSats is Tor-native: in a normal browser robosats.com redirects to
      // dex.robosats.com (dropping the path) and the old unsafe.* clearnet
      // viewer is gone, so these links need Tor Browser. The title says so.
      const rawId = trimmed(offer.offer_id);
      const sep = rawId.indexOf(':');
      const namespacedAlias = sep > 0 ? rawId.slice(0, sep).trim() : '';
      const numericId = (sep > 0 ? rawId.slice(sep + 1) : rawId).trim();
      const coordinator = trimmed(offer.venue_node_name) || namespacedAlias;
      if (/^\d+$/.test(numericId) && coordinator) {
        return {
          url: `https://robosats.com/order/${encodeURIComponent(coordinator)}/${encodeURIComponent(numericId)}`,
          label: 'View on RoboSats',
          title: `Opens order ${numericId} on RoboSats in a new tab (requires Tor Browser + a RoboSats robot)`,
        };
      }
      return {
        url: ROBOSATS_BOOK_URL,
        label: 'View on RoboSats',
        title: 'Opens the RoboSats order book in a new tab (requires Tor Browser + a RoboSats robot)',
      };
    }
    case 'mostro': {
      // The official web client (mostro.network/app) defines take_sell/take_buy
      // order routes, but its static hosting has no SPA fallback, so deep
      // paths 404 (verified). Instead link the order itself: Mostro orders are
      // Nostr (NIP-69 kind 38383) events and the persisted source event id
      // renders in any Nostr event viewer.
      const eventId = trimmed(offer.source_event_id).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(eventId)) return null;
      const orderId = trimmed(offer.offer_id);
      return {
        url: `https://njump.me/${eventId}`,
        label: 'View on Mostro',
        title: orderId
          ? `Opens Mostro order ${orderId} (Nostr event) in a new tab`
          : 'Opens the Mostro order (Nostr event) in a new tab',
      };
    }
    default:
      return null;
  }
}
