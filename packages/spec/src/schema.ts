import { z } from 'zod';
import {
  AGENT_COLORS,
  EFFORT_LEVELS,
  HOOK_EVENTS,
  MODEL_ALIASES,
  SPDX_LICENSES,
} from './catalog.ts';

export const SPEC_VERSION = 1 as const;

// ── primitives ────────────────────────────────────────────────────────────────

export const slugSchema = z
  .string()
  .min(2, 'At least 2 characters')
  .max(64, 'At most 64 characters')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Must be kebab-case: lowercase letters, digits and single hyphens');

export const semverSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    'Must be semver, e.g. 1.0.0',
  );

/**
 * A model alias, `inherit`, or a full model ID. Deliberately permissive about full IDs
 * so a model released after this build still validates.
 */
export const modelRefSchema = z
  .string()
  .refine(
    (v) => (MODEL_ALIASES as readonly string[]).includes(v) || /^[a-z][a-z0-9.\-]{4,}$/.test(v),
    'Use an alias (inherit, opus, sonnet, haiku, fable) or a full model ID',
  );

export const effortSchema = z.enum(EFFORT_LEVELS);
export const colorSchema = z.enum(AGENT_COLORS);

const idSchema = z.string().min(1);

/** A cron expression with 5 fields. Full range validation happens in the L2 validator. */
export const cronSchema = z
  .string()
  .regex(/^\s*\S+(\s+\S+){4}\s*$/, 'Must be a 5-field cron expression, e.g. "0 9 * * 1"');

// ── Misc tab: meta ────────────────────────────────────────────────────────────

export const authorSchema = z.object({
  name: z.string().default(''),
  email: z.string().default(''),
  url: z.string().default(''),
});

export const metaSchema = z.object({
  name: z.string().min(1, 'Give the agent a name').max(120).default('Untitled agent'),
  slug: slugSchema.default('untitled-agent'),
  description: z.string().max(1024).default(''),
  version: semverSchema.default('0.1.0'),
  /** `pinned` writes `version` into the manifest; `commit-sha` omits it so Claude Code tracks HEAD. */
  versionMode: z.enum(['pinned', 'commit-sha']).default('pinned'),
  author: authorSchema.default({ name: '', email: '', url: '' }),
  license: z.enum(SPDX_LICENSES).default('MIT'),
  keywords: z.array(z.string().min(1)).default([]),
  homepage: z.string().default(''),
  repository: z.string().default(''),
  /** `false` for agents that cost money or reach external services. */
  defaultEnabled: z.boolean().default(true),
  readme: z
    .object({
      mode: z.enum(['generated', 'custom']).default('generated'),
      body: z.string().optional(),
    })
    .default({ mode: 'generated' }),
  changelogEntry: z.string().default(''),
  /** Other plugins this one needs, optionally semver-constrained. */
  dependencies: z
    .array(z.object({ name: z.string().min(1), constraint: z.string().default('') }))
    .default([]),
});

// ── Goal tab ──────────────────────────────────────────────────────────────────

export const goalSchema = z.object({
  statement: z.string().default(''),
  successCriteria: z.array(z.string()).default([]),
  outOfScope: z.array(z.string()).default([]),
  tone: z.string().default(''),
  primaryModel: modelRefSchema.default('inherit'),
  primaryEffort: effortSchema.optional(),
});

// ── Workflows tab ─────────────────────────────────────────────────────────────

export const workflowSchema = z.object({
  id: idSchema,
  title: z.string().default(''),
  description: z.string().default(''),
  order: z.number().int().default(0),
  steps: z.array(z.string()).default([]),
  /** The "repetitive → Skill" toggle. */
  promoteToSkill: z.boolean().default(false),
  /**
   * Hand-edits to the promoted skill, preserved across toggling `promoteToSkill`
   * off and on again so users never lose work.
   */
  skillOverrides: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      whenToUse: z.string().optional(),
      body: z.string().optional(),
      allowedTools: z.array(z.string()).optional(),
      disableModelInvocation: z.boolean().optional(),
      userInvocable: z.boolean().optional(),
      model: modelRefSchema.optional(),
      effort: effortSchema.optional(),
    })
    .optional(),
  assignedSubAgentIds: z.array(idSchema).default([]),
});

// ── Sub-Agents tab ────────────────────────────────────────────────────────────

export const toolPolicySchema = z.object({
  mode: z.enum(['inherit', 'allowlist']).default('inherit'),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});

/**
 * "Context budget" — the honest replacement for a fake context-window number.
 * Each preset sets model + maxTurns + background/isolation together; `custom`
 * hands the raw fields back to the user.
 */
export const contextBudgetSchema = z.enum(['lean', 'standard', 'deep', 'custom']);

export const runtimeSchema = z.object({
  model: modelRefSchema.default('inherit'),
  effort: effortSchema.optional(),
  maxTurns: z.number().int().min(1).max(1000).optional(),
  background: z.boolean().default(false),
  /** Claude Code accepts exactly one value here. */
  isolation: z.literal('worktree').optional(),
  memory: z.enum(['user', 'project', 'local']).optional(),
  contextBudget: contextBudgetSchema.default('standard'),
});

export const subAgentSchema = z.object({
  id: idSchema,
  name: slugSchema.default('sub-agent'),
  /** Drives delegation: it must say *when* to use this agent, not just what it is. */
  description: z.string().default(''),
  systemPrompt: z.string().default(''),
  /** Workflow ids assigned to this sub-agent. Mirrored with `workflow.assignedSubAgentIds`. */
  taskIds: z.array(idSchema).default([]),
  trigger: z
    .object({ kind: z.enum(['auto', 'explicit', 'always-background']).default('auto') })
    .default({ kind: 'auto' }),
  tools: toolPolicySchema.default({ mode: 'inherit', allow: [], deny: [] }),
  runtime: runtimeSchema.default({
    model: 'inherit',
    background: false,
    contextBudget: 'standard',
  }),
  preloadSkillIds: z.array(idSchema).default([]),
  color: colorSchema.optional(),
});

export const orchestrationSchema = z.object({
  groups: z
    .array(
      z.object({
        id: idSchema,
        mode: z.enum(['parallel', 'series']).default('series'),
        subAgentIds: z.array(idSchema).default([]),
        order: z.number().int().default(0),
      }),
    )
    .default([]),
  /** What the orchestrator does with the collected results. */
  joinPolicy: z.string().default(''),
});

// ── Skills tab ────────────────────────────────────────────────────────────────

export const skillFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9._\-\/]+$/, 'Letters, digits, dot, dash, underscore and / only')
    .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'Must be a relative path'),
  content: z.string().default(''),
});

export const skillSchema = z.object({
  id: idSchema,
  source: z.enum(['new', 'attached', 'workflow']).default('new'),
  /** Set when `source === 'workflow'` so the UI can link back to the originating card. */
  fromWorkflowId: idSchema.optional(),
  name: slugSchema.default('new-skill'),
  description: z.string().default(''),
  whenToUse: z.string().default(''),
  body: z.string().default(''),
  allowedTools: z.array(z.string()).default([]),
  /** true → manual `/name` only; also blocks preloading and scheduled invocation. */
  disableModelInvocation: z.boolean().default(false),
  /** false → hidden from the `/` menu; background knowledge only. */
  userInvocable: z.boolean().default(true),
  model: modelRefSchema.optional(),
  effort: effortSchema.optional(),
  /** `fork` runs the skill in a forked subagent context. */
  context: z.literal('fork').optional(),
  agent: z.string().optional(),
  files: z.array(skillFileSchema).default([]),
});

// ── Connectors / Tools tab ────────────────────────────────────────────────────

export const envVarSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Environment variables are SCREAMING_SNAKE_CASE'),
  required: z.boolean().default(true),
  description: z.string().default(''),
  secret: z.boolean().default(true),
  /** Non-secret default only. A live-looking credential here is a blocking error. */
  defaultValue: z.string().default(''),
});

export const mcpServerSchema = z.object({
  id: idSchema,
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Lowercase letters, digits, dash and underscore'),
  displayName: z.string().default(''),
  description: z.string().default(''),
  transport: z.enum(['stdio', 'http', 'sse']).default('stdio'),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  url: z.string().default(''),
  env: z.array(envVarSchema).default([]),
  /** Restricts which `mcp__<key>__*` tools the agents may call. */
  toolAllowlist: z.array(z.string()).default([]),
  source: z.enum(['registry', 'custom']).default('custom'),
  docsUrl: z.string().default(''),
});

export const connectorsSchema = z.object({
  mcpServers: z.array(mcpServerSchema).default([]),
  builtinTools: z
    .object({ allow: z.array(z.string()).default([]), deny: z.array(z.string()).default([]) })
    .default({ allow: [], deny: [] }),
  /** Compiled into a copy-pasteable README block — plugin settings.json cannot carry permissions. */
  permissionsHint: z
    .object({ allow: z.array(z.string()).default([]), deny: z.array(z.string()).default([]) })
    .default({ allow: [], deny: [] }),
});

// ── Triggers ──────────────────────────────────────────────────────────────────

export const monitorConfigSchema = z.object({
  name: z.string().default(''),
  /** Shell command polled by the monitor; a non-empty stdout is the signal. */
  check: z.string().default(''),
  intervalSeconds: z.number().int().min(30).default(300),
  prompt: z.string().default(''),
});

export const manualTriggerSchema = z.object({
  id: idSchema,
  kind: z.literal('manual'),
  invocation: z.enum(['slash-command', 'agent-flag']).default('slash-command'),
});

export const scheduledTriggerSchema = z.object({
  id: idSchema,
  kind: z.literal('scheduled'),
  cron: cronSchema.default('0 9 * * 1'),
  timezone: z.string().default('UTC'),
  prompt: z.string().default(''),
});

export const hookTriggerSchema = z.object({
  id: idSchema,
  kind: z.literal('conditional'),
  via: z.literal('hook'),
  event: z.enum(HOOK_EVENTS),
  matcher: z.string().default(''),
  /** Script body; the compiler writes it to `scripts/<name>.sh` and points the hook at it. */
  command: z.string().default(''),
  name: slugSchema.default('on-event'),
});

export const monitorTriggerSchema = z.object({
  id: idSchema,
  kind: z.literal('conditional'),
  via: z.literal('monitor'),
  config: monitorConfigSchema.default({ name: '', check: '', intervalSeconds: 300, prompt: '' }),
});

/**
 * `conditional` covers two very different components, so the union nests: `kind` picks the
 * family, then `via` picks hook vs. monitor within it.
 */
export const triggerSchema = z.discriminatedUnion('kind', [
  manualTriggerSchema,
  scheduledTriggerSchema,
  z.discriminatedUnion('via', [hookTriggerSchema, monitorTriggerSchema]),
]);

// ── Knowledge ─────────────────────────────────────────────────────────────────

export const knowledgeSchema = z.object({
  id: idSchema,
  filename: z.string().min(1),
  mimeType: z.string().default('application/octet-stream'),
  sizeBytes: z.number().int().min(0).default(0),
  storageKey: z.string().default(''),
  purpose: z.string().default(''),
  /** `preload-skill` generates an index skill; large files make that slow and expensive. */
  loadStrategy: z.enum(['reference', 'preload-skill']).default('reference'),
});

// ── Packaging / deployment ────────────────────────────────────────────────────

export const packagingSchema = z.object({
  format: z.literal('plugin-zip').default('plugin-zip'),
  includeMarketplaceManifest: z.boolean().default(true),
  includeInstallScript: z.boolean().default(false),
});

export const deploymentSchema = z.object({
  target: z.literal('github').default('github'),
  repo: z.object({
    owner: z.string().default(''),
    name: z.string().default(''),
    visibility: z.enum(['public', 'private']).default('private'),
  }),
  branch: z.string().default('main'),
  asMarketplace: z.boolean().default(true),
});

// ── The canonical spec ────────────────────────────────────────────────────────

export const agentSpecSchema = z.object({
  specVersion: z.literal(SPEC_VERSION).default(SPEC_VERSION),
  meta: metaSchema.prefault({}),
  goal: goalSchema.prefault({}),
  workflows: z.array(workflowSchema).default([]),
  subAgents: z.array(subAgentSchema).default([]),
  orchestration: orchestrationSchema.default({ groups: [], joinPolicy: '' }),
  skills: z.array(skillSchema).default([]),
  connectors: connectorsSchema.prefault({}),
  triggers: z.array(triggerSchema).default([]),
  knowledge: z.array(knowledgeSchema).default([]),
  packaging: packagingSchema.prefault({}),
  deployment: deploymentSchema.optional(),
});

export type AgentSpec = z.infer<typeof agentSpecSchema>;
export type AgentMeta = z.infer<typeof metaSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type SubAgent = z.infer<typeof subAgentSchema>;
export type Orchestration = z.infer<typeof orchestrationSchema>;
export type OrchestrationGroup = Orchestration['groups'][number];
export type Skill = z.infer<typeof skillSchema>;
export type SkillFile = z.infer<typeof skillFileSchema>;
export type Connectors = z.infer<typeof connectorsSchema>;
export type McpServer = z.infer<typeof mcpServerSchema>;
export type EnvVar = z.infer<typeof envVarSchema>;
export type Trigger = z.infer<typeof triggerSchema>;
export type HookTrigger = Extract<Trigger, { via: 'hook' }>;
export type MonitorTrigger = Extract<Trigger, { via: 'monitor' }>;
export type ScheduledTrigger = Extract<Trigger, { kind: 'scheduled' }>;
export type KnowledgeItem = z.infer<typeof knowledgeSchema>;
export type Packaging = z.infer<typeof packagingSchema>;
export type Deployment = z.infer<typeof deploymentSchema>;
export type ContextBudget = z.infer<typeof contextBudgetSchema>;
export type ModelRef = string;
