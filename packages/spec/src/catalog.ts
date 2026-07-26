/**
 * Static catalogs of the values Claude Code accepts.
 *
 * These are data, not schema: the Zod schema references them, the UI renders them,
 * and the validator resolves user input against them. Keeping them in one file means
 * a Claude Code release that adds a tool or a model is a one-line change here.
 */

/** Model aliases accepted in agent/skill frontmatter, plus `inherit`. */
export const MODEL_ALIASES = ['inherit', 'opus', 'sonnet', 'haiku', 'fable'] as const;

/** Full model IDs offered in the pickers. Any other full ID is still accepted. */
export const MODEL_IDS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-haiku-4-5-20251001',
] as const;

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Built-in tool names usable in `tools` / `disallowedTools` frontmatter.
 * `Agent` is the delegation tool — a primary agent without it cannot spawn sub-agents.
 */
export const BUILTIN_TOOLS = [
  'Agent',
  'Bash',
  'BashOutput',
  'Edit',
  'Glob',
  'Grep',
  'KillShell',
  'NotebookEdit',
  'Read',
  'Skill',
  'SlashCommand',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
] as const;

/** Tools whose broad grant should nudge a least-privilege warning. */
export const DANGEROUS_TOOLS = ['Bash', 'Write', 'Edit', 'NotebookEdit'] as const;

export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SubagentStart',
  'PreCompact',
  'SessionStart',
  'SessionEnd',
] as const;

/** Hook events that accept a tool-name matcher. */
export const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

export const AGENT_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'cyan',
] as const;

/**
 * Frontmatter keys a *plugin-shipped* agent may carry. Anything outside this set is
 * rejected by Claude Code for security reasons — see PLAN §2.2.
 */
export const PLUGIN_AGENT_ALLOWED_KEYS = [
  'name',
  'description',
  'model',
  'effort',
  'maxTurns',
  'tools',
  'disallowedTools',
  'skills',
  'memory',
  'background',
  'isolation',
] as const;

/** Keys that exist on local agents but are refused inside a plugin. */
export const PLUGIN_AGENT_FORBIDDEN_KEYS = ['hooks', 'mcpServers', 'permissionMode'] as const;

/** Combined `description` + `when_to_use` budget in the skill listing. */
export const SKILL_DESCRIPTION_LIMIT = 1536;

/** Known live-credential prefixes; a literal match is a hard block on export. */
export const SECRET_PREFIXES = [
  'sk-',
  'sk_live_',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'github_pat_',
  'xoxb-',
  'xoxp-',
  'xapp-',
  'AKIA',
  'AIza',
  'glpat-',
  'npm_',
];

export const SPDX_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'GPL-3.0-only',
  'AGPL-3.0-only',
  'MPL-2.0',
  'Unlicense',
  'UNLICENSED',
] as const;

/** Names a plugin may not take (would shadow or collide with built-ins). */
export const RESERVED_SLUGS = new Set([
  'claude',
  'claude-code',
  'anthropic',
  'plugin',
  'plugins',
  'skills',
  'agents',
  'hooks',
  'commands',
  'marketplace',
  'settings',
]);
