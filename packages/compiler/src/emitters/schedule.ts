import type { AgentSpec, ScheduledTrigger } from '@agent-spawner/spec';
import type { CompiledFile } from '../types.ts';
import { markdown, shellQuote } from '../util.ts';

/**
 * Cron is not a plugin component — there is nothing to put in the bundle that Claude Code
 * will schedule on its own. So a scheduled trigger compiles into honest instructions plus a
 * wrapper the user can point their own cron/CI at (PLAN §4.3).
 */
export function emitSchedule(spec: AgentSpec): CompiledFile[] {
  const scheduled = spec.triggers.filter((t): t is ScheduledTrigger => t.kind === 'scheduled');
  if (scheduled.length === 0) return [];

  const slug = spec.meta.slug;

  const rows = scheduled
    .map(
      (t) =>
        `| \`${t.cron}\` | ${t.timezone} | ${describeCron(t.cron)} | ${t.prompt.replace(/\|/g, '\\|') || '_(no prompt)_'} |`,
    )
    .join('\n');

  const doc = markdown([
    `# Scheduling \`${slug}\``,
    'A Claude Code plugin cannot schedule itself. This file describes the two supported ways to run this agent on a schedule, and the bundle ships `scripts/run.sh` for the second one.',
    '## Requested schedules',
    '| Cron | Timezone | Meaning | Prompt |\n|---|---|---|---|',
    rows,
    '## Option 1 — Claude Code scheduled tasks',
    'If your Claude Code build has scheduled tasks (routines), create one per row above and paste the prompt in. This is the option to prefer: the run happens inside Claude Code with your normal settings, permissions and MCP connectors.',
    '## Option 2 — your own cron or CI',
    'Use the bundled wrapper. It runs Claude Code headlessly with this plugin\'s primary agent:',
    '```bash\n' +
      scheduled
        .map(
          (t) =>
            `# ${describeCron(t.cron)} (${t.timezone})\n${t.cron} CRON_TZ=${t.timezone} "$CLAUDE_PLUGIN_ROOT/scripts/run.sh" ${shellQuote(t.prompt)}`,
        )
        .join('\n') +
      '\n```',
    '> The wrapper runs with whatever credentials and permissions the invoking shell has. Read `scripts/run.sh` before wiring it to anything automated.',
  ]);

  const runner = `#!/usr/bin/env bash
# Headless runner for the \`${slug}\` agent, for use from cron or CI.
#
# Usage: run.sh "<prompt>"
#
# This executes Claude Code non-interactively on the invoking machine. It inherits your
# credentials and your permission settings — review it before scheduling it.
set -euo pipefail

PROMPT="\${1:-${scheduled[0]?.prompt.replace(/"/g, '\\"') ?? ''}}"

if [ -z "\$PROMPT" ]; then
  echo "usage: run.sh \\"<prompt>\\"" >&2
  exit 64
fi

exec claude --agent ${slug} --print "\$PROMPT"
`;

  return [
    { path: 'SCHEDULING.md', content: doc },
    { path: 'scripts/run.sh', content: runner, executable: true },
  ];
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Plain-English rendering of the common cron shapes; falls back to the raw expression. */
export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];

  const time =
    /^\d+$/.test(min) && /^\d+$/.test(hour)
      ? `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
      : null;

  if (!time) {
    if (min.startsWith('*/')) return `every ${min.slice(2)} minutes`;
    return expression;
  }
  if (dom === '*' && month === '*' && dow === '*') return `every day at ${time}`;
  if (dom === '*' && month === '*' && /^[0-6]$/.test(dow)) {
    return `every ${DOW[Number(dow)]} at ${time}`;
  }
  if (month === '*' && dow === '*' && /^\d+$/.test(dom)) {
    return `on day ${dom} of each month at ${time}`;
  }
  return expression;
}
