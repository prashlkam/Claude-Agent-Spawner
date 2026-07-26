import type { AgentSpec, SubAgent } from '@agent-spawner/spec';
import { markdown } from './util.ts';

/**
 * Parallel vs. series is not a config field anywhere in Claude Code — it is behaviour, and
 * behaviour is produced by prompt language (PLAN §3, honesty note 2). Every phrasing the
 * compiler can emit lives in this file so it can be tuned in one place.
 */
export const PHRASES = {
  parallel: (names: string[]) =>
    `Spawn ${list(names)} **in the same tool block** so they run concurrently. Do not wait for one to return before launching the next.`,
  parallelSingle: (name: string) => `Spawn \`${name}\`.`,
  series: (names: string[]) =>
    names
      .slice(1)
      .map(
        (name, i) =>
          `Wait for \`${names[i]}\` to return before spawning \`${name}\`; pass its findings in the prompt rather than assuming \`${name}\` can see them.`,
      )
      .join('\n'),
  stageHeading: (index: number, mode: 'parallel' | 'series') =>
    `**Stage ${index + 1}** (${mode === 'parallel' ? 'concurrent' : 'sequential'})`,
  stageGate: 'Only move to the next stage once every agent in the current stage has returned.',
  defaultJoin:
    'Collect each sub-agent\'s output, reconcile contradictions explicitly, and state which agent produced each conclusion.',
} as const;

function list(names: string[]): string {
  const quoted = names.map((n) => `\`${n}\``);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** Renders the `# Delegation` section of the primary agent prompt. */
export function delegationSection(spec: AgentSpec): string | null {
  const byId = new Map(spec.subAgents.map((a) => [a.id, a]));
  const groups = [...spec.orchestration.groups].sort((a, b) => a.order - b.order);

  const staged = groups
    .map((group) => {
      const names = group.subAgentIds
        .map((id) => byId.get(id)?.name)
        .filter((n): n is string => Boolean(n));
      if (names.length === 0) return null;
      const body =
        group.mode === 'parallel'
          ? names.length > 1
            ? PHRASES.parallel(names)
            : PHRASES.parallelSingle(names[0]!)
          : names.length > 1
            ? `${PHRASES.parallelSingle(names[0]!)}\n${PHRASES.series(names)}`
            : PHRASES.parallelSingle(names[0]!);
      return { mode: group.mode, body };
    })
    .filter((s): s is { mode: 'parallel' | 'series'; body: string } => s !== null);

  // Sub-agents the user never placed on the canvas still need delegation instructions.
  const placed = new Set(groups.flatMap((g) => g.subAgentIds));
  const unplaced = spec.subAgents.filter((a) => !placed.has(a.id));

  if (staged.length === 0 && unplaced.length === 0) return null;

  const stageLines = staged.map(
    (stage, i) => `${PHRASES.stageHeading(i, stage.mode)}\n${stage.body}`,
  );

  return markdown([
    '# Delegation',
    ...stageLines,
    staged.length > 1 ? PHRASES.stageGate : null,
    unplaced.length > 0
      ? `Use ${list(unplaced.map((a) => a.name))} as needed, in whatever order the work requires.`
      : null,
    spec.orchestration.joinPolicy.trim() || (spec.subAgents.length > 0 ? PHRASES.defaultJoin : null),
  ]);
}

/** Human-readable summary of the canvas, reused in the README. */
export function describeOrchestration(spec: AgentSpec): string[] {
  const byId = new Map<string, SubAgent>(spec.subAgents.map((a) => [a.id, a]));
  return [...spec.orchestration.groups]
    .sort((a, b) => a.order - b.order)
    .map((g, i) => {
      const names = g.subAgentIds.map((id) => byId.get(id)?.name ?? id);
      return `Stage ${i + 1} — ${g.mode}: ${names.join(', ') || '(empty)'}`;
    });
}
