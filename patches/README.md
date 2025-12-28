# ElixirLS Patches

This directory contains patches that are applied to the elixir-ls submodule to add custom functionality for the VS Code extension.

## Current Patches

### `0001-add-exunit-start-for-test-debugging.patch`

**Purpose:** Enables test debugging by starting ExUnit before test files are interpreted.

**Why needed:** When debugging tests in VS Code, test files need to be interpreted for debugging. During interpretation, `ExUnit.Case` is expanded, which requires ExUnit to be started. Without this patch, test debugging fails with:

```
** (RuntimeError) cannot use ExUnit.Case without starting the ExUnit application
```

**Changes:**
- Location: `apps/debug_adapter/lib/debug_adapter/server.ex`
- Adds `ExUnit.start(autorun: false)` before requiring test files
- Only activates when task is "test" and debugging is enabled

## Usage

### Initial Setup

The patch is already applied to the current elixir-ls submodule. No action needed.

### After Updating elixir-ls Submodule

If you update the elixir-ls submodule to a newer version, you'll need to reapply the patches:

```bash
# Automated way (recommended)
./scripts/update-elixir-ls.sh

# Manual way
cd elixir-ls
git pull origin master
cd ..
./scripts/apply-patches.sh
```

### If Patches Fail to Apply

If upstream changes cause patch conflicts:

1. **Manually resolve conflicts:**
   ```bash
   cd elixir-ls
   # Edit apps/debug_adapter/lib/debug_adapter/server.ex
   # Add the ExUnit.start() code manually
   ```

2. **Regenerate the patch:**
   ```bash
   ./scripts/regenerate-patches.sh
   ```

3. **Test that it works:**
   ```bash
   cd elixir-ls
   MIX_ENV=prod mix compile
   cd ..
   npm run compile
   # Test debugging a test file
   ```

## Scripts

- **`apply-patches.sh`** - Apply patches to elixir-ls submodule
- **`regenerate-patches.sh`** - Regenerate patches from current modifications
- **`update-elixir-ls.sh`** - Update submodule and reapply patches (recommended workflow)

## Maintenance

### When to Regenerate Patches

Regenerate patches when:
- Upstream elixir-ls changes the patched files
- You need to modify the custom code
- Patch fails to apply cleanly

### Contributing Changes

If you make improvements to the patched code:

1. Make changes in the elixir-ls submodule
2. Test thoroughly
3. Regenerate patches: `./scripts/regenerate-patches.sh`
4. Commit both the patch file and submodule changes

## Future

Consider contributing this change upstream to elixir-ls via a PR. The modification benefits all VS Code users debugging Elixir tests.

See: https://github.com/elixir-lsp/elixir-ls
