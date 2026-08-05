import { neon } from '@neondatabase/serverless';

// Lazy — DATABASE_URL only needs to exist when a saved-deck route is
// actually hit, not for the game engine itself to start.
let sql: ReturnType<typeof neon> | null = null;

function getSql(): ReturnType<typeof neon> {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — saved decks require a Neon connection string');
  }
  sql = neon(url);
  return sql;
}

let schemaReady: Promise<void> | null = null;

// No migration framework needed at this size (see CLAUDE.md: match the fix
// to the problem). Re-run is idempotent.
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await getSql()`
        CREATE TABLE IF NOT EXISTS decks (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          cards JSONB NOT NULL,
          format TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (user_id, name)
        )
      `;
      // Existing decks tables predate the format column — ALTER is the only
      // way a table created before this patch picks it up (CREATE TABLE IF
      // NOT EXISTS above is a no-op once the table already exists).
      await getSql()`ALTER TABLE decks ADD COLUMN IF NOT EXISTS format TEXT`;
      await getSql()`
        CREATE TABLE IF NOT EXISTS match_results (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          deck_name TEXT NOT NULL,
          won BOOLEAN NOT NULL,
          is_draw BOOLEAN NOT NULL,
          played_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })();
  }
  return schemaReady;
}

// Undefined/omitted means 'main' — existing saved decks predate this field
// and load with no section at all.
export type StoredDeckCard = { name: string; count: number; section?: 'commander' | 'sideboard' };

export async function listSavedDeckNames(userId: string): Promise<string[]> {
  await ensureSchema();
  const rows = (await getSql()`
    SELECT name FROM decks WHERE user_id = ${userId} ORDER BY name
  `) as { name: string }[];
  return rows.map((r) => r.name);
}

export async function getSavedDeck(
  userId: string,
  name: string,
): Promise<{ name: string; cards: StoredDeckCard[]; format: string } | null> {
  await ensureSchema();
  const rows = (await getSql()`
    SELECT name, cards, format FROM decks WHERE user_id = ${userId} AND name = ${name}
  `) as { name: string; cards: StoredDeckCard[]; format: string | null }[];
  const row = rows[0];
  // Decks saved before this column existed have format = null — 'Standard'
  // matches the deckbuilder's own pre-load default (see Deckbuilder.tsx).
  return row ? { name: row.name, cards: row.cards, format: row.format ?? 'Standard' } : null;
}

export async function saveDeck(userId: string, name: string, cards: StoredDeckCard[], format: string): Promise<void> {
  await ensureSchema();
  await getSql()`
    INSERT INTO decks (user_id, name, cards, format, updated_at)
    VALUES (${userId}, ${name}, ${JSON.stringify(cards)}, ${format}, now())
    ON CONFLICT (user_id, name)
    DO UPDATE SET cards = EXCLUDED.cards, format = EXCLUDED.format, updated_at = now()
  `;
}

export async function deleteDeck(userId: string, name: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await getSql()`
    DELETE FROM decks WHERE user_id = ${userId} AND name = ${name} RETURNING id
  `) as { id: number }[];
  return rows.length > 0;
}

export async function recordMatchResult(
  userId: string,
  deckName: string,
  won: boolean,
  isDraw: boolean,
): Promise<void> {
  await ensureSchema();
  await getSql()`
    INSERT INTO match_results (user_id, deck_name, won, is_draw)
    VALUES (${userId}, ${deckName}, ${won}, ${isDraw})
  `;
}

export type MatchHistoryEntry = { deckName: string; won: boolean; isDraw: boolean; playedAt: string };
export type MatchStats = { wins: number; losses: number; draws: number; recent: MatchHistoryEntry[] };

export async function getMatchStats(userId: string): Promise<MatchStats> {
  await ensureSchema();
  const countRows = (await getSql()`
    SELECT
      COUNT(*) FILTER (WHERE is_draw) AS draws,
      COUNT(*) FILTER (WHERE won AND NOT is_draw) AS wins,
      COUNT(*) FILTER (WHERE NOT won AND NOT is_draw) AS losses
    FROM match_results WHERE user_id = ${userId}
  `) as { wins: string; losses: string; draws: string }[];
  const recentRows = (await getSql()`
    SELECT deck_name, won, is_draw, played_at FROM match_results
    WHERE user_id = ${userId} ORDER BY played_at DESC LIMIT 10
  `) as { deck_name: string; won: boolean; is_draw: boolean; played_at: string }[];
  const counts = countRows[0];
  return {
    wins: Number(counts?.wins ?? 0),
    losses: Number(counts?.losses ?? 0),
    draws: Number(counts?.draws ?? 0),
    recent: recentRows.map((r) => ({ deckName: r.deck_name, won: r.won, isDraw: r.is_draw, playedAt: r.played_at })),
  };
}
