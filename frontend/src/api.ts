import type { CardInfo, DeckCard, DeckSummary, DecksList, GameState, Legality } from './types';

const BASE = '/api';

function toDecklistText(cards: DeckCard[]): string {
  return cards.map((c) => `${c.count} ${c.name}`).join('\n');
}

export async function searchCards(query: string, limit = 40): Promise<CardInfo[]> {
  const res = await fetch(`${BASE}/cards/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  return res.json();
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
