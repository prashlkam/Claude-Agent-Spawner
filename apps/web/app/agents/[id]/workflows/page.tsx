'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { skillFromWorkflow } from '@agent-spawner/compiler';
import { SKILL_DESCRIPTION_LIMIT, newSubAgent, newWorkflow } from '@agent-spawner/spec';
import type { Workflow } from '@agent-spawner/spec';
import { useSpec, useUpdate } from '@/lib/store.ts';
import {
  ChipSelect,
  Counter,
  EmptyState,
  Field,
  ListEditor,
  SlideOver,
  TextArea,
  TextInput,
  Toggle,
  cx,
} from '@/components/ui.tsx';
import { AssistButton, AssistError, useAssist } from '@/components/editor/Assist.tsx';

export default function WorkflowsTab() {
  const spec = useSpec();
  const update = useUpdate();
  const [editingSkillFor, setEditingSkillFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const ordered = useMemo(() => [...spec.workflows].sort((a, b) => a.order - b.order), [spec.workflows]);
  const repetition = useMemo(() => detectRepetition(ordered), [ordered]);

  const patch = (id: string, changes: Partial<Workflow>, label?: string) =>
    update(
      (current) => ({
        ...current,
        workflows: current.workflows.map((w) => (w.id === id ? { ...w, ...changes } : w)),
      }),
      label,
    );

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const list = [...ordered];
    const from = list.findIndex((w) => w.id === fromId);
    const to = list.findIndex((w) => w.id === toId);
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved!);
    update(
      (current) => ({
        ...current,
        workflows: current.workflows.map((w) => ({
          ...w,
          order: list.findIndex((item) => item.id === w.id),
        })),
      }),
      'Reordered workflows',
    );
  };

  const agentOptions = spec.subAgents.map((agent) => ({
    value: agent.id,
    label: agent.name,
    title: agent.description,
  }));

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-950">Workflows</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
            The repeatable pieces of work. Each becomes a numbered step in the primary
            agent&rsquo;s prompt — or a Skill, if you promote it.
          </p>
        </div>
        <button
          className="btn-primary shrink-0"
          onClick={() =>
            update(
              (current) => ({ ...current, workflows: [...current.workflows, newWorkflow(current.workflows.length)] }),
              'Added a workflow',
            )
          }
        >
          Add workflow
        </button>
      </header>

      {ordered.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          body="Either add them by hand, or let Claude propose a set from the objective you wrote."
          action={
            <Link href="../goal" className="btn-secondary">
              Suggest workflows from the goal →
            </Link>
          }
        />
      ) : (
        <ol className="space-y-3">
          {ordered.map((workflow, index) => (
            <li
              key={workflow.id}
              draggable
              onDragStart={() => setDragging(workflow.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dragging && reorder(dragging, workflow.id)}
              data-path={`workflows[${spec.workflows.findIndex((w) => w.id === workflow.id)}].assignedSubAgentIds`}
              className={cx('card space-y-4 px-4 py-4', dragging === workflow.id && 'opacity-40')}
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-2 cursor-grab select-none text-[13px] text-ink-400"
                  title="Drag to reorder"
                >
                  ⠿ {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-3">
                  <TextInput
                    value={workflow.title}
                    placeholder="Gather sources"
                    onChange={(event) => patch(workflow.id, { title: event.target.value })}
                    className="field text-[14px] font-medium"
                  />
                  <TextArea
                    rows={2}
                    value={workflow.description}
                    placeholder="Search the web and the team wiki for primary sources."
                    onChange={(event) => patch(workflow.id, { description: event.target.value })}
                  />
                  <Field label="Steps" hint="Optional. Imperative and specific beats thorough.">
                    <ListEditor
                      items={workflow.steps}
                      onChange={(steps) => patch(workflow.id, { steps })}
                      placeholder="Record each source URL and its claim"
                      addLabel="step"
                    />
                  </Field>

                  <Field
                    label="Assigned sub-agents"
                    hint="Leave empty and the primary agent does this work itself."
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ChipSelect
                        options={agentOptions}
                        selected={workflow.assignedSubAgentIds}
                        onChange={(assignedSubAgentIds) => patch(workflow.id, { assignedSubAgentIds })}
                        emptyLabel=""
                      />
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          const agent = newSubAgent({
                            name: slugFor(workflow.title || 'worker'),
                            description: `Use when: ${workflow.description || workflow.title}`,
                          });
                          update(
                            (current) => ({
                              ...current,
                              subAgents: [...current.subAgents, agent],
                              workflows: current.workflows.map((w) =>
                                w.id === workflow.id
                                  ? { ...w, assignedSubAgentIds: [...w.assignedSubAgentIds, agent.id] }
                                  : w,
                              ),
                            }),
                            'Created a sub-agent from a workflow',
                          );
                        }}
                      >
                        + New sub-agent for this
                      </button>
                    </div>
                  </Field>

                  <div className="flex items-center justify-between gap-4 border-t border-ink-100 pt-3">
                    <Toggle
                      checked={workflow.promoteToSkill}
                      onChange={(promoteToSkill) => {
                        patch(workflow.id, { promoteToSkill }, promoteToSkill ? 'Promoted a workflow to a skill' : 'Inlined a skill back into a workflow');
                        if (promoteToSkill) setEditingSkillFor(workflow.id);
                      }}
                      label="Convert to Skill"
                      hint="The prompt replaces the inline steps with `Run /skill-name`. Your edits are kept if you toggle this back off."
                    />
                    <div className="flex shrink-0 gap-1.5">
                      {workflow.promoteToSkill && (
                        <button className="btn-secondary" onClick={() => setEditingSkillFor(workflow.id)}>
                          Edit skill
                        </button>
                      )}
                      <button
                        className="btn-danger"
                        onClick={() =>
                          update(
                            (current) => ({
                              ...current,
                              workflows: current.workflows.filter((w) => w.id !== workflow.id),
                              subAgents: current.subAgents.map((a) => ({
                                ...a,
                                taskIds: a.taskIds.filter((id) => id !== workflow.id),
                              })),
                            }),
                            'Deleted a workflow',
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {repetition.get(workflow.id) && (
                    <p className="rounded-md bg-warn-100 px-3 py-2 text-[12.5px] text-ink-800">
                      This looks a lot like <strong>{repetition.get(workflow.id)}</strong>. Repetitive
                      work is usually better as one Skill both can call.{' '}
                      <button
                        className="cursor-pointer font-medium underline"
                        onClick={() => {
                          patch(workflow.id, { promoteToSkill: true });
                          setEditingSkillFor(workflow.id);
                        }}
                      >
                        Convert to a Skill
                      </button>
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <SkillSlideOver workflowId={editingSkillFor} onClose={() => setEditingSkillFor(null)} />
    </div>
  );
}

/**
 * Client-side repetition detector: flags pairs of workflows with high text similarity, or
 * that share most of their steps. A suggestion chip only — never an automatic change.
 */
function detectRepetition(workflows: Workflow[]): Map<string, string> {
  const hits = new Map<string, string>();
  for (let i = 0; i < workflows.length; i++) {
    for (let j = i + 1; j < workflows.length; j++) {
      const a = workflows[i]!;
      const b = workflows[j]!;
      if (a.promoteToSkill || b.promoteToSkill) continue;
      const score = similarity(textOf(a), textOf(b));
      if (score > 0.55) {
        hits.set(b.id, a.title || 'another workflow');
      }
    }
  }
  return hits;
}

function textOf(workflow: Workflow): string {
  return `${workflow.title} ${workflow.description} ${workflow.steps.join(' ')}`.toLowerCase();
}

/** Jaccard overlap on word sets — cheap, runs on every render, good enough for a hint. */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\W+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.split(/\W+/).filter((w) => w.length > 3));
  if (wordsA.size < 3 || wordsB.size < 3) return 0;
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared / (wordsA.size + wordsB.size - shared);
}

function slugFor(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'worker'
  );
}

/** The promoted skill, prefilled from the workflow and editable. Edits live in `skillOverrides`. */
function SkillSlideOver({ workflowId, onClose }: { workflowId: string | null; onClose: () => void }) {
  const spec = useSpec();
  const update = useUpdate();
  const draft = useAssist<{ name: string; description: string; whenToUse?: string; body: string }>(
    'draft-skill',
  );

  const workflow = spec.workflows.find((w) => w.id === workflowId);
  if (!workflow) return null;

  const skill = skillFromWorkflow(workflow, spec);
  const overrides = workflow.skillOverrides ?? {};

  const setOverride = (patch: Record<string, unknown>) =>
    update(
      (current) => ({
        ...current,
        workflows: current.workflows.map((w) =>
          w.id === workflow.id ? { ...w, skillOverrides: { ...w.skillOverrides, ...patch } } : w,
        ),
      }),
      'Edited a promoted skill',
    );

  const descriptionLength = skill.description.length + skill.whenToUse.length;

  return (
    <SlideOver
      open
      onClose={onClose}
      title={`Skill: ${skill.name}`}
      subtitle="Generated from the workflow. Anything you change here survives toggling promotion off and on."
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-ink-600">
            Compiles to <code>skills/{skill.name}/SKILL.md</code>
          </span>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <Field label="Name" hint="kebab-case; this is also the slash command.">
        <TextInput value={skill.name} onChange={(event) => setOverride({ name: event.target.value })} />
      </Field>

      <Field
        label="Description"
        hint="This is what Claude reads to decide whether to load the skill. Lead with the use case."
        counter={<Counter value={descriptionLength} limit={SKILL_DESCRIPTION_LIMIT} />}
      >
        <TextArea
          rows={3}
          value={skill.description}
          onChange={(event) => setOverride({ description: event.target.value })}
        />
      </Field>

      <Field label="When to use" hint="Counts against the same 1,536-character budget.">
        <TextArea
          rows={2}
          value={skill.whenToUse}
          onChange={(event) => setOverride({ whenToUse: event.target.value })}
        />
      </Field>

      <Field
        label="Body"
        hint={
          <>
            Markdown, no frontmatter — the compiler writes that. Reference bundled files as{' '}
            <code>${'{CLAUDE_SKILL_DIR}'}/name</code>.
          </>
        }
      >
        <TextArea
          rows={14}
          value={skill.body}
          onChange={(event) => setOverride({ body: event.target.value })}
          className="field-mono"
        />
      </Field>

      {overrides.body !== undefined && (
        <button
          className="btn-ghost"
          onClick={() =>
            update((current) => ({
              ...current,
              workflows: current.workflows.map((w) =>
                w.id === workflow.id
                  ? { ...w, skillOverrides: { ...w.skillOverrides, body: undefined } }
                  : w,
              ),
            }))
          }
        >
          Reset the body to the generated version
        </button>
      )}

      <div className="flex gap-1.5">
        <AssistButton
          busy={draft.busy}
          onClick={() =>
            draft.run({
              title: workflow.title,
              description: workflow.description,
              steps: workflow.steps,
            })
          }
        >
          Draft this skill with Claude
        </AssistButton>
        {draft.result && (
          <button
            className="btn-primary"
            onClick={() => {
              setOverride({
                name: draft.result!.name,
                description: draft.result!.description,
                whenToUse: draft.result!.whenToUse ?? '',
                body: draft.result!.body,
              });
              draft.dismiss();
            }}
          >
            Use the draft
          </button>
        )}
      </div>
      <AssistError message={draft.error} />
    </SlideOver>
  );
}
