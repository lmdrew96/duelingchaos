import type { CardInfo, DeckCard } from './types';
import { parseManaCostTokens } from './manaCost';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

// A hybrid/Phyrexian pip (e.g. "W/U", "2/W") counts toward every color
// letter it contains — a simplification (it really only demands ONE of
// those colors, not both), but it's the right direction for a "how
// committed is this deck to each color" heuristic, and precise enough
// without modeling partial mana costs.
function colorPips(manaCost: string): Partial<Record<string, number>> {
  const counts: Partial<Record<string, number>> = {};
  for (const token of parseManaCostTokens(manaCost)) {
    for (const ch of token.toUpperCase()) {
      if ((COLORS as readonly string[]).includes(ch)) counts[ch] = (counts[ch] ?? 0) + 1;
    }
  }
  return counts;
}

// Which colors a land can tap for, read off its own rules text — Forge's
// CardInfo has no dedicated "mana produced" field. Restricted to lines
// containing "Add" so an unrelated color mention elsewhere in a land's text
// (e.g. "Whenever you cast a white spell...") doesn't get miscounted as a
// mana source.
function landColorSources(oracleText: string): string[] {
  const colors = new Set<string>();
  for (const line of oracleText.split('\n')) {
    if (!/add/i.test(line)) continue;
    // "Add one mana of any color" (Command Tower, City of Brass, ...) names
    // no {X} symbols at all — without this it'd read as a zero-color land.
    if (/any color/i.test(line)) {
      COLORS.forEach((c) => colors.add(c));
      continue;
    }
    for (const m of line.matchAll(/\{([WUBRG])\}/g)) colors.add(m[1]);
  }
  return [...colors];
}

// Loose match for "create a 1/1 white Soldier creature token" / "create two
// Treasure tokens" style rules text — good enough to surface what a deck can
// make, not a precise parser for every Forge oracle-text edge case.
const TOKEN_CREATE_RE = /create[s]?\s+(?:an?|one|two|three|four|five|six|x|\d+)\s+([a-z0-9/\-\s]*?token[s]?)(?=[.,;]|$)/gi;

// Different cards phrase the same token differently — "a 1/1 green Squirrel
// creature token" vs "two 1/1 green Squirrel creature tokens" vs "a tapped
// 1/1 green Squirrel creature token" — so the raw capture needs normalizing
// before it's used as a dedup key, or the same token shows up several times
// in the list. "Tapped"/"attacking" describe how the token enters, not what
// it is, and singular/plural is just grammar, so both get stripped.
function normalizeTokenDescription(desc: string): string {
  return desc
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(tapped|attacking)\s+/i, '')
    .replace(/tokens?$/i, 'token');
}

function extractTokenTypes(oracleText: string): string[] {
  const found: string[] = [];
  for (const m of oracleText.matchAll(TOKEN_CREATE_RE)) {
    const desc = normalizeTokenDescription(m[1]);
    if (desc) found.push(desc);
  }
  return found;
}

// P(drawing at least one success) from a finite deck with no replacement —
// computed as 1 minus P(zero successes), itself a running product rather
// than raw binomial coefficients so it stays numerically stable for a
// normal deck/hand size.
function atLeastOneProbability(deckSize: number, successes: number, draws: number): number {
  if (successes <= 0 || deckSize <= 0) return 0;
  if (draws <= 0) return 0;
  let pZero = 1;
  for (let i = 0; i < draws; i++) {
    const remaining = deckSize - successes - i;
    if (remaining < 0) return 1;
    pZero *= remaining / (deckSize - i);
  }
  return 1 - pZero;
}

const DRAW_PROBABILITY_TURNS = 8;

export type ManaBalance = { color: string; pips: number; sources: number };
export type DrawProbabilityPoint = { turn: number; probability: number };

export type ExpandedDeckStats = {
  landCount: number;
  nonLandCount: number;
  manaBalance: ManaBalance[];
  // Chance of having drawn at least one land by each turn, on the play
  // (7-card opening hand, no draw turn 1, one card every turn after).
  drawProbabilities: DrawProbabilityPoint[];
  tokenTypes: string[];
};

// cards should already exclude the sideboard (mirrors Deckbuilder's existing
// manaCurve/colorCounts convention) — commander stays included, same as those.
export function computeExpandedDeckStats(
  cards: DeckCard[],
  cardInfoCache: Record<string, CardInfo>,
): ExpandedDeckStats {
  let landCount = 0;
  let nonLandCount = 0;
  const pips: Record<string, number> = {};
  const sources: Record<string, number> = {};
  const tokenTypes = new Set<string>();

  for (const dc of cards) {
    const info = cardInfoCache[dc.name];
    if (!info) continue;
    const isLand = info.type.includes('Land');
    if (isLand) {
      landCount += dc.count;
      for (const c of landColorSources(info.oracleText)) sources[c] = (sources[c] ?? 0) + dc.count;
    } else {
      nonLandCount += dc.count;
      const cardPips = colorPips(info.manaCost);
      for (const c of COLORS) if (cardPips[c]) pips[c] = (pips[c] ?? 0) + cardPips[c]! * dc.count;
    }
    for (const t of extractTokenTypes(info.oracleText)) tokenTypes.add(t.toLowerCase());
  }

  const manaBalance = COLORS.filter((c) => (pips[c] ?? 0) > 0 || (sources[c] ?? 0) > 0).map((c) => ({
    color: c,
    pips: pips[c] ?? 0,
    sources: sources[c] ?? 0,
  }));

  const deckSize = landCount + nonLandCount;
  const drawProbabilities: DrawProbabilityPoint[] = Array.from({ length: DRAW_PROBABILITY_TURNS }, (_, i) => {
    const turn = i + 1;
    const draws = 7 + Math.max(0, turn - 1);
    return { turn, probability: atLeastOneProbability(deckSize, landCount, Math.min(draws, deckSize)) };
  });

  return { landCount, nonLandCount, manaBalance, drawProbabilities, tokenTypes: [...tokenTypes].sort() };
}
