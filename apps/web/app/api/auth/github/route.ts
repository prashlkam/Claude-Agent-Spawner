import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { oauthConfigured } from '@/lib/auth.ts';

/** Start the GitHub OAuth flow. Only used when OAuth is configured; otherwise the app is local. */
export async function GET(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: 'GitHub sign-in is not configured.' }, { status: 503 });
  }

  const state = randomBytes(16).toString('hex');
  (await cookies()).set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });

  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID!);
  url.searchParams.set('redirect_uri', new URL('/api/auth/github/callback', request.url).toString());
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  return NextResponse.redirect(url);
}
