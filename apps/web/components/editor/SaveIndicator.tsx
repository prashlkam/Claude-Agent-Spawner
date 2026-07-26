'use client';

import { useEditor } from '@/lib/store.ts';

const LABELS: Record<string, string> = {
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
  conflict: 'Changed elsewhere',
};

export function SaveIndicator() {
  const state = useEditor((s) => s.saveState);
  const error = useEditor((s) => s.error);
  const reload = useEditor((s) => s.reload);
  const save = useEditor((s) => s.save);

  if (state === 'conflict') {
    return (
      <span className="flex items-center gap-2 rounded-md bg-danger-100 px-2 py-1 text-[12px] text-danger-600">
        {error}
        <button className="cursor-pointer font-medium underline" onClick={() => void reload()}>
          Reload
        </button>
      </span>
    );
  }

  if (state === 'error') {
    return (
      <span className="flex items-center gap-2 rounded-md bg-danger-100 px-2 py-1 text-[12px] text-danger-600">
        {error || LABELS.error}
        <button className="cursor-pointer font-medium underline" onClick={() => void save()}>
          Retry
        </button>
      </span>
    );
  }

  return <span className="text-[12px] text-ink-400">{LABELS[state]}</span>;
}
