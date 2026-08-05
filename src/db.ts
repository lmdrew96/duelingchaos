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

// One-table schema — no migration framework needed at this size (see
// CLAUDE.md: match the fix to the problem). Re-run is idempotent.
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getSql()`
      CREATE TABLE IF NOT EXISTS decks (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cards JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, name)
      )
    `.then(() => undefined);
  }
  return schemaReady;
}

export type StoredDeckCard = { name: string; count: number };

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
): Promise<{ name: string; cards: StoredDeckCard[] } | null> {
  await ensureSchema();
  const rows = (await getSql()`
    SELECT name, cards FROM decks WHERE user_id = ${userId} AND name = ${name}
  `) as { name: string; cards: StoredDeckCard[] }[];
  const row = rows[0];
  return row ? { name: row.name, cards: row.cards } : null;
}

export async function saveDeck(userId: string, name: string, cards: StoredDeckCard[]): Promise<void> {
  await ensureSchema();
  await getSql()`
    INSERT INTO decks (user_id, name, cards, updated_at)
    VALUES (${userId}, ${name}, ${JSON.stringify(cards)}, now())
    ON CONFLICT (user_id, name)
    DO UPDATE SET cards = EXCLUDED.cards, updated_at = now()
  `;
}

export async function deleteDeck(userId: string, name: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await getSql()`
    DELETE FROM decks WHERE user_id = ${userId} AND name = ${name} RETURNING id
  `) as { id: number }[];
  return rows.length > 0;
}
