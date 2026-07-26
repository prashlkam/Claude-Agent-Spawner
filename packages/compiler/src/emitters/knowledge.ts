import type { AgentSpec } from '@agent-spawner/spec';
import type { CompiledFile } from '../types.ts';
import { frontmatter, markdown, oneLine } from '../util.ts';

/**
 * `knowledge/*` plus, when anything is marked `preload-skill`, a generated index skill.
 *
 * The compiler does no I/O, so uploaded files are emitted as `external` references; the
 * exporter and the deploy worker stream the real bytes from object storage.
 */
export function emitKnowledge(spec: AgentSpec): CompiledFile[] {
  if (spec.knowledge.length === 0) return [];

  const files: CompiledFile[] = spec.knowledge.map((k) => ({
    path: `knowledge/${k.filename}`,
    content: null,
    external: { storageKey: k.storageKey, sizeBytes: k.sizeBytes, filename: k.filename },
  }));

  const preloaded = spec.knowledge.filter((k) => k.loadStrategy === 'preload-skill');
  const referenced = spec.knowledge.filter((k) => k.loadStrategy === 'reference');

  const indexBody = markdown([
    `# Reference material for ${spec.meta.name}`,
    preloaded.length > 0 ? '## Loaded with this skill' : null,
    preloaded.length > 0
      ? preloaded
          .map((k) => `- \`\${CLAUDE_PLUGIN_ROOT}/knowledge/${k.filename}\` — ${k.purpose || 'reference material'}`)
          .join('\n')
      : null,
    preloaded.length > 0
      ? 'Read each of the files above before answering questions that depend on them.'
      : null,
    referenced.length > 0 ? '## Read on demand' : null,
    referenced.length > 0
      ? referenced
          .map((k) => `- \`\${CLAUDE_PLUGIN_ROOT}/knowledge/${k.filename}\` — ${k.purpose || 'reference material'}`)
          .join('\n')
      : null,
  ]);

  const fm = frontmatter({
    name: `${spec.meta.slug}-knowledge`,
    description: oneLine(
      `Reference material bundled with ${spec.meta.name}: ${spec.knowledge
        .map((k) => k.filename)
        .join(', ')}.`,
    ),
    'allowed-tools': ['Read', 'Glob', 'Grep'],
    // Background knowledge: never shown in the `/` menu.
    'user-invocable': false,
  });

  files.push({
    path: `skills/${spec.meta.slug}-knowledge/SKILL.md`,
    content: `${fm}\n${indexBody}`,
  });

  return files;
}
