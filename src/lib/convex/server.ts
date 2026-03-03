import { ConvexHttpClient } from 'convex/browser';

let _client: ConvexHttpClient | null = null;

/**
 * Server-side Convex client singleton.
 * Uses ConvexHttpClient (HTTP-based, no WebSocket) — safe for API routes / server actions.
 * Returns null if NEXT_PUBLIC_CONVEX_URL is not configured.
 */
export function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;

  if (!_client) {
    _client = new ConvexHttpClient(url);
  }
  return _client;
}
