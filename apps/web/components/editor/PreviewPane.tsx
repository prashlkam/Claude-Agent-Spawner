'use client';

import { useMemo } from 'react';
import { compile } from '@agent-spawner/compiler';
import type { CompiledFile, TreeNode } from '@agent-spawner/compiler';
import { useEditor } from '@/lib/store.ts';
import { useUi } from '@/lib/ui-store.ts';
import type { Compiled } from '@/lib/useCompiled.ts';
import { Badge, cx } from '@/components/ui.tsx';

/**
 * The live bundle: **Tree**, **File** and **Diff** (against the last saved revision).
 *
 * Everything here comes from the same compiler the export uses, so what is on screen is the
 * bundle — not a rendering of it.
 */
export function PreviewPane({ compiled }: { compiled: Compiled }) {
  const mode = useUi((s) => s.previewMode);
  const setMode = useUi((s) => s.setPreviewMode);
  const selected = useUi((s) => s.selectedFile);
  const selectFile = useUi((s) => s.selectFile);
  const savedSpec = useEditor((s) => s.savedSpec);

  const savedFiles = useMemo(() => {
    try {
      return savedSpec?.meta ? compile(savedSpec).files : [];
    } catch {
      return [];
    }
  }, [savedSpec]);

  const totalBytes = compiled.files.reduce(
    (sum, file) => sum + (file.external?.sizeBytes ?? file.content?.length ?? 0),
    0,
  );

  const changed = useMemo(() => {
    const before = new Map(savedFiles.map((f) => [f.path, f.content]));
    const after = new Map(compiled.files.map((f) => [f.path, f.content]));
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
    return paths
      .map((path) => ({
        path,
        before: before.get(path) ?? null,
        after: after.get(path) ?? null,
      }))
      .filter((entry) => entry.before !== entry.after);
  }, [savedFiles, compiled.files]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <div className="inline-flex rounded-md border border-ink-200 p-0.5">
          {(['tree', 'file', 'diff'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={cx(
                'cursor-pointer rounded px-2 py-0.5 text-[12px] font-medium capitalize transition',
                mode === value ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {value}
              {value === 'diff' && changed.length > 0 ? ` (${changed.length})` : ''}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-400">
          {compiled.files.length} files · {formatBytes(totalBytes)}
          {compiled.pending ? ' · compiling…' : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'tree' && (
          <div className="px-2 py-2">
            <Tree nodes={compiled.tree} onSelect={selectFile} selected={selected} />
          </div>
        )}

        {mode === 'file' && <FileView files={compiled.files} selected={selected} />}

        {mode === 'diff' && (
          <div className="px-3 py-3">
            {changed.length === 0 ? (
              <p className="text-[12.5px] text-ink-600">
                No differences from the last saved revision.
              </p>
            ) : (
              changed.map((entry) => (
                <div key={entry.path} className="mb-4">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[12px] text-ink-800">{entry.path}</span>
                    <Badge tone={entry.before === null ? 'ok' : entry.after === null ? 'danger' : 'accent'}>
                      {entry.before === null ? 'added' : entry.after === null ? 'removed' : 'changed'}
                    </Badge>
                  </div>
                  <Diff before={entry.before ?? ''} after={entry.after ?? ''} />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Tree({
  nodes,
  onSelect,
  selected,
  depth = 0,
}: {
  nodes: TreeNode[];
  onSelect: (path: string) => void;
  selected: string | null;
  depth?: number;
}) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === 'dir' ? (
            <>
              <div
                className="py-0.5 font-mono text-[12px] text-ink-600"
                style={{ paddingLeft: depth * 12 + 6 }}
              >
                {node.name}/
              </div>
              <Tree nodes={node.children} onSelect={onSelect} selected={selected} depth={depth + 1} />
            </>
          ) : (
            <button
              onClick={() => onSelect(node.path)}
              style={{ paddingLeft: depth * 12 + 6 }}
              className={cx(
                'flex w-full cursor-pointer items-center gap-2 rounded py-0.5 pr-2 text-left font-mono text-[12px] transition',
                selected === node.path ? 'bg-accent-100 text-accent-600' : 'text-ink-800 hover:bg-ink-100',
              )}
            >
              <span className="truncate">{node.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-ink-400">
                {node.external ? 'upload' : formatBytes(node.size)}
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function FileView({ files, selected }: { files: CompiledFile[]; selected: string | null }) {
  const file = files.find((f) => f.path === selected);
  if (!file) {
    return <p className="px-3 py-3 text-[12.5px] text-ink-600">Pick a file in the tree.</p>;
  }
  if (file.external) {
    return (
      <p className="px-3 py-3 text-[12.5px] text-ink-600">
        <span className="font-mono">{file.path}</span> is an uploaded file ({formatBytes(file.external.sizeBytes)}).
        Its bytes are streamed straight from storage into the bundle.
      </p>
    );
  }
  const lines = (file.content ?? '').split('\n');
  return (
    <pre className="px-3 py-3 font-mono text-[11.5px] leading-[1.55]">
      {lines.map((line, index) => (
        <div key={index} className="flex">
          <span className="w-8 shrink-0 select-none text-right text-ink-200">{index + 1}</span>
          <span className="ml-3 whitespace-pre-wrap break-words text-ink-800">{line || ' '}</span>
        </div>
      ))}
    </pre>
  );
}

/** Line diff via a plain LCS. Generated files are small; readability beats cleverness here. */
function Diff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => diffLines(before.split('\n'), after.split('\n')), [before, after]);
  return (
    <div className="overflow-x-auto rounded border border-ink-200">
      {rows.map((row, index) => (
        <div
          key={index}
          className={cx(
            'flex font-mono text-[11.5px] leading-[1.6]',
            row.kind === 'add' && 'bg-ok-600/10',
            row.kind === 'remove' && 'bg-danger-100',
          )}
        >
          <span className="w-4 shrink-0 select-none px-1 text-ink-400">
            {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}
          </span>
          <span className="whitespace-pre-wrap break-words pr-2 text-ink-800">{row.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}

type DiffRow = { kind: 'same' | 'add' | 'remove'; text: string };

function diffLines(before: string[], after: string[]): DiffRow[] {
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i]![j] =
        before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ kind: 'same', text: before[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      rows.push({ kind: 'remove', text: before[i]! });
      i++;
    } else {
      rows.push({ kind: 'add', text: after[j]! });
      j++;
    }
  }
  while (i < before.length) rows.push({ kind: 'remove', text: before[i++]! });
  while (j < after.length) rows.push({ kind: 'add', text: after[j++]! });

  // Collapse long runs of unchanged lines so the interesting parts stay on screen.
  return collapse(rows);
}

function collapse(rows: DiffRow[], context = 3): DiffRow[] {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind === 'same') return;
    for (let k = index - context; k <= index + context; k++) keep.add(k);
  });

  const out: DiffRow[] = [];
  let skipping = false;
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      out.push(row);
      skipping = false;
    } else if (!skipping) {
      out.push({ kind: 'same', text: '⋯' });
      skipping = true;
    }
  });
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
