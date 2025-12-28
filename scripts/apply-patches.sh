#!/bin/bash
set -e

# Script to apply custom patches to elixir-ls submodule
# Run this after updating the elixir-ls submodule

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PATCHES_DIR="$PROJECT_ROOT/patches"
ELIXIR_LS_DIR="$PROJECT_ROOT/elixir-ls"

echo "Applying patches to elixir-ls submodule..."

cd "$ELIXIR_LS_DIR"

# Check if there are uncommitted changes
if ! git diff --quiet; then
    echo "⚠️  Warning: elixir-ls submodule has uncommitted changes"
    echo "Please commit or stash them before applying patches"
    exit 1
fi

# Apply each patch
for patch in "$PATCHES_DIR"/*.patch; do
    if [ -f "$patch" ]; then
        echo "Applying: $(basename "$patch")"

        # Try to apply the patch
        if git apply --check "$patch" 2>/dev/null; then
            git apply "$patch"
            echo "✓ Successfully applied $(basename "$patch")"
        else
            echo "❌ Failed to apply $(basename "$patch")"
            echo "This might happen if:"
            echo "  - The patch was already applied"
            echo "  - The upstream code changed and the patch no longer applies"
            echo ""
            echo "You may need to:"
            echo "  1. Manually resolve conflicts"
            echo "  2. Regenerate the patch with: ./scripts/regenerate-patches.sh"
            exit 1
        fi
    fi
done

echo ""
echo "✓ All patches applied successfully!"
echo ""
echo "Next steps:"
echo "  1. Compile elixir-ls: cd elixir-ls && MIX_ENV=prod mix compile"
echo "  2. Test the changes"
