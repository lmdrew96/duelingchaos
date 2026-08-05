import { useState } from 'react';
import Home from './Home';
import Deckbuilder from './Deckbuilder';
import Board from './Board';
import { DecoDefs } from './DecoDefs';
import { AuthHeader } from './AuthHeader';
import { ThemeToggle } from './ThemeToggle';
import { useTheme } from './theme';
import './App.css';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

type View = 'home' | 'deckbuilder' | 'board';

function App() {
  const [view, setView] = useState<View>('home');
  const [theme, setTheme] = useTheme();

  return (
    <div className="app-root">
      <DecoDefs />
      <nav className="view-switcher">
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
        <div className="header-actions">
          <ThemeToggle theme={theme} onChange={setTheme} />
          {CLERK_ENABLED && <AuthHeader />}
        </div>
      </nav>
      <div className="app-content">
        {view === 'home' && <Home onNavigate={setView} />}
        {view === 'deckbuilder' && <Deckbuilder />}
        {view === 'board' && <Board onExit={() => setView('deckbuilder')} />}
      </div>
    </div>
  );
}

export default App;
