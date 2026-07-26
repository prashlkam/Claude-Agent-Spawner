import { NextResponse } from 'next/server';
import { slugify } from '@agent-spawner/spec';
import { createAgent, loadAgent } from '@/lib/agents.ts';
import { withUser } from '@/lib/route.ts';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const source = await loadAgent(user.id, id);
    const name = `${source.spec.meta.name} copy`;
    // Knowledge files are not copied: the storage objects belong to the original agent, and
    // silently sharing them would make deleting one agent break the other.
    const spec = {
      ...source.spec,
      meta: { ...source.spec.meta, name, slug: slugify(name, 'agent-copy') },
      knowledge: [],
      deployment: undefined,
    };
    const agent = await createAgent(user.id, spec);
    return NextResponse.json({ id: agent.id }, { status: 201 });
  });
}
