import type { AgentSpec, SubAgent } from '@agent-spawner/spec';
import { allSkills } from '../promote.ts';
import type { CompiledFile } from '../types.ts';
import { frontmatter, markdown, numberedList, oneLine } from '../util.ts';
import { subAgentTools } from './tools.ts';

/** Delegation hints folded into `description`, which is the field Claude reads to choose an agent. */
export const TRIGGER_HINT: Record<SubAgent['trigger']['kind'], string> = {
  auto: '',
  explicit: 'Only use this agent when it is named explicitly.',
  'always-background': 'Always run this agent in the background; do not block on it.',
};

/**
 * `agents/*.md` for each sub-agent.
 *
 * Only the keys in `PLUGIN_AGENT_ALLOWED_KEYS` are written. `hooks`, `mcpServers` and
 * `permissionMode` are refused by Claude Code inside a plugin for security reasons, so the
 * emitter never writes them and the validator hard-fails if a spec carries them (PLAN §2.2).
 */
export function emitSubAgents(spec: AgentSpec): CompiledFile[] {
  const skillsById = new Map(allSkills(spec).map((s) => [s.id, s]));
  const workflowsById = new Map(spec.workflows.map((w) => [w.id, w]));

  return spec.subAgents.map((agent) => {
    const hint = TRIGGER_HINT[agent.trigger.kind];
    const description = oneLine([agent.description, hint].filter(Boolean).join(' '));

    const preload = agent.preloadSkillIds
      .map((id) => skillsById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      // A `disable-model-invocation` skill cannot be preloaded into a subagent.
      .filter((s) => !s.disableModelInvocation)
      .map((s) => s.name);

    const fm = frontmatter({
      name: agent.name,
      description,
      model: agent.runtime.model === 'inherit' ? undefined : agent.runtime.model,
      effort: agent.runtime.effort,
      maxTurns: agent.runtime.maxTurns,
      tools: subAgentTools(agent, spec),
      disallowedTools: agent.tools.deny,
      skills: preload,
      memory: agent.runtime.memory,
      background:
        agent.runtime.background || agent.trigger.kind === 'always-background' ? true : undefined,
      isolation: agent.runtime.isolation,
    });

    const tasks = agent.taskIds
      .map((id) => workflowsById.get(id))
      .filter((w): w is NonNullable<typeof w> => Boolean(w))
      .sort((a, b) => a.order - b.order);

    const taskBlock = tasks
      .map((w) =>
        markdown([
          `## ${w.title || 'Task'}`,
          w.description,
          w.steps.length > 0 ? numberedList(w.steps) : null,
        ]),
      )
      .join('\n');

    const body = markdown([
      agent.systemPrompt || `You are \`${agent.name}\`. ${agent.description}`.trim(),
      tasks.length > 0 ? '# Assigned work' : null,
      tasks.length > 0 ? taskBlock : null,
      spec.goal.successCriteria.length > 0 ? '# What "done" means for the overall goal' : null,
      spec.goal.successCriteria.length > 0
        ? spec.goal.successCriteria.map((c) => `- ${c}`).join('\n')
        : null,
      '# Reporting',
      'Return a concise summary of what you did, what you found, and anything you could not complete. The orchestrator cannot see your context — everything it needs must be in your final message.',
    ]);

    return { path: `agents/${agent.name}.md`, content: `${fm}\n${body}` };
  });
}
