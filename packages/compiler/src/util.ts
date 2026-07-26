import type { CompiledFile } from './types.ts';

/** JSON with a fixed 2-space indent and a trailing newline — stable across runs. */
export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Drop undefined / empty-string / empty-array entries so the manifest stays minimal. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Characters that change meaning when they *start* a YAML scalar. */
const LEADING_INDICATORS = /^[-?:,\[\]{}#&*!|>'"%@`]/;
/** Sequences that end a scalar mid-string. */
const INLINE_BREAKERS = /: | #/;
const YAML_RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~']);

/** Quote a scalar only when YAML would otherwise misread it. Keeps frontmatter readable. */
export function yamlScalar(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  const flat = value.replace(/\r?\n/g, ' ').trim();
  if (flat === '') return "''";
  if (
    YAML_RESERVED.has(flat.toLowerCase()) ||
    /^[+-]?\d/.test(flat) ||
    LEADING_INDICATORS.test(flat) ||
    INLINE_BREAKERS.test(flat) ||
    flat.endsWith(':')
  ) {
    return `'${flat.replace(/'/g, "''")}'`;
  }
  return flat;
}

export type FrontmatterValue = string | number | boolean | string[] | undefined;

/**
 * Render YAML frontmatter. Arrays are emitted comma-separated on one line, which is the
 * form Claude Code's docs use for `tools`, `skills` and `allowed-tools`.
 * Key order is the caller's insertion order — deliberately, so output is deterministic.
 */
export function frontmatter(fields: Record<string, FrontmatterValue>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: ${value.join(', ')}`);
    } else if (typeof value === 'string' && value.trim() === '') {
      continue;
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

/** Join markdown blocks with exactly one blank line between them, ending in a newline. */
export function markdown(blocks: Array<string | null | undefined | false>): string {
  const body = blocks
    .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
    .map((b) => b.replace(/\s+$/, ''))
    .join('\n\n');
  return body.length > 0 ? `${body}\n` : '';
}

export function bulletList(items: string[]): string {
  return items
    .map((i) => i.trim())
    .filter(Boolean)
    .map((i) => `- ${i}`)
    .join('\n');
}

export function numberedList(items: string[], start = 1): string {
  return items
    .map((i) => i.trim())
    .filter(Boolean)
    .map((i, idx) => `${start + idx}. ${i}`)
    .join('\n');
}

/** Collapse a multi-line string into a single line — for frontmatter descriptions. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function indent(text: string, spaces = 3): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n');
}

/** Sort by path so the file list — and therefore the zip and the git tree — is stable. */
export function sortFiles(files: CompiledFile[]): CompiledFile[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Escape a value for safe single-quoted use inside a generated shell script. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}
