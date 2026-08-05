export type CardInfo = {
  name: string;
  manaCost: string;
  type: string;
  colors: string;
  power: string | null;
  toughness: string | null;
  oracleText: string;
};

export type DeckCard = { name: string; count: number };

export type DeckSummary = { name: string; deckSize: number; cards: DeckCard[] };

export type DecksList = { presets: string[]; saved: string[] };

export type Legality = {
  legal: boolean;
  deckSize: number;
  structuralProblem: string | null;
  banlistProblem: string | null;
};
