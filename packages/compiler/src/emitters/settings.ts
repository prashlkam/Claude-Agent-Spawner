import type { AgentSpec } from '@agent-spawner/spec';
import type { CompiledFile } from '../types.ts';
import { json } from '../util.ts';

/**
 * Plugin `settings.json`.
 *
 * Only `agent` and `subagentStatusLine` are honoured here. Permissions cannot ship in a
 * plugin — they belong to the consuming project's `.claude/settings.json`, so the docs
 * emitter writes a copy-pasteable block into the README instead (PLAN §2.5).
 */
export function emitSettings(spec: AgentSpec): CompiledFile[] {
  const settings: Record<string, unknown> = {
    // Makes the compiled orchestrator the default main-session agent.
    agent: spec.meta.slug,
  };

  if (spec.subAgents.length > 0) {
    settings.subagentStatusLine = true;
  }

  return [{ path: 'settings.json', content: json(settings) }];
}
