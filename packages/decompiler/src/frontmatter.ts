/**
 * Minimal YAML frontmatter reader.
 *
 * Deliberately not a full YAML parser: agent and skill frontmatter is a flat map of scalars
 * and comma-separated lists, and pulling in a YAML dependency to read ten keys would be a
 * larger surface than the problem. Anything it cannot read is left in `unknown`, so an
 * imported plugin never silently loses fields.
 */
export type Frontmatter = {
  fields: Record<string, string>;
  body: string;
};

export function parseFrontmatter(source: string): Frontmatter {
  const normalized = source.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { fields: {}, body: normalized.trim() };

  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return { fields: {}, body: normalized.trim() };

  const head = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '');

  const fields: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    fields[match[1]!] = unquote(match[2]!.trim());
  }
  return { fields, body: body.trimEnd() };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

/** `tools: Read, Write` → `['Read', 'Write']`. */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  const inner = value.trim().replace(/^\[|\]$/g, '');
  return inner
    .split(',')
    .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

export function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 'yes') return true;
  if (v === 'false' || v === 'no') return false;
  return undefined;
}

export function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : undefined;
}
