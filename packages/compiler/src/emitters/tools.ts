import type { AgentSpec, McpServer, SubAgent } from '@agent-spawner/spec';
import { uniq } from '../util.ts';

/**
 * MCP tool patterns for a server: `mcp__<key>` grants the whole server,
 * `mcp__<key>__<tool>` grants one tool. Least privilege wins when an allowlist exists.
 */
export function mcpPatterns(server: McpServer): string[] {
  if (server.toolAllowlist.length > 0) {
    return server.toolAllowlist.map((tool) => `mcp__${server.key}__${tool}`);
  }
  return [`mcp__${server.key}`];
}

export function allMcpPatterns(spec: AgentSpec): string[] {
  return spec.connectors.mcpServers.flatMap(mcpPatterns);
}

/**
 * The primary agent's `tools` line. Returns `undefined` when the user has not restricted
 * anything — omitting `tools` inherits the full set, which is what they asked for.
 */
export function primaryAgentTools(spec: AgentSpec): string[] | undefined {
  const allow = spec.connectors.builtinTools.allow;
  if (allow.length === 0) return undefined;
  const extras: string[] = [];
  // Without `Agent` the orchestrator physically cannot delegate, so it is always added
  // back when sub-agents exist.
  if (spec.subAgents.length > 0) extras.push('Agent');
  if (spec.skills.length > 0 || spec.workflows.some((w) => w.promoteToSkill)) extras.push('Skill');
  return uniq([...allow, ...extras, ...allMcpPatterns(spec)]);
}

/** A sub-agent's `tools` line, resolved from its own policy. */
export function subAgentTools(agent: SubAgent, spec: AgentSpec): string[] | undefined {
  if (agent.tools.mode === 'inherit') return undefined;
  const patterns = agent.tools.allow.filter((t) => t.startsWith('mcp__'));
  const named = agent.tools.allow.filter((t) => !t.startsWith('mcp__'));
  // An allowlist that mentions a server by key expands to that server's patterns.
  const expanded = patterns.flatMap((p) => {
    const server = spec.connectors.mcpServers.find((s) => p === `mcp__${s.key}`);
    return server ? mcpPatterns(server) : [p];
  });
  const resolved = uniq([...named, ...expanded]);
  return resolved.length > 0 ? resolved : undefined;
}
