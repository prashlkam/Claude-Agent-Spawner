'use client';

import { create } from 'zustand';
import type { AgentSpec } from '@agent-spawner/spec';

/**
 * The draft spec, held once for the whole editor.
 *
 * Every tab is a projection of this object; nothing else owns editable state. That is the
 * whole point of the architecture — a new tab is a new view over the same spec, never a new
 * source of truth.
 *
 * Writes autosave 800 ms after the last keystroke and carry the revision they were based on,
 * so a concurrent edit from another tab or device is rejected rather than silently lost.
 */

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

type EditorState = {
  agentId: string;
  revision: number;
  spec: AgentSpec;
  /** The last version the server acknowledged — the baseline the preview diffs against. */
  savedSpec: AgentSpec;
  saveState: SaveState;
  error: string;
  lastSavedAt: number | null;

  hydrate: (agentId: string, spec: AgentSpec, revision: number) => void;
  /** Apply a change and schedule a save. `label` shows up in the version history. */
  update: (recipe: (spec: AgentSpec) => AgentSpec, label?: string) => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLabel = '';
const SAVE_DEBOUNCE_MS = 800;

export const useEditor = create<EditorState>((set, get) => ({
  agentId: '',
  revision: 0,
  spec: {} as AgentSpec,
  savedSpec: {} as AgentSpec,
  saveState: 'idle',
  error: '',
  lastSavedAt: null,

  hydrate: (agentId, spec, revision) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    set({ agentId, spec, savedSpec: spec, revision, saveState: 'idle', error: '', lastSavedAt: null });
  },

  update: (recipe, label = '') => {
    const next = recipe(get().spec);
    if (label) pendingLabel = label;
    set({ spec: next, saveState: 'dirty', error: '' });

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void get().save();
    }, SAVE_DEBOUNCE_MS);
  },

  save: async () => {
    const { agentId, spec, revision, saveState } = get();
    if (!agentId || saveState === 'saving') return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;

    const label = pendingLabel;
    pendingLabel = '';
    set({ saveState: 'saving' });

    const response = await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, revision, label }),
    });

    if (response.status === 409) {
      const body = await response.json();
      set({
        saveState: 'conflict',
        error:
          body.error ??
          'This agent was changed somewhere else. Reload to get the latest version — your unsaved edits will be lost.',
      });
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      set({ saveState: 'error', error: body.error ?? 'Could not save.' });
      return;
    }

    const body = (await response.json()) as { revision: number };
    set({
      revision: body.revision,
      savedSpec: spec,
      saveState: 'saved',
      lastSavedAt: Date.now(),
      error: '',
    });
  },

  reload: async () => {
    const { agentId } = get();
    const response = await fetch(`/api/agents/${agentId}`);
    if (!response.ok) return;
    const body = (await response.json()) as { spec: AgentSpec; revision: number };
    get().hydrate(agentId, body.spec, body.revision);
  },
}));

/** Convenience for the many `spec.x` reads across the tabs. */
export function useSpec(): AgentSpec {
  return useEditor((state) => state.spec);
}

export function useUpdate() {
  return useEditor((state) => state.update);
}
