import { useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { BoardCard, GameState, PendingChoice, PlayerState } from './types';
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

// One panel shape for every pendingChoice kind — they all reduce to
// "pick indices from options" (list/target/targets), "pick a number"
// (number), or "split a number across options" (combatDamage). Mirrors
// the shared PendingChoice plumbing on the bridge side.
function ChoicePanel({
  choice,
  onResolve,
}: {
  choice: PendingChoice;
  onResolve: (values: number[]) => void;
}) {
  const options = choice.options ?? [];
  const [selected, setSelected] = useState<number[]>([]);
  const [numberValue, setNumberValue] = useState(choice.initialInput ?? '0');
  const [amounts, setAmounts] = useState<number[]>(() => options.map(() => 0));

  useEffect(() => {
    setSelected([]);
    setNumberValue(choice.initialInput ?? '0');
    setAmounts(options.map(() => 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice.kind, choice.title, options.join('|')]);

  if (choice.kind === 'number') {
    const value = Number(numberValue);
    const valid = Number.isInteger(value) && value >= 0;
    return (
      <div className="choice-panel">
        <p className="choice-title">{choice.title}</p>
        <div className="choice-number-row">
          <input type="number" min={0} value={numberValue} onChange={(e) => setNumberValue(e.target.value)} />
          <button disabled={!valid} onClick={() => onResolve([value])}>
            Confirm
          </button>
        </div>
      </div>
    );
  }

  if (choice.kind === 'combatDamage') {
    const total = amounts.reduce((a, b) => a + b, 0);
    const valid = total === choice.damage;
    const setAmount = (i: number, v: number) => setAmounts((prev) => prev.map((a, idx) => (idx === i ? v : a)));
    return (
      <div className="choice-panel">
        <p className="choice-title">
          {choice.attacker} assigns {choice.damage} damage
        </p>
        <div className="choice-damage-rows">
          {options.map((label, i) => (
            <div className="choice-damage-row" key={i}>
              <span>{label}</span>
              <input
                type="number"
                min={0}
                max={choice.damage}
                value={amounts[i] ?? 0}
                onChange={(e) => setAmount(i, Math.max(0, Number(e.target.value)))}
              />
            </div>
          ))}
        </div>
        <div className="choice-footer">
          <span className={`choice-total${valid ? ' valid' : ''}`}>
            {total} / {choice.damage} assigned
          </span>
          <button disabled={!valid} onClick={() => onResolve(amounts)}>
            Confirm
          </button>
        </div>
      </div>
    );
  }

  // list | target | targets
  const isSingle = choice.kind === 'target';
  const max = isSingle ? 1 : choice.max || options.length;
  const valid = selected.length >= choice.min && selected.length <= max;
  const toggle = (i: number) => {
    if (isSingle) {
      setSelected([i]);
      return;
    }
    setSelected((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      if (prev.length >= max) return prev;
      return [...prev, i];
    });
  };

  return (
    <div className="choice-panel">
      <p className="choice-title">{choice.title}</p>
      <div className="choice-options">
        {options.map((label, i) => (
          <button
            key={i}
            className={`choice-option${selected.includes(i) ? ' selected' : ''}`}
            onClick={() => toggle(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="choice-footer">
        <button disabled={!valid} onClick={() => onResolve(selected)}>
          Confirm
        </button>
        {choice.optional && (
          <button className="ghost" onClick={() => onResolve([])}>
            Skip
          </button>
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
  const choice = state.pendingChoice;

  const resolveChoice = (values: number[]) => {
    if (!choice) return;
    if (choice.kind === 'number') {
      runAction(() => api.selectNumber(values[0] ?? 0));
    } else if (choice.kind === 'combatDamage') {
      runAction(() => api.assignDamage(values));
    } else {
      runAction(() => api.selectChoice(values));
    }
  };

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

      {choice && <ChoicePanel choice={choice} onResolve={resolveChoice} />}

      {!choice && prompt?.message && (
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
