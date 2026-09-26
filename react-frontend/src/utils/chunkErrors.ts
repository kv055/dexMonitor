// Helpers for detecting stale-deploy chunk-load failures. A tab left open
// across a deploy still runs the old bundle, whose hashed chunks no longer
// exist on the server — the lazy import rejects and must degrade to a reload,
// not a blank page. Kept outside ErrorBoundary.tsx so that file only exports
// components (react-refresh rule).

// Lazy-chunk load failures look like this across browsers and bundlers:
// - Chrome:  "Failed to fetch dynamically imported module: https://…/assets/X.js"
// - Firefox: "error loading dynamically imported module"
// - Safari:  "Importing a module script failed."
// - Webpack: "Loading chunk N failed."
const CHUNK_LOAD_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \d+ failed/i,
  /chunkloaderror/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return CHUNK_LOAD_PATTERNS.some((pattern) => pattern.test(message));
}

// Session flag so a stale tab reloads at most once per tab session: the first
// chunk failure after a deploy reloads to the new build, but if the chunk is
// still missing afterwards (broken deploy) the fallback stays up instead of
// reload-looping.
const RELOAD_FLAG = 'dex-view-chunk-reloaded';

export function shouldReloadForChunkError(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) !== null) return false;
    sessionStorage.setItem(RELOAD_FLAG, '1');
    return true;
  } catch {
    return false;
  }
}
