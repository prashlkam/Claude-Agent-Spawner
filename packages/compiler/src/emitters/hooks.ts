import type { AgentSpec, HookTrigger } from '@agent-spawner/spec';
import { MATCHER_EVENTS } from '@agent-spawner/spec';
import type { CompiledFile } from '../types.ts';
import { json } from '../util.ts';

/**
 * `hooks/hooks.json` plus a script per hook.
 *
 * Note the distinction the validator also encodes: a plugin-shipped *agent* may not carry
 * `hooks`, but the plugin itself may ship `hooks/hooks.json` at its root (PLAN §4.3).
 */
export function emitHooks(spec: AgentSpec): CompiledFile[] {
  const hookTriggers = spec.triggers.filter(
    (t): t is HookTrigger => t.kind === 'conditional' && t.via === 'hook',
  );
  if (hookTriggers.length === 0) return [];

  const byEvent: Record<string, Array<Record<string, unknown>>> = {};
  const files: CompiledFile[] = [];

  for (const trigger of hookTriggers) {
    const scriptPath = `scripts/${trigger.name}.sh`;
    const entry: Record<string, unknown> = {};
    if (MATCHER_EVENTS.has(trigger.event) && trigger.matcher) entry.matcher = trigger.matcher;
    entry.hooks = [{ type: 'command', command: `\${CLAUDE_PLUGIN_ROOT}/${scriptPath}` }];

    (byEvent[trigger.event] ??= []).push(entry);

    files.push({
      path: scriptPath,
      executable: true,
      content: hookScript(trigger),
    });
  }

  // Sort events so output order does not depend on the order triggers were created in.
  const hooks = Object.fromEntries(Object.entries(byEvent).sort(([a], [b]) => (a < b ? -1 : 1)));
  files.push({ path: 'hooks/hooks.json', content: json({ hooks }) });

  return files;
}

function hookScript(trigger: HookTrigger): string {
  const body = trigger.command.trim();
  return `#!/usr/bin/env bash
# ${trigger.event}${trigger.matcher ? ` · matcher: ${trigger.matcher}` : ''}
#
# Claude Code pipes the hook payload to stdin as JSON. Exit 0 to allow, exit 2 to block
# with the message on stderr. This script runs on the user's machine with their
# permissions — review it before installing the plugin.
set -euo pipefail

payload="$(cat)"
export CLAUDE_HOOK_PAYLOAD="$payload"

${body || '# TODO: implement this hook.\necho "$payload" >/dev/null'}
`;
}
