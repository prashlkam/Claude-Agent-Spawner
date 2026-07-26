'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SlideOver, TextArea, TextInput } from '@/components/ui.tsx';

export function NewAgentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || 'Untitled agent' }),
    });
    setBusy(false);
    if (!response.ok) {
      setError((await response.json().catch(() => ({}))).error ?? 'Could not create the agent.');
      return;
    }
    const body = await response.json();
    router.push(`/agents/${body.id}/goal`);
  }

  async function importBundle() {
    setBusy(true);
    setError('');
    let files: Array<{ path: string; content: string }>;
    try {
      const parsed = JSON.parse(pasted);
      files = Array.isArray(parsed) ? parsed : parsed.files;
      if (!Array.isArray(files)) throw new Error('Expected an array of files.');
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'That is not valid JSON.');
      return;
    }

    const response = await fetch('/api/agents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    setBusy(false);
    if (!response.ok) {
      setError((await response.json().catch(() => ({}))).error ?? 'Import failed.');
      return;
    }
    const body = await response.json();
    router.push(`/agents/${body.id}/goal`);
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        New agent
      </button>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="New agent"
        subtitle="Start from scratch, or import a plugin you already have."
        width="max-w-lg"
        footer={
          <div className="flex items-center justify-between">
            {error ? <span className="text-[12px] text-danger-600">{error}</span> : <span />}
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => (importing ? importBundle() : create())}
            >
              {busy ? 'Working…' : importing ? 'Import' : 'Create'}
            </button>
          </div>
        }
      >
        <div className="flex gap-1.5">
          <button
            className={importing ? 'btn-secondary' : 'btn-primary'}
            onClick={() => setImporting(false)}
          >
            Start fresh
          </button>
          <button
            className={importing ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setImporting(true)}
          >
            Import a plugin
          </button>
        </div>

        {importing ? (
          <div className="space-y-2">
            <label className="label">Plugin files as JSON</label>
            <TextArea
              rows={12}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder={'[\n  { "path": ".claude-plugin/plugin.json", "content": "{ \\"name\\": \\"my-plugin\\" }" }\n]'}
              className="field-mono"
            />
            <p className="hint">
              The importer reads the bundle back into an editable spec. Imported content is treated
              strictly as data — nothing in it is executed, and nothing is sent to an AI assist
              without being marked untrusted.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="label">What should this agent be called?</label>
            <TextInput
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && create()}
              placeholder="Weekly research brief"
            />
            <p className="hint">The slug is derived from this and stays editable on the Misc tab.</p>
          </div>
        )}
      </SlideOver>
    </>
  );
}

export function AgentActions({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function duplicate() {
    setBusy(true);
    const response = await fetch(`/api/agents/${id}/duplicate`, { method: 'POST' });
    setBusy(false);
    if (response.ok) {
      const body = await response.json();
      router.push(`/agents/${body.id}/goal`);
    }
  }

  async function remove() {
    if (!confirm(`Delete “${title}”? Its version history and uploaded files go too.`)) return;
    setBusy(true);
    await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex shrink-0 gap-1.5">
      <button className="btn-secondary" disabled={busy} onClick={duplicate}>
        Duplicate
      </button>
      <button className="btn-danger" disabled={busy} onClick={remove}>
        Delete
      </button>
    </div>
  );
}
