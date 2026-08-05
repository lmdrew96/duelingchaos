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
  id: number;
  name: string;
  tapped: boolean;
  power: number;
  toughness: number;
};

export type PlayerState = {
  id: number;
  name: string;
  life: number;
  isAI: boolean;
  hand: BoardCard[];
  battlefield: BoardCard[];
  graveyard: BoardCard[];
  libraryCount: number;
};

// "card:<id>" | "player:<id>" — matches BoardCard.id / PlayerState.id so an
// entity offered as a target/source can be resolved to its actual rendered
// tile instead of guessed from a display string.
export type EntityRef = string;

export type StackItem = {
  id: number;
  sourceRef: EntityRef | null;
  sourceName: string | null;
  text: string;
  targetRefs: EntityRef[];
};

export type PendingPrompt = {
  message: string | null;
  button1: string | null;
  button2: string | null;
  button1Enabled: boolean;
  button2Enabled: boolean;
};

export type PendingChoiceKind = 'list' | 'target' | 'targets' | 'number' | 'combatDamage';

export type PendingChoice = {
  kind: PendingChoiceKind;
  title: string | null;
  options: string[] | null;
  min: number;
  max: number;
  optional: boolean;
  isNumeric: boolean;
  initialInput: string | null;
  attacker: string | null;
  damage: number;
  refs: (EntityRef | null)[] | null;
  sourceRef: EntityRef | null;
};

export type GameState = {
  turn: number;
  phase: string;
  playerTurn: string | null;
  gameOver: boolean;
  pendingPrompt: PendingPrompt;
  pendingChoice: PendingChoice | null;
  players: PlayerState[];
  stack: StackItem[];
};
