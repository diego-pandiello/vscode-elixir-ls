#!/bin/bash
set -e

# Script to update elixir-ls submodule and reapply patches
# This is the main script you'll run to update elixir-ls

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ELIXIR_LS_DIR="$PROJECT_ROOT/elixir-ls"

echo "Updating elixir-ls submodule from upstream..."
echo ""

cd "$ELIXIR_LS_DIR"

# Save current commit for reference
CURRENT_COMMIT=$(git rev-parse HEAD)
echo "Current elixir-ls commit: $CURRENT_COMMIT"

# Check for uncommitted changes
if ! git diff --quiet; then
    echo ""
    echo "⚠️  Warning: elixir-ls has uncommitted changes"
    echo "These are likely your custom modifications."
    echo ""
    read -p "Do you want to reset them? They will be reapplied from patches. (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git reset --hard HEAD
        echo "✓ Reset uncommitted changes"
    else
        echo "Aborting update. Please handle changes manually."
        exit 1
    fi
fi

# Fetch and update to latest
echo ""
echo "Fetching latest from upstream..."
git fetch origin

echo "Updating to latest master branch..."
git checkout master
git pull origin master

NEW_COMMIT=$(git rev-parse HEAD)
echo ""
echo "Updated to commit: $NEW_COMMIT"

if [ "$CURRENT_COMMIT" = "$NEW_COMMIT" ]; then
    echo "✓ Already up to date"
else
    echo "✓ Updated from $CURRENT_COMMIT to $NEW_COMMIT"
    echo ""
    echo "Changes:"
    git log --oneline "$CURRENT_COMMIT..$NEW_COMMIT"
fi

# Apply patches
echo ""
echo "Applying custom patches..."
cd "$PROJECT_ROOT"
"$SCRIPT_DIR/apply-patches.sh"

# Compile
echo ""
echo "Compiling elixir-ls..."
cd "$ELIXIR_LS_DIR"
mix deps.get
MIX_ENV=prod mix compile

echo ""
echo "✓ elixir-ls updated and patched successfully!"
echo ""
echo "Don't forget to:"
echo "  1. Test the changes"
echo "  2. Commit the submodule update: git add elixir-ls && git commit -m 'Update elixir-ls submodule'"
