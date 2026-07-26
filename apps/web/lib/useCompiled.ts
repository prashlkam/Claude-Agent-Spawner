'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { compile, fileTree, validateL1 } from '@agent-spawner/compiler';
import type { CompiledFile, Diagnostic, TreeNode } from '@agent-spawner/compiler';
import type { AgentSpec } from '@agent-spawner/spec';
import { useSpec } from './store.ts';

export type Compiled = {
  files: CompiledFile[];
  tree: TreeNode[];
  diagnostics: Diagnostic[];
  pending: boolean;
};

const EMPTY: Compiled = { files: [], tree: [], diagnostics: [], pending: true };

function compileInline(spec: AgentSpec): Compiled {
  const result = compile(spec);
  return {
    files: result.files,
    tree: fileTree(result.files),
    diagnostics: [...validateL1(spec), ...result.diagnostics],
    pending: false,
  };
}

/**
 * Live compile of the draft spec, debounced and run in a Web Worker.
 *
 * If the worker cannot start (older browser, blocked module workers) it falls back to
 * compiling on the main thread — the compiler is pure, so both paths give the same answer.
 */
export function useCompiled(debounceMs = 120): Compiled {
  const spec = useSpec();
  const [state, setState] = useState<Compiled>(EMPTY);
  const workerRef = useRef<Worker | null>(null);
  const failedRef = useRef(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (failedRef.current) return;
    try {
      const worker = new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { id: number; ok: boolean } & Compiled;
        // Ignore results from superseded keystrokes.
        if (data.id !== requestRef.current || !data.ok) return;
        setState({ files: data.files, tree: data.tree, diagnostics: data.diagnostics, pending: false });
      });
      worker.addEventListener('error', () => {
        failedRef.current = true;
      });
      workerRef.current = worker;
      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch {
      failedRef.current = true;
      return;
    }
  }, []);

  const key = useMemo(() => JSON.stringify(spec), [spec]);

  useEffect(() => {
    if (!spec || !spec.meta) return;
    setState((prev) => ({ ...prev, pending: true }));

    const timer = setTimeout(() => {
      const worker = workerRef.current;
      if (worker && !failedRef.current) {
        requestRef.current += 1;
        worker.postMessage({ id: requestRef.current, spec });
      } else {
        setState(compileInline(spec));
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [key, debounceMs, spec]);

  return state;
}
