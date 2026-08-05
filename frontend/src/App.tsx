import { useState } from 'react';
import Deckbuilder from './Deckbuilder';
import Board from './Board';
import { DecoDefs } from './DecoDefs';
import { AuthHeader } from './AuthHeader';
import './App.css';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

type View = 'deckbuilder' | 'board';

function App() {
  const [view, setView] = useState<View>('deckbuilder');

  return (
    <>
      <DecoDefs />
      <nav className="view-switcher">
        <button
          className={view === 'deckbuilder' ? 'active' : 'ghost'}
          onClick={() => setView('deckbuilder')}
        >
          Deckbuilder
        </button>
        <button className={view === 'board' ? 'active' : 'ghost'} onClick={() => setView('board')}>
          Board
        </button>
        {CLERK_ENABLED && <AuthHeader />}
      </nav>
      {view === 'deckbuilder' ? <Deckbuilder /> : <Board onExit={() => setView('deckbuilder')} />}
    </>
  );
}

export default App;
