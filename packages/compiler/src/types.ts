/** Which editor tab a diagnostic anchors to, so the drawer can deep-link. */
export type TabId =
  | 'goal'
  | 'workflows'
  | 'sub-agents'
  | 'skills'
  | 'connectors'
  | 'misc'
  | 'preview';

export type Severity = 'error' | 'warning' | 'info';

export type Diagnostic = {
  /** Stable rule id — one per L2 rule, used by tests and by the docs. */
  rule: string;
  severity: Severity;
  message: string;
  /** Dotted spec path, e.g. `subAgents[2].tools.allow[0]`. Powers click-to-field. */
  path?: string;
  tab?: TabId;
  /** Output file the rule is about, when relevant. */
  file?: string;
  /** Where the rule came from: `zod` = L1, `semantic` = L2, `cli` = L3. */
  layer: 'zod' | 'semantic' | 'cli';
};

/**
 * One emitted file. `content` is the text; `external` marks a file whose bytes live in
 * object storage (uploaded knowledge). The compiler is pure and does no I/O, so it
 * describes external files rather than reading them — the exporter resolves them.
 */
export type CompiledFile = {
  path: string;
  content: string | null;
  external?: { storageKey: string; sizeBytes: number; filename: string };
  /** Marks scripts that must be chmod +x in the zip / git tree. */
  executable?: boolean;
};

export type CompileResult = {
  /** Sorted by path; identical spec ⇒ byte-identical result. */
  files: CompiledFile[];
  diagnostics: Diagnostic[];
};

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
