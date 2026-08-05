import { useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { CardInfo, DeckCard, DecksList, Legality } from './types';
import { ManaPips } from './manaCost';
import { CardArt } from './CardArt';
import { DecoCorners } from './DecoCorner';
import './Deckbuilder.css';

export default function Deckbuilder() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CardInfo[]>([]);

  const [deckName, setDeckName] = useState('');
  const [deckCards, setDeckCards] = useState<DeckCard[]>([]);

  const [formats, setFormats] = useState<string[]>([]);
  const [format, setFormat] = useState('Standard');
  const [legality, setLegality] = useState<Legality | null>(null);

  const [decksList, setDecksList] = useState<DecksList>({ presets: [], saved: [] });
  const [loadFilter, setLoadFilter] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshDecksList = () => {
    api.listDecks().then(setDecksList).catch(() => undefined);
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
    const handle = setTimeout(() => {
      const requestId = ++searchRequestId.current;
      api.searchCards(searchQuery, 40).then((results) => {
        if (requestId === searchRequestId.current) setSearchResults(results);
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

  const deckSize = deckCards.reduce((sum, c) => sum + c.count, 0);

  const addCard = (name: string) => {
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
    await api.saveDeck(deckName.trim(), deckCards);
    setStatusMessage(`Saved "${deckName.trim()}".`);
    refreshDecksList();
  };

  const handleLoad = async (source: 'preset' | 'saved', name: string) => {
    const deck = await api.getDeck(source, name);
    setDeckName(deck.name);
    setDeckCards(deck.cards);
    setStatusMessage(`Loaded "${deck.name}" (${source}).`);
  };

  const handleDelete = async (name: string, event: React.MouseEvent) => {
    event.stopPropagation();
    await api.deleteDeck(name);
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
        <h1>DuelingChaos — Deckbuilder</h1>
        <span className="subtitle">{deckSize} cards in deck</span>
      </header>

      <div className="layout">
        <section className="panel">
          <DecoCorners />
          <h2>Card search</h2>
          <input
            className="search-input"
            type="text"
            placeholder="Search by name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="card-list">
            {searchResults.map((card) => (
              <div className="card-row" key={card.name} onClick={() => addCard(card.name)}>
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
            {searchResults.length === 0 && (
              <p className="empty-hint">No cards found.</p>
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
            <button onClick={handleSave} disabled={!deckName.trim() || deckCards.length === 0}>
              Save
            </button>
            <button className="ghost" onClick={startNewDeck}>
              New deck
            </button>
          </div>
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
