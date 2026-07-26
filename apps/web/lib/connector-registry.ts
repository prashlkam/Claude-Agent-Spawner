import { prisma } from './db.ts';

/**
 * Seed catalogue of well-known MCP servers, mirrored into `ConnectorTemplate` on first use.
 *
 * `MCP_REGISTRY_URL` can point at a live registry; when it is set, results from it are merged
 * on top of these. Env vars are declared by *name and purpose only* — no template ever carries
 * a value.
 */
export type ConnectorSeed = {
  key: string;
  displayName: string;
  description: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env: Array<{ name: string; description: string; required: boolean; secret: boolean }>;
  docsUrl: string;
};

const SEEDS: ConnectorSeed[] = [
  {
    key: 'filesystem',
    displayName: 'Filesystem',
    description: 'Read and write files under an explicitly allowed directory.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
    env: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    key: 'github',
    displayName: 'GitHub',
    description: 'Repositories, issues, pull requests and code search.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: [
      {
        name: 'GITHUB_TOKEN',
        description: 'Fine-grained token scoped to the repositories the agent may touch.',
        required: true,
        secret: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    key: 'postgres',
    displayName: 'Postgres',
    description: 'Read-only SQL access to a Postgres database.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: [
      {
        name: 'POSTGRES_CONNECTION_STRING',
        description: 'Connection string for a read-only role.',
        required: true,
        secret: true,
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    key: 'slack',
    displayName: 'Slack',
    description: 'Read channels and post messages as a bot user.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: [
      { name: 'SLACK_BOT_TOKEN', description: 'Bot token (xoxb-…).', required: true, secret: true },
      { name: 'SLACK_TEAM_ID', description: 'Workspace id.', required: true, secret: false },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    key: 'sentry',
    displayName: 'Sentry',
    description: 'Fetch issues and stack traces from Sentry.',
    transport: 'http',
    url: 'https://mcp.sentry.dev/mcp',
    env: [
      { name: 'SENTRY_AUTH_TOKEN', description: 'Auth token with issue:read.', required: true, secret: true },
    ],
    docsUrl: 'https://docs.sentry.io',
  },
  {
    key: 'puppeteer',
    displayName: 'Browser (Puppeteer)',
    description: 'Drive a headless browser to fetch or screenshot pages.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    env: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    key: 'memory',
    displayName: 'Knowledge graph memory',
    description: 'Persistent entity/relation memory across sessions.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    key: 'gdrive',
    displayName: 'Google Drive',
    description: 'Search and read Google Drive documents.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    env: [
      { name: 'GDRIVE_CREDENTIALS_PATH', description: 'Path to the OAuth client credentials file.', required: true, secret: true },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
];

let seeded = false;

export async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  for (const seed of SEEDS) {
    await prisma.connectorTemplate.upsert({
      where: { key: seed.key },
      update: {},
      create: {
        key: seed.key,
        displayName: seed.displayName,
        description: seed.description,
        transport: seed.transport,
        command: seed.command ?? '',
        args: JSON.stringify(seed.args ?? []),
        url: seed.url ?? '',
        envSchema: JSON.stringify(seed.env),
        docsUrl: seed.docsUrl,
      },
    });
  }
  seeded = true;
}

export async function searchConnectors(query: string): Promise<ConnectorSeed[]> {
  await ensureSeeded();
  const rows = await prisma.connectorTemplate.findMany();
  const local: ConnectorSeed[] = rows.map((row) => ({
    key: row.key,
    displayName: row.displayName,
    description: row.description,
    transport: row.transport as ConnectorSeed['transport'],
    command: row.command || undefined,
    args: JSON.parse(row.args),
    url: row.url || undefined,
    env: JSON.parse(row.envSchema),
    docsUrl: row.docsUrl,
  }));

  const remote = await searchRemote(query);
  const merged = new Map(local.map((c) => [c.key, c]));
  for (const entry of remote) merged.set(entry.key, entry);

  const needle = query.trim().toLowerCase();
  const all = [...merged.values()];
  if (!needle) return all;
  return all.filter((c) =>
    `${c.key} ${c.displayName} ${c.description}`.toLowerCase().includes(needle),
  );
}

/** Optional live registry. Failures are silent: the seeded catalogue is still useful. */
async function searchRemote(query: string): Promise<ConnectorSeed[]> {
  const base = process.env.MCP_REGISTRY_URL;
  if (!base) return [];
  try {
    const response = await fetch(`${base}?search=${encodeURIComponent(query)}&limit=20`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { servers?: Array<Record<string, unknown>> };
    return (body.servers ?? []).flatMap((server) => {
      const name = String(server.name ?? '');
      if (!name) return [];
      return [
        {
          key: name.split('/').pop()!.replace(/[^a-z0-9_-]/gi, '-').toLowerCase(),
          displayName: name,
          description: String(server.description ?? ''),
          transport: 'stdio' as const,
          command: 'npx',
          args: ['-y', name],
          env: [],
          docsUrl: String(server.repository ?? server.homepage ?? ''),
        },
      ];
    });
  } catch {
    return [];
  }
}
