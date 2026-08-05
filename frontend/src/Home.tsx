import { useEffect, useState } from 'react';
import { useAuth, SignInButton } from '@clerk/react';
import * as api from './api';
import type { DecksList } from './types';
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

  useEffect(() => {
    getToken()
      .then((token) => api.listDecks(token))
      .then(setDecksList)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
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
          <p className="empty-hint">
            Coming soon — win/loss tracking needs a way to launch a match from a saved deck first.
          </p>
          <button className="ghost" onClick={() => onNavigate('board')}>
            Go to board
          </button>
        </section>
      </div>
    </div>
  );
}
