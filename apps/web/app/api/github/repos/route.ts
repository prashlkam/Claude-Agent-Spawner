import { githubAppConfigured, installationToken, listInstallationRepos } from '@agent-spawner/worker-deploy';
import { prisma } from '@/lib/db.ts';
import { withUser } from '@/lib/route.ts';

/** Repositories the GitHub App installation can reach. Tokens are minted and discarded here. */
export async function GET() {
  return withUser(async (user) => {
    if (!githubAppConfigured()) return { configured: false, repos: [] };

    const installation = await prisma.gitHubInstallation.findFirst({ where: { userId: user.id } });
    if (!installation) return { configured: true, connected: false, repos: [] };

    const token = await installationToken(installation.installationId);
    return {
      configured: true,
      connected: true,
      account: installation.accountLogin,
      repos: await listInstallationRepos(token),
    };
  });
}

/** Record which installation this user owns. Only the id is kept — never a token. */
export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = await request.json().catch(() => ({}));
    const installationId = String(body?.installationId ?? '').trim();
    if (!/^\d+$/.test(installationId)) {
      return { error: 'Enter the numeric installation id from the GitHub App settings URL.' };
    }
    const token = await installationToken(installationId);
    const repos = await listInstallationRepos(token);
    const accountLogin = repos[0]?.fullName.split('/')[0] ?? '';

    await prisma.gitHubInstallation.upsert({
      where: { userId_installationId: { userId: user.id, installationId } },
      update: { accountLogin },
      create: { userId: user.id, installationId, accountLogin },
    });
    return { connected: true, account: accountLogin, repos };
  });
}
