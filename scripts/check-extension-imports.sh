#!/usr/bin/env bash
# check-extension-imports.sh
# Ensures extension files do not use relative path imports to src/.
# Extensions must import from package names (e.g. '@dyyz1993/pi-coding-agent').

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

EXT_DIRS=(
	"packages/coding-agent/extensions"
	"packages/coding-agent/examples/extensions"
)

errors=0
for ext_dir in "${EXT_DIRS[@]}"; do
	full_dir="$ROOT_DIR/$ext_dir"
	if [ ! -d "$full_dir" ]; then
		continue
	fi

	matches=$(grep -rn 'from\s\+['"'"'"]\.\./.*src/' "$full_dir" --include="*.ts" --include="*.js" 2>/dev/null || true)
	exports=$(grep -rn 'export.*from\s\+['"'"'"]\.\./.*src/' "$full_dir" --include="*.ts" --include="*.js" 2>/dev/null || true)

	if [ -n "$matches" ] || [ -n "$exports" ]; then
		echo "ERROR: Found banned relative src/ imports in $ext_dir"
		if [ -n "$matches" ]; then
			echo "$matches" | while IFS= read -r line; do
				echo "  $line"
			done
		fi
		if [ -n "$exports" ]; then
			echo "$exports" | while IFS= read -r line; do
				echo "  $line"
			done
		fi
		echo ""
		errors=$((errors + 1))
	fi
done

if [ "$errors" -gt 0 ]; then
	echo "Found $errors directory/directories with banned relative imports in extensions."
	echo "Extensions must use package imports (e.g. '@dyyz1993/pi-coding-agent'), not relative paths to src/."
	exit 1
fi

echo "All extension imports OK."
exit 0
