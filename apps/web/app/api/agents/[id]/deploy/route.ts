import { createHash } from 'node:crypto';
import {
  GitHubNotConfiguredError,
  createTag,
  githubAppConfigured,
  installationToken,
  pushBundle,
  readTree,
} from '@agent-spawner/worker-deploy';
import { validateBundle } from '@agent-spawner/worker-validate';
import { loadAgent } from '@/lib/agents.ts';
import { blockingErrors, materialize } from '@/lib/bundle.ts';
import { prisma } from '@/lib/db.ts';
import { BadRequestError, withUser } from '@/lib/route.ts';

type Params = { params: Promise<{ id: string }> };

/**
 * Push the bundle to a user-owned repository.
 *
 * Order is deliberate (PLAN §10): compile → L2 → L3 → push. Pushing is outward-facing and
 * hard to undo, so it is gated on validation passing and on an explicit confirmation from the
 * UI that named the repo, branch and visibility.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    if (!githubAppConfigured()) throw new GitHubNotConfiguredError();

    const body = await request.json().catch(() => ({}));
    if (body?.confirmed !== true) {
      throw new BadRequestError('A deploy must be confirmed explicitly in the UI before it runs.');
    }

    const agent = await loadAgent(user.id, id);
    const deployment = agent.spec.deployment;
    if (!deployment?.repo.owner || !deployment.repo.name) {
      throw new BadRequestError('Choose a repository on the Deploy tab first.');
    }

    const installation = await prisma.gitHubInstallation.findFirst({ where: { userId: user.id } });
    if (!installation) {
      throw new BadRequestError('Install the GitHub App on the target repository first.');
    }

    const { files, diagnostics } = await materialize(agent.spec);
    const errors = blockingErrors(diagnostics);
    if (errors.length > 0) {
      throw new BadRequestError('Fix the errors before deploying.', errors);
    }

    const l3 = await validateBundle(agent.spec.meta.slug, files);
    if (l3.status === 'failed') {
      throw new BadRequestError('`claude plugin validate` failed; the bundle was not pushed.', l3.diagnostics);
    }

    const record = await prisma.deployment.create({
      data: {
        agentId: agent.id,
        repoFullName: `${deployment.repo.owner}/${deployment.repo.name}`,
        branch: deployment.branch,
        status: 'running',
      },
    });

    // The token exists only inside this request.
    const token = await installationToken(installation.installationId);

    try {
      const result = await pushBundle(
        token,
        deployment.repo,
        deployment.branch,
        files.map((f) => ({ path: f.path, bytes: f.bytes, executable: f.executable })),
        commitMessage(agent.spec.meta.name, agent.spec.meta.version),
      );

      if (agent.spec.meta.versionMode === 'pinned') {
        await createTag(token, deployment.repo, agent.spec.meta.version, result.commitSha).catch(() => {
          // A tag that already exists is not a failed deploy.
        });
      }

      await prisma.deployment.update({
        where: { id: record.id },
        data: { status: 'succeeded', commitSha: result.commitSha, logs: result.url },
      });

      return {
        status: 'succeeded',
        commitSha: result.commitSha,
        url: result.url,
        installCommand: `/plugin marketplace add ${deployment.repo.owner}/${deployment.repo.name}`,
        validation: l3.status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Push failed';
      await prisma.deployment.update({
        where: { id: record.id },
        data: { status: 'failed', logs: message },
      });
      throw new BadRequestError(message);
    }
  });
}

/** Diff preview: what the push would add, change or leave alone. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return withUser(async (user) => {
    const agent = await loadAgent(user.id, id);
    const deployment = agent.spec.deployment;
    const { files, diagnostics } = await materialize(agent.spec);

    const local = files.map((f) => ({ path: f.path, sha: gitBlobSha(f.bytes) }));

    if (!githubAppConfigured() || !deployment?.repo.owner || !deployment.repo.name) {
      return {
        configured: githubAppConfigured(),
        diff: local.map((f) => ({ path: f.path, change: 'added' as const })),
        diagnostics,
        history: await history(id),
      };
    }

    const installation = await prisma.gitHubInstallation.findFirst({ where: { userId: user.id } });
    if (!installation) {
      return {
        configured: true,
        connected: false,
        diff: local.map((f) => ({ path: f.path, change: 'added' as const })),
        diagnostics,
        history: await history(id),
      };
    }

    const token = await installationToken(installation.installationId);
    const remote = await readTree(token, deployment.repo, deployment.branch);

    type Change = 'added' | 'modified' | 'removed' | 'unchanged';
    const diff: Array<{ path: string; change: Change }> = local.map((f) => ({
      path: f.path,
      change: !remote.has(f.path) ? 'added' : remote.get(f.path) === f.sha ? 'unchanged' : 'modified',
    }));
    for (const path of remote.keys()) {
      if (!local.some((f) => f.path === path)) diff.push({ path, change: 'removed' });
    }

    return { configured: true, connected: true, diff, diagnostics, history: await history(id) };
  });
}

async function history(agentId: string) {
  const rows = await prisma.deployment.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return rows.map((r) => ({
    id: r.id,
    repoFullName: r.repoFullName,
    branch: r.branch,
    status: r.status,
    commitSha: r.commitSha,
    logs: r.logs,
    createdAt: r.createdAt,
  }));
}

/** Git's blob hash, so the diff compares against what GitHub actually stores. */
function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`), bytes]))
    .digest('hex');
}

function commitMessage(name: string, version: string): string {
  return `${name} v${version}\n\nGenerated by Agent Spawner from an AgentSpec.`;
}
