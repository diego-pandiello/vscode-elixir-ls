#!/bin/bash
set -e

# Script to regenerate patches from current modifications in elixir-ls submodule
# Run this when you need to update patches after upstream changes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PATCHES_DIR="$PROJECT_ROOT/patches"
ELIXIR_LS_DIR="$PROJECT_ROOT/elixir-ls"

echo "Regenerating patches from elixir-ls modifications..."

cd "$ELIXIR_LS_DIR"

# Check if there are modifications
if git diff --quiet; then
    echo "⚠️  No modifications found in elixir-ls submodule"
    echo "Nothing to regenerate"
    exit 0
fi

# Show what will be included in the patch
echo ""
echo "Modified files:"
git diff --stat
echo ""

# Backup old patches
if [ -d "$PATCHES_DIR" ] && [ "$(ls -A "$PATCHES_DIR"/*.patch 2>/dev/null)" ]; then
    echo "Backing up old patches..."
    BACKUP_DIR="$PATCHES_DIR/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    mv "$PATCHES_DIR"/*.patch "$BACKUP_DIR/" 2>/dev/null || true
    echo "✓ Old patches backed up to: $BACKUP_DIR"
    echo ""
fi

# Generate new patch
mkdir -p "$PATCHES_DIR"
PATCH_FILE="$PATCHES_DIR/0001-add-exunit-start-for-test-debugging.patch"

git diff apps/debug_adapter/lib/debug_adapter/server.ex > "$PATCH_FILE"

if [ -s "$PATCH_FILE" ]; then
    echo "✓ Patch regenerated: $(basename "$PATCH_FILE")"
    echo ""
    echo "Patch contents:"
    cat "$PATCH_FILE"
    echo ""
    echo "✓ Patch saved to: $PATCH_FILE"
else
    echo "❌ Failed to generate patch (file is empty)"
    rm -f "$PATCH_FILE"
    exit 1
fi
