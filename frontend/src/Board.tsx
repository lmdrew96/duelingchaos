import { useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { BoardCard, GameState, PendingChoice, PlayerState } from './types';
import './Board.css';

const POLL_INTERVAL_MS = 1000;

// Mana-payment ambiguity (which color/source to tap) resolves through the
// same getChoices path as modal spell modes — Forge has no dedicated
// mana-choice hook. When every option in a "list" choice is a recognized
// color name, render WUBRG pips instead of generic text buttons.
const MANA_PIP_CLASS: Record<string, string> = {
  white: 'pip-w',
  blue: 'pip-u',
  black: 'pip-b',
  red: 'pip-r',
  green: 'pip-g',
  colorless: 'pip-c',
};

function manaPipClass(label: string): string | null {
  return MANA_PIP_CLASS[label.trim().toLowerCase()] ?? null;
}

// A double-line hex ring with diamond finials at each vertex — the
// reference deco kit's signature is concentric strokes + diamond ticks,
// not a single flat-filled shape.
const HEX_OUTER: [number, number][] = [
  [25, 0],
  [75, 0],
  [100, 50],
  [75, 100],
  [25, 100],
  [0, 50],
];
const HEX_INNER: [number, number][] = HEX_OUTER.map(([x, y]) => [50 + (x - 50) * 0.82, 50 + (y - 50) * 0.82]);
const toPoints = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(' ');

function LifeBadgeOrnament({ opponent }: { opponent?: boolean }) {
  const color = opponent ? 'var(--blue-muted)' : 'var(--gold)';
  return (
    <svg viewBox="0 0 100 100" className="life-badge-svg" aria-hidden>
      <polygon points={toPoints(HEX_OUTER)} fill="none" stroke={color} strokeWidth={3} />
      <polygon points={toPoints(HEX_INNER)} fill="none" stroke={color} strokeWidth={1.5} opacity={0.7} />
      {HEX_OUTER.map(([x, y], i) => (
        <rect key={i} x={x - 3} y={y - 3} width={6} height={6} fill={color} transform={`rotate(45 ${x} ${y})`} />
      ))}
    </svg>
  );
}

// A small diamond-and-hairline corner ornament, reused (with CSS mirroring)
// at all four corners of the singular chrome panels — prompts/choices are
// one-off, so real linework earns its keep there without becoming noise.
function DecoCorner({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <svg viewBox="0 0 20 20" className={`deco-corner ${position}`} aria-hidden>
      <rect x="6" y="6" width="8" height="8" fill="var(--gold)" transform="rotate(45 10 10)" />
      <line x1="10" y1="10" x2="20" y2="10" stroke="var(--gold)" strokeWidth="1.5" />
      <line x1="10" y1="10" x2="10" y2="20" stroke="var(--gold)" strokeWidth="1.5" />
    </svg>
  );
}

function DecoCorners() {
  return (
    <>
      <DecoCorner position="tl" />
      <DecoCorner position="tr" />
      <DecoCorner position="bl" />
      <DecoCorner position="br" />
    </>
  );
}

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
          <LifeBadgeOrnament opponent={faceDownHand} />
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
        <DecoCorners />
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
        <DecoCorners />
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
  const allPips = choice.kind === 'list' && options.length > 0 && options.every((o) => manaPipClass(o));

  return (
    <div className="choice-panel">
      <DecoCorners />
      <p className="choice-title">{choice.title}</p>
      <div className={allPips ? 'choice-pips' : 'choice-options'}>
        {options.map((label, i) => {
          const pipClass = allPips ? manaPipClass(label) : null;
          return (
            <button
              key={i}
              className={
                pipClass
                  ? `choice-pip ${pipClass}${selected.includes(i) ? ' selected' : ''}`
                  : `choice-option${selected.includes(i) ? ' selected' : ''}`
              }
              title={label}
              onClick={() => toggle(i)}
            >
              {pipClass ? '' : label}
            </button>
          );
        })}
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
        <button className="pass-priority-btn" onClick={() => runAction(api.passPriority)}>
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
          <DecoCorners />
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
