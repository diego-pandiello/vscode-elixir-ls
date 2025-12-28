import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  type DebuggeeExited,
  type DebuggeeOutput,
  trackerFactory,
} from "../debugAdapter";
import { reporter } from "../telemetry";

export type RunTestArgs = {
  cwd: string;
  filePath?: string;
  line?: number;
  doctestLine?: number;
  module?: string;
  workspaceFolder: vscode.WorkspaceFolder;
  getTest: (
    file: string,
    module: string,
    describe: string | null,
    name: string,
    type: string,
  ) => vscode.TestItem | undefined;
};

/**
 * Extracts alias definitions from the test file.
 * Builds a map from short name to fully qualified module name.
 *
 * Patterns detected:
 * - alias MyApp.Services.ExternalAPI
 * - alias MyApp.Services.{A, B, C}
 * - alias MyApp.Cache.Redis, as: RedisCache
 *
 * @returns Map from alias name to fully qualified module name
 */
function extractAliases(content: string): Map<string, string> {
  const aliases = new Map<string, string>();

  // Pattern 1: alias MyApp.Services.ExternalAPI
  // Default alias is the last segment: ExternalAPI
  const simpleAliasPattern = /alias\s+([A-Z][A-Za-z0-9._]+)(?:\s|$|,)/g;
  let match: RegExpExecArray | null;
  while ((match = simpleAliasPattern.exec(content)) !== null) {
    const fullModule = match[1];
    const segments = fullModule.split(".");
    const aliasName = segments[segments.length - 1];
    aliases.set(aliasName, fullModule);
  }

  // Pattern 2: alias MyApp.Services.{A, B, C}
  // Extracts: A -> MyApp.Services.A, B -> MyApp.Services.B, etc.
  const multiAliasPattern = /alias\s+([A-Z][A-Za-z0-9._]+)\.\{([^}]+)\}/g;
  while ((match = multiAliasPattern.exec(content)) !== null) {
    const baseModule = match[1];
    const modules = match[2].split(",").map(m => m.trim());
    for (const module of modules) {
      const fullModule = `${baseModule}.${module}`;
      aliases.set(module, fullModule);
    }
  }

  // Pattern 3: alias MyApp.Cache.Redis, as: RedisCache
  // Custom alias name
  const asAliasPattern = /alias\s+([A-Z][A-Za-z0-9._]+)\s*,\s*as:\s*([A-Z][A-Za-z0-9._]+)/g;
  while ((match = asAliasPattern.exec(content)) !== null) {
    const fullModule = match[1];
    const aliasName = match[2];
    aliases.set(aliasName, fullModule);
  }

  return aliases;
}

/**
 * Resolves a potentially aliased module name to its fully qualified name.
 *
 * @param moduleName - The module name from the mock (might be aliased)
 * @param aliases - Map of alias to fully qualified module name
 * @returns Fully qualified module name
 */
function resolveModuleName(moduleName: string, aliases: Map<string, string>): {
  resolved: string;
  wasAliased: boolean;
} {
  // Check if it's in the alias map
  if (aliases.has(moduleName)) {
    return { resolved: aliases.get(moduleName)!, wasAliased: true };
  }

  // If it contains a dot, it's likely already fully qualified
  if (moduleName.includes(".")) {
    return { resolved: moduleName, wasAliased: false };
  }

  // If it starts with :, it's an Erlang module
  if (moduleName.startsWith(":")) {
    return { resolved: moduleName, wasAliased: false };
  }

  // Otherwise, it's an unresolved alias - return as-is but log warning
  console.warn(
    `ElixirLS: Could not resolve alias for mocked module "${moduleName}". ` +
    `Consider using the fully qualified name in your mock or ensuring the alias is defined in the test file.`
  );
  return { resolved: moduleName, wasAliased: false };
}

/**
 * Extracts module names that are being mocked in the test file.
 * Supports common mocking patterns from the 'mock' library and ':meck'.
 * Resolves aliases to fully qualified module names.
 *
 * Patterns detected:
 * - setup_with_mocks([{ModuleName, ...}])
 * - with_mock ModuleName, [...] do
 * - :meck.new(ModuleName, ...)
 * - :meck.expect(ModuleName, ...)
 */
function extractMockedModules(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const mockedModules = new Set<string>();

    console.log(`ElixirLS: Extracting mocked modules from ${filePath}`);

    // First, extract all aliases from the file
    const aliases = extractAliases(content);
    if (aliases.size > 0) {
      console.log(
        `ElixirLS: Found ${aliases.size} alias(es): ${Array.from(aliases.entries()).map(([k, v]) => `${k}->${v}`).join(", ")}`
      );
    }

    // Pattern 1: setup_with_mocks([{ModuleName, ...}]) - find ALL modules in the list
    // Matches: setup_with_mocks([{HTTPoison, [], [...]}, {MyApp.API, [], [...]}])
    let match: RegExpExecArray | null;

    // First, find all setup_with_mocks blocks
    const setupBlockPattern = /setup_with_mocks\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
    let setupMatch: RegExpExecArray | null;
    while ((setupMatch = setupBlockPattern.exec(content)) !== null) {
      const setupBlock = setupMatch[1];
      // Now extract all module names from within this block
      const modulePattern = /\{([A-Z][A-Za-z0-9._]*),/g;
      let moduleMatch: RegExpExecArray | null;
      while ((moduleMatch = modulePattern.exec(setupBlock)) !== null) {
        const moduleName = moduleMatch[1];
        const { resolved, wasAliased } = resolveModuleName(moduleName, aliases);
        if (wasAliased) {
          console.log(`ElixirLS: Resolved alias ${moduleName} -> ${resolved}`);
        }
        mockedModules.add(resolved);
      }
    }

    // Pattern 2: with_mock ModuleName, [...] do
    // Matches: with_mock HTTPoison, [get: fn(_) -> :ok end] do
    const withMockPattern = /with_mock\s+([A-Z][A-Za-z0-9._]*)/g;
    while ((match = withMockPattern.exec(content)) !== null) {
      const moduleName = match[1];
      const { resolved, wasAliased } = resolveModuleName(moduleName, aliases);
      if (wasAliased) {
        console.log(`ElixirLS: Resolved alias ${moduleName} -> ${resolved}`);
      }
      mockedModules.add(resolved);
    }

    // Pattern 3: :meck.new(ModuleName, ...)
    // Matches: :meck.new(HTTPoison, [:passthrough])
    const meckNewPattern = /:meck\.new\s*\(\s*([A-Z][A-Za-z0-9._]*)/g;
    while ((match = meckNewPattern.exec(content)) !== null) {
      const moduleName = match[1];
      const { resolved, wasAliased } = resolveModuleName(moduleName, aliases);
      if (wasAliased) {
        console.log(`ElixirLS: Resolved alias ${moduleName} -> ${resolved}`);
      }
      mockedModules.add(resolved);
    }

    // Pattern 4: :meck.expect(ModuleName, ...)
    // Matches: :meck.expect(HTTPoison, :get, fn(_) -> :ok end)
    const meckExpectPattern = /:meck\.expect\s*\(\s*([A-Z][A-Za-z0-9._]*)/g;
    while ((match = meckExpectPattern.exec(content)) !== null) {
      const moduleName = match[1];
      const { resolved, wasAliased } = resolveModuleName(moduleName, aliases);
      if (wasAliased) {
        console.log(`ElixirLS: Resolved alias ${moduleName} -> ${resolved}`);
      }
      mockedModules.add(resolved);
    }

    const result = Array.from(mockedModules);

    if (result.length > 0) {
      console.log(`ElixirLS: Detected mocked modules (resolved): ${result.join(", ")}`);
    }

    return result;
  } catch (error) {
    console.warn(`ElixirLS: Failed to extract mocked modules from ${filePath}:`, error);
    return [];
  }
}

// Get the configuration for mix test, if it exists
function getExistingLaunchConfig(
  args: RunTestArgs,
  debug: boolean,
  mockedModules: string[],
): vscode.DebugConfiguration | undefined {
  const launchJson = vscode.workspace.getConfiguration(
    "launch",
    args.workspaceFolder,
  );
  const configurations =
    launchJson.get<vscode.DebugConfiguration[]>("configurations");
  let testConfig: vscode.DebugConfiguration | undefined;
  if (Array.isArray(configurations)) {
    for (let i = configurations.length - 1; i >= 0; i--) {
      const c = configurations[i];
      if (c?.name === "mix test") {
        testConfig = c;
        break;
      }
    }
  }

  if (testConfig === undefined) {
    return undefined;
  }

  // override configuration with sane defaults
  testConfig.request = "launch";
  testConfig.task = "test";
  testConfig.projectDir = args.cwd;
  testConfig.env = {
    MIX_ENV: "test",
    ...(testConfig.env ?? {}),
  };
  // as of vscode 1.78 ANSI is not fully supported
  testConfig.taskArgs = buildTestCommandArgs(args, debug);
  testConfig.requireFiles = [
    args.filePath,
  ];
  testConfig.noDebug = !debug;

  // Auto-exclude mocked modules from interpretation to allow mocking to work
  if (debug && mockedModules.length > 0) {
    const existingExcludes = testConfig.excludeModules || [];
    testConfig.excludeModules = [
      ...new Set([...existingExcludes, ...mockedModules]),
    ];
  }

  return testConfig;
}

// Get the config to use for debugging
function getLaunchConfig(
  args: RunTestArgs,
  debug: boolean,
): vscode.DebugConfiguration {
  console.log("ElixirLS: Preparing launch config for mix test");
  // Extract mocked modules from the test file to auto-exclude them
  const mockedModules = debug && args.filePath
    ? extractMockedModules(path.join(args.cwd, args.filePath))
    : [];

  const fileConfiguration: vscode.DebugConfiguration | undefined =
    getExistingLaunchConfig(args, debug, mockedModules);

  const fallbackConfiguration: vscode.DebugConfiguration = {
    type: "mix_task",
    name: "mix test",
    request: "launch",
    task: "test",
    env: {
      MIX_ENV: "test",
    },
    taskArgs: buildTestCommandArgs(args, debug),
    startApps: true,
    projectDir: args.cwd,
    // We only require the test file itself. test_helper.exs is NOT required here
    // because its side effects need to run in the test execution context, not
    // the debug adapter context. The debug adapter will start ExUnit explicitly
    // before interpreting test files.
    requireFiles: [
      args.filePath,
    ],
    noDebug: !debug,
    // Auto-exclude mocked modules from interpretation to allow mocking to work.
    // Interpreted modules are locked by the debugger and cannot be mocked.
    excludeModules: mockedModules,
  };

  const config = fileConfiguration ?? fallbackConfiguration;

  if (debug && mockedModules.length > 0) {
    console.log(
      "ElixirLS: Auto-excluding mocked modules from interpretation:",
      mockedModules.join(", ")
    );
  }
  console.log("Starting debug session with launch config", config);
  return config;
}

export async function runTest(
  run: vscode.TestRun,
  args: RunTestArgs,
  debug: boolean,
): Promise<string> {
  reporter.sendTelemetryEvent("run_test", {
    "elixir_ls.with_debug": debug ? "true" : "false",
  });

  const debugConfiguration: vscode.DebugConfiguration = getLaunchConfig(
    args,
    debug,
  );

  return new Promise((resolve, reject) => {
    const listeners: Array<vscode.Disposable> = [];
    const disposeListeners = () => {
      for (const listener of listeners) {
        listener.dispose();
      }
    };
    let sessionId = "";
    // default to error
    // expect DAP `exited` event with mix test exit code
    let exitCode = 1;
    const output: string[] = [];
    listeners.push(
      trackerFactory.onOutput((outputEvent: DebuggeeOutput) => {
        if (outputEvent.sessionId === sessionId) {
          const category = outputEvent.output.body.category;
          if (category === "stdout" || category === "stderr") {
            output.push(outputEvent.output.body.output);
          } else if (category === "ex_unit") {
            const exUnitEvent = outputEvent.output.body.data.event;
            const data = outputEvent.output.body.data;
            const test = args.getTest(
              data.file,
              data.module,
              data.describe,
              data.name,
              data.type,
            );
            if (test) {
              if (exUnitEvent === "test_started") {
                run.started(test);
              } else if (exUnitEvent === "test_passed") {
                run.passed(test, data.time / 1000);
              } else if (exUnitEvent === "test_failed") {
                run.failed(
                  test,
                  new vscode.TestMessage(data.message),
                  data.time / 1000,
                );
              } else if (exUnitEvent === "test_errored") {
                // ex_unit does not report duration for invalid tests
                run.errored(test, new vscode.TestMessage(data.message));
              } else if (
                exUnitEvent === "test_skipped" ||
                exUnitEvent === "test_excluded"
              ) {
                run.skipped(test);
              }
            } else {
              if (exUnitEvent !== "test_excluded") {
                console.warn(
                  `ElixirLS: Test ${data.file} ${data.module} ${data.describe} ${data.name} not found`,
                );
              }
            }
          }
        }
      }),
    );
    listeners.push(
      trackerFactory.onExited((exit: DebuggeeExited) => {
        console.log(
          `ElixirLS: Debug session ${exit.sessionId}: debuggee exited with code ${exit.code}`,
        );
        if (exit.sessionId === sessionId) {
          exitCode = exit.code;
        }
      }),
    );
    listeners.push(
      vscode.debug.onDidStartDebugSession((s) => {
        console.log(`ElixirLS: Debug session ${s.id} started`);
        sessionId = s.id;
      }),
    );
    listeners.push(
      vscode.debug.onDidTerminateDebugSession((s) => {
        console.log(`ElixirLS: Debug session ${s.id} terminated`);

        disposeListeners();
        if (exitCode === 0) {
          resolve(output.join(""));
        } else {
          reject(output.join(""));
        }
      }),
    );

    vscode.debug.startDebugging(args.workspaceFolder, debugConfiguration).then(
      (debugSessionStarted) => {
        if (!debugSessionStarted) {
          reporter.sendTelemetryErrorEvent("run_test_error", {
            "elixir_ls.with_debug": debug ? "true" : "false",
          });

          disposeListeners();

          reject("Unable to start debug session");
        }
      },
      (reason) => {
        reporter.sendTelemetryErrorEvent("run_test_error", {
          "elixir_ls.with_debug": debug ? "true" : "false",
          "elixir_ls.run_test_error": String(reason),
          "elixir_ls.run_test_error_stack": reason?.stack ?? "",
        });

        disposeListeners();
        reject("Unable to start debug session");
      },
    );
  });
}

const COMMON_ARGS = ["--formatter", "ElixirLS.DebugAdapter.ExUnitFormatter"];

function buildTestCommandArgs(args: RunTestArgs, debug: boolean): string[] {
  let line = "";
  if (typeof args.line === "number") {
    line = `:${args.line}`;
  }

  const result = [];

  if (args.module) {
    result.push("--only");
    result.push(`module:${args.module}`);
  }

  if (args.doctestLine) {
    result.push("--only");
    result.push(`doctest_line:${args.doctestLine}`);
  }

  if (args.filePath) {
    // workaround for https://github.com/elixir-lang/elixir/issues/13225
    // ex_unit file filters with windows path separators are broken on elixir < 1.16.1
    // fortunately unix separators work correctly
    // TODO remove this when we require elixir 1.17
    const path =
      os.platform() === "win32"
        ? args.filePath.replace(/\\/g, "/")
        : args.filePath;
    result.push(`${path}${line}`);
  }

  // debug tests in tracing mode to disable timeouts
  const maybeTrace = debug ? ["--trace"] : [];

  return [...maybeTrace, ...result, ...COMMON_ARGS];
}
