export function normalizeUrl(urlString: string) {
  // strip origin for same-origin resources; keep origin for cross-origin resources
  const url = new URL(urlString, window.location.origin);
  return url.origin === window.location.origin ? url.pathname + url.search : url.toString() ;
}
