import type { AgentSpec } from '@agent-spawner/spec';
import { emitDocs } from './emitters/docs.ts';
import { emitHooks } from './emitters/hooks.ts';
import { emitKnowledge } from './emitters/knowledge.ts';
import { emitManifest } from './emitters/manifest.ts';
import { emitInstallScript, emitMarketplace } from './emitters/marketplace.ts';
import { emitMcp } from './emitters/mcp.ts';
import { emitMonitors } from './emitters/monitors.ts';
import { emitPrimaryAgent } from './emitters/primaryAgent.ts';
import { emitSchedule } from './emitters/schedule.ts';
import { emitSettings } from './emitters/settings.ts';
import { emitSkills } from './emitters/skills.ts';
import { emitSubAgents } from './emitters/subAgents.ts';
import type { CompileResult, CompiledFile } from './types.ts';
import { sortFiles } from './util.ts';
import { validateL2 } from './validate.ts';

export type CompileOptions = {
  /**
   * Monitors are experimental; the emitter stays behind this flag so the conditional-trigger
   * path can fall back to hooks only if the component format moves (PLAN §14.3).
   */
  enableMonitors?: boolean;
  /** Skip L2 — used by the preview pane when diagnostics are computed separately. */
  skipValidation?: boolean;
};

/**
 * spec → files. Pure: no I/O, no clock, no randomness. The same spec always produces
 * byte-identical output, which is what makes golden-file tests, clean git diffs and the
 * preview's edit-to-edit diff all work.
 */
export function compile(spec: AgentSpec, options: CompileOptions = {}): CompileResult {
  const { enableMonitors = true } = options;

  const files: CompiledFile[] = sortFiles([
    ...emitManifest(spec),
    ...emitMarketplace(spec),
    ...emitPrimaryAgent(spec),
    ...emitSubAgents(spec),
    ...emitSkills(spec),
    ...emitMcp(spec),
    ...emitHooks(spec),
    ...emitMonitors(spec, enableMonitors),
    ...emitSchedule(spec),
    ...emitKnowledge(spec),
    ...emitSettings(spec),
    ...emitDocs(spec),
    ...emitInstallScript(spec),
  ]);

  const diagnostics = options.skipValidation ? [] : validateL2(spec, files);

  return { files, diagnostics };
}

/** Total size of the bundle, for the packaging section's size readout. */
export function bundleSize(result: CompileResult): number {
  return result.files.reduce((total, file) => {
    if (file.external) return total + file.external.sizeBytes;
    return total + new TextEncoder().encode(file.content ?? '').length;
  }, 0);
}

/** Nested tree for the preview pane. */
export type TreeNode =
  | { type: 'dir'; name: string; path: string; children: TreeNode[] }
  | { type: 'file'; name: string; path: string; size: number; external: boolean };

export function fileTree(files: CompiledFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const segments = file.path.split('/');
    let level = root;
    segments.forEach((segment, i) => {
      const isLeaf = i === segments.length - 1;
      const path = segments.slice(0, i + 1).join('/');
      if (isLeaf) {
        level.push({
          type: 'file',
          name: segment,
          path,
          size: file.external
            ? file.external.sizeBytes
            : new TextEncoder().encode(file.content ?? '').length,
          external: Boolean(file.external),
        });
        return;
      }
      let dir = level.find((n): n is Extract<TreeNode, { type: 'dir' }> => n.type === 'dir' && n.name === segment);
      if (!dir) {
        dir = { type: 'dir', name: segment, path, children: [] };
        level.push(dir);
      }
      level = dir.children;
    });
  }

  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => (n.type === 'dir' ? { ...n, children: sort(n.children) } : n))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name < b.name ? -1 : 1;
      });

  return sort(root);
}

export * from './types.ts';
export { validateL1, validateL2, looksLikeSecret } from './validate.ts';
export { skillFromWorkflow, allSkills } from './promote.ts';
export { generateReadme, permissionsSnippet } from './emitters/docs.ts';
export { describeCron } from './emitters/schedule.ts';
export { mcpPatterns, allMcpPatterns } from './emitters/tools.ts';
export { describeOrchestration, PHRASES } from './orchestration.ts';
export { TRIGGER_HINT } from './emitters/subAgents.ts';
