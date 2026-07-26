import { agentSpecSchema } from '@agent-spawner/spec';
import type { AgentSpec } from '@agent-spawner/spec';

/**
 * Fixture specs for the golden-file tests. Ids are hard-coded (never generated) so that
 * output is reproducible run to run.
 */

const minimal: AgentSpec = agentSpecSchema.parse({
  meta: {
    name: 'Changelog Writer',
    slug: 'changelog-writer',
    description: 'Turns merged pull requests into a human changelog entry.',
    version: '1.0.0',
    author: { name: 'Ada Lovelace', email: 'ada@example.com' },
    keywords: ['changelog', 'release'],
  },
  goal: {
    statement:
      'Given a range of merged pull requests, write the changelog entry a user would actually want to read.',
    successCriteria: ['Every user-visible change is mentioned', 'No internal refactors are listed'],
    outOfScope: ['Deciding the version number', 'Publishing the release'],
    primaryModel: 'sonnet',
  },
});

/**
 * The PLAN §15 scenario end to end: a goal, four workflows with one promoted to a skill,
 * two sub-agents in parallel followed by a third in series, an MCP connector with declared
 * credentials, an uploaded document, a scheduled trigger and a hook.
 */
const researchAssistant: AgentSpec = agentSpecSchema.parse({
  meta: {
    name: 'Weekly Research Brief',
    slug: 'weekly-research-brief',
    description:
      'Researches a topic across the web and the team wiki, then produces a one-page brief every Monday.',
    version: '0.3.0',
    versionMode: 'pinned',
    author: { name: 'Ada Lovelace', email: 'ada@example.com', url: 'https://example.com' },
    license: 'Apache-2.0',
    keywords: ['research', 'reporting'],
    homepage: 'https://example.com/weekly-research-brief',
    repository: 'https://github.com/ada/weekly-research-brief',
    defaultEnabled: false,
    changelogEntry: 'Added the fact-checking pass and the GitHub connector.',
    dependencies: [{ name: 'markdown-tools', constraint: '^2.0.0' }],
  },
  goal: {
    statement:
      'Produce a one-page research brief on an assigned topic each week, grounded in sources a reader can check.',
    successCriteria: [
      'Every claim has a source link',
      'The brief fits on one page',
      'Contradictions between sources are called out rather than averaged away',
    ],
    outOfScope: [
      'Making recommendations or investment calls',
      'Summarising sources behind a paywall the team cannot access',
    ],
    tone: 'Plain, specific, no hedging.',
    primaryModel: 'opus',
    primaryEffort: 'high',
  },
  workflows: [
    {
      id: 'wf_scope',
      title: 'Scope the question',
      description: 'Turn the assigned topic into three answerable sub-questions.',
      order: 0,
      steps: ['Restate the topic', 'List what a reader would need to know', 'Pick the three that matter'],
      promoteToSkill: false,
      assignedSubAgentIds: [],
    },
    {
      id: 'wf_gather',
      title: 'Gather sources',
      description: 'Search the web and the team wiki for primary sources.',
      order: 1,
      steps: ['Search the web', 'Search the wiki', 'Record each source URL and its claim'],
      promoteToSkill: false,
      assignedSubAgentIds: ['sa_web', 'sa_wiki'],
    },
    {
      id: 'wf_check',
      title: 'Fact-check the draft',
      description: 'Verify every claim against the recorded sources before the brief goes out.',
      order: 2,
      steps: [
        'List every factual claim in the draft',
        'Match each to a source',
        'Flag the ones that have none',
      ],
      promoteToSkill: true,
      skillOverrides: { whenToUse: 'Use before publishing anything with factual claims in it.' },
      assignedSubAgentIds: ['sa_writer'],
    },
    {
      id: 'wf_write',
      title: 'Write the brief',
      description: 'Assemble the one-page brief from the verified findings.',
      order: 3,
      steps: [],
      promoteToSkill: false,
      assignedSubAgentIds: ['sa_writer'],
    },
  ],
  subAgents: [
    {
      id: 'sa_web',
      name: 'web-researcher',
      description:
        'Use when the topic needs public sources. Searches the open web and returns claims with URLs.',
      systemPrompt:
        'You find primary sources on the open web. Prefer the original document over any article about it. Return a list of claims, each with the URL it came from.',
      taskIds: ['wf_gather'],
      trigger: { kind: 'auto' },
      tools: { mode: 'allowlist', allow: ['WebSearch', 'WebFetch', 'Read'], deny: [] },
      runtime: { model: 'sonnet', maxTurns: 30, background: false, contextBudget: 'standard' },
      preloadSkillIds: [],
      color: 'blue',
    },
    {
      id: 'sa_wiki',
      name: 'wiki-researcher',
      description:
        'Use when the topic may already be covered internally. Searches the team wiki through the GitHub connector.',
      systemPrompt:
        'You search the team wiki for prior work on the topic. Report what already exists so the brief does not repeat it.',
      taskIds: ['wf_gather'],
      trigger: { kind: 'auto' },
      tools: { mode: 'allowlist', allow: ['Read', 'Grep', 'mcp__github'], deny: [] },
      runtime: { model: 'sonnet', maxTurns: 30, background: false, contextBudget: 'standard' },
      preloadSkillIds: [],
      color: 'green',
    },
    {
      id: 'sa_writer',
      name: 'brief-writer',
      description:
        'Use once research is in hand. Turns collected findings into the one-page brief and fact-checks it.',
      systemPrompt:
        'You write the brief. Every sentence that makes a factual claim carries its source link. If two sources disagree, say so in the text.',
      taskIds: ['wf_check', 'wf_write'],
      trigger: { kind: 'auto' },
      tools: { mode: 'allowlist', allow: ['Read', 'Write', 'Edit'], deny: ['Bash'] },
      runtime: {
        model: 'opus',
        effort: 'high',
        maxTurns: 60,
        background: false,
        isolation: 'worktree',
        contextBudget: 'custom',
      },
      preloadSkillIds: ['sk_house_style'],
      color: 'purple',
    },
  ],
  orchestration: {
    groups: [
      { id: 'og_1', mode: 'parallel', subAgentIds: ['sa_web', 'sa_wiki'], order: 0 },
      { id: 'og_2', mode: 'series', subAgentIds: ['sa_writer'], order: 1 },
    ],
    joinPolicy:
      'Merge the two research sets, drop duplicates by URL, and hand the combined list to brief-writer.',
  },
  skills: [
    {
      id: 'sk_house_style',
      source: 'new',
      name: 'house-style',
      description: 'The publication rules every brief follows: length, voice, citation format.',
      whenToUse: 'Consult before writing or editing any brief.',
      body: '# House style\n\n- One page. If it does not fit, cut.\n- Active voice.\n- Every claim carries a link in parentheses right after it.\n- No adjectives that cannot be checked.',
      allowedTools: ['Read'],
      disableModelInvocation: false,
      userInvocable: false,
      files: [],
    },
  ],
  connectors: {
    mcpServers: [
      {
        id: 'mcp_github',
        key: 'github',
        displayName: 'GitHub',
        description: 'Reads the team wiki and issues.',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: [
          {
            name: 'GITHUB_TOKEN',
            required: true,
            description: 'A fine-grained token with read access to the wiki repository.',
            secret: true,
            defaultValue: '',
          },
        ],
        toolAllowlist: ['search_repositories', 'get_file_contents'],
        source: 'registry',
        docsUrl: 'https://github.com/modelcontextprotocol/servers',
      },
    ],
    builtinTools: {
      allow: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
      deny: ['Bash'],
    },
    permissionsHint: {
      allow: ['Read(**)', 'Write(briefs/**)'],
      deny: ['Read(.env)', 'Write(.env)'],
    },
  },
  triggers: [
    {
      id: 'tr_cron',
      kind: 'scheduled',
      cron: '0 9 * * 1',
      timezone: 'Europe/London',
      prompt: 'Write this week\'s research brief on the topic in briefs/NEXT.md.',
    },
    {
      id: 'tr_hook',
      kind: 'conditional',
      via: 'hook',
      event: 'PostToolUse',
      matcher: 'Write',
      name: 'lint-brief',
      command: 'npx markdownlint "$(jq -r \'.tool_input.file_path\' <<<"$payload")" || true',
    },
  ],
  knowledge: [
    {
      id: 'kn_style',
      filename: 'past-briefs.md',
      mimeType: 'text/markdown',
      sizeBytes: 48213,
      storageKey: 'knowledge/kn_style/past-briefs.md',
      purpose: 'Six months of previous briefs, for tone and format.',
      loadStrategy: 'reference',
    },
  ],
  packaging: {
    format: 'plugin-zip',
    includeMarketplaceManifest: true,
    includeInstallScript: true,
  },
  deployment: {
    target: 'github',
    repo: { owner: 'ada', name: 'weekly-research-brief', visibility: 'public' },
    branch: 'main',
    asMarketplace: true,
  },
});

export const fixtures: Record<string, AgentSpec> = {
  minimal,
  'research-assistant': researchAssistant,
};
