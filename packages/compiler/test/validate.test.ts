import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentSpecSchema, emptySpec } from '@agent-spawner/spec';
import type { AgentSpec } from '@agent-spawner/spec';
import { compile } from '../src/index.ts';
import { looksLikeSecret, validateL1, validateL2 } from '../src/validate.ts';
import { fixtures } from './fixtures.ts';

/** One positive and one negative case per L2 rule (PLAN §13). */

function check(spec: AgentSpec) {
  const { files, diagnostics } = compile(spec);
  return { files, diagnostics, rules: diagnostics.map((d) => d.rule) };
}

function base(overrides: Record<string, unknown> = {}): AgentSpec {
  return agentSpecSchema.parse({
    ...emptySpec('Test agent'),
    goal: { statement: 'Do a thing well.' },
    meta: { name: 'Test agent', slug: 'test-agent', description: 'A test agent.' },
    ...overrides,
  });
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sa_1',
    name: 'worker',
    description: 'Use when there is work to do.',
    systemPrompt: 'You do the work.',
    taskIds: [],
    trigger: { kind: 'auto' },
    tools: { mode: 'inherit', allow: [], deny: [] },
    runtime: { model: 'inherit', background: false, contextBudget: 'standard' },
    preloadSkillIds: [],
    ...overrides,
  };
}

// ── the fixtures themselves stay clean ────────────────────────────────────────

test('fixtures produce no errors', () => {
  for (const [name, spec] of Object.entries(fixtures)) {
    const errors = compile(spec).diagnostics.filter((d) => d.severity === 'error');
    assert.deepEqual(errors, [], `${name} produced errors: ${JSON.stringify(errors, null, 2)}`);
  }
});

// ── L1 ────────────────────────────────────────────────────────────────────────

test('L1 rejects a non-kebab-case slug and anchors it to the Misc tab', () => {
  const diagnostics = validateL1({ ...base(), meta: { ...base().meta, slug: 'Not A Slug' } });
  const issue = diagnostics.find((d) => d.path === 'meta.slug');
  assert.ok(issue, 'expected a diagnostic on meta.slug');
  assert.equal(issue.tab, 'misc');
});

test('L1 accepts every fixture', () => {
  for (const spec of Object.values(fixtures)) assert.deepEqual(validateL1(spec), []);
});

// ── plugin-agent-forbidden-key ────────────────────────────────────────────────

test('plugin-agent-forbidden-key: fires on hooks/mcpServers/permissionMode', () => {
  const spec = base({ subAgents: [agent({ permissionMode: 'acceptEdits', hooks: {} })] });
  // The schema strips unknown keys, so simulate a spec that arrived from an import.
  (spec.subAgents[0] as Record<string, unknown>).permissionMode = 'acceptEdits';
  const { diagnostics } = compile(spec);
  const hit = diagnostics.find((d) => d.rule === 'plugin-agent-forbidden-key');
  assert.equal(hit?.severity, 'error');
  assert.match(hit!.message, /permissionMode/);
});

test('plugin-agent-forbidden-key: silent on a clean agent', () => {
  assert.ok(!check(base({ subAgents: [agent()] })).rules.includes('plugin-agent-forbidden-key'));
});

// ── tool resolution ───────────────────────────────────────────────────────────

test('tool-unresolved: fires on a tool that does not exist', () => {
  const spec = base({ subAgents: [agent({ tools: { mode: 'allowlist', allow: ['Reed'], deny: [] } })] });
  const hit = check(spec).diagnostics.find((d) => d.rule === 'tool-unresolved');
  assert.equal(hit?.severity, 'error');
  assert.equal(hit?.path, 'subAgents[0].tools.allow[0]');
});

test('tool-unresolved: silent on real tools and mcp patterns', () => {
  const spec = base({
    subAgents: [agent({ tools: { mode: 'allowlist', allow: ['Read', 'mcp__github__search'], deny: [] } })],
    connectors: {
      mcpServers: [
        {
          id: 'm1',
          key: 'github',
          transport: 'stdio',
          command: 'npx',
          args: [],
          env: [],
          toolAllowlist: [],
          source: 'custom',
        },
      ],
    },
  });
  assert.ok(!check(spec).rules.includes('tool-unresolved'));
});

test('tool-unknown-mcp-server: fires when the server is not configured', () => {
  const spec = base({ subAgents: [agent({ tools: { mode: 'allowlist', allow: ['mcp__slack'], deny: [] } })] });
  assert.ok(check(spec).rules.includes('tool-unknown-mcp-server'));
});

test('tool-empty-allowlist: an allowlist with nothing in it fails to launch', () => {
  const spec = base({ subAgents: [agent({ tools: { mode: 'allowlist', allow: [], deny: [] } })] });
  assert.ok(check(spec).rules.includes('tool-empty-allowlist'));
});

test('tool-deny-overlap: warns that deny wins', () => {
  const spec = base({
    subAgents: [agent({ tools: { mode: 'allowlist', allow: ['Read', 'Bash'], deny: ['Bash'] } })],
  });
  const hit = check(spec).diagnostics.find((d) => d.rule === 'tool-deny-overlap');
  assert.equal(hit?.severity, 'warning');
});

// ── skills ────────────────────────────────────────────────────────────────────

test('skill-description-too-long: warns past 1,536 characters', () => {
  const spec = base({
    skills: [
      {
        id: 'sk1',
        source: 'new',
        name: 'long-skill',
        description: 'x'.repeat(1500),
        whenToUse: 'y'.repeat(100),
        body: '',
        allowedTools: [],
        disableModelInvocation: false,
        userInvocable: true,
        files: [],
      },
    ],
  });
  const hit = check(spec).diagnostics.find((d) => d.rule === 'skill-description-too-long');
  assert.equal(hit?.severity, 'warning');
  assert.match(hit!.message, /1600 characters/);
});

test('skill-description-too-long: silent under the limit', () => {
  const spec = base({
    skills: [
      {
        id: 'sk1',
        source: 'new',
        name: 'short-skill',
        description: 'Does a small thing.',
        whenToUse: 'When the small thing is needed.',
        body: '',
        allowedTools: [],
        disableModelInvocation: false,
        userInvocable: true,
        files: [],
      },
    ],
  });
  assert.ok(!check(spec).rules.includes('skill-description-too-long'));
});

test('duplicate-skill-name: two skills cannot share a file', () => {
  const skill = {
    source: 'new',
    name: 'same',
    description: 'A skill.',
    whenToUse: '',
    body: '',
    allowedTools: [],
    disableModelInvocation: false,
    userInvocable: true,
    files: [],
  };
  const spec = base({ skills: [{ ...skill, id: 'a' }, { ...skill, id: 'b' }] });
  assert.ok(check(spec).rules.includes('duplicate-skill-name'));
});

// ── structure ─────────────────────────────────────────────────────────────────

test('component-in-plugin-dir: nothing but the two manifests may live there', () => {
  const spec = base();
  const files = compile(spec).files;
  const diagnostics = validateL2(spec, [
    ...files,
    { path: '.claude-plugin/agents/rogue.md', content: 'oops' },
  ]);
  const hit = diagnostics.find((d) => d.rule === 'component-in-plugin-dir');
  assert.equal(hit?.severity, 'error');
});

test('component-in-plugin-dir: silent on a normal compile', () => {
  for (const spec of Object.values(fixtures)) {
    assert.ok(!check(spec).rules.includes('component-in-plugin-dir'));
  }
});

test('orphan-subagent: warns when nothing delegates to an agent', () => {
  assert.ok(check(base({ subAgents: [agent()] })).rules.includes('orphan-subagent'));
});

test('orphan-subagent: silent once a workflow uses it', () => {
  const spec = base({
    subAgents: [agent()],
    workflows: [
      {
        id: 'wf1',
        title: 'Work',
        description: '',
        order: 0,
        steps: [],
        promoteToSkill: false,
        assignedSubAgentIds: ['sa_1'],
      },
    ],
  });
  assert.ok(!check(spec).rules.includes('orphan-subagent'));
});

test('orchestration-duplicate and orchestration-dangling', () => {
  const spec = base({
    subAgents: [agent()],
    orchestration: {
      groups: [
        { id: 'g1', mode: 'parallel', subAgentIds: ['sa_1'], order: 0 },
        { id: 'g2', mode: 'series', subAgentIds: ['sa_1', 'sa_gone'], order: 1 },
      ],
      joinPolicy: '',
    },
  });
  const rules = check(spec).rules;
  assert.ok(rules.includes('orchestration-duplicate'));
  assert.ok(rules.includes('orchestration-dangling'));
});

test('duplicate-agent-name and subagent-shadows-primary', () => {
  const spec = base({
    subAgents: [agent(), agent({ id: 'sa_2' }), agent({ id: 'sa_3', name: 'test-agent' })],
  });
  const rules = check(spec).rules;
  assert.ok(rules.includes('duplicate-agent-name'));
  assert.ok(rules.includes('subagent-shadows-primary'));
});

// ── secrets ───────────────────────────────────────────────────────────────────

test('looksLikeSecret: known prefixes and high entropy, not placeholders', () => {
  assert.ok(looksLikeSecret('ghp_1234567890abcdefghij'));
  assert.ok(looksLikeSecret('sk-ant-api03-aaaaaaaaaaaaaaaaaaaaa'));
  assert.ok(looksLikeSecret('xoxb-2847592847-Xk3nP9qL2mWz'));
  assert.ok(!looksLikeSecret('${GITHUB_TOKEN}'));
  assert.ok(!looksLikeSecret('your-token-here'));
  assert.ok(!looksLikeSecret('https://example.com/mcp'));
  assert.ok(!looksLikeSecret(''));
});

test('secret-literal: a live-looking default is a hard error', () => {
  const spec = base({
    connectors: {
      mcpServers: [
        {
          id: 'm1',
          key: 'github',
          transport: 'stdio',
          command: 'npx',
          args: [],
          env: [
            {
              name: 'GITHUB_TOKEN',
              required: true,
              description: 'token',
              secret: true,
              defaultValue: 'ghp_A1b2C3d4E5f6G7h8I9j0',
            },
          ],
          toolAllowlist: [],
          source: 'custom',
        },
      ],
    },
  });
  const hit = check(spec).diagnostics.find((d) => d.rule === 'secret-literal');
  assert.equal(hit?.severity, 'error');
});

test('secret-literal: silent when only placeholders are used', () => {
  assert.ok(!check(fixtures['research-assistant']!).rules.includes('secret-literal'));
});

// ── descriptions, cron, misc ──────────────────────────────────────────────────

test('missing-agent-description: delegation cannot work without one', () => {
  const spec = base({ subAgents: [agent({ description: '' })] });
  const hit = check(spec).diagnostics.find((d) => d.rule === 'missing-agent-description');
  assert.equal(hit?.severity, 'error');
});

test('missing-goal: an empty objective is an error', () => {
  const spec = agentSpecSchema.parse(emptySpec('Blank'));
  assert.ok(check(spec).rules.includes('missing-goal'));
});

test('reserved-slug: cannot shadow a Claude Code name', () => {
  const spec = base({ meta: { ...base().meta, slug: 'claude' } });
  assert.ok(check(spec).rules.includes('reserved-slug'));
});

test('cron-out-of-range: catches an impossible hour', () => {
  const spec = base({
    triggers: [{ id: 't1', kind: 'scheduled', cron: '0 99 * * *', timezone: 'UTC', prompt: 'go' }],
  });
  const hit = check(spec).diagnostics.find((d) => d.rule === 'cron-out-of-range');
  assert.equal(hit?.severity, 'error');
});

test('cron-out-of-range: silent on valid expressions', () => {
  for (const cron of ['0 9 * * 1', '*/15 * * * *', '0 0 1 1 *', '30 6 * * 1-5']) {
    const spec = base({
      triggers: [{ id: 't1', kind: 'scheduled', cron, timezone: 'UTC', prompt: 'go' }],
    });
    assert.ok(!check(spec).rules.includes('cron-out-of-range'), `${cron} should be valid`);
  }
});

test('least-privilege: warns when Bash or Write ships with no deny rules', () => {
  const spec = base({ connectors: { builtinTools: { allow: ['Bash', 'Read'], deny: [] } } });
  const hit = check(spec).diagnostics.find((d) => d.rule === 'least-privilege');
  assert.equal(hit?.severity, 'warning');
});

test('knowledge-preload-large: warns before an agent is made slow and expensive', () => {
  const spec = base({
    knowledge: [
      {
        id: 'k1',
        filename: 'big.md',
        mimeType: 'text/markdown',
        sizeBytes: 2 * 1024 * 1024,
        storageKey: 'k/1',
        purpose: 'everything',
        loadStrategy: 'preload-skill',
      },
    ],
  });
  assert.ok(check(spec).rules.includes('knowledge-preload-large'));
});

test('pinned-version-reminder: always present in pinned mode, absent when tracking commits', () => {
  assert.ok(check(base()).rules.includes('pinned-version-reminder'));
  const tracking = base({ meta: { ...base().meta, versionMode: 'commit-sha' } });
  assert.ok(!check(tracking).rules.includes('pinned-version-reminder'));
});

test('mcp-missing-command and mcp-missing-url', () => {
  const stdio = base({
    connectors: {
      mcpServers: [
        { id: 'm1', key: 'a', transport: 'stdio', command: '', args: [], env: [], toolAllowlist: [], source: 'custom' },
      ],
    },
  });
  assert.ok(check(stdio).rules.includes('mcp-missing-command'));

  const http = base({
    connectors: {
      mcpServers: [
        { id: 'm1', key: 'a', transport: 'http', url: 'not-a-url', args: [], env: [], toolAllowlist: [], source: 'custom' },
      ],
    },
  });
  assert.ok(check(http).rules.includes('mcp-missing-url'));
});
