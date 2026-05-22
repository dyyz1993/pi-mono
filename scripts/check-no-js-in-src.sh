#!/bin/sh
# check-no-js-in-src.sh
# Prevent .js files from being committed inside src/ directories.
# TypeScript source should only have .ts/.tsx files;
# compiled output belongs in dist/.

staged=$(git diff --cached --name-only --diff-filter=ACMR | grep '^packages/[^/]*/src/.*\.js$')

if [ -n "$staged" ]; then
  # Only block untracked .js files (new additions).
  # Already-tracked .js files in src/ are intentional (e.g. vendored assets).
  new_js=""
  for f in $staged; do
    # Check if HEAD has this file — if not, it's a new addition
    if ! git ls-tree HEAD -- "$f" 2>/dev/null | grep -q .; then
      new_js="$new_js$f
"
    fi
  done

  if [ -n "$new_js" ]; then
    echo ""
    echo "BLOCKED: new .js files detected in src/ directories:"
    echo "$new_js" | while read -r f; do
      [ -n "$f" ] && echo "  - $f"
    done
    echo ""
    echo "These are likely stale build artifacts from compilation."
    echo "TypeScript source directories should only contain .ts/.tsx files."
    echo "Already-tracked .js files (vendored assets) are not affected."
    echo ""
    echo "To fix: git restore --staged <file> && rm <file>"
    echo ""
    exit 1
  fi
fi

exit 0
