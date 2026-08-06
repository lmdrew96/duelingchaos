import { useEffect, useState } from 'react';
import { useAuth, SignInButton } from '@clerk/react';
import * as api from './api';
import type { DecksList, MatchStats } from './types';
import { markMatchConfirmed } from './PlayGate';
import { DecoCorners } from './DecoCorner';
import { DecoCrown } from './DecoCrown';
import { DecoRule } from './DecoRule';
import { HeroCardFan } from './HeroCardFan';
import './Deckbuilder.css';
import './Home.css';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

type View = 'deckbuilder' | 'board';

// Required by the Wizards of the Coast Fan Content Policy for any unofficial
// project built on Magic: The Gathering IP — see
// https://company.wizards.com/en/legal/fancontentpolicy. Shown on Home since
// it's the one view every session passes through.
function LegalFooter() {
  return (
    <p className="legal-footer">
      DuelingChaos is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not
      approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards
      of the Coast LLC. Powered by the open-source Forge engine, a separate project unaffiliated with Wizards.
    </p>
  );
}

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
      <div className="landing-hero">
        <span className="landing-eyebrow">Player vs. CPU · Powered by Forge</span>
        <h1 className="landing-title">DuelingChaos</h1>
        <p className="subtitle">
          A full rules-accurate game of Magic: The Gathering against the computer — no opponent required.
        </p>
      </div>
      <HeroCardFan />
      <DecoRule />

      <section className="panel landing-cta">
        <DecoCorners />
        <DecoCrown />
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

      <div className="landing-features">
        <section className="panel">
          <DecoCorners />
          <h2>Real rules, not a simulation</h2>
          <p>
            Forge's own engine runs the game — full targeting, combat math, triggered abilities, and mana payment,
            not a simplified stand-in.
          </p>
        </section>
        <section className="panel">
          <DecoCorners />
          <h2>Build &amp; check legality</h2>
          <p>
            Search the entire card pool, assemble a deck, and see it checked against a real format's structural and
            banlist rules as you build.
          </p>
        </section>
        <section className="panel">
          <DecoCorners />
          <h2>Track your record</h2>
          <p>Sign in to save decks across sessions and keep a running win/loss history for each one.</p>
        </section>
      </div>

      <LegalFooter />
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
  const [decksList, setDecksList] = useState<DecksList>({ presets: [], saved: [], presetFormats: {}, savedFormats: {} });
  const [matchStats, setMatchStats] = useState<MatchStats>({ wins: 0, losses: 0, draws: 0, recent: [] });
  const [startingDeck, setStartingDeck] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [opponentDeck, setOpponentDeck] = useState<string>('random');

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
      .then((token) => api.startMatch(name, opponentDeck === 'random' ? undefined : opponentDeck, token))
      .then(() => {
        markMatchConfirmed();
        onNavigate('board');
      })
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
      <HeroCardFan size="sm" />
      <DecoRule />

      <div className="layout" style={{ marginTop: 20 }}>
        <section className="panel">
          <DecoCorners />
          <h2>Saved decks ({decksList.saved.length})</h2>
          <span className="field-label">Opponent deck</span>
          <select
            className="format-select"
            value={opponentDeck}
            onChange={(e) => setOpponentDeck(e.target.value)}
          >
            <option value="random">Random</option>
            {decksList.presets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
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

      <LegalFooter />
    </div>
  );
}
