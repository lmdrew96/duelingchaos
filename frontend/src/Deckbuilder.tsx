import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import * as api from './api';
import type { CardInfo, DeckCard, DecksList, Legality } from './types';
import { ManaPips, manaValue } from './manaCost';
import { CardArt } from './CardArt';
import { CardHoverPreview } from './CardHoverPreview';
import { DecoCorners } from './DecoCorner';
import { DecoRule } from './DecoRule';
import { DeckStats } from './DeckStats';
import './Deckbuilder.css';

const CURVE_BUCKETS = 8; // 0,1,2,3,4,5,6,7+

// Display order for grouped deck-list headers — mirrors the convention most
// deckbuilders use (creatures/planeswalkers first, lands last), not
// alphabetical. A hybrid type like "Artifact Creature" lands under Creature
// since that's the card's functional role; 'Other' (e.g. no type resolved
// yet) always sorts last.
const CARD_TYPE_GROUPS = [
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
] as const;

function cardTypeGroup(typeLine: string | undefined): string {
  if (!typeLine) return 'Other';
  for (const t of CARD_TYPE_GROUPS) {
    if (typeLine.includes(t)) return t;
  }
  return 'Other';
}

type DeckSortMode = 'alpha' | 'cmc';

function groupDeckCards(
  cards: DeckCard[],
  cardInfoCache: Record<string, CardInfo>,
  sortMode: DeckSortMode,
): { group: string; cards: DeckCard[] }[] {
  const buckets = new Map<string, DeckCard[]>();
  for (const c of cards) {
    const group = cardTypeGroup(cardInfoCache[c.name]?.type);
    (buckets.get(group) ?? buckets.set(group, []).get(group)!).push(c);
  }
  const result: { group: string; cards: DeckCard[] }[] = [];
  for (const group of [...CARD_TYPE_GROUPS, 'Other']) {
    const list = buckets.get(group);
    if (!list || list.length === 0) continue;
    const sorted = [...list].sort((a, b) => {
      if (sortMode === 'cmc') {
        const cmcA = manaValue(cardInfoCache[a.name]?.manaCost ?? '');
        const cmcB = manaValue(cardInfoCache[b.name]?.manaCost ?? '');
        if (cmcA !== cmcB) return cmcA - cmcB;
      }
      return a.name.localeCompare(b.name);
    });
    result.push({ group, cards: sorted });
  }
  return result;
}

// Only saved-deck CRUD needs a Clerk session (see src/api.ts /
// src/db.ts) — everything else (search, presets, legality) stays open.
// useAuth() throws outside a ClerkProvider, so the hook only ever runs in
// DeckbuilderWithAuth, which only mounts when a publishable key exists;
// without one, DeckbuilderCore gets a no-op token getter and just shows
// zero saved decks (the backend already returns saved:[] for an
// unauthenticated /decks/list, so this reuses that path instead of a
// separate empty state).
const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

type DeckbuilderProps = {
  // The saved deck to auto-load on mount — reflects /build/:deckName so a
  // refresh or a shared link lands back on the same deck instead of blank.
  deckName?: string;
  // Fired whenever a saved deck becomes "the current one" (loaded or just
  // saved), so the caller can sync the URL to it.
  onDeckSelected?: (name: string) => void;
};

export default function Deckbuilder({ deckName, onDeckSelected }: DeckbuilderProps) {
  return CLERK_ENABLED ? (
    <DeckbuilderWithAuth deckName={deckName} onDeckSelected={onDeckSelected} />
  ) : (
    <DeckbuilderCore getToken={async () => null} isSignedIn={false} deckName={deckName} onDeckSelected={onDeckSelected} />
  );
}

function DeckbuilderWithAuth({ deckName, onDeckSelected }: DeckbuilderProps) {
  const { getToken, isSignedIn } = useAuth();
  return (
    <DeckbuilderCore getToken={getToken} isSignedIn={!!isSignedIn} deckName={deckName} onDeckSelected={onDeckSelected} />
  );
}

function DeckbuilderCore({
  getToken,
  isSignedIn,
  deckName: initialDeckName,
  onDeckSelected,
}: {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
} & DeckbuilderProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CardInfo[]>([]);
  const [searchTruncated, setSearchTruncated] = useState(false);

  const [deckName, setDeckName] = useState('');
  const [deckCards, setDeckCards] = useState<DeckCard[]>([]);
  // Full CardInfo per deck card, keyed by name — DeckCard only carries
  // {name, count}, so mana curve/color stats need this backfilled. Cards
  // added from a search result are cached immediately (addCard receives
  // the CardInfo it was clicked from); cards from a loaded deck (names
  // only) are backfilled by the resolve effect below.
  const [cardInfoCache, setCardInfoCache] = useState<Record<string, CardInfo>>({});

  const [formats, setFormats] = useState<string[]>([]);
  const [format, setFormat] = useState('Standard');
  const [legality, setLegality] = useState<Legality | null>(null);

  const [decksList, setDecksList] = useState<DecksList>({ presets: [], saved: [], presetFormats: {}, savedFormats: {} });
  const [loadFilter, setLoadFilter] = useState('');
  const [sortMode, setSortMode] = useState<DeckSortMode>('alpha');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [hoverCard, setHoverCard] = useState<{ name: string; el: HTMLElement } | null>(null);

  const refreshDecksList = () => {
    getToken()
      .then((token) => api.listDecks(token))
      .then(setDecksList)
      .catch(() => undefined);
  };

  useEffect(() => {
    api.listFormats().then((f) => {
      setFormats(f);
      if (f.length > 0 && !f.includes(format)) setFormat(f[0]);
    });
    refreshDecksList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The debounce timer alone can't prevent every race — a slow response to
  // an older query can still land after a faster response to a newer one.
  // requestId guards against that: only the most recently *fired* search
  // is allowed to write its results.
  const searchRequestId = useRef(0);
  useEffect(() => {
    // An empty query matches every card in Forge's database (tens of
    // thousands of entries) — searching only once the user has typed
    // something avoids firing that worst case on every page load.
    if (searchQuery.trim() === '') {
      searchRequestId.current++;
      setSearchResults([]);
      setSearchTruncated(false);
      return;
    }
    const handle = setTimeout(() => {
      const requestId = ++searchRequestId.current;
      api.searchCards(searchQuery).then(({ cards, truncated }) => {
        if (requestId === searchRequestId.current) {
          setSearchResults(cards);
          setSearchTruncated(truncated);
        }
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    if (deckCards.length === 0) {
      setLegality(null);
      return;
    }
    const handle = setTimeout(() => {
      api.checkLegality(format, deckCards).then(setLegality);
    }, 250);
    return () => clearTimeout(handle);
  }, [deckCards, format]);

  // Backfills cardInfoCache for deck cards that arrived without it (loaded
  // decks only carry names/counts) — mirrors the legality-check debounce
  // below so rapid deck edits don't fire a resolve per keystroke/click.
  useEffect(() => {
    const missing = Array.from(new Set(deckCards.map((c) => c.name))).filter((n) => !cardInfoCache[n]);
    if (missing.length === 0) return;
    const handle = setTimeout(() => {
      Promise.all(missing.map((n) => api.getCardDetail(n))).then((results) => {
        setCardInfoCache((prev) => {
          const next = { ...prev };
          results.forEach((info, i) => {
            if (info) next[missing[i]] = info;
          });
          return next;
        });
      });
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckCards, cardInfoCache]);

  // A search re-query or deck edit can unmount the row currently under the
  // cursor without ever firing onMouseLeave — drop the stale hover if its
  // anchor is no longer in the document, or CardHoverPreview reads a zeroed
  // rect from the dead node (same guard as Board's own hover state).
  useEffect(() => {
    setHoverCard((prev) => (prev && !document.contains(prev.el) ? null : prev));
  }, [searchResults, deckCards]);

  // Sideboard cards aren't part of the deck actually being played.
  const deckSize = deckCards.filter((c) => c.section !== 'sideboard').reduce((sum, c) => sum + c.count, 0);

  // Lets the search results list show "already in this deck" counts without
  // an O(results × deckCards) scan per render.
  const deckCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of deckCards) counts[c.name] = c.count;
    return counts;
  }, [deckCards]);

  const commanderCard = deckCards.find((c) => c.section === 'commander');
  const mainCards = deckCards.filter((c) => !c.section);
  const sideboardCards = deckCards.filter((c) => c.section === 'sideboard');

  // Commander color identity — every card's identity must be a subset of
  // this once a commander is set, per the format rule (not just its cast
  // cost color; identity includes ability-text/hybrid mana symbols, see
  // CardInfo.colorIdentity). Null (no commander) means no restriction.
  const commanderIdentity = commanderCard ? cardInfoCache[commanderCard.name]?.colorIdentity ?? null : null;
  const withinCommanderIdentity = (colorIdentity: string) =>
    commanderIdentity == null || [...colorIdentity].every((c) => commanderIdentity.includes(c));
  const visibleSearchResults = searchResults.filter((c) => withinCommanderIdentity(c.colorIdentity));

  const manaCurve = useMemo(() => {
    const buckets = new Array(CURVE_BUCKETS).fill(0);
    for (const dc of deckCards) {
      if (dc.section === 'sideboard') continue;
      const info = cardInfoCache[dc.name];
      if (!info || info.type.includes('Land')) continue;
      buckets[Math.min(manaValue(info.manaCost), CURVE_BUCKETS - 1)] += dc.count;
    }
    return buckets;
  }, [deckCards, cardInfoCache]);

  const colorCounts = useMemo(() => {
    const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    for (const dc of deckCards) {
      if (dc.section === 'sideboard') continue;
      const info = cardInfoCache[dc.name];
      if (!info || info.type.includes('Land')) continue;
      if (!info.colors) {
        counts.C += dc.count;
        continue;
      }
      for (const ch of info.colors) {
        if (ch in counts) counts[ch] += dc.count;
      }
    }
    return counts;
  }, [deckCards, cardInfoCache]);

  const addCard = (name: string, info?: CardInfo) => {
    // Defensive re-check against a stale/not-yet-loaded commanderIdentity —
    // the search list itself is already filtered (see visibleSearchResults),
    // this just covers the brief window before the commander's own
    // colorIdentity has resolved into cardInfoCache.
    if (info && !withinCommanderIdentity(info.colorIdentity)) return;
    if (info) setCardInfoCache((prev) => ({ ...prev, [name]: info }));
    setDeckCards((prev) => {
      const existing = prev.find((c) => c.name === name);
      if (existing) {
        return prev.map((c) => (c.name === name ? { ...c, count: c.count + 1 } : c));
      }
      return [...prev, { name, count: 1 }];
    });
  };

  const adjustCount = (name: string, delta: number) => {
    setDeckCards((prev) =>
      prev
        .map((c) => (c.name === name ? { ...c, count: c.count + delta } : c))
        .filter((c) => c.count > 0),
    );
  };

  const removeCard = (name: string) => {
    setDeckCards((prev) => prev.filter((c) => c.name !== name));
  };

  // Only one commander at a time — assigning a new one clears the old.
  // Commander is always a singleton, so the count is pinned to 1.
  const setCommander = (name: string) => {
    setDeckCards((prev) =>
      prev.map((c) => {
        if (c.name === name) {
          return c.section === 'commander' ? { ...c, section: undefined } : { ...c, section: 'commander', count: 1 };
        }
        return c.section === 'commander' ? { ...c, section: undefined } : c;
      }),
    );
  };

  const toggleSideboard = (name: string) => {
    setDeckCards((prev) =>
      prev.map((c) => (c.name === name ? { ...c, section: c.section === 'sideboard' ? undefined : 'sideboard' } : c)),
    );
  };

  const startNewDeck = () => {
    setDeckName('');
    setDeckCards([]);
    setStatusMessage(null);
  };

  const handleSave = async () => {
    if (!deckName.trim() || deckCards.length === 0) return;
    const token = await getToken();
    if (!token) {
      setStatusMessage('Sign in to save decks.');
      return;
    }
    await api.saveDeck(deckName.trim(), deckCards, format, token);
    setStatusMessage(`Saved "${deckName.trim()}".`);
    refreshDecksList();
    onDeckSelected?.(deckName.trim());
  };

  const handleLoad = async (source: 'preset' | 'saved', name: string) => {
    const token = source === 'saved' ? await getToken() : null;
    const deck = await api.getDeck(source, name, token);
    setDeckName(deck.name);
    setDeckCards(deck.cards);
    // Presets carry no format of their own — only restore it when the saved
    // deck's format is still a real option in the current format list.
    if (deck.format && formats.includes(deck.format)) setFormat(deck.format);
    setStatusMessage(`Loaded "${deck.name}" (${source}).`);
    if (source === 'saved') onDeckSelected?.(deck.name);
  };

  // Reflects /build/:deckName — auto-loads once a Clerk session is actually
  // established (getSavedDeck 401s without one). Re-runs if the URL's deck
  // name changes out from under a mounted Deckbuilder (browser back/forward
  // between two previously-visited decks); a no-op deps change (isSignedIn
  // flipping true on initial auth resolution) just re-loads the same deck.
  useEffect(() => {
    if (!initialDeckName || !isSignedIn) return;
    handleLoad('saved', initialDeckName).catch(() =>
      setStatusMessage(`Could not load "${initialDeckName}".`),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDeckName, isSignedIn]);

  const handleDelete = async (name: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    const token = await getToken();
    if (!token) return;
    await api.deleteDeck(name, token);
    refreshDecksList();
    setStatusMessage(`Deleted "${name}".`);
  };

  const renderDeckRow = (c: DeckCard) => (
    <div
      className="deck-row"
      key={c.name}
      onMouseEnter={(e) => setHoverCard({ name: c.name, el: e.currentTarget })}
      onMouseLeave={() => setHoverCard(null)}
    >
      <CardArt name={c.name} variant="crop" className="deck-row-art" />
      <span className="deck-row-name">{c.name}</span>
      <div className="count-controls">
        <button onClick={() => adjustCount(c.name, -1)}>−</button>
        <span className="count-value">{c.count}</span>
        <button onClick={() => adjustCount(c.name, 1)}>+</button>
        <button className="ghost" onClick={() => removeCard(c.name)}>
          ✕
        </button>
      </div>
      <div className="assign-controls">
        <button
          className={`ghost assign-btn${c.section === 'commander' ? ' active' : ''}`}
          onClick={() => setCommander(c.name)}
          title="Set as commander"
        >
          CMDR
        </button>
        <button
          className={`ghost assign-btn${c.section === 'sideboard' ? ' active' : ''}`}
          onClick={() => toggleSideboard(c.name)}
          title="Move to side deck"
        >
          SB
        </button>
      </div>
    </div>
  );

  const renderDeckGroups = (cards: DeckCard[], sectionKey: string) =>
    groupDeckCards(cards, cardInfoCache, sortMode).map(({ group, cards: groupCards }) => {
      const key = `${sectionKey}:${group}`;
      const collapsed = collapsedGroups.has(key);
      const count = groupCards.reduce((s, c) => s + c.count, 0);
      return (
        <div className="deck-group" key={key}>
          <div
            className="deck-group-header"
            role="button"
            tabIndex={0}
            onClick={() => toggleGroup(key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleGroup(key);
              }
            }}
          >
            <span className={`deck-group-caret${collapsed ? ' collapsed' : ''}`}>▾</span>
            {group} ({count})
          </div>
          {!collapsed && groupCards.map(renderDeckRow)}
        </div>
      );
    });

  const filteredPresets = decksList.presets.filter((n) =>
    n.toLowerCase().includes(loadFilter.toLowerCase()),
  );
  const filteredSaved = decksList.saved.filter((n) =>
    n.toLowerCase().includes(loadFilter.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <h1>DuelingChaos — Deckbuilder</h1>
          <span className="subtitle">{deckSize} cards in deck</span>
        </div>
        <DecoRule />
      </header>

      <div className="layout">
        <section className="panel">
          <DecoCorners />
          <h2>Card search</h2>
          <input
            className="search-input"
            type="text"
            placeholder="Search by name, or syntax: t:creature c:rg mv>=3 o:&quot;draw a card&quot;…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {commanderCard && (
            <p className="empty-hint">
              Filtered to {commanderCard.name}'s color identity
              {commanderIdentity ? ` (${commanderIdentity})` : ' (colorless)'}.
            </p>
          )}
          <div className="card-list">
            {visibleSearchResults.map((card) => (
              <div
                className="card-row"
                key={card.name}
                onClick={() => addCard(card.name, card)}
                onMouseEnter={(e) => setHoverCard({ name: card.name, el: e.currentTarget })}
                onMouseLeave={() => setHoverCard(null)}
              >
                <CardArt name={card.name} variant="crop" className="card-row-art" />
                <div className="card-row-main">
                  <div className="card-name">
                    {card.name}
                    {deckCounts[card.name] > 0 && (
                      <span className="in-deck-badge">×{deckCounts[card.name]}</span>
                    )}
                  </div>
                  <div className="card-meta">
                    {card.type}
                    {card.power != null ? ` — ${card.power}/${card.toughness}` : ''}
                  </div>
                  <div className="card-oracle">{card.oracleText}</div>
                </div>
                <ManaPips cost={card.manaCost} size="md" />
              </div>
            ))}
            {searchResults.length === 0 && searchQuery.trim() !== '' && (
              <p className="empty-hint">No cards found.</p>
            )}
            {searchResults.length === 0 && searchQuery.trim() === '' && (
              <p className="empty-hint">Type a card name or search syntax to begin.</p>
            )}
            {searchResults.length > 0 && visibleSearchResults.length === 0 && (
              <p className="empty-hint">No matches fit {commanderCard!.name}'s color identity.</p>
            )}
            {searchTruncated && (
              <p className="empty-hint">Showing first {searchResults.length} matches — refine your search to see more.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <DecoCorners />
          <div className="deck-header">
            <h2>{deckName || 'Untitled deck'}</h2>
            <span className="deck-size">{deckSize}</span>
          </div>
          <div className="deck-sort-toggle">
            <span className="field-label">Sort</span>
            <button
              type="button"
              className={`ghost sort-btn${sortMode === 'alpha' ? ' active' : ''}`}
              onClick={() => setSortMode('alpha')}
            >
              A–Z
            </button>
            <button
              type="button"
              className={`ghost sort-btn${sortMode === 'cmc' ? ' active' : ''}`}
              onClick={() => setSortMode('cmc')}
            >
              Mana value
            </button>
          </div>
          <div className="deck-list">
            {commanderCard && (
              <>
                <p className="deck-section-header">Commander</p>
                {renderDeckRow(commanderCard)}
              </>
            )}
            <p className="deck-section-header">Main deck ({mainCards.reduce((s, c) => s + c.count, 0)})</p>
            {renderDeckGroups(mainCards, 'main')}
            {mainCards.length === 0 && !commanderCard && (
              <p className="empty-hint">Search for cards or load a deck to get started.</p>
            )}
            {sideboardCards.length > 0 && (
              <>
                <p className="deck-section-header">
                  Side deck ({sideboardCards.reduce((s, c) => s + c.count, 0)})
                </p>
                {renderDeckGroups(sideboardCards, 'side')}
              </>
            )}
          </div>

          {deckCards.length > 0 && <DeckStats manaCurve={manaCurve} colorCounts={colorCounts} />}
        </section>

        <section className="panel">
          <DecoCorners />
          <h2>Format &amp; legality</h2>
          <select
            className="format-select"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          {legality && (
            <>
              <span className={`legality-badge ${legality.legal ? 'legality-legal' : 'legality-illegal'}`}>
                {legality.legal ? 'Legal' : 'Not legal'}
              </span>
              {legality.structuralProblem && (
                <p className="legality-problem">{legality.structuralProblem}</p>
              )}
              {legality.banlistProblem && (
                <p className="legality-problem">{legality.banlistProblem}</p>
              )}
            </>
          )}

          <h2 style={{ marginTop: 20 }}>Save deck</h2>
          <label className="field-label" htmlFor="deck-name">
            Deck name
          </label>
          <input
            id="deck-name"
            className="deck-name-input"
            type="text"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
          />
          <div className="save-row">
            <button onClick={handleSave} disabled={!deckName.trim() || deckCards.length === 0 || !isSignedIn}>
              Save
            </button>
            <button className="ghost" onClick={startNewDeck}>
              New deck
            </button>
          </div>
          {!isSignedIn && <p className="status-message">Sign in to save decks.</p>}
          {statusMessage && <p className="status-message">{statusMessage}</p>}

          <div className="load-section">
            <h2>Load a deck</h2>
            <input
              className="load-filter"
              type="text"
              placeholder="Filter presets & saved…"
              value={loadFilter}
              onChange={(e) => setLoadFilter(e.target.value)}
            />
            <p className="field-label">Saved ({filteredSaved.length})</p>
            <div className="load-list">
              {filteredSaved.map((name) => (
                <div className="load-item" key={name} onClick={() => handleLoad('saved', name)}>
                  <span>{name}</span>
                  <button className="delete-btn" onClick={(e) => handleDelete(name, e)}>
                    delete
                  </button>
                </div>
              ))}
            </div>
            <p className="field-label" style={{ marginTop: 12 }}>
              Presets ({filteredPresets.length})
            </p>
            <div className="load-list">
              {filteredPresets.slice(0, 100).map((name) => (
                <div className="load-item" key={name} onClick={() => handleLoad('preset', name)}>
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {hoverCard && <CardHoverPreview name={hoverCard.name} anchor={hoverCard.el} />}
    </div>
  );
}
