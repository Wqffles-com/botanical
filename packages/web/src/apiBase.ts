/**
 * Optional origin. Empty means same-origin `/api/...`, which Vite proxies
 * to the Botanical server without rewriting the path.
 */
export function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE;
  if (configured === undefined || configured === "") return "";
  return configured.replace(/\/$/, "");
}
