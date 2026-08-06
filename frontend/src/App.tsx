import { useEffect, useState } from 'react';
import Home from './Home';
import Deckbuilder from './Deckbuilder';
import Board from './Board';
import PlayGate, { isMatchConfirmed } from './PlayGate';
import { DecoDefs } from './DecoDefs';
import { AuthHeader } from './AuthHeader';
import { ThemeToggle } from './ThemeToggle';
import { useTheme } from './theme';
import { useRoute } from './router';
import './App.css';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// Home/Board only ever navigate between the three base views (they don't
// know or care about a deckbuilder deck-name suffix), so they keep this
// simpler prop type — App is the only place path <-> view translation lives.
type View = 'home' | 'deckbuilder' | 'board';
const PATH_FOR_VIEW: Record<View, string> = { home: '/', deckbuilder: '/build', board: '/play' };

function viewForPath(path: string): View {
  if (path.startsWith('/build')) return 'deckbuilder';
  if (path.startsWith('/play')) return 'board';
  return 'home';
}

function App() {
  const { path, navigate } = useRoute();
  const [theme, setTheme] = useTheme();

  const view = viewForPath(path);
  // /build/:deckName — the saved deck the deckbuilder should auto-load on
  // mount (see Deckbuilder's deckName/onDeckSelected props). Absent for a
  // bare /build, and irrelevant off the deckbuilder route entirely.
  const buildMatch = /^\/build\/(.+)$/.exec(path);
  const deckName = buildMatch ? decodeURIComponent(buildMatch[1]) : undefined;

  const setView = (v: View) => navigate(PATH_FOR_VIEW[v]);

  // Re-synced from sessionStorage every time /play is (re)entered — covers
  // both a deck already having been picked before navigating here (Home's
  // per-deck Play button) and PlayGate confirming one just now.
  const [matchConfirmed, setMatchConfirmed] = useState(isMatchConfirmed);
  useEffect(() => {
    if (view === 'board') setMatchConfirmed(isMatchConfirmed());
  }, [view]);

  return (
    <div className="app-root">
      <DecoDefs />
      <nav className="view-switcher">
        <div className="nav-links">
          <button className={view === 'home' ? 'active' : 'ghost'} onClick={() => setView('home')}>
            Home
          </button>
          <button
            className={view === 'deckbuilder' ? 'active' : 'ghost'}
            onClick={() => setView('deckbuilder')}
          >
            Deckbuilder
          </button>
          <button className={view === 'board' ? 'active' : 'ghost'} onClick={() => setView('board')}>
            Board
          </button>
        </div>
        <span className="app-title">DuelingChaos</span>
        <div className="header-actions">
          <ThemeToggle theme={theme} onChange={setTheme} />
          {CLERK_ENABLED && <AuthHeader />}
        </div>
      </nav>
      <div className="app-content">
        {view === 'home' && <Home onNavigate={setView} />}
        {view === 'deckbuilder' && (
          <Deckbuilder
            deckName={deckName}
            onDeckSelected={(name) => navigate(`/build/${encodeURIComponent(name)}`, { replace: true })}
          />
        )}
        {view === 'board' &&
          (matchConfirmed ? (
            <Board onExit={() => setView('deckbuilder')} />
          ) : (
            <PlayGate onConfirmed={() => setMatchConfirmed(true)} />
          ))}
      </div>
    </div>
  );
}

export default App;
