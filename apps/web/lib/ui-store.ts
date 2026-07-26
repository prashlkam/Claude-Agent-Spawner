'use client';

import { create } from 'zustand';

/** Editor chrome state: which pane is open, and where a diagnostic wants to send you. */
type UiState = {
  previewMode: 'tree' | 'file' | 'diff';
  selectedFile: string | null;
  drawerOpen: boolean;
  /** Spec path a diagnostic pointed at; the tab scrolls to and highlights it. */
  focusPath: string | null;

  setPreviewMode: (mode: UiState['previewMode']) => void;
  selectFile: (path: string | null) => void;
  toggleDrawer: (open?: boolean) => void;
  focus: (path: string | null) => void;
};

export const useUi = create<UiState>((set) => ({
  previewMode: 'tree',
  selectedFile: null,
  drawerOpen: false,
  focusPath: null,

  setPreviewMode: (previewMode) => set({ previewMode }),
  selectFile: (selectedFile) => set({ selectedFile, previewMode: selectedFile ? 'file' : 'tree' }),
  toggleDrawer: (open) => set((state) => ({ drawerOpen: open ?? !state.drawerOpen })),
  focus: (focusPath) => set({ focusPath }),
}));
