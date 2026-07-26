import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, oauthConfigured, signSession } from '@/lib/auth.ts';
import { prisma } from '@/lib/db.ts';

/**
 * Finish the OAuth flow. The GitHub access token is used once, here, to read the profile —
 * it is never stored. Repository access comes from the GitHub App installation instead.
 */
export async function GET(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: 'GitHub sign-in is not configured.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const jar = await cookies();

  if (!code || !state || state !== jar.get('oauth_state')?.value) {
    return NextResponse.json({ error: 'Invalid OAuth state.' }, { status: 400 });
  }
  jar.delete('oauth_state');

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) {
    return NextResponse.json({ error: 'GitHub did not return a token.' }, { status: 400 });
  }

  const profileResponse = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json' },
  });
  const profile = (await profileResponse.json()) as {
    id: number;
    login: string;
    name?: string;
    email?: string;
    avatar_url?: string;
  };

  const email = profile.email ?? `${profile.login}@users.noreply.github.com`;
  const user = await prisma.user.upsert({
    where: { email },
    update: { name: profile.name ?? profile.login, avatarUrl: profile.avatar_url ?? '' },
    create: { email, name: profile.name ?? profile.login, avatarUrl: profile.avatar_url ?? '' },
  });

  jar.set(SESSION_COOKIE, signSession(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.redirect(new URL('/agents', request.url));
}
