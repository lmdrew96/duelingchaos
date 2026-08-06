// Live card art via Scryfall's public API (CORS-open, confirmed via
// `access-control-allow-origin: *` on /cards/named). Forge itself is fully
// offline/local — this is the one place the frontend reaches the network,
// purely for art. Results are cached by lowercased name for the life of the
// tab; in-flight requests are deduped so a card rendered in multiple tiles
// at once (e.g. two copies in hand) only fires one fetch.

export type CardArt = { normal: string; artCrop: string } | null;

const cache = new Map<string, CardArt>();
const inFlight = new Map<string, Promise<CardArt>>();

// A search result list can be up to 300 distinct cards at once, each
// mounting a CardArt that requests art immediately. A concurrency-only
// limiter (N requests in flight, next one fires the instant a slot frees)
// can still sustain well over Scryfall's documented ~10 req/s under a burst
// like that — and their rate-limit response apparently omits CORS headers,
// so a throttled request doesn't fail as a clean "429": the browser reports
// it as a CORS error (see the ChaosPatch "console errors" report — hundreds
// of "blocked by CORS policy" lines, one per card, from exactly this path).
// Pacing request *starts* to one every MIN_INTERVAL_MS keeps us under the
// limit regardless of how many cards are queued at once.
const MIN_INTERVAL_MS = 100; // ~10 req/s, matching Scryfall's documented limit
let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

function scheduleFetch<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the queue alive even if this fetch fails — fetchArt already
  // swallows its own errors, but nothing else should ever back up behind it.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function imageUrisOf(card: any): { normal?: string; art_crop?: string } | undefined {
  return card.image_uris ?? card.card_faces?.[0]?.image_uris;
}

async function fetchArt(name: string): Promise<CardArt> {
  try {
    const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const card = await res.json();
    const uris = imageUrisOf(card);
    if (!uris?.normal || !uris?.art_crop) return null;
    return { normal: uris.normal, artCrop: uris.art_crop };
  } catch {
    return null;
  }
}

export function getCardArt(name: string): Promise<CardArt> {
  const key = name.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const result = scheduleFetch(() => fetchArt(name)).then((art) => {
    cache.set(key, art);
    inFlight.delete(key);
    return art;
  });
  inFlight.set(key, result);
  return result;
}
