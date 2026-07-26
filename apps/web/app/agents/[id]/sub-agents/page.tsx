'use client';

import { useState } from 'react';
import { allSkills } from '@agent-spawner/compiler';
import {
  AGENT_COLORS,
  BUILTIN_TOOLS,
  CONTEXT_BUDGET_PRESETS,
  EFFORT_LEVELS,
  MODEL_ALIASES,
  MODEL_IDS,
  applyContextBudget,
  newId,
  newSubAgent,
  slugify,
} from '@agent-spawner/spec';
import type { AgentSpec, ContextBudget, SubAgent } from '@agent-spawner/spec';
import { useSpec, useUpdate } from '@/lib/store.ts';
import {
  Badge,
  ChipSelect,
  EmptyState,
  Field,
  Segmented,
  Select,
  TextArea,
  TextInput,
  Toggle,
  cx,
} from '@/components/ui.tsx';
import { AssistButton, AssistError, SuggestionPanel, useAssist } from '@/components/editor/Assist.tsx';

/** Fields Claude Code refuses on plugin-packaged agents (PLAN §2.2). */
const UNSUPPORTED = [
  {
    label: 'Permission mode',
    reason:
      'Not available in plugin-packaged agents — Claude Code rejects `permissionMode` here for security reasons. Set permissions in the consuming project instead; the README carries a ready-made block.',
  },
  {
    label: 'Per-agent MCP servers',
    reason:
      'Not available in plugin-packaged agents. Define the connector once on the Connectors tab and narrow this agent with its tool allowlist.',
  },
  {
    label: 'Per-agent hooks',
    reason:
      'Not available in plugin-packaged agents. The plugin itself can ship hooks — add one as a conditional trigger on the Misc tab.',
  },
];

type Decomposition = {
  subAgents: Array<{
    name: string;
    description: string;
    systemPrompt: string;
    workflowTitles: string[];
    contextBudget?: ContextBudget;
    tools?: string[];
  }>;
  stages: Array<{ mode: 'parallel' | 'series'; agentNames: string[] }>;
  joinPolicy?: string;
};

export default function SubAgentsTab() {
  const spec = useSpec();
  const update = useUpdate();
  const [selectedId, setSelectedId] = useState<string | null>(spec.subAgents[0]?.id ?? null);
  const decompose = useAssist<Decomposition>('decompose-subagents');

  const selected = spec.subAgents.find((agent) => agent.id === selectedId) ?? spec.subAgents[0] ?? null;

  const addAgent = () => {
    const agent = newSubAgent({ name: `sub-agent-${spec.subAgents.length + 1}` });
    update((current) => ({ ...current, subAgents: [...current.subAgents, agent] }), 'Added a sub-agent');
    setSelectedId(agent.id);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-950">Sub-agents</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
            Each one runs in its own context window. That is the real reason to delegate: work that
            would otherwise flood the main session happens somewhere else and comes back as a summary.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <AssistButton busy={decompose.busy} onClick={() => decompose.run()}>
            Decompose with Claude
          </AssistButton>
          <button className="btn-primary" onClick={addAgent}>
            Add
          </button>
        </div>
      </header>

      <AssistError message={decompose.error} />

      {decompose.result && (
        <SuggestionPanel
          title={`${decompose.result.subAgents.length} sub-agents, ${decompose.result.stages.length} stages`}
          onDismiss={decompose.dismiss}
          acceptLabel="Add all"
          onAccept={() => {
            update((current) => applyDecomposition(current, decompose.result!), 'Accepted a decomposition');
            decompose.dismiss();
          }}
        >
          {decompose.result.subAgents.map((agent) => (
            <div key={agent.name} className="rounded-md bg-white px-3 py-2">
              <span className="font-mono text-[12.5px] font-medium text-ink-900">{agent.name}</span>
              <p className="mt-0.5 text-[12.5px] text-ink-600">{agent.description}</p>
              {agent.workflowTitles.length > 0 && (
                <p className="mt-1 text-[11.5px] text-ink-400">Owns: {agent.workflowTitles.join(', ')}</p>
              )}
            </div>
          ))}
          <div className="text-[12.5px] text-ink-700">
            {decompose.result.stages.map((stage, index) => (
              <div key={index}>
                Stage {index + 1} ({stage.mode}): {stage.agentNames.join(', ')}
              </div>
            ))}
          </div>
        </SuggestionPanel>
      )}

      {spec.subAgents.length === 0 ? (
        <EmptyState
          title="No sub-agents yet"
          body="You do not need any — a single agent with a good prompt is often the right answer. Add one when a piece of work is big enough to deserve its own context window, or when two things can genuinely run at the same time."
          action={
            <button className="btn-primary" onClick={addAgent}>
              Add the first one
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-[200px_1fr] gap-5">
          <ul className="space-y-1">
            {spec.subAgents.map((agent, index) => (
              <li key={agent.id}>
                <button
                  onClick={() => setSelectedId(agent.id)}
                  data-path={`subAgents[${index}]`}
                  className={cx(
                    'w-full cursor-pointer rounded-md px-2.5 py-2 text-left transition',
                    selected?.id === agent.id ? 'bg-ink-900 text-white' : 'hover:bg-ink-100',
                  )}
                >
                  <span className="block truncate font-mono text-[12.5px]">{agent.name}</span>
                  <span
                    className={cx(
                      'mt-0.5 block truncate text-[11px]',
                      selected?.id === agent.id ? 'text-ink-200' : 'text-ink-400',
                    )}
                  >
                    {agent.runtime.model}
                    {agent.runtime.background ? ' · background' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected && <AgentEditor agent={selected} onDeleted={() => setSelectedId(null)} />}
        </div>
      )}

      {spec.subAgents.length > 0 && <OrchestrationCanvas />}
    </div>
  );
}

function AgentEditor({ agent, onDeleted }: { agent: SubAgent; onDeleted: () => void }) {
  const spec = useSpec();
  const update = useUpdate();
  const describe = useAssist<{ description: string }>('write-description');
  const index = spec.subAgents.findIndex((a) => a.id === agent.id);

  const patch = (changes: Partial<SubAgent>, label?: string) =>
    update(
      (current) => ({
        ...current,
        subAgents: current.subAgents.map((a) => (a.id === agent.id ? { ...a, ...changes } : a)),
      }),
      label,
    );

  const skills = allSkills(spec);

  return (
    <div className="space-y-6">
      <section className="card space-y-4 px-4 py-4">
        <h2 className="section-title">Identity</h2>
        <Field label="Name" hint="kebab-case. This is the file name and how the orchestrator refers to it.">
          <TextInput
            value={agent.name}
            onChange={(event) => patch({ name: slugify(event.target.value, 'sub-agent') })}
          />
        </Field>

        <div data-path={`subAgents[${index}].description`}>
          <Field
            label="Description"
            hint="The single field that decides whether this agent gets used. Say when to reach for it — start with “Use when…”."
          >
            <TextArea
              rows={2}
              value={agent.description}
              placeholder="Use when the topic needs public sources. Searches the open web and returns claims with URLs."
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
          <div className="mt-2 flex items-center gap-1.5">
            <AssistButton
              busy={describe.busy}
              onClick={() =>
                describe.run({ kind: 'sub-agent', name: agent.name, context: agent.systemPrompt })
              }
            >
              Write it with Claude
            </AssistButton>
            {describe.result && (
              <button
                className="btn-primary"
                onClick={() => {
                  patch({ description: describe.result!.description }, 'Accepted a description');
                  describe.dismiss();
                }}
              >
                Use: “{describe.result.description.slice(0, 60)}…”
              </button>
            )}
          </div>
          <AssistError message={describe.error} />
        </div>

        <Field label="Colour" hint="Cosmetic; shows in the Claude Code UI.">
          <Select
            value={agent.color ?? ''}
            onChange={(event) => patch({ color: (event.target.value || undefined) as SubAgent['color'] })}
            options={[{ value: '', label: 'none' }, ...AGENT_COLORS.map((c) => ({ value: c, label: c }))]}
          />
        </Field>
      </section>

      <section className="card space-y-4 px-4 py-4" data-path={`subAgents[${index}].systemPrompt`}>
        <h2 className="section-title">System prompt</h2>
        <TextArea
          rows={8}
          value={agent.systemPrompt}
          placeholder="You find primary sources on the open web. Prefer the original document over any article about it."
          onChange={(event) => patch({ systemPrompt: event.target.value })}
        />
        <p className="hint">
          The compiler appends the assigned work, the overall success criteria and a reporting
          instruction — the orchestrator cannot see this agent&rsquo;s context, so everything it
          needs has to be in the final message.
        </p>
      </section>

      <section className="card space-y-4 px-4 py-4">
        <h2 className="section-title">Assigned work</h2>
        <ChipSelect
          options={[...spec.workflows]
            .sort((a, b) => a.order - b.order)
            .map((workflow) => ({ value: workflow.id, label: workflow.title || 'Untitled' }))}
          selected={agent.taskIds}
          onChange={(taskIds) =>
            update(
              (current) => ({
                ...current,
                subAgents: current.subAgents.map((a) => (a.id === agent.id ? { ...a, taskIds } : a)),
                // Kept in sync with the Workflows tab — one relationship, two views of it.
                workflows: current.workflows.map((workflow) => {
                  const assigned = taskIds.includes(workflow.id);
                  const has = workflow.assignedSubAgentIds.includes(agent.id);
                  if (assigned === has) return workflow;
                  return {
                    ...workflow,
                    assignedSubAgentIds: assigned
                      ? [...workflow.assignedSubAgentIds, agent.id]
                      : workflow.assignedSubAgentIds.filter((id) => id !== agent.id),
                  };
                }),
              }),
              'Reassigned workflows',
            )
          }
          emptyLabel="Add workflows first — this list mirrors the Workflows tab."
        />
      </section>

      <ToolsSection agent={agent} patch={patch} index={index} />
      <RuntimeSection agent={agent} patch={patch} />

      <section className="card space-y-3 px-4 py-4">
        <h2 className="section-title">Preloaded skills</h2>
        <p className="hint">
          Loaded into this agent&rsquo;s context up front. Skills marked “only when I type /name”
          cannot be preloaded and are not offered here.
        </p>
        <ChipSelect
          options={skills
            .filter((skill) => !skill.disableModelInvocation)
            .map((skill) => ({ value: skill.id, label: skill.name, title: skill.description }))}
          selected={agent.preloadSkillIds}
          onChange={(preloadSkillIds) => patch({ preloadSkillIds })}
          emptyLabel="No preloadable skills yet."
        />
      </section>

      <section className="card space-y-3 px-4 py-4">
        <h2 className="section-title">Not available here</h2>
        {UNSUPPORTED.map((item) => (
          <div key={item.label} title={item.reason} className="cursor-not-allowed opacity-60">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-ink-800">{item.label}</span>
              <Badge tone="warn">plugin limitation</Badge>
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-600">{item.reason}</p>
          </div>
        ))}
      </section>

      <button
        className="btn-danger"
        onClick={() => {
          update(
            (current) => ({
              ...current,
              subAgents: current.subAgents.filter((a) => a.id !== agent.id),
              workflows: current.workflows.map((w) => ({
                ...w,
                assignedSubAgentIds: w.assignedSubAgentIds.filter((id) => id !== agent.id),
              })),
              orchestration: {
                ...current.orchestration,
                groups: current.orchestration.groups.map((group) => ({
                  ...group,
                  subAgentIds: group.subAgentIds.filter((id) => id !== agent.id),
                })),
              },
            }),
            'Deleted a sub-agent',
          );
          onDeleted();
        }}
      >
        Delete this sub-agent
      </button>
    </div>
  );
}

function ToolsSection({
  agent,
  patch,
  index,
}: {
  agent: SubAgent;
  patch: (changes: Partial<SubAgent>, label?: string) => void;
  index: number;
}) {
  const spec = useSpec();
  const mcpOptions = spec.connectors.mcpServers.map((server) => ({
    value: `mcp__${server.key}`,
    label: `mcp__${server.key}`,
    title: server.description || server.displayName,
  }));

  return (
    <section className="card space-y-4 px-4 py-4" data-path={`subAgents[${index}].tools.allow`}>
      <div className="flex items-center justify-between">
        <h2 className="section-title">Tools</h2>
        <Segmented
          value={agent.tools.mode}
          onChange={(mode) => patch({ tools: { ...agent.tools, mode } })}
          options={[
            { value: 'inherit', label: 'Inherit', title: 'Whatever the session already has.' },
            { value: 'allowlist', label: 'Allowlist', title: 'Only the tools you pick.' },
          ]}
        />
      </div>

      {agent.tools.mode === 'inherit' ? (
        <p className="hint">
          This agent gets whatever the main session has. Simple, and usually right — switch to an
          allowlist when you want it kept away from something.
        </p>
      ) : (
        <>
          <Field label="Allowed" hint="If nothing here resolves to a real tool, the agent fails to launch.">
            <ChipSelect
              options={[
                ...BUILTIN_TOOLS.map((tool) => ({ value: tool, label: tool })),
                ...mcpOptions,
              ]}
              selected={agent.tools.allow}
              onChange={(allow) => patch({ tools: { ...agent.tools, allow } })}
            />
          </Field>
          <Field
            label="Denied"
            hint="Applied first: anything here is removed even if it is also allowed."
          >
            <ChipSelect
              options={BUILTIN_TOOLS.map((tool) => ({ value: tool, label: tool }))}
              selected={agent.tools.deny}
              onChange={(deny) => patch({ tools: { ...agent.tools, deny } })}
            />
          </Field>
        </>
      )}
    </section>
  );
}

function RuntimeSection({
  agent,
  patch,
}: {
  agent: SubAgent;
  patch: (changes: Partial<SubAgent>, label?: string) => void;
}) {
  const budget = agent.runtime.contextBudget;

  return (
    <section className="card space-y-4 px-4 py-4">
      <h2 className="section-title">Context budget</h2>
      <p className="hint">
        There is no context-window setting on a sub-agent — that is not a field Claude Code has.
        What you can actually control is the model, how many turns it gets, whether it runs in the
        background, and whether it works in its own git worktree. These presets set all of those
        together.
      </p>

      <Segmented
        value={budget}
        onChange={(next) =>
          patch({ runtime: applyContextBudget(agent.runtime, next) }, 'Changed the context budget')
        }
        options={[
          { value: 'lean', label: 'Lean', title: CONTEXT_BUDGET_PRESETS.lean.blurb },
          { value: 'standard', label: 'Standard', title: CONTEXT_BUDGET_PRESETS.standard.blurb },
          { value: 'deep', label: 'Deep', title: CONTEXT_BUDGET_PRESETS.deep.blurb },
          { value: 'custom', label: 'Custom', title: 'Set the raw fields yourself.' },
        ]}
      />

      {budget !== 'custom' && (
        <p className="rounded-md bg-ink-100 px-3 py-2 text-[12.5px] leading-relaxed text-ink-700">
          {CONTEXT_BUDGET_PRESETS[budget].blurb}
        </p>
      )}

      <details open={budget === 'custom'} className="rounded-md border border-ink-200 px-3 py-2">
        <summary className="cursor-pointer text-[12.5px] font-medium text-ink-700">
          Advanced — the raw fields
        </summary>
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Model">
              <Select
                value={agent.runtime.model}
                onChange={(event) =>
                  patch({
                    runtime: { ...agent.runtime, model: event.target.value, contextBudget: 'custom' },
                  })
                }
                options={[
                  ...MODEL_ALIASES.map((value) => ({ value, label: value })),
                  ...MODEL_IDS.map((value) => ({ value, label: value })),
                ]}
              />
            </Field>
            <Field label="Effort">
              <Select
                value={agent.runtime.effort ?? ''}
                onChange={(event) =>
                  patch({
                    runtime: {
                      ...agent.runtime,
                      effort: (event.target.value || undefined) as SubAgent['runtime']['effort'],
                      contextBudget: 'custom',
                    },
                  })
                }
                options={[
                  { value: '', label: 'default' },
                  ...EFFORT_LEVELS.map((value) => ({ value, label: value })),
                ]}
              />
            </Field>
          </div>

          <Field
            label="Max turns"
            hint="A hard stop. The most reliable way to keep a delegated job from running away."
          >
            <TextInput
              type="number"
              min={1}
              value={agent.runtime.maxTurns ?? ''}
              onChange={(event) =>
                patch({
                  runtime: {
                    ...agent.runtime,
                    maxTurns: event.target.value ? Number(event.target.value) : undefined,
                    contextBudget: 'custom',
                  },
                })
              }
            />
          </Field>

          <Toggle
            checked={agent.runtime.background}
            onChange={(background) =>
              patch({ runtime: { ...agent.runtime, background, contextBudget: 'custom' } })
            }
            label="Run in the background"
            hint="The orchestrator keeps working instead of waiting."
          />

          <Toggle
            checked={agent.runtime.isolation === 'worktree'}
            onChange={(on) =>
              patch({
                runtime: {
                  ...agent.runtime,
                  isolation: on ? 'worktree' : undefined,
                  contextBudget: 'custom',
                },
              })
            }
            label="Isolate in its own git worktree"
            hint="`worktree` is the only value Claude Code accepts. Its file writes stay off your working copy."
          />

          <Field label="Memory scope" hint="Where this agent's memory is written, if it keeps any.">
            <Select
              value={agent.runtime.memory ?? ''}
              onChange={(event) =>
                patch({
                  runtime: {
                    ...agent.runtime,
                    memory: (event.target.value || undefined) as SubAgent['runtime']['memory'],
                    contextBudget: 'custom',
                  },
                })
              }
              options={[
                { value: '', label: 'none' },
                { value: 'user', label: 'user' },
                { value: 'project', label: 'project' },
                { value: 'local', label: 'local' },
              ]}
            />
          </Field>

          <Field label="When it is triggered">
            <Select
              value={agent.trigger.kind}
              onChange={(event) =>
                patch({ trigger: { kind: event.target.value as SubAgent['trigger']['kind'] } })
              }
              options={[
                { value: 'auto', label: 'Claude decides from the description' },
                { value: 'explicit', label: 'Only when named explicitly' },
                { value: 'always-background', label: 'Always, in the background' },
              ]}
            />
          </Field>
        </div>
      </details>
    </section>
  );
}

/**
 * The orchestration canvas: one lane per stage, agents stacked in a lane run together.
 * This compiles directly into the delegation language in the primary agent's prompt.
 */
function OrchestrationCanvas() {
  const spec = useSpec();
  const update = useUpdate();
  const [dragging, setDragging] = useState<string | null>(null);

  const groups = [...spec.orchestration.groups].sort((a, b) => a.order - b.order);
  const placed = new Set(groups.flatMap((g) => g.subAgentIds));
  const unplaced = spec.subAgents.filter((agent) => !placed.has(agent.id));

  const setGroups = (next: AgentSpec['orchestration']['groups'], label?: string) =>
    update(
      (current) => ({ ...current, orchestration: { ...current.orchestration, groups: next } }),
      label,
    );

  const moveTo = (agentId: string, targetGroupId: string | null) => {
    const cleaned = groups.map((group) => ({
      ...group,
      subAgentIds: group.subAgentIds.filter((id) => id !== agentId),
    }));
    const next =
      targetGroupId === null
        ? cleaned
        : cleaned.map((group) =>
            group.id === targetGroupId
              ? { ...group, subAgentIds: [...group.subAgentIds, agentId] }
              : group,
          );
    setGroups(
      next.filter((group) => group.subAgentIds.length > 0 || group.id === targetGroupId),
      'Rearranged the orchestration',
    );
  };

  const nameOf = (id: string) => spec.subAgents.find((agent) => agent.id === id)?.name ?? id;

  return (
    <section className="card space-y-4 px-4 py-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="section-title">Orchestration</h2>
          <p className="hint">
            Stages run one after another. Agents in the same stage run at the same time. This is not
            a config field anywhere — it compiles into explicit instructions in the primary
            agent&rsquo;s prompt.
          </p>
        </div>
        <button
          className="btn-secondary shrink-0"
          onClick={() =>
            setGroups(
              [
                ...groups,
                { id: newId('og'), mode: 'parallel' as const, subAgentIds: [], order: groups.length },
              ],
              'Added a stage',
            )
          }
        >
          + Stage
        </button>
      </div>

      <div className="space-y-2">
        {groups.map((group, index) => (
          <div
            key={group.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dragging && moveTo(dragging, group.id)}
            className="rounded-md border border-dashed border-ink-200 px-3 py-2.5"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-ink-800">Stage {index + 1}</span>
              <div className="flex items-center gap-1.5">
                <Segmented
                  value={group.mode}
                  onChange={(mode) =>
                    setGroups(groups.map((g) => (g.id === group.id ? { ...g, mode } : g)))
                  }
                  options={[
                    { value: 'parallel', label: 'Together' },
                    { value: 'series', label: 'In order' },
                  ]}
                />
                <button
                  className="btn-ghost px-2 text-ink-400 hover:text-danger-600"
                  onClick={() =>
                    setGroups(
                      groups
                        .filter((g) => g.id !== group.id)
                        .map((g, i) => ({ ...g, order: i })),
                      'Removed a stage',
                    )
                  }
                >
                  ✕
                </button>
              </div>
            </div>

            {group.subAgentIds.length === 0 ? (
              <p className="text-[12px] text-ink-400">Drag a sub-agent here.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {group.subAgentIds.map((id) => (
                  <span
                    key={id}
                    draggable
                    onDragStart={() => setDragging(id)}
                    onDragEnd={() => setDragging(null)}
                    className="chip cursor-grab font-mono"
                  >
                    {nameOf(id)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {unplaced.length > 0 && (
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => dragging && moveTo(dragging, null)}
          className="rounded-md bg-ink-100 px-3 py-2.5"
        >
          <p className="mb-2 text-[12px] text-ink-600">
            Not on the canvas — the prompt will say to use these &ldquo;as needed&rdquo;.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unplaced.map((agent) => (
              <span
                key={agent.id}
                draggable
                onDragStart={() => setDragging(agent.id)}
                onDragEnd={() => setDragging(null)}
                className="chip cursor-grab font-mono"
              >
                {agent.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <Field
        label="What the orchestrator does with the results"
        hint="Written into the delegation section verbatim."
      >
        <TextArea
          rows={2}
          value={spec.orchestration.joinPolicy}
          placeholder="Merge the two research sets, drop duplicates by URL, and hand the combined list to brief-writer."
          onChange={(event) =>
            update((current) => ({
              ...current,
              orchestration: { ...current.orchestration, joinPolicy: event.target.value },
            }))
          }
        />
      </Field>
    </section>
  );
}

/** Map a Claude decomposition onto the spec, matching workflows by title. */
function applyDecomposition(spec: AgentSpec, result: Decomposition): AgentSpec {
  const created = result.subAgents.map((proposed) => {
    const taskIds = spec.workflows
      .filter((workflow) =>
        proposed.workflowTitles.some(
          (title) => title.trim().toLowerCase() === workflow.title.trim().toLowerCase(),
        ),
      )
      .map((workflow) => workflow.id);

    const agent = newSubAgent({
      name: slugify(proposed.name, 'sub-agent'),
      description: proposed.description,
      systemPrompt: proposed.systemPrompt,
      taskIds,
      tools:
        proposed.tools && proposed.tools.length > 0
          ? { mode: 'allowlist' as const, allow: proposed.tools, deny: [] }
          : { mode: 'inherit' as const, allow: [], deny: [] },
    });
    return proposed.contextBudget && proposed.contextBudget !== 'custom'
      ? { ...agent, runtime: applyContextBudget(agent.runtime, proposed.contextBudget) }
      : agent;
  });

  const byName = new Map(created.map((agent) => [agent.name, agent.id]));

  return {
    ...spec,
    subAgents: [...spec.subAgents, ...created],
    workflows: spec.workflows.map((workflow) => {
      const owners = created.filter((agent) => agent.taskIds.includes(workflow.id)).map((a) => a.id);
      return owners.length > 0
        ? { ...workflow, assignedSubAgentIds: [...workflow.assignedSubAgentIds, ...owners] }
        : workflow;
    }),
    orchestration: {
      joinPolicy: result.joinPolicy ?? spec.orchestration.joinPolicy,
      groups: [
        ...spec.orchestration.groups,
        ...result.stages.map((stage, index) => ({
          id: newId('og'),
          mode: stage.mode,
          subAgentIds: stage.agentNames
            .map((name) => byName.get(slugify(name, 'sub-agent')))
            .filter((id): id is string => Boolean(id)),
          order: spec.orchestration.groups.length + index,
        })),
      ],
    },
  };
}
