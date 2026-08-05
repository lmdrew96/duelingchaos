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

// Undefined/omitted means 'main' — existing saved decks predate this field
// and load with no section at all.
export type DeckCardSection = 'commander' | 'sideboard';
export type DeckCard = { name: string; count: number; section?: DeckCardSection };

export type DeckSummary = { name: string; deckSize: number; cards: DeckCard[] };

export type DecksList = { presets: string[]; saved: string[] };

export type MatchHistoryEntry = { deckName: string; won: boolean; isDraw: boolean; playedAt: string };
export type MatchStats = { wins: number; losses: number; draws: number; recent: MatchHistoryEntry[] };

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
  poison: number;
  energy: number;
  experience: number;
  // Floating mana pool as a {W}{U}... cost string (empty when nothing's
  // floating) — reuses ManaPips' existing cost-string renderer as-is.
  manaPool: string;
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

export type PendingChoiceKind = 'list' | 'target' | 'targets' | 'number' | 'combatDamage' | 'splitAmount';

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
  // Total to split across `options` for "combatDamage" (combat damage) and
  // "splitAmount" (any other Forge assignGenericAmount-style split) alike.
  amount: number;
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

// Newest-first — see GameStateJson.writeGameLog.
export type GameLogEntry = { type: string; message: string };

export type GameState = {
  turn: number;
  stormCount: number;
  phase: string;
  playerTurn: string | null;
  canUndo: boolean;
  // True while the pendingPrompt is the opening-hand Keep/Mulligan decision
  // — lets the board swap in a dedicated Mulligan panel instead of the
  // generic yes/no prompt (see BridgeGuiGame.isMulliganPrompt).
  isMulligan: boolean;
  gameOver: boolean;
  isDraw: boolean;
  winnerName: string | null;
  pendingPrompt: PendingPrompt;
  pendingChoice: PendingChoice | null;
  pointers: PointerInfo[];
  combat: CombatState | null;
  log: GameLogEntry[];
  players: PlayerState[];
  stack: StackItem[];
};
