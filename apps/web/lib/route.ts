import { NextResponse } from 'next/server';
import { AuthRequiredError, currentUser } from './auth.ts';
import type { SessionUser } from './auth.ts';
import { NotFoundError, StaleRevisionError } from './agents.ts';

/**
 * One place that resolves the session and maps thrown errors to status codes, so no route
 * can accidentally skip the ownership check or leak an internal error to the client.
 */
export async function withUser<T>(
  handler: (user: SessionUser) => Promise<T>,
): Promise<NextResponse> {
  try {
    const user = await currentUser();
    const result = await handler(user);
    return result instanceof NextResponse ? result : NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof StaleRevisionError) {
      return NextResponse.json(
        {
          error: 'This agent was changed somewhere else. Reload to get the latest version.',
          currentRevision: error.current,
        },
        { status: 409 },
      );
    }
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export class BadRequestError extends Error {
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}
