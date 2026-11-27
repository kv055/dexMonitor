/**
 * Meta tag dexMonitor adds to index.html in the public monitor deployment
 * (PUBLIC_EDITION=true, docker-compose.public.yml).
 */
export const EDITION_META_NAME = 'dexpendulum-edition';

/**
 * Shown in the public monitor wherever the trading deployment would quote or
 * trade. Same wording as nginx/public.conf's canned answer for those calls.
 * A placeholder until "Start trade" links to an explainer.
 */
export const PUBLIC_TRADING_UNAVAILABLE = "Trading isn't available on the public monitor.";

/**
 * True in the public monitor deployment: the dex Monitor and Statistics tabs
 * only, no login, and no settings that change the shared routing policy. The
 * trading deployment never sets the meta tag, so it keeps today's behaviour.
 */
export function isPublicEdition(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector(`meta[name="${EDITION_META_NAME}"]`)?.getAttribute('content') === 'public';
}
