import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as api from './api';
import type { BoardCard, CardInfo, EntityRef, GameState, PendingChoice, PlayerState, PointerInfo, StackItem } from './types';
import { ManaPips } from './manaCost';
import { CardArt } from './CardArt';
import { DecoCorners } from './DecoCorner';
import { DecoCrown } from './DecoCrown';
import { DecoRule } from './DecoRule';
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

// A triple-line hex ring with diamond finials at each vertex — the
// reference deco kit's signature is concentric strokes + diamond ticks,
// not a single flat-filled shape. The opponent's badge stays flat/muted
// (no gradient, no glow) so the active player's own life total keeps the
// visual weight.
const HEX_OUTER: [number, number][] = [
  [25, 0],
  [75, 0],
  [100, 50],
  [75, 100],
  [25, 100],
  [0, 50],
];
const HEX_MID: [number, number][] = HEX_OUTER.map(([x, y]) => [50 + (x - 50) * 0.82, 50 + (y - 50) * 0.82]);
const HEX_INNER: [number, number][] = HEX_OUTER.map(([x, y]) => [50 + (x - 50) * 0.64, 50 + (y - 50) * 0.64]);
const toPoints = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(' ');

function LifeBadgeOrnament({ opponent }: { opponent?: boolean }) {
  const color = opponent ? 'var(--blue-muted)' : 'url(#gold-gradient)';
  return (
    <svg viewBox="0 0 100 100" className={`life-badge-svg${opponent ? '' : ' glow'}`} aria-hidden>
      <polygon points={toPoints(HEX_OUTER)} fill="none" stroke={color} strokeWidth={3} />
      <polygon points={toPoints(HEX_MID)} fill="none" stroke={color} strokeWidth={1.5} opacity={0.7} />
      <polygon points={toPoints(HEX_INNER)} fill="none" stroke={color} strokeWidth={1} opacity={0.45} />
      {HEX_OUTER.map(([x, y], i) => (
        <rect key={i} x={x - 3} y={y - 3} width={6} height={6} fill={color} transform={`rotate(45 ${x} ${y})`} />
      ))}
    </svg>
  );
}

function CardTile({
  card,
  index,
  onClick,
  targetable,
  registerRef,
  onInfoClick,
  onHoverStart,
  onHoverEnd,
  attacking,
  blocking,
}: {
  card: BoardCard;
  index: number;
  onClick?: (index: number) => void;
  targetable?: boolean;
  registerRef?: (el: HTMLElement | null) => void;
  onInfoClick?: (name: string) => void;
  onHoverStart?: (name: string, el: HTMLElement) => void;
  onHoverEnd?: () => void;
  attacking?: boolean;
  blocking?: boolean;
}) {
  const showPT = card.power !== 0 || card.toughness !== 0;
  return (
    <div
      ref={registerRef}
      className={`card-tile${card.tapped ? ' tapped' : ''}${onClick ? ' clickable' : ''}${targetable ? ' targetable' : ''}${attacking ? ' attacking' : ''}${blocking ? ' blocking' : ''}`}
      onClick={onClick ? () => onClick(index) : undefined}
      onMouseEnter={onHoverStart ? (e) => onHoverStart(card.name, e.currentTarget) : undefined}
      onMouseLeave={onHoverEnd}
    >
      <CardArt name={card.name} variant="crop" className="card-tile-art" />
      <div className="card-tile-scrim" />
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
      {(attacking || blocking) && (
        <span className={`card-tile-combat-badge${attacking ? ' attacking' : ' blocking'}`}>
          {attacking ? 'ATK' : 'BLK'}
        </span>
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
  onHoverStart,
  onHoverEnd,
  onGraveyardClick,
  attackingRefs,
  blockingRefs,
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
  onHoverStart?: (name: string, el: HTMLElement) => void;
  onHoverEnd?: () => void;
  onGraveyardClick?: () => void;
  attackingRefs?: Set<EntityRef>;
  blockingRefs?: Set<EntityRef>;
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
          {/* Graveyard is public info in real MTG (unlike the library), so
              it's browsable — clicking opens the actual card list. */}
          <button
            type="button"
            className="zone-count-btn"
            disabled={player.graveyard.length === 0 || !onGraveyardClick}
            onClick={onGraveyardClick}
          >
            graveyard {player.graveyard.length}
          </button>
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
                      onHoverStart={onHoverStart}
                      onHoverEnd={onHoverEnd}
                      attacking={attackingRefs?.has(ref) ?? false}
                      blocking={blockingRefs?.has(ref) ?? false}
                      key={ref}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <DecoRule />
      <div className="card-row">
        {faceDownHand ? (
          <CardBacks count={player.hand.length} />
        ) : (
          player.hand.map((c, i) => (
            <CardTile
              card={c}
              index={i}
              onClick={onHandClick}
              onInfoClick={onInfoClick}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
              key={`${c.name}-${i}`}
            />
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
        <DecoCrown />
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
        <DecoCrown />
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
      <DecoCrown />
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
        <DecoCrown />
        <button type="button" className="ghost card-detail-close" onClick={onClose}>
          close
        </button>
        {loading && <p className="choice-hint">Loading…</p>}
        {!loading && notFound && <p className="choice-hint">No card data found for "{cardName}".</p>}
        {!loading && detail && (
          <>
            <CardArt name={detail.name} variant="full" className="card-detail-art" />
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

// Desktop-hover companion to CardDetailModal's click-to-pin: floats the full
// card face beside the hovered tile so you can read it without leaving your
// place on the board. Positioned from the tile's own rect (not the cursor)
// so it doesn't jitter as the mouse moves within the tile, and clamped to
// the viewport since tiles near an edge would otherwise push it off-screen.
function CardHoverPreview({ name, anchor }: { name: string; anchor: HTMLElement }) {
  const rect = anchor.getBoundingClientRect();
  const width = 240;
  let left = rect.right + 12;
  if (left + width > window.innerWidth - 12) left = rect.left - width - 12;
  left = Math.max(12, left);
  const top = Math.min(Math.max(12, rect.top), window.innerHeight - 340);

  return (
    <div className="card-hover-preview" style={{ top, left, width }}>
      <CardArt name={name} variant="full" className="card-hover-preview-art" />
    </div>
  );
}

// Graveyards are public information in real MTG (unlike libraries), so this
// browses the actual cards rather than just showing a count. Reuses
// CardDetailModal for a selected card's full text instead of duplicating it.
function GraveyardModal({
  playerName,
  cards,
  onClose,
}: {
  playerName: string;
  cards: BoardCard[];
  onClose: () => void;
}) {
  const [detailCardName, setDetailCardName] = useState<string | null>(null);
  return (
    <div className="card-detail-backdrop" onClick={onClose}>
      <div className="card-detail-panel graveyard-panel" onClick={(e) => e.stopPropagation()}>
        <DecoCorners />
        <DecoCrown />
        <button type="button" className="ghost card-detail-close" onClick={onClose}>
          close
        </button>
        <p className="choice-title">
          {playerName}'s graveyard — {cards.length}
        </p>
        <div className="graveyard-grid">
          {cards.map((c, i) => (
            <button type="button" className="graveyard-card" key={`${c.name}-${i}`} onClick={() => setDetailCardName(c.name)}>
              <CardArt name={c.name} variant="crop" className="graveyard-card-art" />
              <span className="graveyard-card-name">{c.name}</span>
            </button>
          ))}
        </div>
      </div>
      {detailCardName && <CardDetailModal cardName={detailCardName} onClose={() => setDetailCardName(null)} />}
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

type Arrow = { x1: number; y1: number; x2: number; y2: number; dashed: boolean; kind: 'target' | 'attack' | 'block' };

function GameOverScreen({
  isDraw,
  winnerName,
  human,
  onExit,
}: {
  isDraw: boolean;
  winnerName: string | null;
  human?: PlayerState;
  onExit: () => void;
}) {
  const won = !isDraw && winnerName != null && human != null && winnerName === human.name;
  const headline = isDraw ? 'Draw' : won ? 'Victory' : 'Defeat';
  return (
    <div className="card-detail-backdrop">
      <div className="prompt-panel game-over-panel">
        <DecoCorners />
        <DecoCrown />
        <p className={`game-over-headline${won ? ' won' : isDraw ? '' : ' lost'}`}>{headline}</p>
        {!isDraw && winnerName && <p className="prompt-message">{winnerName} wins the game.</p>}
        <div className="prompt-buttons">
          <button onClick={onExit}>Back to deckbuilder</button>
        </div>
      </div>
    </div>
  );
}

export default function Board({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [detailCardName, setDetailCardName] = useState<string | null>(null);
  const [hoverCard, setHoverCard] = useState<{ name: string; el: HTMLElement } | null>(null);
  const [graveyardOwnerId, setGraveyardOwnerId] = useState<number | null>(null);
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

  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    api
      .fetchGameState()
      .then((s) => {
        setState(s);
        setError(null);
        // The bridge keeps the finished game view alive after gameOver, but
        // there's nothing left worth polling for — stop hitting the API
        // once the win/loss screen takes over.
        if (s.gameOver && pollHandle.current != null) {
          clearInterval(pollHandle.current);
          pollHandle.current = null;
        }
        // A board refresh can unmount the tile currently under the cursor
        // (e.g. a card changing zones) without ever firing onMouseLeave —
        // drop the stale hover if its anchor is no longer in the document,
        // or CardHoverPreview reads a zeroed rect from the dead node and
        // pins itself to the top-left corner instead of disappearing.
        setHoverCard((prev) => (prev && !document.contains(prev.el) ? null : prev));
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
    pollHandle.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (pollHandle.current != null) clearInterval(pollHandle.current);
    };
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
    const specs: { from: EntityRef; to: EntityRef; dashed: boolean; kind: Arrow['kind'] }[] = [];
    for (const item of state.stack) {
      if (!item.sourceRef) continue;
      for (const t of item.targetRefs) specs.push({ from: item.sourceRef, to: t, dashed: false, kind: 'target' });
    }
    const choice = state.pendingChoice;
    if (choice?.sourceRef && choice.refs && (choice.kind === 'target' || choice.kind === 'targets')) {
      for (const i of selected) {
        const ref = choice.refs[i];
        if (ref) specs.push({ from: choice.sourceRef, to: ref, dashed: true, kind: 'target' });
      }
    }
    if (state.combat) {
      for (const a of state.combat.attackers) {
        if (a.defenderRef) specs.push({ from: a.attackerRef, to: a.defenderRef, dashed: false, kind: 'attack' });
      }
      for (const b of state.combat.blocks) {
        specs.push({ from: b.blockerRef, to: b.attackerRef, dashed: false, kind: 'block' });
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
        kind: spec.kind,
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

  const attackingRefs = new Set<EntityRef>(state.combat?.attackers.map((a) => a.attackerRef) ?? []);
  const blockingRefs = new Set<EntityRef>(state.combat?.blocks.map((b) => b.blockerRef) ?? []);

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
          onHoverStart={(name, el) => setHoverCard({ name, el })}
          onHoverEnd={() => setHoverCard(null)}
          onGraveyardClick={() => setGraveyardOwnerId(opponent.id)}
          attackingRefs={attackingRefs}
          blockingRefs={blockingRefs}
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
          onHoverStart={(name, el) => setHoverCard({ name, el })}
          onHoverEnd={() => setHoverCard(null)}
          onGraveyardClick={() => setGraveyardOwnerId(human.id)}
          attackingRefs={attackingRefs}
          blockingRefs={blockingRefs}
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
        <DecoCrown />
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
            <marker id="arrowhead-target" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--gold)" />
            </marker>
            <marker id="arrowhead-attack" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--danger)" />
            </marker>
            <marker id="arrowhead-block" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--text-muted)" />
            </marker>
          </defs>
          {arrows.map((a, i) => (
            <line
              key={i}
              x1={a.x1}
              y1={a.y1}
              x2={a.x2}
              y2={a.y2}
              stroke={a.kind === 'attack' ? 'var(--danger)' : a.kind === 'block' ? 'var(--text-muted)' : 'var(--gold)'}
              strokeWidth={2}
              strokeDasharray={a.dashed ? '6 5' : undefined}
              markerEnd={`url(#arrowhead-${a.kind})`}
            />
          ))}
        </svg>
      )}

      {detailCardName && (
        <CardDetailModal cardName={detailCardName} onClose={() => setDetailCardName(null)} />
      )}

      {hoverCard && <CardHoverPreview name={hoverCard.name} anchor={hoverCard.el} />}

      {graveyardOwnerId != null &&
        (() => {
          const owner = state.players.find((p) => p.id === graveyardOwnerId);
          if (!owner) return null;
          return (
            <GraveyardModal playerName={owner.name} cards={owner.graveyard} onClose={() => setGraveyardOwnerId(null)} />
          );
        })()}

      {state.gameOver && (
        <GameOverScreen isDraw={state.isDraw} winnerName={state.winnerName} human={human} onExit={onExit} />
      )}
    </div>
  );
}
