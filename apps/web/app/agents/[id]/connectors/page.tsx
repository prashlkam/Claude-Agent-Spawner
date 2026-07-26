'use client';

import { useEffect, useMemo, useState } from 'react';
import { looksLikeSecret, mcpPatterns, permissionsSnippet } from '@agent-spawner/compiler';
import { BUILTIN_TOOLS, DANGEROUS_TOOLS, newId } from '@agent-spawner/spec';
import type { McpServer } from '@agent-spawner/spec';
import { useSpec, useUpdate } from '@/lib/store.ts';
import {
  Badge,
  ChipSelect,
  CopyButton,
  Field,
  ListEditor,
  Segmented,
  SlideOver,
  TextArea,
  TextInput,
  Toggle,
  cx,
} from '@/components/ui.tsx';
import { AssistButton, AssistError, SuggestionPanel, useAssist } from '@/components/editor/Assist.tsx';

type ConnectorTemplate = {
  key: string;
  displayName: string;
  description: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env: Array<{ name: string; description: string; required: boolean; secret: boolean }>;
  docsUrl: string;
};

type ConnectorSuggestion = { servers: Array<ConnectorTemplate & { reasoning: string }> };

/** What the registry and the AI assist hand back: names and purposes, never values. */
type TemplateInput = Partial<Omit<McpServer, 'env'>> & {
  env?: Array<{ name: string; description?: string; required?: boolean; secret?: boolean }>;
};

export default function ConnectorsTab() {
  const spec = useSpec();
  const update = useUpdate();
  const [browsing, setBrowsing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const suggest = useAssist<ConnectorSuggestion>('suggest-connectors');

  const addServer = (template?: TemplateInput) => {
    const server: McpServer = {
      id: newId('mcp'),
      key: template?.key ?? 'new-server',
      displayName: template?.displayName ?? '',
      description: template?.description ?? '',
      transport: template?.transport ?? 'stdio',
      command: template?.command ?? '',
      args: template?.args ?? [],
      url: template?.url ?? '',
      // Templates declare names and purposes only, so the default value is always empty.
      env: (template?.env ?? []).map((variable) => ({
        name: variable.name,
        description: variable.description ?? '',
        required: variable.required ?? true,
        secret: variable.secret ?? true,
        defaultValue: '',
      })),
      toolAllowlist: [],
      source: template?.source ?? 'custom',
      docsUrl: template?.docsUrl ?? '',
    };
    update(
      (current) => ({
        ...current,
        connectors: { ...current.connectors, mcpServers: [...current.connectors.mcpServers, server] },
      }),
      'Added a connector',
    );
    setEditingId(server.id);
  };

  const permissions = permissionsSnippet(spec);

  return (
    <div className="space-y-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-950">Connectors &amp; tools</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
            What the agent can reach. Credentials are never entered here — you declare the variable
            names, and the person installing the plugin supplies the values.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <AssistButton busy={suggest.busy} onClick={() => suggest.run()}>
            Suggest connectors
          </AssistButton>
          <button className="btn-secondary" onClick={() => setBrowsing(true)}>
            Browse registry
          </button>
          <button className="btn-primary" onClick={() => addServer()}>
            Custom
          </button>
        </div>
      </header>

      <AssistError message={suggest.error} />

      {suggest.result && (
        <SuggestionPanel title="Suggested connectors" onDismiss={suggest.dismiss}>
          {suggest.result.servers.map((server) => (
            <div key={server.key} className="rounded-md bg-white px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12.5px] font-medium text-ink-900">{server.key}</span>
                <Badge tone="neutral">{server.transport}</Badge>
                <button className="btn-secondary ml-auto" onClick={() => addServer({ ...server, source: 'registry' })}>
                  Add
                </button>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-600">{server.description}</p>
              <p className="mt-1 text-[12px] text-ink-700">
                <strong>Why:</strong> {server.reasoning}
              </p>
            </div>
          ))}
        </SuggestionPanel>
      )}

      <section className="space-y-2.5">
        {spec.connectors.mcpServers.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-ink-600">
            No connectors. The agent can still use every built-in tool.
          </p>
        ) : (
          spec.connectors.mcpServers.map((server, index) => (
            <button
              key={server.id}
              onClick={() => setEditingId(server.id)}
              data-path={`connectors.mcpServers[${index}].key`}
              className="card block w-full cursor-pointer px-4 py-3.5 text-left hover:border-ink-400"
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium text-ink-900">{server.key}</span>
                <Badge tone="neutral">{server.transport}</Badge>
                {server.env.some((v) => v.secret) && <Badge tone="warn">needs a secret</Badge>}
              </span>
              <span className="mt-1 block text-[12.5px] text-ink-600">
                {server.description || server.displayName || 'No description.'}
              </span>
              <span className="mt-1 block font-mono text-[11px] text-ink-400">
                {mcpPatterns(server).join(', ')}
              </span>
            </button>
          ))
        )}
      </section>

      <BuiltinTools />
      <PermissionsBlock snippet={permissions} />
      <EnvPreview />

      <ServerEditor serverId={editingId} onClose={() => setEditingId(null)} />
      <RegistryBrowser open={browsing} onClose={() => setBrowsing(false)} onPick={addServer} />
    </div>
  );
}

function BuiltinTools() {
  const spec = useSpec();
  const update = useUpdate();
  const { allow, deny } = spec.connectors.builtinTools;

  const set = (patch: Partial<typeof spec.connectors.builtinTools>) =>
    update((current) => ({
      ...current,
      connectors: { ...current.connectors, builtinTools: { ...current.connectors.builtinTools, ...patch } },
    }));

  const broadGrant = allow.filter((tool) => (DANGEROUS_TOOLS as readonly string[]).includes(tool));

  return (
    <section className="card space-y-4 px-4 py-4">
      <div>
        <h2 className="section-title">Built-in tools</h2>
        <p className="hint">
          Leave the allowlist empty to inherit everything. Denials are applied first, so a tool in
          both lists is removed.
        </p>
      </div>

      <Field label="Allow" >
        <ChipSelect
          options={BUILTIN_TOOLS.map((tool) => ({ value: tool, label: tool }))}
          selected={allow}
          onChange={(next) => set({ allow: next })}
        />
      </Field>

      <div data-path="connectors.builtinTools.deny">
        <Field label="Deny">
          <ChipSelect
            options={BUILTIN_TOOLS.map((tool) => ({ value: tool, label: tool }))}
            selected={deny}
            onChange={(next) => set({ deny: next })}
          />
        </Field>
      </div>

      {broadGrant.length > 0 && (
        <p className="rounded-md bg-warn-100 px-3 py-2 text-[12.5px] leading-relaxed text-ink-800">
          {broadGrant.join(' and ')} {broadGrant.length === 1 ? 'is' : 'are'} granted broadly. Add
          specific deny rules below — <code>Bash(rm:*)</code>, <code>Write(.env)</code> — so the
          consuming project is not handing over unrestricted access.
        </p>
      )}
    </section>
  );
}

function PermissionsBlock({ snippet }: { snippet: string | null }) {
  const spec = useSpec();
  const update = useUpdate();
  const hint = spec.connectors.permissionsHint;

  const set = (patch: Partial<typeof hint>) =>
    update((current) => ({
      ...current,
      connectors: { ...current.connectors, permissionsHint: { ...current.connectors.permissionsHint, ...patch } },
    }));

  return (
    <section className="card space-y-4 px-4 py-4" data-path="connectors.permissionsHint.deny">
      <div>
        <h2 className="section-title">Recommended permissions</h2>
        <p className="hint">
          A plugin&rsquo;s <code>settings.json</code> cannot carry permissions — only{' '}
          <code>agent</code> and <code>subagentStatusLine</code> are honoured there. These go into
          the consuming project&rsquo;s <code>.claude/settings.json</code>, and the compiler puts
          this exact block in the README.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Allow patterns">
          <ListEditor
            mono
            items={hint.allow}
            onChange={(allow) => set({ allow })}
            placeholder="Read(**)"
            addLabel="pattern"
          />
        </Field>
        <Field label="Deny patterns">
          <ListEditor
            mono
            items={hint.deny}
            onChange={(deny) => set({ deny })}
            placeholder="Write(.env)"
            addLabel="pattern"
          />
        </Field>
      </div>

      {snippet && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label mb-0">Generated block</span>
            <CopyButton text={snippet} />
          </div>
          <pre className="overflow-x-auto rounded-md bg-ink-950 px-3 py-2.5 font-mono text-[11.5px] text-ink-100">
            {snippet}
          </pre>
        </div>
      )}
    </section>
  );
}

/** Live view of the generated `.env.example` — what the consumer will be asked for. */
function EnvPreview() {
  const spec = useSpec();
  const vars = spec.connectors.mcpServers.flatMap((server) =>
    server.env.map((variable) => ({ server: server.key, ...variable })),
  );
  if (vars.length === 0) return null;

  return (
    <section className="card space-y-3 px-4 py-4">
      <div>
        <h2 className="section-title">What the consumer will be asked for</h2>
        <p className="hint">
          These become <code>${'{VAR}'}</code> placeholders in <code>.mcp.json</code> and documented
          lines in <code>.env.example</code>. No value you type here is ever a credential.
        </p>
      </div>
      <ul className="space-y-1.5">
        {vars.map((variable) => (
          <li key={`${variable.server}.${variable.name}`} className="flex items-baseline gap-2">
            <code className="text-[12.5px] text-ink-900">{variable.name}</code>
            {variable.secret && <Badge tone="warn">secret</Badge>}
            {!variable.required && <Badge tone="neutral">optional</Badge>}
            <span className="text-[12px] text-ink-600">{variable.description || 'no description'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ServerEditor({ serverId, onClose }: { serverId: string | null; onClose: () => void }) {
  const spec = useSpec();
  const update = useUpdate();
  const server = spec.connectors.mcpServers.find((s) => s.id === serverId);
  if (!server) return null;

  const patch = (changes: Partial<McpServer>, label?: string) =>
    update(
      (current) => ({
        ...current,
        connectors: {
          ...current.connectors,
          mcpServers: current.connectors.mcpServers.map((s) =>
            s.id === server.id ? { ...s, ...changes } : s,
          ),
        },
      }),
      label,
    );

  return (
    <SlideOver
      open
      onClose={onClose}
      title={server.key}
      subtitle="Compiles into .mcp.json and .env.example"
      footer={
        <div className="flex items-center justify-between">
          <button
            className="btn-danger"
            onClick={() => {
              update(
                (current) => ({
                  ...current,
                  connectors: {
                    ...current.connectors,
                    mcpServers: current.connectors.mcpServers.filter((s) => s.id !== server.id),
                  },
                }),
                'Removed a connector',
              );
              onClose();
            }}
          >
            Remove
          </button>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Key" hint="How agents refer to it: mcp__key">
          <TextInput
            value={server.key}
            onChange={(event) =>
              patch({ key: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') })
            }
          />
        </Field>
        <Field label="Display name">
          <TextInput value={server.displayName} onChange={(event) => patch({ displayName: event.target.value })} />
        </Field>
      </div>

      <Field label="Description" hint="Written into the primary agent's prompt and the README.">
        <TextArea rows={2} value={server.description} onChange={(event) => patch({ description: event.target.value })} />
      </Field>

      <Field label="Transport">
        <Segmented
          value={server.transport}
          onChange={(transport) => patch({ transport })}
          options={[
            { value: 'stdio', label: 'stdio' },
            { value: 'http', label: 'http' },
            { value: 'sse', label: 'sse' },
          ]}
        />
      </Field>

      {server.transport === 'stdio' ? (
        <>
          <Field label="Command">
            <TextInput
              value={server.command}
              placeholder="npx"
              onChange={(event) => patch({ command: event.target.value })}
              className="field-mono"
            />
          </Field>
          <Field label="Arguments">
            <ListEditor
              mono
              items={server.args}
              onChange={(args) => patch({ args })}
              placeholder="@modelcontextprotocol/server-github"
              addLabel="argument"
            />
          </Field>
        </>
      ) : (
        <Field label="URL">
          <TextInput
            value={server.url}
            placeholder="https://mcp.example.com/mcp"
            onChange={(event) => patch({ url: event.target.value })}
            className="field-mono"
          />
        </Field>
      )}

      <Field
        label="Tool allowlist"
        hint="Empty grants the whole server as mcp__key. Naming tools narrows it to mcp__key__tool."
      >
        <ListEditor
          mono
          items={server.toolAllowlist}
          onChange={(toolAllowlist) => patch({ toolAllowlist })}
          placeholder="search_repositories"
          addLabel="tool"
        />
      </Field>

      <Field label="Environment variables">
        <div className="space-y-2.5">
          {server.env.map((variable, index) => {
            const suspicious = looksLikeSecret(variable.defaultValue);
            return (
              <div key={index} className="card space-y-2.5 px-3 py-3">
                <div className="flex items-center gap-1.5">
                  <TextInput
                    value={variable.name}
                    placeholder="GITHUB_TOKEN"
                    onChange={(event) => {
                      const env = [...server.env];
                      env[index] = { ...env[index]!, name: event.target.value.toUpperCase() };
                      patch({ env });
                    }}
                    className="field-mono"
                  />
                  <button
                    className="btn-ghost px-2 text-ink-400 hover:text-danger-600"
                    onClick={() => patch({ env: server.env.filter((_, i) => i !== index) })}
                  >
                    ✕
                  </button>
                </div>

                <TextInput
                  value={variable.description}
                  placeholder="What this is for and how to get one."
                  onChange={(event) => {
                    const env = [...server.env];
                    env[index] = { ...env[index]!, description: event.target.value };
                    patch({ env });
                  }}
                />

                <div className="flex gap-5">
                  <Toggle
                    checked={variable.required}
                    onChange={(required) => {
                      const env = [...server.env];
                      env[index] = { ...env[index]!, required };
                      patch({ env });
                    }}
                    label="Required"
                  />
                  <Toggle
                    checked={variable.secret}
                    onChange={(secret) => {
                      const env = [...server.env];
                      env[index] = { ...env[index]!, secret, defaultValue: secret ? '' : env[index]!.defaultValue };
                      patch({ env });
                    }}
                    label="Secret"
                    hint="Secrets never carry a default."
                  />
                </div>

                {!variable.secret && (
                  <Field
                    label="Default value"
                    error={
                      suspicious
                        ? 'That looks like a live credential. Nothing secret may be baked into the bundle — mark this variable secret and leave the value empty.'
                        : undefined
                    }
                  >
                    <TextInput
                      value={variable.defaultValue}
                      onChange={(event) => {
                        const env = [...server.env];
                        env[index] = { ...env[index]!, defaultValue: event.target.value };
                        patch({ env });
                      }}
                      className={cx('field-mono', suspicious && 'border-danger-600')}
                    />
                  </Field>
                )}
              </div>
            );
          })}
          <button
            className="btn-secondary"
            onClick={() =>
              patch({
                env: [
                  ...server.env,
                  { name: '', required: true, description: '', secret: true, defaultValue: '' },
                ],
              })
            }
          >
            + Add a variable
          </button>
        </div>
      </Field>

      <Field label="Docs URL">
        <TextInput value={server.docsUrl} onChange={(event) => patch({ docsUrl: event.target.value })} />
      </Field>
    </SlideOver>
  );
}

function RegistryBrowser({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (template: TemplateInput) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConnectorTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/connectors/search?q=${encodeURIComponent(query)}`);
      const body = await response.json().catch(() => ({ connectors: [] }));
      setResults(body.connectors ?? []);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  const rows = useMemo(() => results, [results]);

  return (
    <SlideOver open={open} onClose={onClose} title="MCP servers" width="max-w-xl">
      <TextInput
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search…"
      />
      {loading && <p className="text-[12.5px] text-ink-600">Searching…</p>}
      <ul className="space-y-2">
        {rows.map((template) => (
          <li key={template.key} className="card px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12.5px] font-medium text-ink-900">{template.key}</span>
              <Badge tone="neutral">{template.transport}</Badge>
              <button
                className="btn-secondary ml-auto"
                onClick={() => {
                  onPick({ ...template, source: 'registry' });
                  onClose();
                }}
              >
                Add
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-ink-600">{template.description}</p>
            {template.env.length > 0 && (
              <p className="mt-1 font-mono text-[11px] text-ink-400">
                needs: {template.env.map((v) => v.name).join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </SlideOver>
  );
}
