import {
  BUILTIN_TOOLS,
  DANGEROUS_TOOLS,
  PLUGIN_AGENT_FORBIDDEN_KEYS,
  RESERVED_SLUGS,
  SECRET_PREFIXES,
  SKILL_DESCRIPTION_LIMIT,
  agentSpecSchema,
} from '@agent-spawner/spec';
import type { AgentSpec } from '@agent-spawner/spec';
import { allSkills } from './promote.ts';
import type { CompiledFile, Diagnostic } from './types.ts';

/**
 * L1 — Zod. Types, required fields, slug format, semver, cron shape.
 * Runs client-side on every keystroke and again server-side before export.
 */
export function validateL1(input: unknown): Diagnostic[] {
  const result = agentSpecSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    rule: `zod/${issue.code}`,
    severity: 'error' as const,
    message: issue.message,
    path: formatPath(issue.path),
    tab: tabForPath(issue.path.map(String)),
    layer: 'zod' as const,
  }));
}

/**
 * L2 — semantic rules. These are the ones that actually save users: everything here
 * describes a plugin that parses fine but does not work.
 */
export function validateL2(spec: AgentSpec, files: CompiledFile[]): Diagnostic[] {
  return [
    ...ruleForbiddenAgentKeys(spec),
    ...ruleToolsResolve(spec),
    ...ruleDenyOverlap(spec),
    ...ruleSkillDescriptionLength(spec),
    ...ruleWorkflowAssignment(spec),
    ...ruleNoComponentsInPluginDir(files),
    ...ruleOrphanSubAgents(spec),
    ...ruleOrchestrationCoverage(spec),
    ...ruleNoLiteralSecrets(spec),
    ...ruleNameCollisions(spec),
    ...ruleDescriptionsPresent(spec),
    ...ruleReservedSlug(spec),
    ...ruleLeastPrivilege(spec),
    ...ruleConnectorShape(spec),
    ...ruleCronFields(spec),
    ...ruleHookScripts(spec),
    ...ruleSkillFork(spec),
    ...ruleKnowledgePreloadSize(spec),
    ...rulePinnedVersion(spec),
  ];
}

// ── rules ─────────────────────────────────────────────────────────────────────

/** Plugin agents may not carry `hooks`, `mcpServers` or `permissionMode` (PLAN §2.2). */
function ruleForbiddenAgentKeys(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  spec.subAgents.forEach((agent, i) => {
    for (const key of PLUGIN_AGENT_FORBIDDEN_KEYS) {
      if (key in (agent as unknown as Record<string, unknown>)) {
        out.push({
          rule: 'plugin-agent-forbidden-key',
          severity: 'error',
          message: `\`${agent.name}\` carries \`${key}\`, which Claude Code rejects on plugin-packaged agents for security reasons. Move it to a local agent in the consuming project, or drop it.`,
          path: `subAgents[${i}].${key}`,
          tab: 'sub-agents',
          layer: 'semantic',
        });
      }
    }
  });
  return out;
}

const BUILTIN = new Set<string>(BUILTIN_TOOLS);
const MCP_PATTERN = /^mcp__[a-z0-9_-]+(__[A-Za-z0-9_*-]+)?$/;

/** If nothing in `tools` resolves, the subagent silently fails to launch. */
function ruleToolsResolve(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  const serverKeys = new Set(spec.connectors.mcpServers.map((s) => s.key));

  const check = (
    tool: string,
    path: string,
    tab: Diagnostic['tab'],
    label: string,
  ): Diagnostic | null => {
    if (BUILTIN.has(tool)) return null;
    if (MCP_PATTERN.test(tool)) {
      const key = tool.slice(5).split('__')[0]!;
      if (!serverKeys.has(key)) {
        return {
          rule: 'tool-unknown-mcp-server',
          severity: 'error',
          message: `${label} references \`${tool}\`, but no MCP server with key \`${key}\` is configured.`,
          path,
          tab,
          layer: 'semantic',
        };
      }
      return null;
    }
    return {
      rule: 'tool-unresolved',
      severity: 'error',
      message: `${label} lists \`${tool}\`, which is not a built-in tool or an \`mcp__server\` pattern. A subagent whose \`tools\` resolves to nothing fails to launch.`,
      path,
      tab,
      layer: 'semantic',
    };
  };

  spec.connectors.builtinTools.allow.forEach((tool, i) => {
    const d = check(tool, `connectors.builtinTools.allow[${i}]`, 'connectors', 'The built-in tool allowlist');
    if (d) out.push(d);
  });
  spec.connectors.builtinTools.deny.forEach((tool, i) => {
    const d = check(tool, `connectors.builtinTools.deny[${i}]`, 'connectors', 'The built-in tool denylist');
    if (d) out.push(d);
  });

  spec.subAgents.forEach((agent, ai) => {
    agent.tools.allow.forEach((tool, i) => {
      const d = check(tool, `subAgents[${ai}].tools.allow[${i}]`, 'sub-agents', `\`${agent.name}\``);
      if (d) out.push(d);
    });
    agent.tools.deny.forEach((tool, i) => {
      const d = check(tool, `subAgents[${ai}].tools.deny[${i}]`, 'sub-agents', `\`${agent.name}\``);
      if (d) out.push(d);
    });
    if (agent.tools.mode === 'allowlist' && agent.tools.allow.length === 0) {
      out.push({
        rule: 'tool-empty-allowlist',
        severity: 'error',
        message: `\`${agent.name}\` is set to an allowlist but lists no tools. It will fail to launch. Grant at least one tool, or switch it back to inheriting.`,
        path: `subAgents[${ai}].tools.allow`,
        tab: 'sub-agents',
        layer: 'semantic',
      });
    }
  });

  allSkills(spec).forEach((skill, si) => {
    skill.allowedTools.forEach((tool, i) => {
      // Skills accept Bash command patterns like `Bash(git status:*)`.
      const base = tool.replace(/\(.*\)$/, '');
      const d = check(base, `skills[${si}].allowedTools[${i}]`, 'skills', `Skill \`${skill.name}\``);
      if (d) out.push(d);
    });
  });

  return out;
}

/** `disallowedTools` is applied first, so a tool in both lists is simply removed. */
function ruleDenyOverlap(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  const overlap = (allow: string[], deny: string[]) => allow.filter((t) => deny.includes(t));

  const globalOverlap = overlap(spec.connectors.builtinTools.allow, spec.connectors.builtinTools.deny);
  if (globalOverlap.length > 0) {
    out.push({
      rule: 'tool-deny-overlap',
      severity: 'warning',
      message: `${globalOverlap.join(', ')} appear in both the allow and deny lists. \`disallowedTools\` is applied first, so these tools are removed entirely.`,
      path: 'connectors.builtinTools.deny',
      tab: 'connectors',
      layer: 'semantic',
    });
  }

  spec.subAgents.forEach((agent, i) => {
    const both = overlap(agent.tools.allow, agent.tools.deny);
    if (both.length > 0) {
      out.push({
        rule: 'tool-deny-overlap',
        severity: 'warning',
        message: `\`${agent.name}\` allows and denies ${both.join(', ')}. Deny wins, so ${
          both.length === 1 ? 'this tool is' : 'these tools are'
        } removed.`,
        path: `subAgents[${i}].tools.deny`,
        tab: 'sub-agents',
        layer: 'semantic',
      });
    }
  });

  return out;
}

/** `description` + `when_to_use` is truncated at 1,536 chars in the skill listing. */
function ruleSkillDescriptionLength(spec: AgentSpec): Diagnostic[] {
  return allSkills(spec)
    .map((skill, i) => {
      const length = skill.description.length + skill.whenToUse.length;
      if (length <= SKILL_DESCRIPTION_LIMIT) return null;
      return {
        rule: 'skill-description-too-long',
        severity: 'warning' as const,
        message: `Skill \`${skill.name}\`: description + when-to-use is ${length} characters; the listing truncates at ${SKILL_DESCRIPTION_LIMIT}. Put the key use case first.`,
        path: `skills[${i}].description`,
        tab: 'skills' as const,
        layer: 'semantic' as const,
      };
    })
    .filter((d) => d !== null) as Diagnostic[];
}

function ruleWorkflowAssignment(spec: AgentSpec): Diagnostic[] {
  if (spec.subAgents.length === 0) return [];
  return spec.workflows
    .map((w, i) => {
      if (w.assignedSubAgentIds.length > 0 || w.promoteToSkill) return null;
      return {
        rule: 'workflow-unassigned',
        severity: 'info' as const,
        message: `"${w.title || 'Untitled workflow'}" is not assigned to a sub-agent and is not promoted to a skill, so the primary agent does it inline. That is fine — flagging it in case it was an oversight.`,
        path: `workflows[${i}].assignedSubAgentIds`,
        tab: 'workflows' as const,
        layer: 'semantic' as const,
      };
    })
    .filter((d) => d !== null) as Diagnostic[];
}

/** The #1 cause of plugins silently not loading. */
function ruleNoComponentsInPluginDir(files: CompiledFile[]): Diagnostic[] {
  const allowed = new Set(['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']);
  return files
    .filter((f) => f.path.startsWith('.claude-plugin/') && !allowed.has(f.path))
    .map((f) => ({
      rule: 'component-in-plugin-dir',
      severity: 'error' as const,
      message: `\`${f.path}\` sits inside \`.claude-plugin/\`. Only \`plugin.json\` and \`marketplace.json\` belong there; everything else must be at the plugin root or Claude Code will not load it.`,
      file: f.path,
      tab: 'preview' as const,
      layer: 'semantic' as const,
    }));
}

function ruleOrphanSubAgents(spec: AgentSpec): Diagnostic[] {
  const assigned = new Set(spec.workflows.flatMap((w) => w.assignedSubAgentIds));
  const placed = new Set(spec.orchestration.groups.flatMap((g) => g.subAgentIds));
  return spec.subAgents
    .map((agent, i) => {
      if (assigned.has(agent.id) || placed.has(agent.id)) return null;
      return {
        rule: 'orphan-subagent',
        severity: 'warning' as const,
        message: `\`${agent.name}\` is defined but no workflow delegates to it and it is not on the orchestration canvas. It will ship but never be used.`,
        path: `subAgents[${i}]`,
        tab: 'sub-agents' as const,
        layer: 'semantic' as const,
      };
    })
    .filter((d) => d !== null) as Diagnostic[];
}

function ruleOrchestrationCoverage(spec: AgentSpec): Diagnostic[] {
  if (spec.orchestration.groups.length === 0) return [];
  const out: Diagnostic[] = [];
  const counts = new Map<string, number>();
  for (const group of spec.orchestration.groups) {
    for (const id of group.subAgentIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  for (const [id, count] of counts) {
    if (count > 1) {
      const name = spec.subAgents.find((a) => a.id === id)?.name ?? id;
      out.push({
        rule: 'orchestration-duplicate',
        severity: 'warning',
        message: `\`${name}\` appears in ${count} orchestration stages. The generated prompt will tell the orchestrator to spawn it more than once.`,
        path: 'orchestration.groups',
        tab: 'sub-agents',
        layer: 'semantic',
      });
    }
  }

  const missing = spec.subAgents.filter((a) => !counts.has(a.id));
  if (missing.length > 0) {
    out.push({
      rule: 'orchestration-incomplete',
      severity: 'info',
      message: `Not on the orchestration canvas: ${missing.map((a) => `\`${a.name}\``).join(', ')}. The prompt will tell the orchestrator to use them "as needed" rather than at a specific stage.`,
      path: 'orchestration.groups',
      tab: 'sub-agents',
      layer: 'semantic',
    });
  }

  const dangling = [...counts.keys()].filter((id) => !spec.subAgents.some((a) => a.id === id));
  for (const id of dangling) {
    out.push({
      rule: 'orchestration-dangling',
      severity: 'error',
      message: `The orchestration canvas references a sub-agent that no longer exists (${id}).`,
      path: 'orchestration.groups',
      tab: 'sub-agents',
      layer: 'semantic',
    });
  }

  return out;
}

/** Entropy + known-prefix scan. A hit is a hard block on export and deploy. */
export function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (v.length < 12) return false;
  if (v.includes('${') || v.startsWith('$')) return false;
  if (SECRET_PREFIXES.some((p) => v.startsWith(p))) return true;
  if (v.length < 24) return false;
  // Placeholders like `your-token-here` are low entropy; real credentials are not.
  return shannonEntropy(v) > 3.6 && /[A-Za-z]/.test(v) && /\d/.test(v);
}

function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function ruleNoLiteralSecrets(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  spec.connectors.mcpServers.forEach((server, si) => {
    server.env.forEach((v, vi) => {
      if (looksLikeSecret(v.defaultValue)) {
        out.push({
          rule: 'secret-literal',
          severity: 'error',
          message: `\`${server.key}\` → \`${v.name}\` has what looks like a live credential as its default value. Nothing secret may be baked into the bundle: declare the variable and leave the value empty, and the consumer will be asked for it.`,
          path: `connectors.mcpServers[${si}].env[${vi}].defaultValue`,
          tab: 'connectors',
          layer: 'semantic',
        });
      }
    });
    server.args.forEach((arg, ai) => {
      if (looksLikeSecret(arg)) {
        out.push({
          rule: 'secret-literal',
          severity: 'error',
          message: `\`${server.key}\` passes what looks like a live credential in \`args[${ai}]\`. Use an \`\${ENV_VAR}\` placeholder instead.`,
          path: `connectors.mcpServers[${si}].args[${ai}]`,
          tab: 'connectors',
          layer: 'semantic',
        });
      }
    });
  });
  return out;
}

/** Two agents (or two skills) with the same name overwrite each other's file. */
function ruleNameCollisions(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];

  const agentNames = new Map<string, number[]>();
  spec.subAgents.forEach((a, i) => agentNames.set(a.name, [...(agentNames.get(a.name) ?? []), i]));
  for (const [name, indices] of agentNames) {
    if (indices.length > 1) {
      out.push({
        rule: 'duplicate-agent-name',
        severity: 'error',
        message: `${indices.length} sub-agents are named \`${name}\`. They compile to the same file, so all but one would be lost.`,
        path: `subAgents[${indices[1]}].name`,
        tab: 'sub-agents',
        layer: 'semantic',
      });
    }
    if (name === spec.meta.slug) {
      out.push({
        rule: 'subagent-shadows-primary',
        severity: 'error',
        message: `Sub-agent \`${name}\` has the same name as the plugin's primary agent, so they compile to the same file.`,
        path: `subAgents[${indices[0]}].name`,
        tab: 'sub-agents',
        layer: 'semantic',
      });
    }
  }

  const skillNames = new Map<string, number>();
  allSkills(spec).forEach((s, i) => {
    const seen = skillNames.get(s.name);
    if (seen !== undefined) {
      out.push({
        rule: 'duplicate-skill-name',
        severity: 'error',
        message: `Two skills are named \`${s.name}\` — they compile to the same \`skills/${s.name}/SKILL.md\`.`,
        path: `skills[${i}].name`,
        tab: 'skills',
        layer: 'semantic',
      });
    }
    skillNames.set(s.name, i);
  });

  const serverKeys = new Set<string>();
  spec.connectors.mcpServers.forEach((s, i) => {
    if (serverKeys.has(s.key)) {
      out.push({
        rule: 'duplicate-mcp-key',
        severity: 'error',
        message: `Two MCP servers use the key \`${s.key}\`; only one survives in \`.mcp.json\`.`,
        path: `connectors.mcpServers[${i}].key`,
        tab: 'connectors',
        layer: 'semantic',
      });
    }
    serverKeys.add(s.key);
  });

  return out;
}

/** `description` is the field Claude reads to decide whether to delegate. */
function ruleDescriptionsPresent(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];

  if (!spec.meta.description.trim()) {
    out.push({
      rule: 'missing-plugin-description',
      severity: 'warning',
      message: 'The plugin has no description. It is what users see in the marketplace listing.',
      path: 'meta.description',
      tab: 'misc',
      layer: 'semantic',
    });
  }

  if (!spec.goal.statement.trim()) {
    out.push({
      rule: 'missing-goal',
      severity: 'error',
      message: 'No objective is set, so the primary agent would ship with an empty system prompt.',
      path: 'goal.statement',
      tab: 'goal',
      layer: 'semantic',
    });
  }

  spec.subAgents.forEach((agent, i) => {
    if (!agent.description.trim()) {
      out.push({
        rule: 'missing-agent-description',
        severity: 'error',
        message: `\`${agent.name}\` has no description. Delegation is chosen from this field, so an empty one means the agent is never picked. Say *when* to use it, not just what it is.`,
        path: `subAgents[${i}].description`,
        tab: 'sub-agents',
        layer: 'semantic',
      });
    }
    if (!agent.systemPrompt.trim()) {
      out.push({
        rule: 'missing-agent-prompt',
        severity: 'warning',
        message: `\`${agent.name}\` has no system prompt; it will ship with a one-line generated placeholder.`,
        path: `subAgents[${i}].systemPrompt`,
        tab: 'sub-agents',
        layer: 'semantic',
      });
    }
  });

  allSkills(spec).forEach((skill, i) => {
    if (!skill.description.trim() && !skill.disableModelInvocation) {
      out.push({
        rule: 'missing-skill-description',
        severity: 'error',
        message: `Skill \`${skill.name}\` has no description. Claude decides when to auto-load a skill purely from this field.`,
        path: `skills[${i}].description`,
        tab: 'skills',
        layer: 'semantic',
      });
    }
  });

  return out;
}

function ruleReservedSlug(spec: AgentSpec): Diagnostic[] {
  if (!RESERVED_SLUGS.has(spec.meta.slug)) return [];
  return [
    {
      rule: 'reserved-slug',
      severity: 'error',
      message: `\`${spec.meta.slug}\` is a reserved name and will collide with Claude Code's own components.`,
      path: 'meta.slug',
      tab: 'misc',
      layer: 'semantic',
    },
  ];
}

function ruleLeastPrivilege(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  const granted = (list: string[]) => list.filter((t) => (DANGEROUS_TOOLS as readonly string[]).includes(t));

  const globalDangerous = granted(spec.connectors.builtinTools.allow);
  if (globalDangerous.length > 0 && spec.connectors.permissionsHint.deny.length === 0) {
    out.push({
      rule: 'least-privilege',
      severity: 'warning',
      message: `${globalDangerous.join(' and ')} ${
        globalDangerous.length === 1 ? 'is' : 'are'
      } granted with no deny rules. Add specific deny patterns (for example \`Bash(rm:*)\`, \`Write(.env)\`) so the consuming project is not handing over unrestricted access.`,
      path: 'connectors.permissionsHint.deny',
      tab: 'connectors',
      layer: 'semantic',
    });
  }

  spec.subAgents.forEach((agent, i) => {
    const dangerous = granted(agent.tools.allow);
    if (dangerous.length > 0 && agent.tools.deny.length === 0 && agent.runtime.isolation !== 'worktree') {
      out.push({
        rule: 'least-privilege-agent',
        severity: 'info',
        message: `\`${agent.name}\` can use ${dangerous.join(' and ')} with no deny rules and is not isolated to a worktree. Consider \`isolation: worktree\` so its writes stay contained.`,
        path: `subAgents[${i}].tools.deny`,
        tab: 'sub-agents',
        layer: 'semantic',
      });
    }
  });

  return out;
}

function ruleConnectorShape(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  spec.connectors.mcpServers.forEach((server, i) => {
    if (server.transport === 'stdio' && !server.command.trim()) {
      out.push({
        rule: 'mcp-missing-command',
        severity: 'error',
        message: `\`${server.key}\` uses stdio transport but has no command to run.`,
        path: `connectors.mcpServers[${i}].command`,
        tab: 'connectors',
        layer: 'semantic',
      });
    }
    if (server.transport !== 'stdio' && !/^https?:\/\//.test(server.url)) {
      out.push({
        rule: 'mcp-missing-url',
        severity: 'error',
        message: `\`${server.key}\` uses ${server.transport} transport and needs an http(s) URL.`,
        path: `connectors.mcpServers[${i}].url`,
        tab: 'connectors',
        layer: 'semantic',
      });
    }
    server.env.forEach((v, vi) => {
      if (v.required && !v.description.trim()) {
        out.push({
          rule: 'env-undocumented',
          severity: 'info',
          message: `\`${v.name}\` is required but undocumented. The description is what the consumer sees when asked for it.`,
          path: `connectors.mcpServers[${i}].env[${vi}].description`,
          tab: 'connectors',
          layer: 'semantic',
        });
      }
    });
  });
  return out;
}

const CRON_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function ruleCronFields(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  spec.triggers.forEach((trigger, i) => {
    if (trigger.kind !== 'scheduled') return;
    const fields = trigger.cron.trim().split(/\s+/);
    fields.forEach((field, fi) => {
      const range = CRON_RANGES[fi];
      if (!range) return;
      const ok = field.split(',').every((part) => cronPartValid(part, range));
      if (!ok) {
        out.push({
          rule: 'cron-out-of-range',
          severity: 'error',
          message: `\`${trigger.cron}\`: field ${fi + 1} (\`${field}\`) is not valid for the range ${range[0]}–${range[1]}.`,
          path: `triggers[${i}].cron`,
          tab: 'misc',
          layer: 'semantic',
        });
      }
    });
  });
  return out;
}

function cronPartValid(part: string, [lo, hi]: [number, number]): boolean {
  const [value, step] = part.split('/');
  if (step !== undefined && !/^\d+$/.test(step)) return false;
  if (value === '*' || value === undefined) return true;
  const bounds = value.split('-');
  return bounds.every((b) => /^\d+$/.test(b) && Number(b) >= lo && Number(b) <= hi);
}

function ruleHookScripts(spec: AgentSpec): Diagnostic[] {
  const out: Diagnostic[] = [];
  spec.triggers.forEach((trigger, i) => {
    if (trigger.kind !== 'conditional' || trigger.via !== 'hook') return;
    if (!trigger.command.trim()) {
      out.push({
        rule: 'hook-empty',
        severity: 'warning',
        message: `The \`${trigger.event}\` hook has no command; it compiles to a stub script that does nothing.`,
        path: `triggers[${i}].command`,
        tab: 'misc',
        layer: 'semantic',
      });
    }
  });
  return out;
}

function ruleSkillFork(spec: AgentSpec): Diagnostic[] {
  return allSkills(spec)
    .map((skill, i) => {
      if (skill.context !== 'fork' || skill.agent) return null;
      return {
        rule: 'skill-fork-without-agent',
        severity: 'warning' as const,
        message: `Skill \`${skill.name}\` runs in a forked context but names no \`agent\`, so the fork inherits the caller's agent type.`,
        path: `skills[${i}].agent`,
        tab: 'skills' as const,
        layer: 'semantic' as const,
      };
    })
    .filter((d) => d !== null) as Diagnostic[];
}

const PRELOAD_WARN_BYTES = 256 * 1024;

function ruleKnowledgePreloadSize(spec: AgentSpec): Diagnostic[] {
  return spec.knowledge
    .map((item, i) => {
      if (item.loadStrategy !== 'preload-skill' || item.sizeBytes <= PRELOAD_WARN_BYTES) return null;
      return {
        rule: 'knowledge-preload-large',
        severity: 'warning' as const,
        message: `\`${item.filename}\` is ${(item.sizeBytes / 1024).toFixed(0)} KB and set to preload. Preloading large files into every session is the fastest way to make an agent slow and expensive — switch it to "read on demand" unless it is genuinely needed every time.`,
        path: `knowledge[${i}].loadStrategy`,
        tab: 'misc' as const,
        layer: 'semantic' as const,
      };
    })
    .filter((d) => d !== null) as Diagnostic[];
}

function rulePinnedVersion(spec: AgentSpec): Diagnostic[] {
  if (spec.meta.versionMode !== 'pinned') return [];
  return [
    {
      rule: 'pinned-version-reminder',
      severity: 'info',
      message: `Version is pinned at \`${spec.meta.version}\`. Users will not receive this build as an update unless the version is bumped.`,
      path: 'meta.version',
      tab: 'misc',
      layer: 'semantic',
    },
  ];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc ? `${acc}.${String(segment)}` : String(segment);
  }, '');
}

function tabForPath(path: string[]): Diagnostic['tab'] {
  switch (path[0]) {
    case 'goal':
      return 'goal';
    case 'workflows':
      return 'workflows';
    case 'subAgents':
    case 'orchestration':
      return 'sub-agents';
    case 'skills':
      return 'skills';
    case 'connectors':
      return 'connectors';
    default:
      return 'misc';
  }
}
