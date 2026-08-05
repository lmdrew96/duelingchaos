// Live card art via Scryfall's public API (CORS-open, confirmed via
// `access-control-allow-origin: *` on /cards/named). Forge itself is fully
// offline/local — this is the one place the frontend reaches the network,
// purely for art. Results are cached by lowercased name for the life of the
// tab; in-flight requests are deduped so a card rendered in multiple tiles
// at once (e.g. two copies in hand) only fires one fetch.

export type CardArt = { normal: string; artCrop: string } | null;

const cache = new Map<string, CardArt>();
const inFlight = new Map<string, Promise<CardArt>>();

// Scryfall asks clients to space out requests (~50-100ms) rather than
// burst — a simple serialized queue is enough for a single local game's
// worth of distinct card names.
let queue: Promise<void> = Promise.resolve();

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

  const run = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, 100))).then(() => fetchArt(name));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  const result = run.then((art) => {
    cache.set(key, art);
    inFlight.delete(key);
    return art;
  });
  inFlight.set(key, result);
  return result;
}
