# Super ElixirLS

A specialized fork of [ElixirLS](https://github.com/elixir-lsp/vscode-elixir-ls) adapted for the Super development environment. This fork addresses specific pain points in test debugging workflows that are critical for productive TDD (Test-Driven Development) in Elixir projects.

## Why This Fork Exists

### The Problem with Standard ElixirLS

While ElixirLS provides excellent language server support, its test debugging capabilities fall short in real-world scenarios where modern testing patterns are common:

1. **Test debugging would crash when using ExUnit.Case** - The debugger interprets test files before ExUnit is started, causing `ExUnit.Case` macro expansion to fail with runtime errors
2. **Mocked modules break the debugger** - When tests mock external dependencies (using libraries like `mock` or `:meck`), the debugger attempts to interpret those mocked modules, leading to crashes or incorrect behavior
3. **Aliased modules in mocks aren't resolved** - Tests often use aliases for cleaner code (e.g., `alias MyApp.Services.ExternalAPI`), but the debugger couldn't resolve these when detecting mocked modules
4. **test_helper.exs can't use standard patterns** - The original extension requires test helpers to be structured as modules rather than top-level setup scripts, breaking compatibility with standard Elixir test initialization (like starting :shards, setting up Ecto Sandbox, etc.)
5. **No flexibility in test execution arguments** - Different projects need different test flags (coverage, formatters, etc.) but these had to be manually configured each time

### Why These Matter

Modern Elixir projects rely heavily on:
- **Unit testing with mocks** to isolate code from external dependencies (APIs, databases, etc.)
- **Fast iteration cycles** using test-driven development
- **Interactive debugging** to understand complex business logic
- **Team consistency** through shared debug configurations

Without these fixes, developers face a frustrating choice: either avoid using mocks (reducing test quality) or skip debugging entirely (reducing development speed).

## Core Improvements

### 1. Test Debugging Foundation

**Problem**: Running the debugger on test files would fail with `cannot use ExUnit.Case without starting the ExUnit application`.

**Why it happens**: VS Code's debugger interprets Elixir files to enable breakpoints and stack traces. When test files are interpreted, the `ExUnit.Case` macro expands immediately—but ExUnit hasn't started yet, causing a crash.

**Solution**: Applied a patch to ElixirLS that starts ExUnit (with `autorun: false`) before interpreting test files. This mirrors the pattern used in `test_helper.exs` but happens automatically during debug sessions.

**Impact**: Test debugging now works out-of-the-box. Developers can set breakpoints in tests, step through code, and inspect variables without workarounds.

### 2. Intelligent Mock Detection

**Problem**: Tests that mock external modules (e.g., `HTTPoison`, third-party APIs) would cause debugger crashes or unpredictable behavior.

**Why it happens**: Mocking libraries replace module implementations at runtime. When the debugger tries to interpret these modules for stack traces, it conflicts with the mock's runtime manipulation.

**Solution**: Automatically detect mocking patterns in test files:
- `setup_with_mocks([{ModuleName, ...}])`
- `with_mock ModuleName, [...] do`
- `:meck.new(ModuleName)` and `:meck.expect(ModuleName)`

These modules are automatically added to the `excludeModules` list, preventing the debugger from interpreting them while still allowing the mocks to function.

**Impact**: Tests with mocks now debug cleanly. You can test integration points (HTTP clients, external services) with confidence that debugging will work.

### 3. Alias Resolution for Mocks

**Problem**: Even with mock detection, modules referenced via aliases weren't being excluded properly, leading to subtle debugging failures.

**Why it happens**: Elixir code commonly uses aliases for brevity (`alias MyApp.Services.ExternalAPI` lets you write `ExternalAPI` instead). The debugger would detect the aliased name but not the fully-qualified module name needed for exclusion.

**Solution**: Parse test files to extract alias definitions, supporting:
- Simple aliases: `alias MyApp.Services.ExternalAPI` → `ExternalAPI`
- Multi-aliases: `alias MyApp.Services.{A, B, C}` → `A`, `B`, `C`
- Custom aliases: `alias MyApp.Cache.Redis, as: RedisCache` → `RedisCache`

When mocks are detected, aliases are resolved to their fully-qualified names before exclusion.

**Impact**: Test code can remain clean and idiomatic (using aliases) without breaking debugger compatibility.

### 4. Configurable Test Arguments

**Problem**: Different projects need different test execution flags (e.g., `--cover`, `--slowest 10`, custom formatters), but these weren't easily configurable per-project.

**Why it matters**: Teams often have standardized test configurations (CI/CD pipelines, coverage requirements, performance monitoring). Developers had to manually specify these arguments each time or maintain separate launch configurations.

**Solution**: Added VS Code settings for default test arguments:
```json
{
  "elixirLS.testDebugArgs": ["--cover", "--trace"],
  "elixirLS.testRunArgs": ["--cover"]
}
```

These are automatically included when running or debugging tests, with sensible defaults (`--trace` for debugging visibility).

**Impact**: Project-specific test configurations are version-controlled and consistent across the team. Onboarding is faster since test execution "just works" with the right flags.

### 5. Patch Management Infrastructure

**Problem**: Customizations to the ElixirLS codebase (like the ExUnit.start fix) need to be preserved when updating to newer ElixirLS versions.

**Why manual patching fails**: ElixirLS is included as a git submodule. Updating it would overwrite any manual changes, forcing developers to reapply fixes manually—error-prone and time-consuming.

**Solution**: Created a patch management system:
- `patches/` directory stores `.patch` files (git format-patch format)
- `scripts/apply-patches.sh` applies patches after submodule updates
- `scripts/regenerate-patches.sh` updates patches when upstream changes
- `scripts/update-elixir-ls.sh` automates the entire workflow

**Impact**: Updating ElixirLS is now safe and repeatable. The custom test debugging functionality is preserved across updates, and the team can easily contribute patches upstream if desired.

### 6. Natural test_helper.exs Execution Model

**Problem**: Original ElixirLS requires `test_helper.exs` to define a module with setup functions that each test file must call. This breaks the standard Elixir testing pattern where `test_helper.exs` contains top-level setup code.

**Why it happens**: The original extension tries to `require` test_helper.exs before debugging, which means the file gets evaluated in the debugger's interpretation context. Any top-level code that starts applications or initializes dependencies (like `:shards` tables, database connections, or mock servers) would execute in the wrong context or fail entirely.

**Solution**: This fork doesn't require test_helper.exs before debugging—it lets `mix test` handle it naturally. The test helper executes as a top-level script before any test files run, exactly as it does when you run `mix test` from the command line. This assumes you're debugging/running tests without pre-starting the application (matching the `startApps: false` default in the debug configuration).

**Impact**: Your `test_helper.exs` can contain normal setup code:
```elixir
# Standard pattern that works with this fork
ExUnit.start()

# Start required applications
Application.ensure_all_started(:shards)

# Create global test resources
:shards.new(:my_cache, [:named_table, :public])

# Configure test environment
Application.put_env(:my_app, :env, :test)
```

This mirrors the real `mix test` behavior, so tests run identically whether debugged or not. The test helper's setup code executes once before any tests, establishing the proper environment just like the standard Mix task does.

**Tradeoff**: You cannot set breakpoints in `test_helper.exs` itself, since it executes outside the debugger's interpretation context. If you need to debug test setup code, move it into a test file's `setup` or `setup_all` block.

## When to Use This Fork

Use **Super ElixirLS** if you:
- Work on the Super codebase or similar projects with heavy test mocking
- Practice test-driven development and rely on debugging tests interactively
- Need team-wide consistency in test execution and debugging configurations
- Want test debugging to "just work" without manual excludeModules configuration
- Use standard test_helper.exs patterns with top-level setup code (application starts, dependency initialization, etc.)

Use **standard ElixirLS** if you:
- Don't use mocking libraries in your tests
- Rarely debug tests (preferring `IO.inspect` or print debugging)
- Need to set breakpoints in test_helper.exs
- Want to stay on the official release path
- Contribute to ElixirLS development

## Technical Details

For detailed information about the implementation:
- See [`patches/README.md`](patches/README.md) for patch management documentation
- See [`CLAUDE.md`](CLAUDE.md) for project architecture and development commands
- Review commit history for specific feature implementations

## Relationship to Upstream

This fork tracks the [official ElixirLS VS Code extension](https://github.com/elixir-lsp/vscode-elixir-ls) as an upstream dependency. Changes here are **additive**—they don't remove or modify core ElixirLS functionality, only enhance test debugging workflows.

The ExUnit.start patch is a candidate for upstream contribution, as it benefits all VS Code users debugging Elixir tests. If you're interested in contributing it upstream, see the [ElixirLS repository](https://github.com/elixir-lsp/elixir-ls).

## License

This project maintains the MIT license of the original ElixirLS project. See LICENSE for details.