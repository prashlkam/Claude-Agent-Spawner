'use client';

import { useState } from 'react';
import { useCompiled } from '@/lib/useCompiled.ts';
import { Badge, cx } from '@/components/ui.tsx';
import { AssistButton, AssistError, useAssist } from '@/components/editor/Assist.tsx';

type Review = {
  summary: string;
  findings: Array<{ severity: 'high' | 'medium' | 'low'; area: string; message: string; suggestion: string }>;
};

/** Full-width file browser — the same compile the preview pane and the export use. */
export default function PreviewTab() {
  const compiled = useCompiled();
  const [selected, setSelected] = useState<string | null>(null);
  const review = useAssist<Review>('review-agent');

  const file = compiled.files.find((f) => f.path === selected) ?? compiled.files[0];

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-950">The bundle</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
            Exactly what gets zipped and pushed. Read the scripts before you ship them — they run on
            the installing user&rsquo;s machine.
          </p>
        </div>
        <AssistButton busy={review.busy} onClick={() => review.run()}>
          Review this agent
        </AssistButton>
      </header>

      <AssistError message={review.error} />

      {review.result && (
        <section className="card space-y-3 px-4 py-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Review</h2>
            <button className="btn-ghost" onClick={review.dismiss}>
              Dismiss
            </button>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-700">{review.result.summary}</p>
          <ul className="space-y-2">
            {review.result.findings.map((finding, index) => (
              <li key={index} className="rounded-md bg-ink-50 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Badge tone={finding.severity === 'high' ? 'danger' : finding.severity === 'medium' ? 'warn' : 'neutral'}>
                    {finding.severity}
                  </Badge>
                  <span className="text-[12px] text-ink-500">{finding.area}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-800">{finding.message}</p>
                <p className="mt-1 text-[12.5px] text-ink-600">{finding.suggestion}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-[240px_1fr] gap-4">
        <ul className="space-y-0.5">
          {compiled.files.map((entry) => (
            <li key={entry.path}>
              <button
                onClick={() => setSelected(entry.path)}
                className={cx(
                  'w-full cursor-pointer truncate rounded px-2 py-1 text-left font-mono text-[11.5px] transition',
                  file?.path === entry.path ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100',
                )}
              >
                {entry.path}
              </button>
            </li>
          ))}
        </ul>

        <div className="card overflow-hidden">
          {file ? (
            <>
              <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
                <span className="font-mono text-[12px] text-ink-800">{file.path}</span>
                {file.executable && <Badge tone="warn">executable</Badge>}
              </div>
              <pre className="max-h-[60vh] overflow-auto px-3 py-3 font-mono text-[11.5px] leading-[1.6] text-ink-800">
                {file.external
                  ? `Uploaded file — ${file.external.sizeBytes} bytes streamed from storage at export time.`
                  : file.content}
              </pre>
            </>
          ) : (
            <p className="px-4 py-6 text-[13px] text-ink-600">Nothing compiled yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
