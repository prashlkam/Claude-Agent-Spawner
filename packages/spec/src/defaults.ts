import { agentSpecSchema, SPEC_VERSION } from './schema.ts';
import type { AgentSpec, ContextBudget, Skill, SubAgent, Workflow } from './schema.ts';

/**
 * Deterministic-ish id generator. Ids only need to be unique inside one spec; they are
 * never used as database keys, so 8 hex chars is plenty and keeps JSON diffs readable.
 */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(4);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function slugify(input: string, fallback = 'untitled'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug.length >= 2 ? slug : fallback;
}

/**
 * Context-budget presets. There is no context-window field on a subagent, so the
 * "budget" is expressed through the levers that genuinely exist. See PLAN §3.
 */
export const CONTEXT_BUDGET_PRESETS: Record<
  Exclude<ContextBudget, 'custom'>,
  { model: string; effort?: SubAgent['runtime']['effort']; maxTurns: number; background: boolean; isolation?: 'worktree'; blurb: string }
> = {
  lean: {
    model: 'haiku',
    effort: 'low',
    maxTurns: 12,
    background: false,
    blurb: 'Cheap and quick. Short, well-scoped jobs; returns a summary rather than reasoning at length.',
  },
  standard: {
    model: 'inherit',
    maxTurns: 40,
    background: false,
    blurb: 'Inherits the main session model. Good default for most delegated work.',
  },
  deep: {
    model: 'opus',
    effort: 'high',
    maxTurns: 200,
    background: true,
    isolation: 'worktree',
    blurb:
      'Long-running investigation in its own context and its own git worktree. Slower and more expensive; use for work that would otherwise flood the main session.',
  },
};

export function applyContextBudget(runtime: SubAgent['runtime'], budget: ContextBudget): SubAgent['runtime'] {
  if (budget === 'custom') return { ...runtime, contextBudget: 'custom' };
  const preset = CONTEXT_BUDGET_PRESETS[budget];
  return {
    ...runtime,
    contextBudget: budget,
    model: preset.model,
    effort: preset.effort,
    maxTurns: preset.maxTurns,
    background: preset.background,
    isolation: preset.isolation,
  };
}

/** A brand-new, valid, empty spec. */
export function emptySpec(name = 'Untitled agent'): AgentSpec {
  return agentSpecSchema.parse({
    specVersion: SPEC_VERSION,
    meta: { name, slug: slugify(name, 'untitled-agent') },
  });
}

export function newWorkflow(order: number, partial: Partial<Workflow> = {}): Workflow {
  return {
    id: newId('wf'),
    title: '',
    description: '',
    order,
    steps: [],
    promoteToSkill: false,
    assignedSubAgentIds: [],
    ...partial,
  };
}

export function newSubAgent(partial: Partial<SubAgent> = {}): SubAgent {
  return {
    id: newId('sa'),
    name: 'sub-agent',
    description: '',
    systemPrompt: '',
    taskIds: [],
    trigger: { kind: 'auto' },
    tools: { mode: 'inherit', allow: [], deny: [] },
    runtime: { model: 'inherit', background: false, contextBudget: 'standard', maxTurns: 40 },
    preloadSkillIds: [],
    ...partial,
  };
}

export function newSkill(partial: Partial<Skill> = {}): Skill {
  return {
    id: newId('sk'),
    source: 'new',
    name: 'new-skill',
    description: '',
    whenToUse: '',
    body: '',
    allowedTools: [],
    disableModelInvocation: false,
    userInvocable: true,
    files: [],
    ...partial,
  };
}
