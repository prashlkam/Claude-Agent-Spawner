'use client';

import { useState } from 'react';
import { skillFromWorkflow } from '@agent-spawner/compiler';
import { BUILTIN_TOOLS, SKILL_DESCRIPTION_LIMIT, newSkill, slugify } from '@agent-spawner/spec';
import type { Skill } from '@agent-spawner/spec';
import { useSpec, useUpdate } from '@/lib/store.ts';
import {
  Badge,
  ChipSelect,
  Counter,
  EmptyState,
  Field,
  SlideOver,
  TextArea,
  TextInput,
  cx,
} from '@/components/ui.tsx';

/**
 * Invocation, expressed the way a user thinks about it rather than as two booleans.
 * Each option maps onto `disable-model-invocation` / `user-invocable`.
 */
const INVOCATION = [
  {
    id: 'auto' as const,
    label: 'Claude decides when to use it',
    hint: 'Loaded automatically when the description matches, and available as /name.',
    flags: { disableModelInvocation: false, userInvocable: true },
  },
  {
    id: 'manual' as const,
    label: 'Only when I type /name',
    hint: 'Never auto-loaded. Also blocks preloading into sub-agents and scheduled invocation.',
    flags: { disableModelInvocation: true, userInvocable: true },
  },
  {
    id: 'background' as const,
    label: 'Background knowledge, hidden from the menu',
    hint: 'Not in the / menu. Use for house style, glossaries, standing rules.',
    flags: { disableModelInvocation: false, userInvocable: false },
  },
];

function invocationOf(skill: Skill): (typeof INVOCATION)[number]['id'] {
  if (skill.disableModelInvocation) return 'manual';
  if (!skill.userInvocable) return 'background';
  return 'auto';
}

export default function SkillsTab() {
  const spec = useSpec();
  const update = useUpdate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  const promoted = spec.workflows
    .filter((workflow) => workflow.promoteToSkill)
    .map((workflow) => ({ workflow, skill: skillFromWorkflow(workflow, spec) }));

  const addSkill = () => {
    const skill = newSkill({ name: `skill-${spec.skills.length + 1}` });
    update((current) => ({ ...current, skills: [...current.skills, skill] }), 'Added a skill');
    setEditingId(skill.id);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-950">Skills</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
            Procedures the agent can load on demand. A skill&rsquo;s description is the only thing
            Claude reads when deciding whether to use it, so it earns its place there.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button className="btn-secondary" onClick={() => setPasteOpen(true)}>
            Attach existing
          </button>
          <button className="btn-primary" onClick={addSkill}>
            Create new
          </button>
        </div>
      </header>

      {spec.skills.length === 0 && promoted.length === 0 ? (
        <EmptyState
          title="No skills yet"
          body="Promote a repetitive workflow on the Workflows tab, write one here, or paste a SKILL.md you already have."
          action={
            <button className="btn-primary" onClick={addSkill}>
              Create one
            </button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {spec.skills.map((skill, index) => (
            <li key={skill.id} className="card px-4 py-3.5" data-path={`skills[${index}].description`}>
              <button
                onClick={() => setEditingId(skill.id)}
                className="w-full cursor-pointer text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-medium text-ink-900">{skill.name}</span>
                  <Badge tone={skill.source === 'attached' ? 'neutral' : 'accent'}>
                    {skill.source === 'attached' ? 'attached' : 'authored'}
                  </Badge>
                  <span className="ml-auto text-[11.5px] text-ink-400">
                    {INVOCATION.find((option) => option.id === invocationOf(skill))?.label}
                  </span>
                </span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-600">
                  {skill.description || 'No description — Claude will never auto-load this.'}
                </span>
              </button>
            </li>
          ))}

          {promoted.map(({ workflow, skill }) => (
            <li key={skill.id} className="card border-dashed px-4 py-3.5">
              <span className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium text-ink-900">{skill.name}</span>
                <Badge tone="warn">from workflow</Badge>
                <a href="workflows" className="ml-auto text-[12px] text-accent-600 hover:underline">
                  Edit on the Workflows tab →
                </a>
              </span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-600">
                {skill.description || `Generated from “${workflow.title}”.`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SkillEditor skillId={editingId} onClose={() => setEditingId(null)} />
      <PasteSkill open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  );
}

function SkillEditor({ skillId, onClose }: { skillId: string | null; onClose: () => void }) {
  const spec = useSpec();
  const update = useUpdate();
  const skill = spec.skills.find((s) => s.id === skillId);
  if (!skill) return null;

  const patch = (changes: Partial<Skill>, label?: string) =>
    update(
      (current) => ({
        ...current,
        skills: current.skills.map((s) => (s.id === skill.id ? { ...s, ...changes } : s)),
      }),
      label,
    );

  const descriptionLength = skill.description.length + skill.whenToUse.length;
  const invocation = invocationOf(skill);

  return (
    <SlideOver
      open
      onClose={onClose}
      title={skill.name}
      subtitle={`Compiles to skills/${skill.name}/SKILL.md`}
      footer={
        <div className="flex items-center justify-between">
          <button
            className="btn-danger"
            onClick={() => {
              update(
                (current) => ({
                  ...current,
                  skills: current.skills.filter((s) => s.id !== skill.id),
                  subAgents: current.subAgents.map((agent) => ({
                    ...agent,
                    preloadSkillIds: agent.preloadSkillIds.filter((id) => id !== skill.id),
                  })),
                }),
                'Deleted a skill',
              );
              onClose();
            }}
          >
            Delete
          </button>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <Field label="Name" hint="kebab-case; also the slash command.">
        <TextInput
          value={skill.name}
          onChange={(event) => patch({ name: slugify(event.target.value, 'new-skill') })}
        />
      </Field>

      <Field
        label="Description"
        hint="Put the key use case first — this is what gets truncated."
        counter={<Counter value={descriptionLength} limit={SKILL_DESCRIPTION_LIMIT} />}
      >
        <TextArea
          rows={3}
          value={skill.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>

      <Field label="When to use" hint="Shares the 1,536-character budget with the description.">
        <TextArea rows={2} value={skill.whenToUse} onChange={(event) => patch({ whenToUse: event.target.value })} />
      </Field>

      <Field label="Invocation">
        <div className="space-y-1.5">
          {INVOCATION.map((option) => (
            <label
              key={option.id}
              className={cx(
                'flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 transition',
                invocation === option.id
                  ? 'border-accent-600 bg-accent-100/40'
                  : 'border-ink-200 hover:border-ink-400',
              )}
            >
              <input
                type="radio"
                name="invocation"
                checked={invocation === option.id}
                onChange={() => patch(option.flags)}
                className="mt-1"
              />
              <span>
                <span className="block text-[13px] font-medium text-ink-800">{option.label}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-600">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Allowed tools" hint="Leave empty to inherit. Bash patterns like `Bash(git status:*)` also work.">
        <ChipSelect
          options={BUILTIN_TOOLS.map((tool) => ({ value: tool, label: tool }))}
          selected={skill.allowedTools}
          onChange={(allowedTools) => patch({ allowedTools })}
        />
      </Field>

      <Field
        label="Body"
        hint={
          <>
            Markdown without frontmatter. Reference bundled files as{' '}
            <code>${'{CLAUDE_SKILL_DIR}'}/path</code> so <code>allowed-tools</code> rules match the
            exact command and the script runs without prompting.
          </>
        }
      >
        <TextArea
          rows={14}
          value={skill.body}
          onChange={(event) => patch({ body: event.target.value })}
          className="field-mono"
        />
      </Field>

      <Field label="Supporting files">
        <div className="space-y-2">
          {skill.files.map((file, index) => (
            <div key={index} className="card space-y-2 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <TextInput
                  value={file.path}
                  placeholder="scripts/check.sh"
                  onChange={(event) => {
                    const files = [...skill.files];
                    files[index] = { ...files[index]!, path: event.target.value };
                    patch({ files });
                  }}
                  className="field-mono"
                />
                <button
                  className="btn-ghost px-2 text-ink-400 hover:text-danger-600"
                  onClick={() => patch({ files: skill.files.filter((_, i) => i !== index) })}
                >
                  ✕
                </button>
              </div>
              <TextArea
                rows={5}
                value={file.content}
                onChange={(event) => {
                  const files = [...skill.files];
                  files[index] = { ...files[index]!, content: event.target.value };
                  patch({ files });
                }}
                className="field-mono"
              />
            </div>
          ))}
          <button
            className="btn-secondary"
            onClick={() => patch({ files: [...skill.files, { path: '', content: '' }] })}
          >
            + Add a file
          </button>
        </div>
      </Field>
    </SlideOver>
  );
}

/** Attach an existing skill by pasting its `SKILL.md`. Content is parsed, never executed. */
function PasteSkill({ open, onClose }: { open: boolean; onClose: () => void }) {
  const update = useUpdate();
  const [text, setText] = useState('');

  const attach = () => {
    const { fields, body } = splitFrontmatter(text);
    const skill = newSkill({
      source: 'attached',
      name: slugify(fields.name ?? 'attached-skill', 'attached-skill'),
      description: fields.description ?? '',
      whenToUse: fields['when-to-use'] ?? '',
      body,
      allowedTools: (fields['allowed-tools'] ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      disableModelInvocation: fields['disable-model-invocation'] === 'true',
      userInvocable: fields['user-invocable'] !== 'false',
    });
    update((current) => ({ ...current, skills: [...current.skills, skill] }), 'Attached a skill');
    setText('');
    onClose();
  };

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Attach an existing skill"
      subtitle="Paste a SKILL.md. It is parsed as data — nothing in it runs, here or later."
      width="max-w-xl"
      footer={
        <div className="flex justify-end">
          <button className="btn-primary" disabled={!text.trim()} onClick={attach}>
            Attach
          </button>
        </div>
      }
    >
      <TextArea
        rows={20}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={'---\nname: my-skill\ndescription: What it does and when to use it.\n---\n\n# My skill\n\n…'}
        className="field-mono"
      />
    </SlideOver>
  );
}

function splitFrontmatter(source: string): { fields: Record<string, string>; body: string } {
  const normalized = source.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { fields: {}, body: normalized.trim() };
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return { fields: {}, body: normalized.trim() };

  const fields: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (match) fields[match[1]!] = match[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return { fields, body: normalized.slice(end + 4).trim() };
}
