'use client';

import { useEffect, useState } from 'react';
import { useEditor, useSpec, useUpdate } from '@/lib/store.ts';
import { Badge, CopyButton, Field, Segmented, Select, TextInput, cx } from '@/components/ui.tsx';

type DiffEntry = { path: string; change: 'added' | 'modified' | 'removed' | 'unchanged' };

type DeployState = {
  configured: boolean;
  connected?: boolean;
  diff: DiffEntry[];
  history: Array<{
    id: string;
    repoFullName: string;
    branch: string;
    status: string;
    commitSha: string;
    logs: string;
    createdAt: string;
  }>;
};

type Repo = { fullName: string; private: boolean; defaultBranch: string };

export default function DeployTab() {
  const spec = useSpec();
  const update = useUpdate();
  const agentId = useEditor((state) => state.agentId);
  const save = useEditor((state) => state.save);

  const [state, setState] = useState<DeployState | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [installationId, setInstallationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const deployment = spec.deployment;

  useEffect(() => {
    if (!agentId) return;
    void (async () => {
      const [deployResponse, repoResponse] = await Promise.all([
        fetch(`/api/agents/${agentId}/deploy`),
        fetch('/api/github/repos'),
      ]);
      setState(await deployResponse.json().catch(() => null));
      const repoBody = await repoResponse.json().catch(() => ({ repos: [] }));
      setRepos(repoBody.repos ?? []);
    })();
  }, [agentId]);

  const setDeployment = (patch: Record<string, unknown>) =>
    update(
      (current) => ({
        ...current,
        deployment: {
          target: 'github' as const,
          repo: { owner: '', name: '', visibility: 'private' as const },
          branch: 'main',
          asMarketplace: true,
          ...current.deployment,
          ...patch,
        },
      }),
      'Changed the deploy target',
    );

  async function connect() {
    setBusy(true);
    setError('');
    const response = await fetch('/api/github/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (body.error) {
      setError(body.error);
      return;
    }
    setRepos(body.repos ?? []);
  }

  async function push() {
    const target = `${deployment?.repo.owner}/${deployment?.repo.name}`;
    const confirmed = confirm(
      `Push to ${target} on branch ${deployment?.branch}?\n\nThis writes a commit to a repository you own. It is public if the repository is public.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    setMessage('');
    await save();

    const response = await fetch(`/api/agents/${agentId}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? 'The push failed.');
      return;
    }
    setMessage(`Pushed ${body.commitSha.slice(0, 7)} — ${body.url}`);
    const refreshed = await fetch(`/api/agents/${agentId}/deploy`);
    setState(await refreshed.json().catch(() => null));
  }

  const changed = state?.diff.filter((entry) => entry.change !== 'unchanged') ?? [];
  const ready = Boolean(deployment?.repo.owner && deployment.repo.name && state?.connected);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-ink-950">Deploy</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
          Push the bundle to a repository you own, so it can be installed with{' '}
          <code className="rounded bg-ink-100 px-1">/plugin marketplace add</code>.
        </p>
      </header>

      <section className="card space-y-4 px-4 py-4">
        <h2 className="section-title">GitHub connection</h2>

        {state && !state.configured ? (
          <div className="rounded-md bg-warn-100 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-800">
            <p className="font-medium">Not configured on this deployment.</p>
            <p className="mt-1">
              Deployment uses a GitHub App rather than a personal access token: installation tokens
              are short-lived and scoped to the repositories you pick, so this app never holds a
              credential that can touch your whole account. Set{' '}
              <code>GITHUB_APP_ID</code> and <code>GITHUB_APP_PRIVATE_KEY</code>, then install the
              app on the target repository.
            </p>
            <p className="mt-1">You can still export the zip and push it yourself.</p>
          </div>
        ) : state?.connected ? (
          <p className="text-[12.5px] text-ok-600">
            Connected. Only the installation id is stored — access tokens are minted per push and
            never written down.
          </p>
        ) : (
          <div className="space-y-2">
            <Field
              label="Installation id"
              hint="From the URL after you install the GitHub App: github.com/settings/installations/<id>"
            >
              <TextInput
                value={installationId}
                onChange={(event) => setInstallationId(event.target.value)}
                placeholder="12345678"
                className="field-mono w-48"
              />
            </Field>
            <button className="btn-primary" disabled={busy || !installationId} onClick={connect}>
              Connect
            </button>
          </div>
        )}
      </section>

      <section className="card space-y-4 px-4 py-4">
        <h2 className="section-title">Target</h2>

        {repos.length > 0 ? (
          <Field label="Repository">
            <Select
              value={`${deployment?.repo.owner ?? ''}/${deployment?.repo.name ?? ''}`}
              onChange={(event) => {
                const [owner = '', name = ''] = event.target.value.split('/');
                const repo = repos.find((r) => r.fullName === event.target.value);
                setDeployment({
                  repo: { owner, name, visibility: repo?.private ? 'private' : 'public' },
                  branch: repo?.defaultBranch ?? 'main',
                });
              }}
              options={[
                { value: '/', label: 'Choose a repository…' },
                ...repos.map((repo) => ({
                  value: repo.fullName,
                  label: `${repo.fullName}${repo.private ? ' (private)' : ''}`,
                })),
              ]}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Owner">
              <TextInput
                value={deployment?.repo.owner ?? ''}
                onChange={(event) =>
                  setDeployment({ repo: { ...deployment?.repo, owner: event.target.value } })
                }
              />
            </Field>
            <Field label="Repository">
              <TextInput
                value={deployment?.repo.name ?? ''}
                onChange={(event) =>
                  setDeployment({ repo: { ...deployment?.repo, name: event.target.value } })
                }
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Branch">
            <TextInput
              value={deployment?.branch ?? 'main'}
              onChange={(event) => setDeployment({ branch: event.target.value })}
              className="field-mono"
            />
          </Field>
          <Field label="Visibility" hint="Read from the repository; shown so nothing is a surprise.">
            <Segmented
              value={deployment?.repo.visibility ?? 'private'}
              onChange={(visibility) =>
                setDeployment({ repo: { ...deployment?.repo, visibility } })
              }
              options={[
                { value: 'private', label: 'Private' },
                { value: 'public', label: 'Public' },
              ]}
            />
          </Field>
        </div>
      </section>

      <section className="card space-y-3 px-4 py-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title">What will change</h2>
          <span className="text-[12px] text-ink-600">
            {changed.length === 0 ? 'Nothing to push' : `${changed.length} files`}
          </span>
        </div>

        {changed.length > 0 && (
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {changed.map((entry) => (
              <li key={entry.path} className="flex items-center gap-2 font-mono text-[11.5px]">
                <span
                  className={cx(
                    'w-16 shrink-0 text-[10.5px] uppercase',
                    entry.change === 'added' && 'text-ok-600',
                    entry.change === 'modified' && 'text-warn-600',
                    entry.change === 'removed' && 'text-danger-600',
                  )}
                >
                  {entry.change}
                </span>
                <span className="truncate text-ink-800">{entry.path}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={!ready || busy} onClick={push}>
            {busy ? 'Pushing…' : 'Push to GitHub'}
          </button>
          <span className="text-[12px] text-ink-600">
            Runs validation first, then writes one commit
            {spec.meta.versionMode === 'pinned' ? ` and tags v${spec.meta.version}` : ''}.
          </span>
        </div>

        {error && <p className="rounded-md bg-danger-100 px-3 py-2 text-[12.5px] text-danger-600">{error}</p>}
        {message && <p className="rounded-md bg-ok-600/10 px-3 py-2 text-[12.5px] text-ok-600">{message}</p>}
      </section>

      {deployment?.repo.owner && deployment.repo.name && (
        <section className="card space-y-2 px-4 py-4">
          <h2 className="section-title">Then, in Claude Code</h2>
          <div className="flex items-center gap-2">
            <pre className="flex-1 overflow-x-auto rounded-md bg-ink-950 px-3 py-2 font-mono text-[11.5px] text-ink-100">
              {`/plugin marketplace add ${deployment.repo.owner}/${deployment.repo.name}\n/plugin install ${spec.meta.slug}@${spec.meta.slug}`}
            </pre>
            <CopyButton
              text={`/plugin marketplace add ${deployment.repo.owner}/${deployment.repo.name}\n/plugin install ${spec.meta.slug}@${spec.meta.slug}`}
            />
          </div>
        </section>
      )}

      {state && state.history.length > 0 && (
        <section className="card space-y-2 px-4 py-4">
          <h2 className="section-title">History</h2>
          <ul className="space-y-1.5">
            {state.history.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-[12.5px]">
                <Badge tone={entry.status === 'succeeded' ? 'ok' : entry.status === 'failed' ? 'danger' : 'neutral'}>
                  {entry.status}
                </Badge>
                <span className="font-mono text-ink-700">
                  {entry.repoFullName}@{entry.branch}
                </span>
                {entry.commitSha && (
                  <span className="font-mono text-ink-400">{entry.commitSha.slice(0, 7)}</span>
                )}
                <span className="ml-auto text-ink-400">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
