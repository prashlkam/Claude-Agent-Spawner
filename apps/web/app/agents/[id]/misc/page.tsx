'use client';

import { useRef, useState } from 'react';
import { bundleSize, compile, describeCron, generateReadme } from '@agent-spawner/compiler';
import { HOOK_EVENTS, SPDX_LICENSES, newId, slugify } from '@agent-spawner/spec';
import type { KnowledgeItem, Trigger } from '@agent-spawner/spec';
import { useEditor, useSpec, useUpdate } from '@/lib/store.ts';
import {
  Accordion,
  Badge,
  Field,
  ListEditor,
  Segmented,
  Select,
  TextArea,
  TextInput,
  Toggle,
  cx,
} from '@/components/ui.tsx';
import { AssistButton, AssistError, useAssist } from '@/components/editor/Assist.tsx';

export default function MiscTab() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-ink-950">Packaging</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
          Identity, triggers, docs, bundled files, and the export itself.
        </p>
      </header>

      <Identity />
      <Triggers />
      <Docs />
      <Knowledge />
      <Packaging />
      <Dependencies />
    </div>
  );
}

function Identity() {
  const spec = useSpec();
  const update = useUpdate();
  const meta = spec.meta;

  const set = (patch: Partial<typeof meta>, label?: string) =>
    update((current) => ({ ...current, meta: { ...current.meta, ...patch } }), label);

  return (
    <Accordion title="Identity" description="Name, slug, version and licence." defaultOpen>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name">
          <TextInput
            value={meta.name}
            onChange={(event) => {
              const name = event.target.value;
              // The slug follows the name until the user edits it directly.
              const followed = meta.slug === slugify(meta.name, 'untitled-agent');
              set(followed ? { name, slug: slugify(name, 'untitled-agent') } : { name });
            }}
          />
        </Field>
        <div data-path="meta.slug">
          <Field label="Slug" hint="kebab-case. The plugin's directory and manifest name.">
            <TextInput
              value={meta.slug}
              onChange={(event) => set({ slug: event.target.value })}
              className="field-mono"
            />
          </Field>
        </div>
      </div>

      <div data-path="meta.description">
        <Field label="Description" hint="What users see in the marketplace listing.">
          <TextArea rows={2} value={meta.description} onChange={(event) => set({ description: event.target.value })} />
        </Field>
      </div>

      <Field label="Version mode">
        <Segmented
          value={meta.versionMode}
          onChange={(versionMode) => set({ versionMode }, 'Changed the version mode')}
          options={[
            { value: 'pinned', label: 'Pinned release' },
            { value: 'commit-sha', label: 'Track every commit' },
          ]}
        />
        <p className="hint">
          {meta.versionMode === 'pinned'
            ? 'The manifest carries an explicit version. Users receive an update only when you bump it — this is the usual choice.'
            : 'The manifest omits `version`, so Claude Code resolves it from the git commit SHA and every push is an update.'}
        </p>
      </Field>

      {meta.versionMode === 'pinned' && (
        <div className="flex items-end gap-2" data-path="meta.version">
          <Field label="Version">
            <TextInput
              value={meta.version}
              onChange={(event) => set({ version: event.target.value })}
              className="field-mono w-40"
            />
          </Field>
          <button className="btn-secondary mb-0.5" onClick={() => set({ version: bumpPatch(meta.version) })}>
            Bump patch
          </button>
          <button className="btn-secondary mb-0.5" onClick={() => set({ version: bumpMinor(meta.version) })}>
            Bump minor
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Licence">
          <Select
            value={meta.license}
            onChange={(event) => set({ license: event.target.value as typeof meta.license })}
            options={SPDX_LICENSES.map((value) => ({ value, label: value }))}
          />
        </Field>
        <Field label="Homepage">
          <TextInput value={meta.homepage} onChange={(event) => set({ homepage: event.target.value })} />
        </Field>
      </div>

      <Field label="Repository">
        <TextInput
          value={meta.repository}
          placeholder="https://github.com/you/your-plugin"
          onChange={(event) => set({ repository: event.target.value })}
        />
      </Field>

      <Field label="Keywords">
        <ListEditor items={meta.keywords} onChange={(keywords) => set({ keywords })} addLabel="keyword" />
      </Field>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Author name">
          <TextInput
            value={meta.author.name}
            onChange={(event) => set({ author: { ...meta.author, name: event.target.value } })}
          />
        </Field>
        <Field label="Author email">
          <TextInput
            value={meta.author.email}
            onChange={(event) => set({ author: { ...meta.author, email: event.target.value } })}
          />
        </Field>
        <Field label="Author URL">
          <TextInput
            value={meta.author.url}
            onChange={(event) => set({ author: { ...meta.author, url: event.target.value } })}
          />
        </Field>
      </div>

      <Toggle
        checked={!meta.defaultEnabled}
        onChange={(off) => set({ defaultEnabled: !off })}
        label="Off by default"
        hint="Turn this on for agents that cost money or reach external services, so installing the plugin does not silently start it."
      />
    </Accordion>
  );
}

function Triggers() {
  const spec = useSpec();
  const update = useUpdate();

  const setTriggers = (triggers: Trigger[], label?: string) =>
    update((current) => ({ ...current, triggers }), label);

  const add = (trigger: Trigger) => setTriggers([...spec.triggers, trigger], 'Added a trigger');

  const patch = (id: string, changes: Record<string, unknown>) =>
    setTriggers(spec.triggers.map((t) => (t.id === id ? ({ ...t, ...changes } as Trigger) : t)));

  return (
    <Accordion
      title="Triggers"
      description="How the agent gets started. Each one shows the file it produces."
      right={<Badge tone="neutral">{spec.triggers.length}</Badge>}
    >
      <div className="flex flex-wrap gap-1.5">
        <button
          className="btn-secondary"
          onClick={() => add({ id: newId('tr'), kind: 'manual', invocation: 'slash-command' })}
        >
          + Manual
        </button>
        <button
          className="btn-secondary"
          onClick={() =>
            add({ id: newId('tr'), kind: 'scheduled', cron: '0 9 * * 1', timezone: 'UTC', prompt: '' })
          }
        >
          + Scheduled
        </button>
        <button
          className="btn-secondary"
          onClick={() =>
            add({
              id: newId('tr'),
              kind: 'conditional',
              via: 'hook',
              event: 'PostToolUse',
              matcher: '',
              command: '',
              name: 'on-event',
            })
          }
        >
          + Hook
        </button>
        <button
          className="btn-secondary"
          onClick={() =>
            add({
              id: newId('tr'),
              kind: 'conditional',
              via: 'monitor',
              config: { name: '', check: '', intervalSeconds: 300, prompt: '' },
            })
          }
        >
          + Monitor <Badge tone="warn">experimental</Badge>
        </button>
      </div>

      {spec.triggers.map((trigger, index) => (
        <div key={trigger.id} className="card space-y-3 px-3.5 py-3.5" data-path={`triggers[${index}].cron`}>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-900">
              {trigger.kind === 'manual'
                ? 'Manual'
                : trigger.kind === 'scheduled'
                  ? 'Scheduled'
                  : trigger.via === 'hook'
                    ? `Hook · ${trigger.event}`
                    : 'Monitor'}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-ink-400">{producedFile(trigger)}</span>
              <button
                className="btn-ghost px-2 text-ink-400 hover:text-danger-600"
                onClick={() => setTriggers(spec.triggers.filter((t) => t.id !== trigger.id), 'Removed a trigger')}
              >
                ✕
              </button>
            </div>
          </div>

          {trigger.kind === 'manual' && (
            <Field label="How it is invoked">
              <Select
                value={trigger.invocation}
                onChange={(event) => patch(trigger.id, { invocation: event.target.value })}
                options={[
                  { value: 'slash-command', label: '/slash command' },
                  { value: 'agent-flag', label: 'claude --agent <slug>' },
                ]}
              />
            </Field>
          )}

          {trigger.kind === 'scheduled' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Cron" hint={describeCron(trigger.cron)}>
                  <TextInput
                    value={trigger.cron}
                    onChange={(event) => patch(trigger.id, { cron: event.target.value })}
                    className="field-mono"
                  />
                </Field>
                <Field label="Timezone">
                  <TextInput
                    value={trigger.timezone}
                    onChange={(event) => patch(trigger.id, { timezone: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Prompt" hint="What the scheduled run should be asked to do.">
                <TextArea
                  rows={2}
                  value={trigger.prompt}
                  onChange={(event) => patch(trigger.id, { prompt: event.target.value })}
                />
              </Field>
              <p className="rounded-md bg-ink-100 px-3 py-2 text-[12px] leading-relaxed text-ink-700">
                Cron is not a plugin component — nothing in the bundle can schedule itself. This
                compiles to <code>SCHEDULING.md</code> with the exact setup steps plus a{' '}
                <code>scripts/run.sh</code> wrapper for your own cron or CI.
              </p>
            </>
          )}

          {trigger.kind === 'conditional' && trigger.via === 'hook' && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Event">
                  <Select
                    value={trigger.event}
                    onChange={(event) => patch(trigger.id, { event: event.target.value })}
                    options={HOOK_EVENTS.map((value) => ({ value, label: value }))}
                  />
                </Field>
                <Field label="Matcher" hint="Tool name, for Pre/PostToolUse.">
                  <TextInput
                    value={trigger.matcher}
                    placeholder="Write"
                    onChange={(event) => patch(trigger.id, { matcher: event.target.value })}
                  />
                </Field>
                <Field label="Script name">
                  <TextInput
                    value={trigger.name}
                    onChange={(event) => patch(trigger.id, { name: slugify(event.target.value, 'on-event') })}
                    className="field-mono"
                  />
                </Field>
              </div>
              <Field
                label="Command"
                hint="Runs on the installing user's machine with their permissions. The hook payload arrives on stdin as $payload."
              >
                <TextArea
                  rows={3}
                  value={trigger.command}
                  onChange={(event) => patch(trigger.id, { command: event.target.value })}
                  className="field-mono"
                />
              </Field>
              <p className="rounded-md bg-warn-100 px-3 py-2 text-[12px] leading-relaxed text-ink-800">
                A plugin-packaged <em>agent</em> may not carry hooks, but the plugin itself may ship
                them. Anyone installing this will see the script in the bundle before it runs.
              </p>
            </>
          )}

          {trigger.kind === 'conditional' && trigger.via === 'monitor' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Name">
                  <TextInput
                    value={trigger.config.name}
                    onChange={(event) =>
                      patch(trigger.id, { config: { ...trigger.config, name: event.target.value } })
                    }
                  />
                </Field>
                <Field label="Interval (seconds)">
                  <TextInput
                    type="number"
                    min={30}
                    value={trigger.config.intervalSeconds}
                    onChange={(event) =>
                      patch(trigger.id, {
                        config: { ...trigger.config, intervalSeconds: Number(event.target.value) },
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Check command">
                <TextInput
                  value={trigger.config.check}
                  onChange={(event) =>
                    patch(trigger.id, { config: { ...trigger.config, check: event.target.value } })
                  }
                  className="field-mono"
                />
              </Field>
              <Field label="Prompt">
                <TextArea
                  rows={2}
                  value={trigger.config.prompt}
                  onChange={(event) =>
                    patch(trigger.id, { config: { ...trigger.config, prompt: event.target.value } })
                  }
                />
              </Field>
              <p className="rounded-md bg-warn-100 px-3 py-2 text-[12px] leading-relaxed text-ink-800">
                Monitors are experimental in Claude Code and the format may change. If it does, use a
                hook instead — the rest of the bundle is unaffected.
              </p>
            </>
          )}
        </div>
      ))}
    </Accordion>
  );
}

function producedFile(trigger: Trigger): string {
  if (trigger.kind === 'manual') return 'README.md';
  if (trigger.kind === 'scheduled') return 'SCHEDULING.md + scripts/run.sh';
  if (trigger.via === 'hook') return `hooks/hooks.json + scripts/${trigger.name}.sh`;
  return 'monitors/monitors.json';
}

function Docs() {
  const spec = useSpec();
  const update = useUpdate();
  const readme = useAssist<{ markdown: string }>('generate-readme');
  const generated = generateReadme(spec);

  const set = (patch: Record<string, unknown>) =>
    update((current) => ({ ...current, meta: { ...current.meta, ...patch } }));

  return (
    <Accordion title="Docs" description="README and the changelog entry for this version.">
      <Field label="README">
        <Segmented
          value={spec.meta.readme.mode}
          onChange={(mode) =>
            set({
              readme: {
                mode,
                // Seed the editor from the generated version so nobody starts from a blank page.
                body: mode === 'custom' ? (spec.meta.readme.body ?? generated) : spec.meta.readme.body,
              },
            })
          }
          options={[
            { value: 'generated', label: 'Generated' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </Field>

      {spec.meta.readme.mode === 'generated' ? (
        <pre className="max-h-96 overflow-auto rounded-md border border-ink-200 bg-ink-50 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-700">
          {generated}
        </pre>
      ) : (
        <>
          <TextArea
            rows={18}
            value={spec.meta.readme.body ?? generated}
            onChange={(event) => set({ readme: { mode: 'custom', body: event.target.value } })}
            className="field-mono"
          />
          <div className="flex gap-1.5">
            <button
              className="btn-secondary"
              onClick={() => set({ readme: { mode: 'custom', body: generated } })}
            >
              Reset to generated
            </button>
            <AssistButton busy={readme.busy} onClick={() => readme.run()}>
              Write it with Claude
            </AssistButton>
            {readme.result && (
              <button
                className="btn-primary"
                onClick={() => {
                  set({ readme: { mode: 'custom', body: readme.result!.markdown } });
                  readme.dismiss();
                }}
              >
                Use the draft
              </button>
            )}
          </div>
          <AssistError message={readme.error} />
        </>
      )}

      <Field label="Changelog entry" hint={`Written under “${spec.meta.version}” in CHANGELOG.md.`}>
        <TextArea
          rows={3}
          value={spec.meta.changelogEntry}
          onChange={(event) => set({ changelogEntry: event.target.value })}
        />
      </Field>
    </Accordion>
  );
}

function Knowledge() {
  const spec = useSpec();
  const update = useUpdate();
  const agentId = useEditor((state) => state.agentId);
  const reload = useEditor((state) => state.reload);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/agents/${agentId}/knowledge`, { method: 'POST', body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? `Could not upload ${file.name}.`);
        break;
      }
    }
    setBusy(false);
    // The upload wrote through the server, so pull the authoritative spec back.
    await reload();
  }

  const patch = (id: string, changes: Partial<KnowledgeItem>) =>
    update((current) => ({
      ...current,
      knowledge: current.knowledge.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    }));

  return (
    <Accordion
      title="Knowledge base"
      description="Files bundled with the plugin."
      right={<Badge tone="neutral">{spec.knowledge.length}</Badge>}
    >
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void upload(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-lg border-2 border-dashed border-ink-200 px-4 py-8 text-center hover:border-accent-500"
      >
        <p className="text-[13px] text-ink-700">{busy ? 'Uploading…' : 'Drop files here, or click to choose'}</p>
        <p className="mt-1 text-[12px] text-ink-400">Text, markdown, CSV, JSON, YAML or PDF · up to 10 MB each</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => void upload(event.target.files)}
        />
      </div>
      {error && <p className="text-[12.5px] text-danger-600">{error}</p>}

      {spec.knowledge.map((item, index) => (
        <div key={item.id} className="card space-y-3 px-3.5 py-3.5" data-path={`knowledge[${index}].loadStrategy`}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12.5px] text-ink-900">{item.filename}</span>
            <span className="text-[11.5px] text-ink-400">{formatBytes(item.sizeBytes)}</span>
            <button
              className="btn-ghost ml-auto px-2 text-ink-400 hover:text-danger-600"
              onClick={async () => {
                await fetch(
                  `/api/agents/${agentId}/knowledge?key=${encodeURIComponent(item.storageKey)}`,
                  { method: 'DELETE' },
                );
                await reload();
              }}
            >
              ✕
            </button>
          </div>

          <Field label="What it is for" hint="Written into the README and the generated index skill.">
            <TextInput value={item.purpose} onChange={(event) => patch(item.id, { purpose: event.target.value })} />
          </Field>

          <Field label="How it is loaded">
            <Segmented
              value={item.loadStrategy}
              onChange={(loadStrategy) => patch(item.id, { loadStrategy })}
              options={[
                { value: 'reference', label: 'Read on demand' },
                { value: 'preload-skill', label: 'Preload' },
              ]}
            />
            <p className={cx('hint', item.loadStrategy === 'preload-skill' && item.sizeBytes > 256 * 1024 && 'text-warn-600')}>
              {item.loadStrategy === 'reference'
                ? 'The agent is told the path and reads it when it needs it. Almost always the right choice.'
                : item.sizeBytes > 256 * 1024
                  ? `${formatBytes(item.sizeBytes)} in every session. Preloading files this large is the fastest way to make an agent slow and expensive.`
                  : 'Loaded up front through a generated index skill.'}
            </p>
          </Field>
        </div>
      ))}
    </Accordion>
  );
}

function Packaging() {
  const spec = useSpec();
  const update = useUpdate();
  const agentId = useEditor((state) => state.agentId);
  const save = useEditor((state) => state.save);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const result = compile(spec);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');

  const set = (patch: Record<string, unknown>) =>
    update((current) => ({ ...current, packaging: { ...current.packaging, ...patch } }));

  async function exportZip() {
    setExporting(true);
    setError('');
    // Export runs the server-side compile of the *saved* spec, so flush first.
    await save();

    const response = await fetch(`/api/agents/${agentId}/export`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? 'Export failed.');
      setExporting(false);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${spec.meta.slug}-${spec.meta.version}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  }

  return (
    <Accordion title="Packaging" description="What goes in the bundle, and the export." defaultOpen>
      <Toggle
        checked={spec.packaging.includeMarketplaceManifest}
        onChange={(value) => set({ includeMarketplaceManifest: value })}
        label="Include a marketplace manifest"
        hint="Adds .claude-plugin/marketplace.json so the repo is installable with /plugin marketplace add."
      />
      <Toggle
        checked={spec.packaging.includeInstallScript}
        onChange={(value) => set({ includeInstallScript: value })}
        label="Include install.sh"
        hint="Copies the bundle into a project or ~/.claude/. It only copies files — nothing is executed for you."
      />

      <div className="rounded-md bg-ink-100 px-3 py-2.5 text-[12.5px] text-ink-700">
        {result.files.length} files · {formatBytes(bundleSize(result))} ·{' '}
        {errors.length === 0 ? (
          <span className="text-ok-600">ready to export</span>
        ) : (
          <span className="text-danger-600">
            {errors.length} error{errors.length === 1 ? '' : 's'} to fix first
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={exporting || errors.length > 0} onClick={exportZip}>
          {exporting ? 'Building…' : 'Export .zip'}
        </button>
        <span className="text-[12px] text-ink-600">
          Built on demand and never stored. The same spec always produces the same bytes.
        </span>
      </div>
      {error && <p className="text-[12.5px] text-danger-600">{error}</p>}
    </Accordion>
  );
}

function Dependencies() {
  const spec = useSpec();
  const update = useUpdate();
  const dependencies = spec.meta.dependencies;

  const set = (next: typeof dependencies) =>
    update((current) => ({ ...current, meta: { ...current.meta, dependencies: next } }));

  return (
    <Accordion title="Dependencies" description="Other plugins this one needs.">
      {dependencies.map((dependency, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <TextInput
            value={dependency.name}
            placeholder="markdown-tools"
            onChange={(event) => {
              const next = [...dependencies];
              next[index] = { ...next[index]!, name: event.target.value };
              set(next);
            }}
            className="field-mono"
          />
          <TextInput
            value={dependency.constraint}
            placeholder="^2.0.0"
            onChange={(event) => {
              const next = [...dependencies];
              next[index] = { ...next[index]!, constraint: event.target.value };
              set(next);
            }}
            className="field-mono w-40"
          />
          <button
            className="btn-ghost px-2 text-ink-400 hover:text-danger-600"
            onClick={() => set(dependencies.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn-secondary" onClick={() => set([...dependencies, { name: '', constraint: '' }])}>
        + Add a dependency
      </button>
    </Accordion>
  );
}

function bumpPatch(version: string): string {
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  return `${major}.${minor}.${Number(patch.split('-')[0]) + 1}`;
}

function bumpMinor(version: string): string {
  const [major = '0', minor = '0'] = version.split('.');
  return `${major}.${Number(minor) + 1}.0`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
