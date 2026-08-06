// Live card art via Scryfall's public API (CORS-open, confirmed via
// `access-control-allow-origin: *` on /cards/named). Forge itself is fully
// offline/local — this is the one place the frontend reaches the network,
// purely for art. Results are cached by lowercased name for the life of the
// tab; in-flight requests are deduped so a card rendered in multiple tiles
// at once (e.g. two copies in hand) only fires one fetch.

export type CardArt = { normal: string; artCrop: string } | null;

const cache = new Map<string, CardArt>();
const inFlight = new Map<string, Promise<CardArt>>();

// A search result list can be up to 300 distinct cards at once — fetching
// those one at a time (the previous fully-serialized queue) took minutes.
// Scryfall's documented limit is ~10 req/s; a small concurrent pool comes
// in well under that while actually finishing in a few seconds instead of
// several minutes.
const CONCURRENCY = 6;
let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
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

  const result = withSlot(() => fetchArt(name)).then((art) => {
    cache.set(key, art);
    inFlight.delete(key);
    return art;
  });
  inFlight.set(key, result);
  return result;
}
