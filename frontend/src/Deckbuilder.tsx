import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import * as api from './api';
import type { CardInfo, DeckCard, DecksList, Legality } from './types';
import { ManaPips, manaValue } from './manaCost';
import { CardArt } from './CardArt';
import { DecoCorners } from './DecoCorner';
import { DecoRule } from './DecoRule';
import { DeckStats } from './DeckStats';
import './Deckbuilder.css';

const CURVE_BUCKETS = 8; // 0,1,2,3,4,5,6,7+

// Only saved-deck CRUD needs a Clerk session (see src/api.ts /
// src/db.ts) — everything else (search, presets, legality) stays open.
// useAuth() throws outside a ClerkProvider, so the hook only ever runs in
// DeckbuilderWithAuth, which only mounts when a publishable key exists;
// without one, DeckbuilderCore gets a no-op token getter and just shows
// zero saved decks (the backend already returns saved:[] for an
// unauthenticated /decks/list, so this reuses that path instead of a
// separate empty state).
const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export default function Deckbuilder() {
  return CLERK_ENABLED ? (
    <DeckbuilderWithAuth />
  ) : (
    <DeckbuilderCore getToken={async () => null} isSignedIn={false} />
  );
}

function DeckbuilderWithAuth() {
  const { getToken, isSignedIn } = useAuth();
  return <DeckbuilderCore getToken={getToken} isSignedIn={!!isSignedIn} />;
}

function DeckbuilderCore({
  getToken,
  isSignedIn,
}: {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
}) {
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

  const [decksList, setDecksList] = useState<DecksList>({ presets: [], saved: [] });
  const [loadFilter, setLoadFilter] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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

  const deckSize = deckCards.reduce((sum, c) => sum + c.count, 0);

  const manaCurve = useMemo(() => {
    const buckets = new Array(CURVE_BUCKETS).fill(0);
    for (const dc of deckCards) {
      const info = cardInfoCache[dc.name];
      if (!info || info.type.includes('Land')) continue;
      buckets[Math.min(manaValue(info.manaCost), CURVE_BUCKETS - 1)] += dc.count;
    }
    return buckets;
  }, [deckCards, cardInfoCache]);

  const colorCounts = useMemo(() => {
    const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    for (const dc of deckCards) {
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
    await api.saveDeck(deckName.trim(), deckCards, token);
    setStatusMessage(`Saved "${deckName.trim()}".`);
    refreshDecksList();
  };

  const handleLoad = async (source: 'preset' | 'saved', name: string) => {
    const token = source === 'saved' ? await getToken() : null;
    const deck = await api.getDeck(source, name, token);
    setDeckName(deck.name);
    setDeckCards(deck.cards);
    setStatusMessage(`Loaded "${deck.name}" (${source}).`);
  };

  const handleDelete = async (name: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const token = await getToken();
    if (!token) return;
    await api.deleteDeck(name, token);
    refreshDecksList();
    setStatusMessage(`Deleted "${name}".`);
  };

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
          <div className="card-list">
            {searchResults.map((card) => (
              <div className="card-row" key={card.name} onClick={() => addCard(card.name, card)}>
                <CardArt name={card.name} variant="crop" className="card-row-art" />
                <div className="card-row-main">
                  <div className="card-name">{card.name}</div>
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
          <div className="deck-list">
            {deckCards.map((c) => (
              <div className="deck-row" key={c.name}>
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
              </div>
            ))}
            {deckCards.length === 0 && (
              <p className="empty-hint">Search for cards or load a deck to get started.</p>
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
    </div>
  );
}
