import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from './db.ts';

/**
 * Session handling.
 *
 * Two modes, chosen by whether GitHub OAuth credentials are configured:
 *
 *  - **GitHub OAuth** (`GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` set) — the intended
 *    production path. `/api/auth/github` starts it, `/api/auth/github/callback` finishes it.
 *  - **Local mode** (nothing set) — a single local user, so the app runs with no external
 *    service. Every ownership check below still runs, so the multi-tenant paths are exercised.
 *
 * The cookie holds `userId.signature`; the signature is HMAC-SHA256 over the id with
 * `AUTH_SECRET`. No user data and nothing sensitive is stored client-side.
 */

const COOKIE = 'agent_spawner_session';
const LOCAL_EMAIL = 'local@agent-spawner.dev';

export function oauthConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error('AUTH_SECRET is not set');
  return value;
}

export function signSession(userId: string): string {
  const signature = createHmac('sha256', secret()).update(userId).digest('base64url');
  return `${userId}.${signature}`;
}

function verifySession(token: string): string | null {
  const index = token.lastIndexOf('.');
  if (index <= 0) return null;
  const userId = token.slice(0, index);
  const provided = Buffer.from(token.slice(index + 1));
  const expected = Buffer.from(createHmac('sha256', secret()).update(userId).digest('base64url'));
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? userId : null;
}

export type SessionUser = { id: string; email: string; name: string; avatarUrl: string };

/** The signed-in user, creating the local one on first run when OAuth is not configured. */
export async function currentUser(): Promise<SessionUser> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;

  if (token) {
    const userId = verifySession(token);
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) return user;
    }
  }

  if (oauthConfigured()) {
    throw new AuthRequiredError();
  }

  const local = await prisma.user.upsert({
    where: { email: LOCAL_EMAIL },
    update: {},
    create: { email: LOCAL_EMAIL, name: 'Local user' },
  });
  // Next only allows cookie writes from route handlers and server actions, not from a Server
  // Component render. In local mode the cookie is an optimisation rather than the source of
  // truth — the user is resolvable from the fixed email either way — so a failed write here is
  // not an error.
  try {
    jar.set(COOKIE, signSession(local.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch {
    // Rendering a page, not handling a request that can set headers.
  }

  return local;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Sign in required');
  }
}

export const SESSION_COOKIE = COOKIE;
