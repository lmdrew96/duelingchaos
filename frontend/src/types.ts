export type CardInfo = {
  name: string;
  manaCost: string;
  type: string;
  colors: string;
  power: string | null;
  toughness: string | null;
  oracleText: string;
};

export type CardSearchResult = { cards: CardInfo[]; truncated: boolean };

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
  manaCost: string;
  typeCategory: string;
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

// Dismissible reminder chips for legal-but-easy-to-forget options (unplayed
// land drop, an unused instant during the opponent's turn) — not rule
// warnings, Forge enforces those itself. Computed bridge-side from data
// (priority, land-drop count, hand contents) the frontend doesn't otherwise
// have; see GameStateJson.writePointers.
export type PointerInfo = { id: string; message: string };

// Declared attackers/blockers only — no precomputed "legal to attack/block"
// set (see GameStateJson.writeCombat). Null outside combat.
export type CombatAttacker = { attackerRef: EntityRef; defenderRef: EntityRef | null };
export type CombatBlock = { blockerRef: EntityRef; attackerRef: EntityRef };
export type CombatState = { attackers: CombatAttacker[]; blocks: CombatBlock[] };

export type GameState = {
  turn: number;
  phase: string;
  playerTurn: string | null;
  gameOver: boolean;
  isDraw: boolean;
  winnerName: string | null;
  pendingPrompt: PendingPrompt;
  pendingChoice: PendingChoice | null;
  pointers: PointerInfo[];
  combat: CombatState | null;
  players: PlayerState[];
  stack: StackItem[];
};
