import { slugify } from '@agent-spawner/spec';
import type { AgentSpec, Skill, Workflow } from '@agent-spawner/spec';
import { markdown, numberedList } from './util.ts';

/**
 * Derive the `SKILL.md` for a workflow whose `promoteToSkill` toggle is on.
 *
 * Hand edits live in `workflow.skillOverrides` and win over the generated text, so
 * toggling promotion off and back on never destroys the user's writing (PLAN §4.2).
 * Both the compiler and the Workflows slide-over call this, so what the user previews
 * is exactly what ships.
 */
export function skillFromWorkflow(workflow: Workflow, spec: AgentSpec): Skill {
  const o = workflow.skillOverrides ?? {};
  const name = o.name ?? slugify(workflow.title || 'workflow', 'workflow');

  const generatedBody = markdown([
    `# ${workflow.title || name}`,
    workflow.description,
    workflow.steps.length > 0 ? '## Steps' : null,
    workflow.steps.length > 0 ? numberedList(workflow.steps) : null,
    spec.goal.successCriteria.length > 0
      ? `## Done when\n${spec.goal.successCriteria.map((c) => `- ${c}`).join('\n')}`
      : null,
  ]);

  return {
    id: `${workflow.id}__skill`,
    source: 'workflow',
    fromWorkflowId: workflow.id,
    name,
    description: o.description ?? workflow.description ?? '',
    whenToUse: o.whenToUse ?? '',
    body: o.body ?? generatedBody,
    allowedTools: o.allowedTools ?? [],
    disableModelInvocation: o.disableModelInvocation ?? false,
    userInvocable: o.userInvocable ?? true,
    model: o.model,
    effort: o.effort,
    files: [],
  };
}

/** Every skill that will be emitted: authored skills plus promoted workflows. */
export function allSkills(spec: AgentSpec): Skill[] {
  const promoted = [...spec.workflows]
    .sort((a, b) => a.order - b.order)
    .filter((w) => w.promoteToSkill)
    .map((w) => skillFromWorkflow(w, spec));
  return [...spec.skills, ...promoted];
}
