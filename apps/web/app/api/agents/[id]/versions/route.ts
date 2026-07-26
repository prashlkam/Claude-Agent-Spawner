import { loadAgent } from '@/lib/agents.ts';
import { prisma } from '@/lib/db.ts';
import { withUser } from '@/lib/route.ts';

type Params = { params: Promise<{ id: string }> };

/** Save history — the free undo/diff surface that comes from snapshotting every write. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    await loadAgent(user.id, id);
    const wanted = new URL(request.url).searchParams.get('revision');

    if (wanted) {
      const version = await prisma.agentVersion.findFirst({
        where: { agentId: id, revision: Number(wanted) },
      });
      return { version: version ? { ...version, spec: JSON.parse(version.spec) } : null };
    }

    const versions = await prisma.agentVersion.findMany({
      where: { agentId: id },
      orderBy: { revision: 'desc' },
      take: 50,
      select: { revision: true, label: true, createdAt: true },
    });
    return { versions };
  });
}
