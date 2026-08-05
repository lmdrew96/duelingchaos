import { useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { BoardCard, GameState, PlayerState } from './types';
import './Board.css';

const POLL_INTERVAL_MS = 1000;

function CardTile({ card, index, onClick }: { card: BoardCard; index: number; onClick?: (index: number) => void }) {
  const showPT = card.power !== 0 || card.toughness !== 0;
  return (
    <div
      className={`card-tile${card.tapped ? ' tapped' : ''}${onClick ? ' clickable' : ''}`}
      onClick={onClick ? () => onClick(index) : undefined}
    >
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

function PlayerZone({
  player,
  faceDownHand,
  onHandClick,
  onBattlefieldClick,
}: {
  player: PlayerState;
  faceDownHand: boolean;
  onHandClick?: (index: number) => void;
  onBattlefieldClick?: (index: number) => void;
}) {
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
          <CardTile card={c} index={i} onClick={onBattlefieldClick} key={`${c.name}-${i}`} />
        ))}
      </div>
      <div className="board-divider" />
      <div className="card-row">
        {faceDownHand ? (
          <CardBacks count={player.hand.length} />
        ) : (
          player.hand.map((c, i) => (
            <CardTile card={c} index={i} onClick={onHandClick} key={`${c.name}-${i}`} />
          ))
        )}
      </div>
    </div>
  );
}

export default function Board() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = () => {
    api
      .fetchGameState()
      .then((s) => {
        setState(s);
        setError(null);
      })
      .catch(() => setError('Could not reach the bridge — is the game running?'));
  };

  useEffect(() => {
    load();
    const handle = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, []);

  // Re-poll right after an action instead of waiting for the next tick, so
  // clicks feel responsive. inFlight guards against a slow action + the
  // next poll tick both landing and stepping on each other.
  const runAction = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await action();
      load();
    } finally {
      inFlight.current = false;
    }
  };

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
  const prompt = state.pendingPrompt;

  return (
    <div className="board-shell">
      <div className="board-hud">
        <span>turn {state.turn}</span>
        <span>{state.phase}</span>
        <span>{state.playerTurn ?? '—'}</span>
        <button className="refresh-btn" onClick={load}>
          refresh
        </button>
        <button className="refresh-btn" onClick={() => runAction(api.passPriority)}>
          pass priority
        </button>
      </div>

      {opponent && <PlayerZone player={opponent} faceDownHand />}

      {state.stack.length > 0 && (
        <div className="stack-strip">
          <span className="stack-label">stack</span>
          {state.stack.join(' · ')}
        </div>
      )}

      {human && (
        <PlayerZone
          player={human}
          faceDownHand={false}
          onHandClick={(index) => runAction(() => api.playCard(index))}
          onBattlefieldClick={(index) => runAction(() => api.tapLand(index))}
        />
      )}

      {prompt?.message && (
        <div className="prompt-panel">
          <p className="prompt-message">{prompt.message}</p>
          <div className="prompt-buttons">
            {prompt.button1Enabled && (
              <button onClick={() => runAction(api.selectOk)}>{prompt.button1}</button>
            )}
            {prompt.button2Enabled && (
              <button className="ghost" onClick={() => runAction(api.selectCancel)}>
                {prompt.button2}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
