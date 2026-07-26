'use client';

import { useState } from 'react';
import { useEditor } from '@/lib/store.ts';
import { cx } from '@/components/ui.tsx';

/**
 * Suggest-then-accept. Every AI assist runs, shows what it would change, and waits — the spec
 * is never mutated behind the user's back (PLAN §8).
 */
export function useAssist<T>(task: string) {
  const [result, setResult] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    const spec = useEditor.getState().spec;
    const response = await fetch(`/api/ai/${task}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, ...extra }),
    });
    setBusy(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? 'The assist failed.');
      return;
    }
    const body = await response.json();
    setResult(body.result as T);
  }

  return { result, busy, error, run, dismiss: () => setResult(null) };
}

export function AssistButton({
  onClick,
  busy,
  children,
  className,
}: {
  onClick: () => void;
  busy: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={cx('btn-secondary', className)}>
      {busy ? 'Asking Claude…' : children}
    </button>
  );
}

/** Panel that holds a pending suggestion until the user accepts or rejects it. */
export function SuggestionPanel({
  title,
  onAccept,
  onDismiss,
  acceptLabel = 'Accept',
  children,
}: {
  title: string;
  onAccept?: () => void;
  onDismiss: () => void;
  acceptLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-accent-600/30 bg-accent-100/40">
      <header className="flex items-center justify-between border-b border-accent-600/20 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-ink-900">{title}</span>
        <div className="flex gap-1.5">
          {onAccept && (
            <button className="btn-primary" onClick={onAccept}>
              {acceptLabel}
            </button>
          )}
          <button className="btn-ghost" onClick={onDismiss}>
            Discard
          </button>
        </div>
      </header>
      <div className="space-y-3 px-4 py-3">{children}</div>
    </div>
  );
}

export function AssistError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="rounded-md bg-danger-100 px-3 py-2 text-[12.5px] text-danger-600">{message}</p>
  );
}
