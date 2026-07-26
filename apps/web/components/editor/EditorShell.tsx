'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AgentSpec } from '@agent-spawner/spec';
import { useCompiled } from '@/lib/useCompiled.ts';
import { useEditor } from '@/lib/store.ts';
import { useUi } from '@/lib/ui-store.ts';
import { cx } from '@/components/ui.tsx';
import { DiagnosticsDrawer } from './DiagnosticsDrawer.tsx';
import { PreviewPane } from './PreviewPane.tsx';
import { SaveIndicator } from './SaveIndicator.tsx';

const TABS = [
  { slug: 'goal', label: 'Goal' },
  { slug: 'workflows', label: 'Workflows' },
  { slug: 'sub-agents', label: 'Sub-agents' },
  { slug: 'skills', label: 'Skills' },
  { slug: 'connectors', label: 'Connectors' },
  { slug: 'misc', label: 'Misc' },
  { slug: 'preview', label: 'Preview' },
  { slug: 'deploy', label: 'Deploy' },
];

/**
 * Tab shell, live preview pane and validation drawer.
 *
 * The shell owns hydration of the draft spec; every tab underneath reads from the same store.
 * The preview is a compile of the current draft, so it always reflects what would ship.
 */
export function EditorShell({
  agentId,
  spec,
  revision,
  children,
}: {
  agentId: string;
  spec: AgentSpec;
  revision: number;
  children: React.ReactNode;
}) {
  const hydrate = useEditor((state) => state.hydrate);
  const hydrated = useEditor((state) => state.agentId === agentId);
  const name = useEditor((state) => state.spec?.meta?.name);
  const pathname = usePathname();
  const compiled = useCompiled();
  const [showPreview, setShowPreview] = useState(true);
  const focusPath = useUi((state) => state.focusPath);
  const clearFocus = useUi((state) => state.focus);

  useEffect(() => {
    hydrate(agentId, spec, revision);
    // Re-hydrating on every server render would stomp on unsaved edits; the agent id is the
    // only thing that should trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Click-to-field: a diagnostic sets a spec path, the tab that owns it gets scrolled into view.
  useEffect(() => {
    if (!focusPath) return;
    const timer = setTimeout(() => {
      const element = document.querySelector(`[data-path="${CSS.escape(focusPath)}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ring-2', 'ring-accent-500', 'rounded-md');
        setTimeout(() => element.classList.remove('ring-2', 'ring-accent-500', 'rounded-md'), 2400);
      }
      clearFocus(null);
    }, 220);
    return () => clearTimeout(timer);
  }, [focusPath, pathname, clearFocus]);

  const errors = compiled.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = compiled.diagnostics.filter((d) => d.severity === 'warning').length;

  if (!hydrated) {
    return <div className="px-6 py-10 text-[13px] text-ink-600">Loading the editor…</div>;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-ink-200 bg-white px-4 py-2.5">
        <Link href="/agents" className="text-[13px] text-ink-600 hover:text-ink-900">
          ← Agents
        </Link>
        <span className="truncate text-[14px] font-semibold text-ink-900">{name}</span>
        <SaveIndicator />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => useUi.getState().toggleDrawer()}
            className={cx(
              'btn-secondary',
              errors > 0 && 'border-danger-600/40 text-danger-600',
              errors === 0 && warnings > 0 && 'border-warn-600/40 text-warn-600',
            )}
          >
            {errors > 0
              ? `${errors} error${errors === 1 ? '' : 's'}`
              : warnings > 0
                ? `${warnings} warning${warnings === 1 ? '' : 's'}`
                : 'No problems'}
          </button>
          <button className="btn-ghost" onClick={() => setShowPreview((value) => !value)}>
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
      </header>

      <nav className="flex shrink-0 gap-0.5 border-b border-ink-200 bg-white px-3">
        {TABS.map((tab) => {
          const href = `/agents/${agentId}/${tab.slug}`;
          const active = pathname === href;
          return (
            <Link
              key={tab.slug}
              href={href}
              className={cx(
                'border-b-2 px-3 py-2 text-[13px] font-medium transition',
                active
                  ? 'border-accent-600 text-ink-900'
                  : 'border-transparent text-ink-600 hover:text-ink-900',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl pb-24">{children}</div>
        </main>
        {showPreview && (
          <aside className="hidden w-[420px] shrink-0 border-l border-ink-200 bg-white xl:block">
            <PreviewPane compiled={compiled} />
          </aside>
        )}
      </div>

      <DiagnosticsDrawer agentId={agentId} diagnostics={compiled.diagnostics} />
    </div>
  );
}
