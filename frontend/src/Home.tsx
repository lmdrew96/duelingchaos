import { useEffect, useState } from 'react';
import { useAuth, SignInButton } from '@clerk/react';
import * as api from './api';
import type { DecksList, MatchStats } from './types';
import { DecoCorners } from './DecoCorner';
import { DecoRule } from './DecoRule';
import './Deckbuilder.css';
import './Home.css';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

type View = 'deckbuilder' | 'board';

export default function Home({ onNavigate }: { onNavigate: (view: View) => void }) {
  return CLERK_ENABLED ? (
    <HomeWithAuth onNavigate={onNavigate} />
  ) : (
    <Landing onNavigate={onNavigate} />
  );
}

function HomeWithAuth({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { getToken, isSignedIn } = useAuth();
  return isSignedIn ? <Dashboard getToken={getToken} onNavigate={onNavigate} /> : <Landing onNavigate={onNavigate} />;
}

function Landing({ onNavigate }: { onNavigate: (view: View) => void }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <h1>DuelingChaos</h1>
        </div>
        <span className="subtitle">Player vs. CPU Magic: The Gathering, powered by Forge's own rules engine.</span>
      </header>
      <DecoRule />

      <section className="panel" style={{ marginTop: 20, maxWidth: 640 }}>
        <DecoCorners />
        <h2>Build a deck, then play it against the AI</h2>
        <p>
          Search the full card pool, assemble a deck, check it against real format legality, and take it to the
          board for a full rules-accurate match — targeting, combat, mana payment, the works.
        </p>
        <div className="landing-actions">
          <button onClick={() => onNavigate('deckbuilder')}>Open the deckbuilder</button>
          <button className="ghost" onClick={() => onNavigate('board')}>
            Go to board
          </button>
        </div>
        {CLERK_ENABLED && (
          <p className="landing-signin-hint">
            <SignInButton mode="modal">
              <button className="ghost">Sign in</button>
            </SignInButton>{' '}
            to save decks across sessions.
          </p>
        )}
      </section>
    </div>
  );
}

function Dashboard({
  getToken,
  onNavigate,
}: {
  getToken: () => Promise<string | null>;
  onNavigate: (view: View) => void;
}) {
  const [decksList, setDecksList] = useState<DecksList>({ presets: [], saved: [] });
  const [matchStats, setMatchStats] = useState<MatchStats>({ wins: 0, losses: 0, draws: 0, recent: [] });
  const [startingDeck, setStartingDeck] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    getToken()
      .then((token) => api.listDecks(token))
      .then(setDecksList)
      .catch(() => undefined);
    getToken()
      .then((token) => api.getMatchStats(token))
      .then(setMatchStats)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playDeck = (name: string) => {
    setStartingDeck(name);
    setStartError(null);
    getToken()
      .then((token) => api.startMatch(name, token))
      .then(() => onNavigate('board'))
      .catch(() => setStartError('Could not start a match with that deck.'))
      .finally(() => setStartingDeck(null));
  };

  const totalGames = matchStats.wins + matchStats.losses + matchStats.draws;
  const winRate = totalGames > 0 ? Math.round((matchStats.wins / totalGames) * 100) : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <h1>Dashboard</h1>
        </div>
        <span className="subtitle">Your decks and match history.</span>
      </header>
      <DecoRule />

      <div className="layout" style={{ marginTop: 20 }}>
        <section className="panel">
          <DecoCorners />
          <h2>Saved decks ({decksList.saved.length})</h2>
          {decksList.saved.length === 0 ? (
            <p className="empty-hint">No saved decks yet.</p>
          ) : (
            <ul className="dashboard-deck-list">
              {decksList.saved.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                  <button disabled={startingDeck !== null} onClick={() => playDeck(name)}>
                    {startingDeck === name ? 'Starting…' : 'Play'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {startError && <p className="empty-hint">{startError}</p>}
          <button onClick={() => onNavigate('deckbuilder')}>Go to deckbuilder</button>
        </section>

        <section className="panel">
          <DecoCorners />
          <h2>Deck library</h2>
          <p className="dashboard-stat-line">
            <span className="dashboard-stat-number">{decksList.saved.length}</span> saved deck
            {decksList.saved.length === 1 ? '' : 's'}
          </p>
          <p className="dashboard-stat-line">
            <span className="dashboard-stat-number">{decksList.presets.length}</span> preset deck
            {decksList.presets.length === 1 ? '' : 's'} available
          </p>
        </section>

        <section className="panel">
          <DecoCorners />
          <h2>Match history</h2>
          {totalGames === 0 ? (
            <p className="empty-hint">No matches played yet — play a saved deck to start tracking results.</p>
          ) : (
            <>
              <p className="dashboard-stat-line">
                <span className="dashboard-stat-number">{winRate}%</span> win rate ({matchStats.wins}-
                {matchStats.losses}
                {matchStats.draws > 0 ? `-${matchStats.draws}` : ''})
              </p>
              <ul className="dashboard-deck-list">
                {matchStats.recent.map((entry, i) => (
                  <li key={i}>
                    <span>{entry.deckName}</span>
                    <span>{entry.isDraw ? 'Draw' : entry.won ? 'Win' : 'Loss'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button className="ghost" onClick={() => onNavigate('board')}>
            Go to board
          </button>
        </section>
      </div>
    </div>
  );
}
