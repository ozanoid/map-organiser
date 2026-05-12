#!/usr/bin/env bash
# .claude/hooks/post-edit-docs.sh
#
# PostToolUse hook: after an Edit/Write to a source file, find every vault doc
# whose `sources:` list mentions that file and print a reminder so the agent
# knows what to update. Output goes to stdout and becomes additional context.

set -euo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
[ -z "$file_path" ] && exit 0

# Resolve project root (parent of .claude/)
script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$script_dir/../.." && pwd)"

# Skip if the edited file is inside docs/ or .claude/ — only flag SOURCE-file edits
case "$file_path" in
  "$project_root/docs/"*|"$project_root/.claude/"*) exit 0 ;;
esac

# Compute path relative to project root
rel_path="${file_path#"$project_root/"}"

# Bail if no vault
[ -d "$project_root/docs" ] || exit 0

# Escape regex special chars in rel_path for grep -E
escaped="$(printf '%s' "$rel_path" | sed -e 's/[][\.|$(){}?+^*\/]/\\&/g')"

# Search vault frontmatter for `  - <rel_path>` lines (sources: list entries)
# grep -R is POSIX-portable; we want files (-l) and a regex (-E)
matches="$(grep -RlE --include='*.md' "^[[:space:]]*-[[:space:]]+${escaped}\$" "$project_root/docs" 2>/dev/null || true)"

[ -z "$matches" ] && exit 0

echo ""
echo "📝 You edited: $rel_path"
echo ""
echo "Docs that list this file under \`sources:\`:"
while IFS= read -r match; do
  echo "  - ${match#"$project_root/"}"
done <<< "$matches"
echo ""
echo "Consider whether they need updating. See docs/_agent/common-tasks.md for the workflow."
echo "For each doc you update: bump \`version\`, refresh \`last_updated\`, log in docs/CHANGELOG.md."
