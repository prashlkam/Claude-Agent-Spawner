import type { AgentSpec, McpServer } from '@agent-spawner/spec';
import type { CompiledFile } from '../types.ts';
import { compact, json } from '../util.ts';

/**
 * `.mcp.json` and `.env.example`.
 *
 * Secrets are **never** baked in. Every declared env var becomes a `${VAR}` placeholder
 * in the manifest and a documented line in `.env.example`; the validator hard-blocks
 * anything that looks like a live credential before it can reach here (PLAN §2.4).
 */
export function emitMcp(spec: AgentSpec): CompiledFile[] {
  const servers = spec.connectors.mcpServers;
  if (servers.length === 0) return [];

  const mcpServers: Record<string, unknown> = {};
  for (const server of [...servers].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    mcpServers[server.key] = serverEntry(server);
  }

  const files: CompiledFile[] = [{ path: '.mcp.json', content: json({ mcpServers }) }];

  const envLines: string[] = [
    '# Environment variables required by this plugin\'s MCP connectors.',
    '# Copy to `.env`, fill in real values, and keep it out of version control.',
    '',
  ];
  for (const server of servers) {
    if (server.env.length === 0) continue;
    envLines.push(`# ── ${server.displayName || server.key} ──`);
    if (server.docsUrl) envLines.push(`# docs: ${server.docsUrl}`);
    for (const v of server.env) {
      if (v.description) envLines.push(`# ${v.description}`);
      envLines.push(`# ${v.required ? 'required' : 'optional'}${v.secret ? ' · secret' : ''}`);
      envLines.push(`${v.name}=${v.secret ? '' : v.defaultValue}`);
      envLines.push('');
    }
  }

  if (envLines.length > 3) {
    files.push({ path: '.env.example', content: `${envLines.join('\n').trimEnd()}\n` });
  }

  return files;
}

function serverEntry(server: McpServer): Record<string, unknown> {
  const env =
    server.env.length > 0
      ? Object.fromEntries(
          server.env.map((v) => [v.name, v.secret || !v.defaultValue ? `\${${v.name}}` : v.defaultValue]),
        )
      : undefined;

  if (server.transport === 'stdio') {
    return compact({
      command: server.command,
      args: server.args,
      env,
    });
  }

  return compact({
    type: server.transport,
    url: server.url,
    env,
  });
}
