import type { AgentSpec } from '@agent-spawner/spec';
import type { CompiledFile } from '../types.ts';
import { compact, json } from '../util.ts';

/**
 * `.claude-plugin/plugin.json` — the only file allowed inside `.claude-plugin/`.
 *
 * `skills` / `agents` / `commands` / `hooks` / `mcpServers` are deliberately omitted:
 * Claude Code auto-discovers them at the default paths, and listing them is one more
 * thing to keep in sync.
 */
export function emitManifest(spec: AgentSpec): CompiledFile[] {
  const { meta } = spec;

  const author = compact({
    name: meta.author.name,
    email: meta.author.email,
    url: meta.author.url,
  });

  const manifest = compact({
    name: meta.slug,
    displayName: meta.name,
    // Omitted in `commit-sha` mode so Claude Code falls back to the git commit SHA.
    version: meta.versionMode === 'pinned' ? meta.version : undefined,
    description: meta.description,
    author: Object.keys(author).length > 0 ? author : undefined,
    homepage: meta.homepage,
    repository: meta.repository,
    license: meta.license === 'UNLICENSED' ? undefined : meta.license,
    keywords: meta.keywords,
    // An array of `name` or `name@constraint` strings — `claude plugin validate` rejects
    // the object-map form.
    dependencies: meta.dependencies.map((d) => (d.constraint ? `${d.name}@${d.constraint}` : d.name)),
    // Only written when false — `true` is the default and noise in the manifest.
    defaultEnabled: meta.defaultEnabled ? undefined : false,
  });

  return [{ path: '.claude-plugin/plugin.json', content: json(manifest) }];
}
