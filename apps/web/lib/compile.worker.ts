/// <reference lib="webworker" />

import { compile, fileTree, validateL1 } from '@agent-spawner/compiler';
import type { AgentSpec } from '@agent-spawner/spec';

/**
 * Client-side compile, off the main thread.
 *
 * This is the *same* compiler the server runs — the payoff of keeping it a pure function.
 * The server compile stays authoritative for export and deploy; this one exists so the
 * preview updates while you type without dropping frames.
 */

type Request = { id: number; spec: AgentSpec };

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const { id, spec } = event.data;
  try {
    const result = compile(spec);
    self.postMessage({
      id,
      ok: true,
      files: result.files,
      tree: fileTree(result.files),
      diagnostics: [...validateL1(spec), ...result.diagnostics],
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
