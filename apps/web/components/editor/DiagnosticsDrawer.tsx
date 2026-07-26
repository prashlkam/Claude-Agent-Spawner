'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Diagnostic } from '@agent-spawner/compiler';
import { useUi } from '@/lib/ui-store.ts';
import { Badge, cx } from '@/components/ui.tsx';

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/**
 * The validation drawer. Every diagnostic carries a spec path and a tab, so clicking one
 * navigates to the field that caused it rather than leaving the user to hunt.
 */
export function DiagnosticsDrawer({
  agentId,
  diagnostics,
}: {
  agentId: string;
  diagnostics: Diagnostic[];
}) {
  const open = useUi((s) => s.drawerOpen);
  const toggle = useUi((s) => s.toggleDrawer);
  const focus = useUi((s) => s.focus);
  const selectFile = useUi((s) => s.selectFile);
  const router = useRouter();

  const [l3, setL3] = useState<{ status: string; runner: string; output: string } | null>(null);
  const [running, setRunning] = useState(false);

  if (!open) return null;

  const sorted = [...diagnostics].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  async function runL3() {
    setRunning(true);
    const response = await fetch(`/api/agents/${agentId}/validate`, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    setRunning(false);
    setL3({
      status: body.status ?? 'failed',
      runner: body.runner ?? 'none',
      output: body.cliOutput ?? body.error ?? '',
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 max-h-[55vh] border-t border-ink-200 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
      <header className="flex items-center justify-between border-b border-ink-200 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-ink-900">Validation</span>
          <span className="text-[12px] text-ink-600">
            {diagnostics.length === 0 ? 'Nothing to report.' : `${diagnostics.length} findings`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={running} onClick={runL3}>
            {running ? 'Running…' : 'Run claude plugin validate'}
          </button>
          <button className="btn-ghost px-2" onClick={() => toggle(false)} aria-label="Close">
            ✕
          </button>
        </div>
      </header>

      <div className="max-h-[42vh] overflow-y-auto">
        {l3 && (
          <div className="border-b border-ink-200 bg-ink-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Badge tone={l3.status === 'passed' ? 'ok' : l3.status === 'failed' ? 'danger' : 'warn'}>
                {l3.status}
              </Badge>
              <span className="text-[12px] text-ink-600">
                {l3.runner === 'docker'
                  ? 'sandboxed container'
                  : l3.runner === 'local'
                    ? 'local CLI — not sandboxed'
                    : 'no runner available'}
              </span>
            </div>
            {l3.output && (
              <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11.5px] text-ink-700">
                {l3.output}
              </pre>
            )}
          </div>
        )}

        {sorted.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-600">
            The schema and semantic checks pass. Run the real CLI validation for ground truth.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {sorted.map((diagnostic, index) => (
              <li key={index}>
                <button
                  onClick={() => {
                    if (diagnostic.file) selectFile(diagnostic.file);
                    if (diagnostic.tab) router.push(`/agents/${agentId}/${diagnostic.tab}`);
                    if (diagnostic.path) focus(diagnostic.path);
                  }}
                  className="flex w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left hover:bg-ink-50"
                >
                  <span className="mt-0.5">
                    <Badge
                      tone={
                        diagnostic.severity === 'error'
                          ? 'danger'
                          : diagnostic.severity === 'warning'
                            ? 'warn'
                            : 'neutral'
                      }
                    >
                      {diagnostic.severity}
                    </Badge>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-relaxed text-ink-800">
                      {diagnostic.message}
                    </span>
                    <span className="mt-0.5 flex gap-2 font-mono text-[11px] text-ink-400">
                      <span>{diagnostic.rule}</span>
                      {diagnostic.path && <span>· {diagnostic.path}</span>}
                      {diagnostic.file && <span>· {diagnostic.file}</span>}
                    </span>
                  </span>
                  <span className={cx('mt-1 shrink-0 text-[11px] text-ink-400')}>
                    {diagnostic.layer === 'cli' ? 'L3' : diagnostic.layer === 'zod' ? 'L1' : 'L2'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
