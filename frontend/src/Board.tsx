import { useEffect, useState } from 'react';
import * as api from './api';
import type { BoardCard, GameState, PlayerState } from './types';
import './Board.css';

// Phase 3: prove the render works off a GET /api/game-state snapshot. No
// clicking, no polling loop — that's phase 4 (live state + actions). A
// manual refresh button re-fetches for convenience while testing; it's not
// a game action.
function CardTile({ card }: { card: BoardCard }) {
  const showPT = card.power !== 0 || card.toughness !== 0;
  return (
    <div className={`card-tile${card.tapped ? ' tapped' : ''}`}>
      <div className="card-tile-name">{card.name}</div>
      {showPT && (
        <div className="card-tile-pt">
          {card.power}/{card.toughness}
        </div>
      )}
    </div>
  );
}

function CardBacks({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="card-back" key={i} />
      ))}
    </>
  );
}

function PlayerZone({ player, faceDownHand }: { player: PlayerState; faceDownHand: boolean }) {
  return (
    <div className={`board-zone${faceDownHand ? ' opponent-zone' : ''}`}>
      <div className="player-row">
        <div className={`life-badge${faceDownHand ? ' opponent' : ''}`}>
          <span className="life-value">{player.life}</span>
        </div>
        <span className="player-name">{player.name}</span>
        <span className="zone-counts">
          <span>library {player.libraryCount}</span>
          <span>graveyard {player.graveyard.length}</span>
        </span>
      </div>
      <div className="card-row">
        {player.battlefield.map((c, i) => (
          <CardTile card={c} key={`${c.name}-${i}`} />
        ))}
      </div>
      <div className="board-divider" />
      <div className="card-row">
        {faceDownHand ? (
          <CardBacks count={player.hand.length} />
        ) : (
          player.hand.map((c, i) => <CardTile card={c} key={`${c.name}-${i}`} />)
        )}
      </div>
    </div>
  );
}

export default function Board() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .fetchGameState()
      .then((s) => {
        setState(s);
        setError(null);
      })
      .catch(() => setError('Could not reach the bridge — is the game running?'));
  };

  useEffect(load, []);

  if (error) {
    return (
      <div className="board-shell">
        <p className="board-error">{error}</p>
        <button className="refresh-btn" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  if (!state) return null;

  const human = state.players.find((p) => !p.isAI) ?? state.players[0];
  const opponent = state.players.find((p) => p.isAI) ?? state.players[1];

  return (
    <div className="board-shell">
      <div className="board-hud">
        <span>turn {state.turn}</span>
        <span>{state.phase}</span>
        <span>{state.playerTurn ?? '—'}</span>
        <button className="refresh-btn" onClick={load}>
          refresh
        </button>
      </div>

      {opponent && <PlayerZone player={opponent} faceDownHand />}

      {state.stack.length > 0 && (
        <div className="stack-strip">
          <span className="stack-label">stack</span>
          {state.stack.join(' · ')}
        </div>
      )}

      {human && <PlayerZone player={human} faceDownHand={false} />}
    </div>
  );
}
