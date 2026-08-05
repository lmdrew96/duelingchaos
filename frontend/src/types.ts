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

export type BoardCard = {
  name: string;
  tapped: boolean;
  power: number;
  toughness: number;
};

export type PlayerState = {
  name: string;
  life: number;
  isAI: boolean;
  hand: BoardCard[];
  battlefield: BoardCard[];
  graveyard: BoardCard[];
  libraryCount: number;
};

export type GameState = {
  turn: number;
  phase: string;
  playerTurn: string | null;
  gameOver: boolean;
  players: PlayerState[];
  stack: string[];
};
