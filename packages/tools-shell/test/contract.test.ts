import { describe, expect, test } from "bun:test";
import { createShellTools, toModelTool } from "../src/index.ts";
import { splitShellWords, shellCommandArgv } from "../src/shell/args.ts";
import { resolveShellOptions } from "../src/shell/options.ts";
import { ToolInputError } from "../src/errors.ts";

describe("tool contract", () => {
  test("shell and code_exec share the builtin shape", () => {
    const tools = createShellTools({ network: false });
    expect(tools.map((tool) => tool.name)).toEqual(["shell", "code_exec"]);
    for (const tool of tools) {
      expect(tool.approval).toBe("ask");
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.additionalProperties).toBe(false);
      const model = toModelTool(tool);
      expect(model.name).toBe(tool.name);
      expect("execute" in model).toBe(false);
    }
    const shell = tools[0]!;
    expect(shell.parameters.required).toEqual(["command"]);
    const code = tools[1]!;
    expect(code.parameters.required).toEqual(["language", "code"]);
    expect(code.parameters.properties.language?.enum).toEqual(["javascript", "typescript", "python"]);
  });

  test("network defaults off and an explicit option wins over the environment", () => {
    const previous = process.env.BOTANICAL_SHELL_NETWORK;
    process.env.BOTANICAL_SHELL_NETWORK = "1";
    try {
      expect(resolveShellOptions().network).toBe(true);
      expect(resolveShellOptions({ network: false }).network).toBe(false);
    } finally {
      if (previous == null) delete process.env.BOTANICAL_SHELL_NETWORK;
      else process.env.BOTANICAL_SHELL_NETWORK = previous;
    }
  });

  test("rejects loader-control extra env at configuration time", () => {
    expect(() => resolveShellOptions({ extraEnv: { LD_PRELOAD: "/tmp/x.so" } })).toThrow(ToolInputError);
    expect(() => resolveShellOptions({ extraEnv: { PATH: "/tmp" } })).toThrow(ToolInputError);
  });
});

describe("shell allowlist parsing", () => {
  test("splits quotes without invoking a shell", () => {
    expect(splitShellWords(`echo "hello world" 'a b'`)).toEqual(["echo", "hello world", "a b"]);
  });

  test("unrestricted mode is sh -c", () => {
    expect(shellCommandArgv("echo hi", undefined)).toEqual(["/bin/sh", "-c", "echo hi"]);
  });

  test("allowlist mode execs the binary directly and rejects pipes", () => {
    const argv = shellCommandArgv("echo hello", ["echo"]);
    expect(argv[0]?.endsWith("/echo")).toBe(true);
    expect(argv.slice(1)).toEqual(["hello"]);
    expect(() => shellCommandArgv("echo hi | wc", ["echo"])).toThrow(/metacharacters/);
    expect(() => shellCommandArgv("/bin/echo hi", ["echo"])).toThrow(/allowlist/);
    expect(() => shellCommandArgv("rm -rf /", ["echo"])).toThrow(/allowlist/);
  });
});
