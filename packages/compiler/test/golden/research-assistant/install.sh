#!/usr/bin/env bash
# Copy this plugin into a Claude Code plugin directory.
#
#   ./install.sh              -> ~/.claude/plugins/weekly-research-brief
#   ./install.sh /path/to/repo -> /path/to/repo/.claude/plugins/weekly-research-brief
#
# Nothing is executed by this script beyond copying files. Review the bundle first —
# hooks and scripts inside it will run on your machine once the plugin is enabled.
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_root="${1:-$HOME/.claude}"
dest="$target_root/plugins/weekly-research-brief"

if [ -n "${1:-}" ]; then
  dest="$1/.claude/plugins/weekly-research-brief"
fi

mkdir -p "$dest"
cp -R "$src/." "$dest/"
rm -f "$dest/install.sh"

echo "Installed weekly-research-brief to $dest"
echo "Enable it with: /plugin"
