'use client';

import { useRouter } from 'next/navigation';
import { EFFORT_LEVELS, MODEL_ALIASES, MODEL_IDS, newWorkflow } from '@agent-spawner/spec';
import { useSpec, useUpdate } from '@/lib/store.ts';
import { Field, ListEditor, Select, TextArea } from '@/components/ui.tsx';
import { AssistButton, AssistError, SuggestionPanel, useAssist } from '@/components/editor/Assist.tsx';

/** Plain-language note so the model picker is a decision, not a guess. */
const MODEL_NOTES: Record<string, string> = {
  inherit: 'Uses whatever model the session is already on. Cheapest to reason about.',
  opus: 'Most capable, slowest, most expensive. Worth it for planning and judgement.',
  sonnet: 'The balanced default for most agents.',
  haiku: 'Fast and cheap. Good for mechanical work with a clear rule.',
  fable: 'Tuned for long autonomous runs.',
};

type RefineResult = {
  statement: string;
  successCriteria: string[];
  outOfScope: string[];
  notes?: string;
};

type WorkflowSuggestion = {
  workflows: Array<{ title: string; description: string; steps: string[]; repetitive?: boolean }>;
};

export default function GoalTab() {
  const spec = useSpec();
  const update = useUpdate();
  const router = useRouter();

  const refine = useAssist<RefineResult>('refine-goal');
  const suggest = useAssist<WorkflowSuggestion>('suggest-workflows');

  const setGoal = (patch: Partial<typeof spec.goal>, label?: string) =>
    update((current) => ({ ...current, goal: { ...current.goal, ...patch } }), label);

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-lg font-semibold text-ink-950">Goal</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
          This compiles into the primary agent&rsquo;s system prompt. A plugin&rsquo;s{' '}
          <code className="rounded bg-ink-100 px-1">CLAUDE.md</code> is not loaded as context, so
          this is the only place standing instructions can live.
        </p>
      </header>

      <div data-path="goal.statement">
        <Field
          label="What should this agent accomplish?"
          hint="Write it the way you would brief a colleague. One paragraph is plenty."
        >
          <TextArea
            rows={5}
            value={spec.goal.statement}
            onChange={(event) => setGoal({ statement: event.target.value }, 'Edited the goal')}
            placeholder="Produce a one-page research brief on an assigned topic each week, grounded in sources a reader can check."
          />
        </Field>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AssistButton busy={refine.busy} onClick={() => refine.run()}>
            Refine with Claude
          </AssistButton>
          <AssistButton busy={suggest.busy} onClick={() => suggest.run()}>
            Suggest workflows from this goal
          </AssistButton>
        </div>
        <AssistError message={refine.error || suggest.error} />
      </div>

      {refine.result && (
        <SuggestionPanel
          title="Suggested rewrite"
          onDismiss={refine.dismiss}
          acceptLabel="Use this"
          onAccept={() => {
            setGoal(
              {
                statement: refine.result!.statement,
                successCriteria: refine.result!.successCriteria,
                outOfScope: refine.result!.outOfScope,
              },
              'Accepted a refined goal',
            );
            refine.dismiss();
          }}
        >
          <DiffBlock label="Objective" before={spec.goal.statement} after={refine.result.statement} />
          <DiffList label="Success criteria" before={spec.goal.successCriteria} after={refine.result.successCriteria} />
          <DiffList label="Out of scope" before={spec.goal.outOfScope} after={refine.result.outOfScope} />
          {refine.result.notes && (
            <p className="text-[12.5px] text-ink-600">{refine.result.notes}</p>
          )}
        </SuggestionPanel>
      )}

      {suggest.result && (
        <SuggestionPanel
          title={`${suggest.result.workflows.length} suggested workflows`}
          onDismiss={suggest.dismiss}
          acceptLabel="Add all and open Workflows"
          onAccept={() => {
            update(
              (current) => ({
                ...current,
                workflows: [
                  ...current.workflows,
                  ...suggest.result!.workflows.map((w, index) =>
                    newWorkflow(current.workflows.length + index, {
                      title: w.title,
                      description: w.description,
                      steps: w.steps,
                      promoteToSkill: false,
                    }),
                  ),
                ],
              }),
              'Accepted suggested workflows',
            );
            suggest.dismiss();
            router.push(`workflows`);
          }}
        >
          <ul className="space-y-2">
            {suggest.result.workflows.map((workflow, index) => (
              <li key={index} className="rounded-md bg-white px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-ink-900">{workflow.title}</span>
                  {workflow.repetitive && (
                    <span className="text-[11px] text-accent-600">looks repetitive — good Skill candidate</span>
                  )}
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-600">{workflow.description}</p>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-600">
            Added as ordinary cards — edit or delete any of them on the Workflows tab.
          </p>
        </SuggestionPanel>
      )}

      <div data-path="goal.successCriteria">
        <Field
          label="Success criteria"
          hint="How the agent judges that it is done. Keep them checkable by looking at the output."
        >
          <ListEditor
            items={spec.goal.successCriteria}
            onChange={(successCriteria) => setGoal({ successCriteria })}
            placeholder="Every claim has a source link"
            addLabel="criterion"
          />
        </Field>
      </div>

      <div data-path="goal.outOfScope">
        <Field
          label="Out of scope"
          hint="The plausible-but-wrong things this agent should refuse. Unusual in agent builders, and one of the highest-leverage things you can write here."
        >
          <ListEditor
            items={spec.goal.outOfScope}
            onChange={(outOfScope) => setGoal({ outOfScope })}
            placeholder="Making recommendations or investment calls"
            addLabel="non-goal"
          />
        </Field>
      </div>

      <Field label="Tone" hint="Optional. Folded into the primary agent's prompt.">
        <TextArea
          rows={2}
          value={spec.goal.tone}
          onChange={(event) => setGoal({ tone: event.target.value })}
          placeholder="Plain, specific, no hedging."
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Model" hint={MODEL_NOTES[spec.goal.primaryModel] ?? 'A pinned full model ID.'}>
          <Select
            value={spec.goal.primaryModel}
            onChange={(event) => setGoal({ primaryModel: event.target.value })}
            options={[
              ...MODEL_ALIASES.map((value) => ({ value, label: value })),
              ...MODEL_IDS.map((value) => ({ value, label: value })),
            ]}
          />
        </Field>
        <Field
          label="Effort"
          hint="Higher effort means more thinking per turn: better judgement, slower and more expensive."
        >
          <Select
            value={spec.goal.primaryEffort ?? ''}
            onChange={(event) =>
              setGoal({ primaryEffort: (event.target.value || undefined) as typeof spec.goal.primaryEffort })
            }
            options={[
              { value: '', label: 'default' },
              ...EFFORT_LEVELS.map((value) => ({ value, label: value })),
            ]}
          />
        </Field>
      </div>
    </div>
  );
}

function DiffBlock({ label, before, after }: { label: string; before: string; after: string }) {
  if (before === after) return null;
  return (
    <div>
      <span className="label">{label}</span>
      <p className="rounded bg-danger-100 px-2 py-1 text-[12.5px] text-ink-700 line-through decoration-danger-600/40">
        {before || '(empty)'}
      </p>
      <p className="mt-1 rounded bg-ok-600/10 px-2 py-1 text-[12.5px] text-ink-800">{after}</p>
    </div>
  );
}

function DiffList({ label, before, after }: { label: string; before: string[]; after: string[] }) {
  const added = after.filter((item) => !before.includes(item));
  const removed = before.filter((item) => !after.includes(item));
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <div>
      <span className="label">{label}</span>
      <ul className="space-y-0.5 text-[12.5px]">
        {removed.map((item) => (
          <li key={`-${item}`} className="rounded bg-danger-100 px-2 py-0.5 text-ink-700 line-through">
            {item}
          </li>
        ))}
        {added.map((item) => (
          <li key={`+${item}`} className="rounded bg-ok-600/10 px-2 py-0.5 text-ink-800">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
