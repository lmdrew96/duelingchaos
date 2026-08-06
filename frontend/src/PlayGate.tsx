import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import * as api from './api';
import type { DecksList } from './types';
import { DecoCorners } from './DecoCorner';
import { DecoRule } from './DecoRule';
import './Deckbuilder.css';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

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
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getToken()
      .then((token) => api.listDecks(token))
      .then((list) => {
        setDecksList(list);
        setDeckName((prev) => prev || list.saved[0] || '');
      })
      .catch(() => undefined);
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

  const handleStart = async () => {
    if (!deckName) return;
    setStarting(true);
    setError(null);
    try {
      const token = await getToken();
      await api.startMatch(deckName, opponentDeck === 'random' ? undefined : opponentDeck, token);
      markMatchConfirmed();
      onConfirmed();
    } catch {
      setError('Could not start a match with that deck.');
    } finally {
      setStarting(false);
    }
  };

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
        ) : decksList.saved.length === 0 ? (
          <>
            <p className="empty-hint">No saved decks yet — build one first.</p>
            <button className="ghost" onClick={handleSkip}>
              Continue to the current game
            </button>
          </>
        ) : (
          <>
            <span className="field-label">Your deck</span>
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
      </section>
    </div>
  );
}
