import { validateBundle } from '@agent-spawner/worker-validate';
import { loadAgent } from '@/lib/agents.ts';
import { materialize } from '@/lib/bundle.ts';
import { prisma } from '@/lib/db.ts';
import { withUser } from '@/lib/route.ts';

type Params = { params: Promise<{ id: string }> };

/** L3 — run the real `claude plugin validate` in a sandbox and record the run. */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const agent = await loadAgent(user.id, id);
    const { files, diagnostics } = await materialize(agent.spec);

    const run = await prisma.validationRun.create({
      data: { agentId: agent.id, status: 'running' },
    });

    const result = await validateBundle(agent.spec.meta.slug, files);
    const combined = [...diagnostics, ...result.diagnostics];

    await prisma.validationRun.update({
      where: { id: run.id },
      data: {
        status: result.status,
        diagnostics: JSON.stringify(combined),
        cliOutput: result.cliOutput,
      },
    });

    return {
      runId: run.id,
      status: result.status,
      runner: result.runner,
      cliOutput: result.cliOutput,
      diagnostics: combined,
    };
  });
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    await loadAgent(user.id, id);
    const runs = await prisma.validationRun.findMany({
      where: { agentId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return {
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        diagnostics: JSON.parse(r.diagnostics),
        cliOutput: r.cliOutput,
      })),
    };
  });
}
