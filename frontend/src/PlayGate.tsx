import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import * as api from './api';
import type { DecksList, PuzzleInfo } from './types';
import { DecoCorners } from './DecoCorner';
import { DecoCrown } from './DecoCrown';
import { DecoRule } from './DecoRule';
import './Deckbuilder.css';
// Reuses Board's generic backdrop/choice-panel modal classes (.card-detail-
// backdrop, .choice-panel, .choice-filter, .choice-options/.choice-option)
// for the AI-warning modal below instead of duplicating that deco-styled
// panel chrome here.
import './Board.css';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// Forge's bundled AI personality profiles (res/ai/*.ai) — mirrors the
// hardcoded list in src/index.ts's AI_PROFILES; no bridge endpoint
// enumerates these since the set is small and fixed.
const AI_PROFILES = ['Default', 'Cautious', 'Experimental', 'Reckless'];

// Whether *this browser tab* already picked decks (or explicitly chose to
// skip picking) for the match currently running server-side — sessionStorage
// rather than component state so a page refresh mid-game resumes straight
// to the board instead of re-prompting, but a fresh tab/session still gets
// the prompt. Cleared on game-over (see Board.tsx) so the next visit to the
// board starts a new match instead of re-showing the finished one.
const CONFIRMED_KEY = 'dc:matchConfirmed';
export const isMatchConfirmed = (): boolean => sessionStorage.getItem(CONFIRMED_KEY) === 'true';
export const markMatchConfirmed = (): void => sessionStorage.setItem(CONFIRMED_KEY, 'true');
export const clearMatchConfirmed = (): void => sessionStorage.removeItem(CONFIRMED_KEY);

// Warns before starting a match against a precon Forge's own AI can't pilot
// well (see api.getAiWarnings) — a filterable list of the specific cards
// flagged, not a blanket "this deck is bad" message, so the player knows
// exactly what to expect. Confirm proceeds with the match as-is; this is
// informational, not a hard block (curating replacement cards for every
// flagged precon is real deck-design work, out of scope here).
function AiWarningModal({
  deckName,
  cards,
  onConfirm,
  onCancel,
}: {
  deckName: string;
  cards: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState('');
  const visible = cards.filter((c) => c.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="card-detail-backdrop" onClick={onCancel}>
      <div className="choice-panel" onClick={(e) => e.stopPropagation()}>
        <DecoCorners />
        <DecoCrown />
        <p className="choice-title">
          AI can't play these cards well from {deckName}'s deck
        </p>
        <input
          className="choice-filter"
          type="text"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="ai-warning-grid">
          {visible.map((name) => (
            <span className="ai-warning-card" key={name}>
              {name}
            </span>
          ))}
        </div>
        <div className="choice-footer">
          <button onClick={onConfirm}>Confirm</button>
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Shown whenever the board is reached without a deck already having been
// chosen for this match (see App.tsx) — previously the board just jumped
// straight into whatever match the server happened to be running.
export default function PlayGate({ onConfirmed }: { onConfirmed: () => void }) {
  return CLERK_ENABLED ? (
    <PlayGateWithAuth onConfirmed={onConfirmed} />
  ) : (
    <PlayGateCore getToken={async () => null} isSignedIn={false} onConfirmed={onConfirmed} />
  );
}

function PlayGateWithAuth({ onConfirmed }: { onConfirmed: () => void }) {
  const { getToken, isSignedIn } = useAuth();
  return <PlayGateCore getToken={getToken} isSignedIn={!!isSignedIn} onConfirmed={onConfirmed} />;
}

function PlayGateCore({
  getToken,
  isSignedIn,
  onConfirmed,
}: {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
  onConfirmed: () => void;
}) {
  const [decksList, setDecksList] = useState<DecksList>({ presets: [], saved: [], presetFormats: {}, savedFormats: {} });
  const [deckName, setDeckName] = useState('');
  const [opponentDeck, setOpponentDeck] = useState('random');
  const [aiProfile, setAiProfile] = useState('Default');
  const [mode, setMode] = useState<'standard' | 'momir' | 'puzzle'>('standard');
  const [puzzles, setPuzzles] = useState<PuzzleInfo[]>([]);
  const [puzzleFile, setPuzzleFile] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiWarningCards, setAiWarningCards] = useState<string[]>([]);
  const [showAiWarning, setShowAiWarning] = useState(false);

  useEffect(() => {
    getToken()
      .then((token) => api.listDecks(token))
      .then((list) => {
        setDecksList(list);
        setDeckName((prev) => prev || list.saved[0] || '');
      })
      .catch(() => undefined);
    api.listPuzzles().then((list) => {
      setPuzzles(list);
      setPuzzleFile((prev) => prev || list[0]?.file || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Presets are curated across many formats — only offer ones legal in the
  // format the player's own deck was saved under (see DecksList.presetFormats).
  const playerFormat = decksList.savedFormats[deckName] ?? 'Standard';
  const opponentOptions = decksList.presets.filter((name) => decksList.presetFormats[name]?.includes(playerFormat));

  useEffect(() => {
    if (opponentDeck !== 'random' && !opponentOptions.includes(opponentDeck)) {
      setOpponentDeck('random');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerFormat]);

  // 'Random' picks its actual deck server-side at match start — there's
  // nothing to warn about until a specific precon is named.
  useEffect(() => {
    if (opponentDeck === 'random') {
      setAiWarningCards([]);
      return;
    }
    let cancelled = false;
    api.getAiWarnings(opponentDeck).then((cards) => {
      if (!cancelled) setAiWarningCards(cards);
    });
    return () => {
      cancelled = true;
    };
  }, [opponentDeck]);

  const doStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const token = await getToken();
      await api.startMatch(
        deckName,
        opponentDeck === 'random' ? undefined : opponentDeck,
        token,
        aiProfile,
        mode === 'momir' ? 'momir' : undefined,
        mode === 'puzzle' ? puzzleFile : undefined,
      );
      markMatchConfirmed();
      onConfirmed();
    } catch {
      setError('Could not start a match.');
    } finally {
      setStarting(false);
    }
  };

  const handleStart = () => {
    if (mode === 'momir') {
      doStart();
      return;
    }
    if (mode === 'puzzle') {
      if (!puzzleFile) return;
      doStart();
      return;
    }
    if (!deckName) return;
    if (aiWarningCards.length > 0) {
      setShowAiWarning(true);
      return;
    }
    doStart();
  };

  const selectedPuzzle = puzzles.find((p) => p.file === puzzleFile);

  const handleSkip = () => {
    markMatchConfirmed();
    onConfirmed();
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <h1>Choose your decks</h1>
        </div>
        <span className="subtitle">Pick a saved deck and an opponent before heading to the board.</span>
      </header>
      <DecoRule />

      <section className="panel" style={{ margin: '20px auto 0', maxWidth: 480 }}>
        <DecoCorners />
        {!isSignedIn ? (
          <>
            <p className="empty-hint">Sign in to pick a saved deck and opponent.</p>
            <button className="ghost" onClick={handleSkip}>
              Continue to the current game
            </button>
          </>
        ) : (
          <>
            <span className="field-label">Mode</span>
            <select
              className="format-select"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'standard' | 'momir' | 'puzzle')}
            >
              <option value="standard">Standard match</option>
              <option value="momir">Momir Basic (chaos mode — random creatures off a basics-only library)</option>
              <option value="puzzle">Puzzle (solve a pre-built board state)</option>
            </select>
            {mode === 'momir' ? (
              <>
                <span className="field-label" style={{ marginTop: 12 }}>
                  AI personality
                </span>
                <select
                  className="format-select"
                  value={aiProfile}
                  onChange={(e) => setAiProfile(e.target.value)}
                >
                  {AI_PROFILES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <div className="save-row" style={{ marginTop: 16 }}>
                  <button disabled={starting} onClick={handleStart}>
                    {starting ? 'Starting…' : 'Start match'}
                  </button>
                  <button className="ghost" onClick={handleSkip}>
                    Continue to the current game
                  </button>
                </div>
                {error && <p className="status-message">{error}</p>}
              </>
            ) : mode === 'puzzle' ? (
              <>
                <span className="field-label" style={{ marginTop: 12 }}>
                  Puzzle
                </span>
                <select
                  className="format-select"
                  value={puzzleFile}
                  onChange={(e) => setPuzzleFile(e.target.value)}
                >
                  {puzzles.map((p) => (
                    <option key={p.file} value={p.file}>
                      {p.name ?? p.file} {p.difficulty ? `(${p.difficulty})` : ''}
                    </option>
                  ))}
                </select>
                {selectedPuzzle && (
                  <p className="empty-hint" style={{ marginTop: 4, whiteSpace: 'pre-line' }}>
                    {selectedPuzzle.goal}
                    {selectedPuzzle.description ? `\n${selectedPuzzle.description}` : ''}
                  </p>
                )}
                <div className="save-row" style={{ marginTop: 16 }}>
                  <button disabled={starting || !puzzleFile} onClick={handleStart}>
                    {starting ? 'Starting…' : 'Start puzzle'}
                  </button>
                  <button className="ghost" onClick={handleSkip}>
                    Continue to the current game
                  </button>
                </div>
                {error && <p className="status-message">{error}</p>}
              </>
            ) : decksList.saved.length === 0 ? (
              <>
                <p className="empty-hint" style={{ marginTop: 12 }}>
                  No saved decks yet — build one first.
                </p>
                <button className="ghost" onClick={handleSkip}>
                  Continue to the current game
                </button>
              </>
            ) : (
              <>
                <span className="field-label" style={{ marginTop: 12 }}>
                  Your deck
                </span>
                <select className="format-select" value={deckName} onChange={(e) => setDeckName(e.target.value)}>
                  {decksList.saved.map((name) => (
                    <option key={name} value={name}>
                      {name} — {decksList.savedFormats[name] ?? 'Standard'}
                    </option>
                  ))}
                </select>
                <span className="field-label" style={{ marginTop: 12 }}>
                  Opponent deck
                </span>
                <select
                  className="format-select"
                  value={opponentDeck}
                  onChange={(e) => setOpponentDeck(e.target.value)}
                >
                  <option value="random">Random</option>
                  {opponentOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {opponentOptions.length === 0 && (
                  <p className="empty-hint" style={{ marginTop: 4 }}>
                    No preset opponents are legal in {playerFormat} — a random deck will still be picked from all presets.
                  </p>
                )}
                <span className="field-label" style={{ marginTop: 12 }}>
                  AI personality
                </span>
                <select
                  className="format-select"
                  value={aiProfile}
                  onChange={(e) => setAiProfile(e.target.value)}
                >
                  {AI_PROFILES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {aiWarningCards.length > 0 && (
                  <p className="empty-hint" style={{ marginTop: 4 }}>
                    {aiWarningCards.length} card{aiWarningCards.length === 1 ? '' : 's'} in this precon the AI plays badly.
                  </p>
                )}
                <div className="save-row" style={{ marginTop: 16 }}>
                  <button disabled={starting} onClick={handleStart}>
                    {starting ? 'Starting…' : 'Start match'}
                  </button>
                  <button className="ghost" onClick={handleSkip}>
                    Continue to the current game
                  </button>
                </div>
                {error && <p className="status-message">{error}</p>}
              </>
            )}
          </>
        )}
      </section>
      {showAiWarning && (
        <AiWarningModal
          deckName={opponentDeck}
          cards={aiWarningCards}
          onConfirm={() => {
            setShowAiWarning(false);
            doStart();
          }}
          onCancel={() => setShowAiWarning(false)}
        />
      )}
    </div>
  );
}
