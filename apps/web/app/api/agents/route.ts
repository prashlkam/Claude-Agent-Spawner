import { NextResponse } from 'next/server';
import { emptySpec, safeMigrateSpec, slugify } from '@agent-spawner/spec';
import { createAgent, listAgents } from '@/lib/agents.ts';
import { BadRequestError, withUser } from '@/lib/route.ts';

export async function GET() {
  return withUser(async (user) => ({ agents: await listAgents(user.id) }));
}

export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled agent';

    // `spec` is present when duplicating or importing; otherwise start from a blank one.
    let spec = emptySpec(name);
    if (body.spec) {
      const parsed = safeMigrateSpec(body.spec);
      if (!parsed.ok) throw new BadRequestError(parsed.error);
      spec = { ...parsed.spec, meta: { ...parsed.spec.meta, name, slug: slugify(name, 'untitled-agent') } };
    }

    const agent = await createAgent(user.id, spec);
    return NextResponse.json({ id: agent.id, slug: agent.slug }, { status: 201 });
  });
}
