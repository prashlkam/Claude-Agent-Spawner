import { createSign } from 'node:crypto';

/**
 * GitHub App client.
 *
 * The single most important security decision in the project (PLAN §10): the app stores only
 * an `installation_id`. An installation access token is minted per operation, lives for an
 * hour, is scoped to the repositories the user selected, is never written to the database,
 * never logged, and never returned to the client.
 *
 * There is deliberately no personal-access-token fallback. A PAT would be a long-lived
 * credential able to touch the user's whole account.
 */

const API = 'https://api.github.com';

export class GitHubNotConfiguredError extends Error {
  constructor() {
    super(
      'GitHub deployment is not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, then install the app on the target repository.',
    );
  }
}

export function githubAppConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}

/** Short-lived (10 minute) app JWT, used only to exchange for an installation token. */
function appJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  const key = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!appId || !key) throw new GitHubNotConfiguredError();

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key, 'base64url')}`;
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

/** Mint a token for one operation. Callers must not persist the return value. */
export async function installationToken(installationId: string): Promise<string> {
  const response = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`Could not mint an installation token (${response.status}).`);
  }
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    // The token never appears in the message.
    throw new Error(`GitHub ${init.method ?? 'GET'} ${path} failed (${response.status}): ${detail.slice(0, 400)}`);
  }
  return response.status === 204 ? (null as T) : ((await response.json()) as T);
}

export type RepoRef = { owner: string; name: string };

export async function listInstallationRepos(token: string) {
  const body = await api<{ repositories: Array<{ full_name: string; private: boolean; default_branch: string }> }>(
    token,
    '/installation/repositories?per_page=100',
  );
  return body.repositories.map((r) => ({
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
  }));
}

export type PushFile = { path: string; bytes: Buffer; executable?: boolean };

export type PushResult = { commitSha: string; branch: string; url: string; created: string[] };

/**
 * Write the bundle as one commit using the Git Data API — blobs, then a tree, then a commit,
 * then a ref update. No clone, no working copy, no shelling out to git.
 */
export async function pushBundle(
  token: string,
  repo: RepoRef,
  branch: string,
  files: PushFile[],
  message: string,
): Promise<PushResult> {
  const base = `/repos/${repo.owner}/${repo.name}`;

  const repository = await api<{ default_branch: string }>(token, base);
  let parentSha: string | null = null;
  let baseTree: string | undefined;

  try {
    const ref = await api<{ object: { sha: string } }>(token, `${base}/git/ref/heads/${branch}`);
    parentSha = ref.object.sha;
    const commit = await api<{ tree: { sha: string } }>(token, `${base}/git/commits/${parentSha}`);
    baseTree = commit.tree.sha;
  } catch {
    // Branch does not exist yet: branch from the repository default when it has commits.
    if (branch !== repository.default_branch) {
      try {
        const ref = await api<{ object: { sha: string } }>(
          token,
          `${base}/git/ref/heads/${repository.default_branch}`,
        );
        parentSha = ref.object.sha;
      } catch {
        parentSha = null;
      }
    }
  }

  const tree = await Promise.all(
    files.map(async (file) => {
      const blob = await api<{ sha: string }>(token, `${base}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: file.bytes.toString('base64'), encoding: 'base64' }),
      });
      return {
        path: file.path,
        mode: file.executable ? '100755' : '100644',
        type: 'blob' as const,
        sha: blob.sha,
      };
    }),
  );

  const created = await api<{ sha: string }>(token, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree, ...(baseTree ? { base_tree: baseTree } : {}) }),
  });

  const commit = await api<{ sha: string; html_url: string }>(token, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: created.sha,
      parents: parentSha ? [parentSha] : [],
    }),
  });

  const refPath = `${base}/git/refs/heads/${branch}`;
  if (parentSha) {
    await api(token, refPath, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  } else {
    await api(token, `${base}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return {
    commitSha: commit.sha,
    branch,
    url: commit.html_url,
    created: files.map((f) => f.path),
  };
}

/** Tag the release so `meta.version` is resolvable from the repository. */
export async function createTag(token: string, repo: RepoRef, version: string, commitSha: string) {
  await api(token, `/repos/${repo.owner}/${repo.name}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/tags/v${version}`, sha: commitSha }),
  });
}

/** Files currently on the branch, so the deploy screen can show a real diff before pushing. */
export async function readTree(
  token: string,
  repo: RepoRef,
  branch: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const tree = await api<{ tree: Array<{ path: string; type: string; sha: string }> }>(
      token,
      `/repos/${repo.owner}/${repo.name}/git/trees/${branch}?recursive=1`,
    );
    for (const entry of tree.tree) {
      if (entry.type === 'blob') out.set(entry.path, entry.sha);
    }
  } catch {
    // No branch yet — everything in the bundle is an addition.
  }
  return out;
}
