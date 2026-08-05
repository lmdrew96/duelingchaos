import { verifyToken } from '@clerk/backend';
import * as http from 'http';

// Saved decks are the only thing gated behind sign-in (see the "Auth and
// DB" ChaosPatch scoping decision) — presets, card search, and the game
// engine itself all stay open. Returns null on any missing/invalid/expired
// token rather than throwing, so callers can treat "not signed in" and
// "bad token" the same way (401).
export async function getUserId(req: http.IncomingMessage): Promise<string | null> {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : null;
  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    const payload = await verifyToken(token, { secretKey });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
