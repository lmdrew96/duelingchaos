import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as api from './api';
import type { BoardCard, CardInfo, EntityRef, GameState, PendingChoice, PlayerState, PointerInfo, StackItem } from './types';
import { ManaPips } from './manaCost';
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

function CardTile({
  card,
  index,
  onClick,
  targetable,
  registerRef,
  onInfoClick,
}: {
  card: BoardCard;
  index: number;
  onClick?: (index: number) => void;
  targetable?: boolean;
  registerRef?: (el: HTMLElement | null) => void;
  onInfoClick?: (name: string) => void;
}) {
  const showPT = card.power !== 0 || card.toughness !== 0;
  return (
    <div
      ref={registerRef}
      className={`card-tile${card.tapped ? ' tapped' : ''}${onClick ? ' clickable' : ''}${targetable ? ' targetable' : ''}`}
      onClick={onClick ? () => onClick(index) : undefined}
    >
      {onInfoClick && (
        <button
          type="button"
          className="card-tile-info"
          onClick={(e) => {
            e.stopPropagation();
            onInfoClick(card.name);
          }}
          aria-label={`View ${card.name} details`}
        >
          i
        </button>
      )}
      <div className="card-tile-name">{card.name}</div>
      {card.manaCost && (
        <div className="card-tile-cost">
          <ManaPips cost={card.manaCost} size="sm" />
        </div>
      )}
      {showPT && (
        <div className="card-tile-pt">
          {card.power}/{card.toughness}
        </div>
      )}
    </div>
  );
}

// Row order and display labels for battlefield grouping — matches the
// bridge's typeCategory precedence (Creature checked before Artifact/Land
// so multi-type permanents land with their creature-specific mechanics).
const TYPE_GROUP_ORDER: [string, string][] = [
  ['Land', 'Lands'],
  ['Creature', 'Creatures'],
  ['Planeswalker', 'Planeswalkers'],
  ['Artifact', 'Artifacts'],
  ['Enchantment', 'Enchantments'],
  ['Battle', 'Battles'],
  ['Other', 'Other'],
];

function CardBacks({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="card-back" key={i} />
      ))}
    </>
  );
}

// The stack resolves LIFO — Forge's own stack iterator returns top-of-stack
// (the next thing to resolve) first, so that's rendered frontmost/brightest
// in the fan. Each tile registers under its source card's ref, so the
// targeting-arrow overlay can anchor an arrow at a freshly-cast spell that
// hasn't (yet) landed on the battlefield as a permanent.
function StackRail({
  items,
  registerElementRef,
}: {
  items: StackItem[];
  registerElementRef: (key: EntityRef, el: HTMLElement | null) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="stack-rail">
      <span className="stack-label">stack</span>
      <div className="stack-fan">
        {items.map((item, i) => (
          <div
            key={item.id}
            ref={item.sourceRef ? (el) => registerElementRef(item.sourceRef!, el) : undefined}
            className={`stack-tile${i === 0 ? ' top' : ''}`}
            title={item.text}
            style={{ zIndex: items.length - i }}
          >
            {item.sourceName ?? item.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerZone({
  player,
  faceDownHand,
  onHandClick,
  onBattlefieldClick,
  targetableRefs,
  onEntityClick,
  onEntityFallbackClick,
  registerElementRef,
  onInfoClick,
}: {
  player: PlayerState;
  faceDownHand: boolean;
  onHandClick?: (index: number) => void;
  onBattlefieldClick?: (index: number) => void;
  targetableRefs?: Set<EntityRef>;
  onEntityClick?: (ref: EntityRef) => void;
  // Spell-cast targeting (no pendingChoice involved — see api.selectEntity)
  // has no advance list of valid targets, so any card/player is clickable
  // as a "maybe this is legal" attempt; Forge silently no-ops an illegal one.
  onEntityFallbackClick?: (ref: EntityRef) => void;
  registerElementRef: (key: EntityRef, el: HTMLElement | null) => void;
  onInfoClick?: (name: string) => void;
}) {
  const playerRef: EntityRef = `player:${player.id}`;
  const playerTargetable = targetableRefs?.has(playerRef) ?? false;
  return (
    <div className={`board-zone${faceDownHand ? ' opponent-zone' : ''}`}>
      <div className="player-row">
        <div
          ref={(el) => registerElementRef(playerRef, el)}
          className={`life-badge${faceDownHand ? ' opponent' : ''}${playerTargetable ? ' targetable' : ''}`}
          onClick={
            playerTargetable
              ? () => onEntityClick?.(playerRef)
              : onEntityFallbackClick
                ? () => onEntityFallbackClick(playerRef)
                : undefined
          }
        >
          <LifeBadgeOrnament opponent={faceDownHand} />
          <span className="life-value">{player.life}</span>
        </div>
        <span className="player-name">{player.name}</span>
        <span className="zone-counts">
          <span>library {player.libraryCount}</span>
          <span>graveyard {player.graveyard.length}</span>
        </span>
      </div>
      {/* A single wrapping div, not one flex child per group — .opponent-zone
          reverses flex-direction so the opponent's hand renders near the
          middle of the screen, and that reversal would otherwise scramble
          TYPE_GROUP_ORDER's fixed sequence for every direct sibling too. */}
      <div className="battlefield-groups">
        {TYPE_GROUP_ORDER.map(([category, label]) => {
          const entries = player.battlefield
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => (c.typeCategory || 'Other') === category);
          if (entries.length === 0) return null;
          return (
            <div className="battlefield-group" key={category}>
              <span className="battlefield-group-label">{label}</span>
              <div className="card-row">
                {entries.map(({ c, i }) => {
                  const ref: EntityRef = `card:${c.id}`;
                  const targetable = targetableRefs?.has(ref) ?? false;
                  const fallbackClick = onEntityFallbackClick ? () => onEntityFallbackClick(ref) : undefined;
                  return (
                    <CardTile
                      card={c}
                      index={i}
                      onClick={targetable ? () => onEntityClick?.(ref) : (onBattlefieldClick ?? fallbackClick)}
                      targetable={targetable}
                      registerRef={(el) => registerElementRef(ref, el)}
                      onInfoClick={onInfoClick}
                      key={ref}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="board-divider" />
      <div className="card-row">
        {faceDownHand ? (
          <CardBacks count={player.hand.length} />
        ) : (
          player.hand.map((c, i) => (
            <CardTile card={c} index={i} onClick={onHandClick} onInfoClick={onInfoClick} key={`${c.name}-${i}`} />
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
  selected,
  onToggle,
  boardIsPicker,
}: {
  choice: PendingChoice;
  onResolve: (values: number[]) => void;
  selected: number[];
  onToggle: (i: number) => void;
  boardIsPicker: boolean;
}) {
  const options = choice.options ?? [];
  const [numberValue, setNumberValue] = useState(choice.initialInput ?? '0');
  const [amounts, setAmounts] = useState<number[]>(() => options.map(() => 0));

  useEffect(() => {
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
  const max = choice.kind === 'target' ? 1 : choice.max || options.length;
  const valid = selected.length >= choice.min && selected.length <= max;
  const allPips = choice.kind === 'list' && options.length > 0 && options.every((o) => manaPipClass(o));

  return (
    <div className="choice-panel">
      <DecoCorners />
      <p className="choice-title">{choice.title}</p>
      {boardIsPicker ? (
        <p className="choice-hint">Click a highlighted target on the board.</p>
      ) : (
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
                onClick={() => onToggle(i)}
              >
                {pipClass ? '' : label}
              </button>
            );
          })}
        </div>
      )}
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

// The board only ever knows a card's name/P&T/tapped-state from the live
// game view — full oracle text/type isn't part of that payload, so this
// looks the card up through the same /cards/search the deckbuilder uses.
function CardDetailModal({ cardName, onClose }: { cardName: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CardInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setNotFound(false);
    api
      .getCardDetail(cardName)
      .then((c) => {
        if (cancelled) return;
        if (c) setDetail(c);
        else setNotFound(true);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="card-detail-backdrop" onClick={onClose}>
      <div className="card-detail-panel" onClick={(e) => e.stopPropagation()}>
        <DecoCorners />
        <button type="button" className="ghost card-detail-close" onClick={onClose}>
          close
        </button>
        {loading && <p className="choice-hint">Loading…</p>}
        {!loading && notFound && <p className="choice-hint">No card data found for "{cardName}".</p>}
        {!loading && detail && (
          <>
            <div className="card-detail-header">
              <span className="card-detail-name">{detail.name}</span>
              <ManaPips cost={detail.manaCost} size="md" />
            </div>
            <p className="card-detail-type">{detail.type}</p>
            <p className="card-detail-oracle">{detail.oracleText}</p>
            {detail.power != null && (
              <p className="card-detail-pt">
                {detail.power}/{detail.toughness}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Non-blocking, dismissible nudges for legal-but-easy-to-forget options
// (land drop, an unused instant) — never a rules warning, since Forge
// enforces those itself. Dismissal is per-instance, not persisted: once the
// underlying condition clears (id drops out of state.pointers) and later
// recurs (e.g. next turn's land drop), it's no longer in dismissedIds and
// reappears — see the pruning effect in Board().
function PointerBar({
  pointers,
  dismissedIds,
  onDismiss,
}: {
  pointers: PointerInfo[];
  dismissedIds: Set<string>;
  onDismiss: (id: string) => void;
}) {
  const visible = pointers.filter((p) => !dismissedIds.has(p.id));
  if (visible.length === 0) return null;
  return (
    <div className="pointer-bar">
      {visible.map((p) => (
        <div className="pointer-chip" key={p.id}>
          <span className="pointer-chip-icon" aria-hidden>
            ◆
          </span>
          <span className="pointer-chip-message">{p.message}</span>
          <button
            type="button"
            className="pointer-chip-dismiss"
            onClick={() => onDismiss(p.id)}
            aria-label="Dismiss reminder"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

type Arrow = { x1: number; y1: number; x2: number; y2: number; dashed: boolean };

export default function Board() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [detailCardName, setDetailCardName] = useState<string | null>(null);
  const [dismissedPointerIds, setDismissedPointerIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  // Maps "card:<id>" / "player:<id>" to its rendered element — populated by
  // ref callbacks on CardTile/life-badge/stack-tile as they mount, read back
  // after each commit to compute arrow endpoints and target-click hit areas.
  const elementRefs = useRef<Map<EntityRef, HTMLElement>>(new Map());
  const registerElementRef = (key: EntityRef, el: HTMLElement | null) => {
    if (el) elementRefs.current.set(key, el);
    else elementRefs.current.delete(key);
  };

  const load = () => {
    api
      .fetchGameState()
      .then((s) => {
        setState(s);
        setError(null);
        // Drop dismissals whose condition no longer holds, so the same id
        // (e.g. "land-drop") can nudge again once it recurs next turn,
        // instead of staying silently dismissed forever.
        const activeIds = new Set(s.pointers.map((p) => p.id));
        setDismissedPointerIds((prev) => {
          const next = new Set([...prev].filter((id) => activeIds.has(id)));
          return next.size === prev.size ? prev : next;
        });
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

  const pendingChoice = state?.pendingChoice ?? null;
  const choiceKey = pendingChoice
    ? `${pendingChoice.kind}|${pendingChoice.title}|${(pendingChoice.options ?? []).join(',')}`
    : null;
  useEffect(() => {
    setSelected([]);
  }, [choiceKey]);

  // Recomputed every render after commit: confirmed targets already on the
  // stack (solid arrows, real data straight from Forge's StackItemView) plus
  // a tentative arrow for whatever's currently selected in a live target
  // choice (dashed, cleared on Confirm since the choice disappears).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !state) {
      setArrows([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const specs: { from: EntityRef; to: EntityRef; dashed: boolean }[] = [];
    for (const item of state.stack) {
      if (!item.sourceRef) continue;
      for (const t of item.targetRefs) specs.push({ from: item.sourceRef, to: t, dashed: false });
    }
    const choice = state.pendingChoice;
    if (choice?.sourceRef && choice.refs && (choice.kind === 'target' || choice.kind === 'targets')) {
      for (const i of selected) {
        const ref = choice.refs[i];
        if (ref) specs.push({ from: choice.sourceRef, to: ref, dashed: true });
      }
    }
    const next: Arrow[] = [];
    for (const spec of specs) {
      const fromEl = elementRefs.current.get(spec.from);
      const toEl = elementRefs.current.get(spec.to);
      if (!fromEl || !toEl) continue;
      const fr = fromEl.getBoundingClientRect();
      const tr = toEl.getBoundingClientRect();
      next.push({
        x1: fr.left + fr.width / 2 - containerRect.left,
        y1: fr.top + fr.height / 2 - containerRect.top,
        x2: tr.left + tr.width / 2 - containerRect.left,
        y2: tr.top + tr.height / 2 - containerRect.top,
        dashed: spec.dashed,
      });
    }
    setArrows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selected]);

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

  const isTargetChoice = choice != null && (choice.kind === 'target' || choice.kind === 'targets');
  // The board itself is the picker only when every option resolved to a
  // real ref — if any came back null (an entity type entityRef() doesn't
  // recognize), fall back to the panel's text list so nothing's unreachable.
  const boardIsPicker = isTargetChoice && !!choice!.refs && choice!.refs.every((r) => r != null);
  const targetableRefs = new Set<EntityRef>(boardIsPicker ? (choice!.refs!.filter(Boolean) as EntityRef[]) : []);
  const max = choice ? (choice.kind === 'target' ? 1 : choice.max || (choice.options?.length ?? 0)) : 0;

  const toggleSelected = (i: number) => {
    if (!choice) return;
    if (choice.kind === 'target') {
      setSelected([i]);
      return;
    }
    setSelected((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      if (prev.length >= max) return prev;
      return [...prev, i];
    });
  };

  const onEntityClick = (ref: EntityRef) => {
    if (!choice?.refs) return;
    const idx = choice.refs.indexOf(ref);
    if (idx >= 0) toggleSelected(idx);
  };

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
    <div className="board-shell" ref={containerRef}>
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

      {!choice && !prompt?.message && (
        <PointerBar
          pointers={state.pointers}
          dismissedIds={dismissedPointerIds}
          onDismiss={(id) => setDismissedPointerIds((prev) => new Set(prev).add(id))}
        />
      )}

      {opponent && (
        <PlayerZone
          player={opponent}
          faceDownHand
          targetableRefs={targetableRefs}
          onEntityClick={onEntityClick}
          onEntityFallbackClick={choice ? undefined : (ref) => runAction(() => api.selectEntity(ref))}
          registerElementRef={registerElementRef}
          onInfoClick={setDetailCardName}
        />
      )}

      <StackRail items={state.stack} registerElementRef={registerElementRef} />

      {human && (
        <PlayerZone
          player={human}
          faceDownHand={false}
          onHandClick={choice ? undefined : (index) => runAction(() => api.playCard(index))}
          onBattlefieldClick={choice ? undefined : (index) => runAction(() => api.tapLand(index))}
          targetableRefs={targetableRefs}
          onEntityClick={onEntityClick}
          onEntityFallbackClick={choice ? undefined : (ref) => runAction(() => api.selectEntity(ref))}
          registerElementRef={registerElementRef}
          onInfoClick={setDetailCardName}
        />
      )}

      {choice && (
        <ChoicePanel
          choice={choice}
          onResolve={resolveChoice}
          selected={selected}
          onToggle={toggleSelected}
          boardIsPicker={boardIsPicker}
        />
      )}

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

      {arrows.length > 0 && (
        <svg className="targeting-arrows">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--gold)" />
            </marker>
          </defs>
          {arrows.map((a, i) => (
            <line
              key={i}
              x1={a.x1}
              y1={a.y1}
              x2={a.x2}
              y2={a.y2}
              stroke="var(--gold)"
              strokeWidth={2}
              strokeDasharray={a.dashed ? '6 5' : undefined}
              markerEnd="url(#arrowhead)"
            />
          ))}
        </svg>
      )}

      {detailCardName && (
        <CardDetailModal cardName={detailCardName} onClose={() => setDetailCardName(null)} />
      )}
    </div>
  );
}
