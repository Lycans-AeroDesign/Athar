import { apiFetch } from "@/lib/api/client";

const CACHE_NAME = "athar-media-v1";
const memoryUrlCache = new Map<string, string>();
const inFlightPromises = new Map<string, Promise<string | null>>();

/**
 * Returns a cached object URL synchronously if it was already fetched in the current session.
 * Used by image components to render immediately on mount with zero flash/skeleton.
 */
export function getCachedBlobUrlSync(src: string): string | null {
  if (!src) return null;
  return memoryUrlCache.get(src) ?? null;
}

/**
 * Fetches an authenticated file/image, caching the resulting blob URL in memory
 * and in persistent browser CacheStorage (across reloads).
 * Concurrent requests for the same `src` are deduplicated.
 */
export async function fetchBlobUrl(src: string): Promise<string | null> {
  if (!src || !src.trim()) return null;

  // 1. In-memory hit
  const inMemory = memoryUrlCache.get(src);
  if (inMemory) {
    return inMemory;
  }

  // 2. Single-flight: return existing in-flight promise if currently fetching
  const inFlight = inFlightPromises.get(src);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      // 3. Check persistent CacheStorage (available in modern browsers)
      if (typeof window !== "undefined" && "caches" in window) {
        try {
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(src);
          if (cachedResponse && cachedResponse.ok) {
            const blob = await cachedResponse.blob();
            const objectUrl = URL.createObjectURL(blob);
            memoryUrlCache.set(src, objectUrl);
            return objectUrl;
          }
        } catch {
          // CacheStorage access may fail in restricted iframes; fall through to network fetch
        }
      }

      // 4. Network fetch with Bearer token
      const res = await apiFetch(src);
      if (!res.ok) {
        return null;
      }

      // Store clone in CacheStorage for future page reloads
      if (typeof window !== "undefined" && "caches" in window) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(src, res.clone());
        } catch {
          // Ignore cache write errors
        }
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      memoryUrlCache.set(src, objectUrl);
      return objectUrl;
    } catch {
      return null;
    } finally {
      inFlightPromises.delete(src);
    }
  })();

  inFlightPromises.set(src, promise);
  return promise;
}
