import { useState } from 'react';
import Deckbuilder from './Deckbuilder';
import Board from './Board';
import { DecoDefs } from './DecoDefs';
import './App.css';

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
      </nav>
      {view === 'deckbuilder' ? <Deckbuilder /> : <Board />}
    </>
  );
}

export default App;
