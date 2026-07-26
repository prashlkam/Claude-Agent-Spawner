import type { AgentSpec } from '@agent-spawner/spec';
import { delegationSection } from '../orchestration.ts';
import { allSkills } from '../promote.ts';
import type { CompiledFile } from '../types.ts';
import { bulletList, frontmatter, indent, markdown, oneLine } from '../util.ts';
import { mcpPatterns, primaryAgentTools } from './tools.ts';

/**
 * `agents/<slug>.md` — where the Goal and Workflows tabs land.
 *
 * A `CLAUDE.md` at plugin root is *not* loaded as context, so this file is the only place
 * the agent's standing instructions can live (PLAN §2). Section order is fixed so that an
 * unchanged spec produces byte-identical output and the preview can diff edits.
 */
export function emitPrimaryAgent(spec: AgentSpec): CompiledFile[] {
  const { meta, goal } = spec;
  const skills = allSkills(spec);

  // Only background-knowledge skills are worth preloading; `disable-model-invocation`
  // skills cannot be preloaded at all.
  const preloaded = skills
    .filter((s) => !s.userInvocable && !s.disableModelInvocation)
    .map((s) => s.name);

  const fm = frontmatter({
    name: meta.slug,
    description: oneLine(meta.description || goal.statement || meta.name),
    model: goal.primaryModel === 'inherit' ? undefined : goal.primaryModel,
    effort: goal.primaryEffort,
    tools: primaryAgentTools(spec),
    disallowedTools: spec.connectors.builtinTools.deny,
    skills: preloaded,
  });

  const workflows = [...spec.workflows].sort((a, b) => a.order - b.order);
  const subAgentName = new Map(spec.subAgents.map((a) => [a.id, a.name]));
  const promotedSkillName = new Map(
    skills.filter((s) => s.fromWorkflowId).map((s) => [s.fromWorkflowId!, s.name]),
  );

  const workflowBlock = workflows
    .map((w, i) => {
      const lines: string[] = [`${i + 1}. **${w.title || 'Untitled step'}**${w.description ? ` — ${w.description}` : ''}`];
      if (w.promoteToSkill) {
        lines.push(indent(`Run \`/${promotedSkillName.get(w.id) ?? w.id}\`.`));
      } else if (w.steps.length > 0) {
        lines.push(indent(w.steps.map((s) => `- ${s}`).join('\n')));
      }
      const assigned = w.assignedSubAgentIds
        .map((id) => subAgentName.get(id))
        .filter((n): n is string => Boolean(n));
      if (assigned.length > 0) {
        lines.push(indent(`Delegate to: ${assigned.map((n) => `\`${n}\``).join(', ')}`));
      }
      return lines.join('\n');
    })
    .join('\n');

  const connectorBlock = spec.connectors.mcpServers
    .map((s) => {
      const what = s.description || s.displayName || s.key;
      return `- \`${s.key}\` — ${what} (tools: ${mcpPatterns(s).join(', ')})`;
    })
    .join('\n');

  const knowledgeBlock = spec.knowledge
    .map(
      (k) =>
        `- \`\${CLAUDE_PLUGIN_ROOT}/knowledge/${k.filename}\`${k.purpose ? ` — ${k.purpose}` : ''}`,
    )
    .join('\n');

  const skillBlock = skills
    .filter((s) => s.userInvocable || s.disableModelInvocation)
    .map((s) => `- \`/${s.name}\`${s.description ? ` — ${oneLine(s.description)}` : ''}`)
    .join('\n');

  const body = markdown([
    '# Objective',
    goal.statement || '_No objective set yet._',
    goal.tone ? `**Tone:** ${goal.tone}` : null,
    goal.successCriteria.length > 0 ? '## Success criteria' : null,
    goal.successCriteria.length > 0 ? bulletList(goal.successCriteria) : null,
    goal.outOfScope.length > 0 ? '## Out of scope' : null,
    goal.outOfScope.length > 0 ? bulletList(goal.outOfScope) : null,
    workflows.length > 0 ? '# Workflow' : null,
    workflows.length > 0 ? workflowBlock : null,
    delegationSection(spec),
    skillBlock ? '# Skills' : null,
    skillBlock ? skillBlock : null,
    connectorBlock ? '# Available connectors' : null,
    connectorBlock ? connectorBlock : null,
    knowledgeBlock ? '# Knowledge' : null,
    knowledgeBlock ? knowledgeBlock : null,
  ]);

  return [{ path: `agents/${meta.slug}.md`, content: `${fm}\n${body}` }];
}
