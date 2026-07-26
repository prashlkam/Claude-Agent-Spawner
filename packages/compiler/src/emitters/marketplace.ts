import type { AgentSpec } from '@agent-spawner/spec';
import type { CompiledFile } from '../types.ts';
import { compact, json } from '../util.ts';

/**
 * `.claude-plugin/marketplace.json` — makes the repo directly installable with
 * `/plugin marketplace add <owner>/<repo>`.
 *
 * This is the second and last file permitted inside `.claude-plugin/`.
 */
export function emitMarketplace(spec: AgentSpec): CompiledFile[] {
  if (!spec.packaging.includeMarketplaceManifest) return [];

  // Author first: the marketplace owner is a person, not a repo path.
  const owner = spec.meta.author.name || spec.deployment?.repo.owner || spec.meta.slug;

  const manifest = compact({
    name: spec.meta.slug,
    owner: compact({
      name: owner,
      email: spec.meta.author.email,
      url: spec.meta.author.url,
    }),
    metadata: compact({
      description: spec.meta.description,
      version: spec.meta.versionMode === 'pinned' ? spec.meta.version : undefined,
    }),
    plugins: [
      compact({
        name: spec.meta.slug,
        // The plugin lives at the repository root when deployed as its own repo.
        source: './',
        description: spec.meta.description,
        version: spec.meta.versionMode === 'pinned' ? spec.meta.version : undefined,
        author: compact({ name: spec.meta.author.name }),
        keywords: spec.meta.keywords,
      }),
    ],
  });

  return [{ path: '.claude-plugin/marketplace.json', content: json(manifest) }];
}

/** Optional `install.sh` that copies the bundle into a project or `~/.claude/`. */
export function emitInstallScript(spec: AgentSpec): CompiledFile[] {
  if (!spec.packaging.includeInstallScript) return [];

  const slug = spec.meta.slug;
  return [
    {
      path: 'install.sh',
      executable: true,
      content: `#!/usr/bin/env bash
# Copy this plugin into a Claude Code plugin directory.
#
#   ./install.sh              -> ~/.claude/plugins/${slug}
#   ./install.sh /path/to/repo -> /path/to/repo/.claude/plugins/${slug}
#
# Nothing is executed by this script beyond copying files. Review the bundle first —
# hooks and scripts inside it will run on your machine once the plugin is enabled.
set -euo pipefail

src="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
target_root="\${1:-$HOME/.claude}"
dest="$target_root/plugins/${slug}"

if [ -n "\${1:-}" ]; then
  dest="$1/.claude/plugins/${slug}"
fi

mkdir -p "$dest"
cp -R "$src/." "$dest/"
rm -f "$dest/install.sh"

echo "Installed ${slug} to $dest"
echo "Enable it with: /plugin"
`,
    },
  ];
}
