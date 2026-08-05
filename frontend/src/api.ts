import type {
  CardInfo,
  CardSearchResult,
  DeckCard,
  DeckSummary,
  DecksList,
  EntityRef,
  GameState,
  Legality,
  MatchStats,
} from './types';

const BASE = '/api';

function toDecklistText(cards: DeckCard[]): string {
  return cards.map((c) => `${c.count} ${c.name}`).join('\n');
}

export async function searchCards(query: string, limit = 300): Promise<CardSearchResult> {
  const res = await fetch(`${BASE}/cards/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  const { cards, truncated }: CardSearchResult = await res.json();
  // Forge's raw card scripts use a literal "\n" (backslash-n) for a
  // paragraph break in oracle text, not an actual newline character — every
  // display surface expects real ones (white-space: pre-wrap / line-clamp).
  const normalized = cards.map((c) => (c.oracleText ? { ...c, oracleText: c.oracleText.replace(/\\n/g, '\n') } : c));
  return { cards: normalized, truncated };
}

// /cards/search matches by substring, not exact name — a board card's name
// is always a real card name though, so an exact case-insensitive match
// (falling back to the first hit) reliably resolves it to its full detail.
export async function getCardDetail(name: string): Promise<CardInfo | null> {
  const { cards } = await searchCards(name, 5);
  if (cards.length === 0) return null;
  return cards.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? cards[0];
}

export async function listFormats(): Promise<string[]> {
  const res = await fetch(`${BASE}/formats/list`);
  return res.json();
}

// Presets and card search stay open to anyone hitting the bridge; saved
// decks are Clerk-gated (see src/auth.ts, src/db.ts), so every saved-deck
// call takes the caller's Clerk session token (Deckbuilder gets it from
// useAuth().getToken()) and forwards it as a bearer token. Loading presets
// or listing decks while signed out is fine — token is simply omitted.
function authHeaders(token: string | null): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export async function listDecks(token: string | null): Promise<DecksList> {
  const res = await fetch(`${BASE}/decks/list`, { headers: authHeaders(token) });
  return res.json();
}

export async function getDeck(source: 'preset' | 'saved', name: string, token: string | null): Promise<DeckSummary> {
  const res = await fetch(`${BASE}/decks/get?source=${source}&name=${encodeURIComponent(name)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`deck not found: ${name}`);
  return res.json();
}

export async function saveDeck(name: string, cards: DeckCard[], token: string | null): Promise<DeckSummary> {
  const res = await fetch(`${BASE}/decks/save?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...authHeaders(token) },
    body: toDecklistText(cards),
  });
  if (!res.ok) throw new Error('failed to save deck');
  return res.json();
}

export async function deleteDeck(name: string, token: string | null): Promise<void> {
  await fetch(`${BASE}/decks/delete?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: authHeaders(token),
  });
}

// Restarts the running match with a saved deck in the human seat and a
// chosen AI opponent deck (a preset name, or 'random'/undefined to pick one
// of the presets at random server-side) — resolves once the new game is
// actually ready to poll (see src/index.ts's restartMatch), so the caller
// can navigate to the board immediately after.
export async function startMatch(deckName: string, opponentDeck: string | undefined, token: string | null): Promise<void> {
  const res = await fetch(`${BASE}/match/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ deckName, opponentDeck }),
  });
  if (!res.ok) throw new Error('failed to start match');
}

// Fired once by the board when it sees gameOver — no-ops server-side if the
// running game wasn't started from a saved deck, so this is safe to call
// unconditionally.
export async function reportMatchResult(won: boolean, isDraw: boolean): Promise<void> {
  await fetch(`${BASE}/match/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ won, isDraw }),
  }).catch(() => undefined);
}

export async function getMatchStats(token: string | null): Promise<MatchStats> {
  const res = await fetch(`${BASE}/match/stats`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('failed to load match stats');
  return res.json();
}

export async function checkLegality(format: string, cards: DeckCard[]): Promise<Legality> {
  const res = await fetch(`${BASE}/legality/check?format=${encodeURIComponent(format)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: toDecklistText(cards),
  });
  return res.json();
}

export async function fetchGameState(): Promise<GameState> {
  const res = await fetch(`${BASE}/game-state`);
  if (!res.ok) throw new Error('failed to fetch game state');
  return res.json();
}

async function postAction(path: string, body?: object): Promise<void> {
  await fetch(`${BASE}/action/${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const passPriority = (): Promise<void> => postAction('pass-priority');
export const selectOk = (): Promise<void> => postAction('select-ok');
export const selectCancel = (): Promise<void> => postAction('select-cancel');
export const concede = (): Promise<void> => postAction('concede');
export const undo = (): Promise<void> => postAction('undo');
// Same underlying "click a card" selection Forge uses for casting a spell,
// playing a land, AND answering a card-selection prompt (e.g. cleanup
// discard) — InputProxy figures out what the click means server-side.
export const playCard = (index: number): Promise<void> => postAction('play-card', { index });
export const tapLand = (index: number): Promise<void> => postAction('tap-land', { index });

// Resolves any pendingChoice of kind "list" | "target" | "targets" — all
// three are answered the same way, by index into pendingChoice.options.
export const selectChoice = (indices: number[]): Promise<void> =>
  postAction('select-choice', { indices });
export const selectNumber = (value: number): Promise<void> => postAction('select-number', { value });
// Resolves a pendingChoice of kind "combatDamage" or "splitAmount" — both
// split a total across pendingChoice.options, in order.
export const assignDamage = (amounts: number[]): Promise<void> =>
  postAction('assign-damage', { amounts });

// Spell-cast target declaration doesn't go through pendingChoice at all —
// it's the same click-a-card mechanism as playCard/tapLand, just reaching
// beyond the human player's own zones (an opponent's creature, or a player
// directly) via the same "card:<id>" / "player:<id>" ref scheme.
export const selectEntity = (ref: EntityRef): Promise<void> => postAction('select-entity', { ref });
