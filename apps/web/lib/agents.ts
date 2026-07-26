import { migrateSpec } from '@agent-spawner/spec';
import type { AgentSpec } from '@agent-spawner/spec';
import { prisma } from './db.ts';

/**
 * Row-level ownership is enforced here rather than in each route, so a missed check in a new
 * endpoint is impossible as long as it goes through these helpers (PLAN §11).
 */

export class NotFoundError extends Error {}
export class StaleRevisionError extends Error {
  current: number;

  constructor(current: number) {
    super('The agent was modified elsewhere');
    this.current = current;
  }
}

export type LoadedAgent = {
  id: string;
  slug: string;
  title: string;
  revision: number;
  spec: AgentSpec;
  updatedAt: Date;
};

export async function loadAgent(userId: string, agentId: string): Promise<LoadedAgent> {
  const row = await prisma.agent.findFirst({ where: { id: agentId, userId } });
  if (!row) throw new NotFoundError('Agent not found');
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    revision: row.revision,
    // Migrations run lazily on read (PLAN §14.5), so old snapshots load without a batch job.
    spec: migrateSpec(JSON.parse(row.spec)),
    updatedAt: row.updatedAt,
  };
}

export async function listAgents(userId: string) {
  const rows = await prisma.agent.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, slug: true, title: true, updatedAt: true, revision: true, spec: true },
  });
  return rows.map((row) => {
    const spec = migrateSpec(JSON.parse(row.spec));
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      updatedAt: row.updatedAt,
      revision: row.revision,
      description: spec.meta.description,
      version: spec.meta.version,
      counts: {
        workflows: spec.workflows.length,
        subAgents: spec.subAgents.length,
        skills: spec.skills.length + spec.workflows.filter((w) => w.promoteToSkill).length,
        connectors: spec.connectors.mcpServers.length,
      },
    };
  });
}

export async function createAgent(userId: string, spec: AgentSpec) {
  const slug = await uniqueSlug(userId, spec.meta.slug);
  const stored = { ...spec, meta: { ...spec.meta, slug } };
  const agent = await prisma.agent.create({
    data: {
      userId,
      slug,
      title: stored.meta.name,
      spec: JSON.stringify(stored),
      specVersion: stored.specVersion,
    },
  });
  await prisma.agentVersion.create({
    data: { agentId: agent.id, revision: 1, spec: JSON.stringify(stored), label: 'Created' },
  });
  return agent;
}

/**
 * Optimistic concurrency: the client sends the revision it read. A mismatch means another tab
 * or device wrote first, and the caller gets a 409 rather than silently clobbering that work.
 */
export async function saveSpec(
  userId: string,
  agentId: string,
  spec: AgentSpec,
  expectedRevision: number,
  label = '',
): Promise<{ revision: number }> {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    select: { revision: true, slug: true },
  });
  if (!existing) throw new NotFoundError('Agent not found');
  if (existing.revision !== expectedRevision) throw new StaleRevisionError(existing.revision);

  const slug =
    spec.meta.slug === existing.slug ? existing.slug : await uniqueSlug(userId, spec.meta.slug, agentId);
  const stored = { ...spec, meta: { ...spec.meta, slug } };
  const revision = expectedRevision + 1;

  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agentId },
      data: {
        spec: JSON.stringify(stored),
        title: stored.meta.name,
        slug,
        revision,
        specVersion: stored.specVersion,
      },
    }),
    prisma.agentVersion.create({
      data: { agentId, revision, spec: JSON.stringify(stored), label },
    }),
  ]);

  return { revision };
}

export async function deleteAgent(userId: string, agentId: string) {
  const result = await prisma.agent.deleteMany({ where: { id: agentId, userId } });
  if (result.count === 0) throw new NotFoundError('Agent not found');
}

async function uniqueSlug(userId: string, desired: string, ignoreAgentId?: string): Promise<string> {
  let candidate = desired;
  for (let n = 2; n < 500; n++) {
    const clash = await prisma.agent.findFirst({
      where: { userId, slug: candidate, ...(ignoreAgentId ? { NOT: { id: ignoreAgentId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${desired}-${n}`;
  }
  return `${desired}-${Date.now()}`;
}
