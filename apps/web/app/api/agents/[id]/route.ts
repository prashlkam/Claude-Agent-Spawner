import { NextResponse } from 'next/server';
import { safeMigrateSpec } from '@agent-spawner/spec';
import { deleteAgent, loadAgent, saveSpec } from '@/lib/agents.ts';
import { BadRequestError, withUser } from '@/lib/route.ts';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => await loadAgent(user.id, id));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.revision !== 'number') {
      throw new BadRequestError('A `revision` is required so concurrent edits can be detected.');
    }
    const parsed = safeMigrateSpec(body.spec);
    if (!parsed.ok) throw new BadRequestError(parsed.error);

    const { revision } = await saveSpec(
      user.id,
      id,
      parsed.spec,
      body.revision,
      typeof body.label === 'string' ? body.label : '',
    );
    return { revision };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    await deleteAgent(user.id, id);
    return NextResponse.json(null, { status: 204 });
  });
}
