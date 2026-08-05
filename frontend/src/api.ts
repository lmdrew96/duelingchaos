import type { CardInfo, DeckCard, DeckSummary, DecksList, EntityRef, GameState, Legality } from './types';

const BASE = '/api';

function toDecklistText(cards: DeckCard[]): string {
  return cards.map((c) => `${c.count} ${c.name}`).join('\n');
}

export async function searchCards(query: string, limit = 40): Promise<CardInfo[]> {
  const res = await fetch(`${BASE}/cards/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  return res.json();
}

// /cards/search matches by substring, not exact name — a board card's name
// is always a real card name though, so an exact case-insensitive match
// (falling back to the first hit) reliably resolves it to its full detail.
export async function getCardDetail(name: string): Promise<CardInfo | null> {
  const results = await searchCards(name, 5);
  if (results.length === 0) return null;
  return results.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? results[0];
}

export async function listFormats(): Promise<string[]> {
  const res = await fetch(`${BASE}/formats/list`);
  return res.json();
}

export async function listDecks(): Promise<DecksList> {
  const res = await fetch(`${BASE}/decks/list`);
  return res.json();
}

export async function getDeck(source: 'preset' | 'saved', name: string): Promise<DeckSummary> {
  const res = await fetch(`${BASE}/decks/get?source=${source}&name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`deck not found: ${name}`);
  return res.json();
}

export async function saveDeck(name: string, cards: DeckCard[]): Promise<DeckSummary> {
  const res = await fetch(`${BASE}/decks/save?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: toDecklistText(cards),
  });
  if (!res.ok) throw new Error('failed to save deck');
  return res.json();
}

export async function deleteDeck(name: string): Promise<void> {
  await fetch(`${BASE}/decks/delete?name=${encodeURIComponent(name)}`, { method: 'POST' });
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
export const assignDamage = (amounts: number[]): Promise<void> =>
  postAction('assign-damage', { amounts });

// Spell-cast target declaration doesn't go through pendingChoice at all —
// it's the same click-a-card mechanism as playCard/tapLand, just reaching
// beyond the human player's own zones (an opponent's creature, or a player
// directly) via the same "card:<id>" / "player:<id>" ref scheme.
export const selectEntity = (ref: EntityRef): Promise<void> => postAction('select-entity', { ref });
