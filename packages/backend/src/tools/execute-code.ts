import { tool } from "ai";
import { z } from "zod";
import { Sandbox as E2BSandbox } from "@e2b/code-interpreter";
import { getSandbox, type Sandbox as CFSandbox } from "@cloudflare/sandbox";
import type { AppEnv } from "../types";

// Sample - Given the following list of numbers identify which one is even, odd and in the fibonacci sequence - 1, 2, 4, 8, 15, 17, 23, 45, 57, 71, 89, 99

type SandboxResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type Bindings = AppEnv["Bindings"];

async function runE2B(
  code: string,
  language: string,
  apiKey: string
): Promise<SandboxResult> {
  const sbx = await E2BSandbox.create({ apiKey, timeoutMs: 30_000 });
  try {
    const exec = await sbx.runCode(code, { language, timeoutMs: 15_000 });
    return {
      stdout: exec.logs.stdout.join("\n"),
      stderr: exec.logs.stderr.join("\n"),
      exitCode: exec.error ? 1 : 0,
    };
  } finally {
    await sbx.kill();
  }
}

async function runCloudflare(
  code: string,
  language: string,
  binding: DurableObjectNamespace<CFSandbox>
): Promise<SandboxResult> {
  const sandbox = getSandbox(binding, `exec-${Date.now()}`);
  try {
    const ext = language === "python" ? "py" : "js";
    const cmd =
      language === "python"
        ? `python3 /workspace/code.${ext}`
        : `node /workspace/code.${ext}`;
    await sandbox.writeFile(`/workspace/code.${ext}`, code);
    return await sandbox.exec(cmd, { timeout: 15_000 });
  } finally {
    await sandbox.destroy();
  }
}

async function runStub(
  code: string,
  language: string
): Promise<SandboxResult> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const timestamp = new Date().toISOString();
  return {
    stdout:
      `[simulated ${language} output — ${timestamp}]\n` +
      `Executed ${code.split("\n").length} lines of ${language}.\n` +
      `Set SANDBOX_PROVIDER to "e2b" or "cloudflare" for real execution.`,
    stderr: "",
    exitCode: 0,
  };
}

async function runInSandbox(
  code: string,
  language: string,
  env: Bindings
): Promise<SandboxResult> {
  const provider = env.SANDBOX_PROVIDER ?? "stub";

  switch (provider) {
    case "e2b": {
      if (!env.E2B_API_KEY) throw new Error("E2B_API_KEY is not set");
      return runE2B(code, language, env.E2B_API_KEY);
    }
    case "cloudflare": {
      if (!env.SANDBOX) throw new Error("SANDBOX DO binding is not configured");
      return runCloudflare(code, language, env.SANDBOX);
    }
    default:
      return runStub(code, language);
  }
}

export function createExecuteCodeTool(env: Bindings) {
  return tool({
    description:
      "Execute code in a secure isolated sandbox. Use when the user's question requires running code to compute a result, test a snippet, or demonstrate behavior. Supports Python and JavaScript.",
    inputSchema: z.object({
      code: z.string().describe("The code to execute"),
      language: z
        .enum(["python", "javascript"])
        .describe("The programming language")
        .default("javascript"),
    }),
    execute: async ({ code, language }) => {
      const result = await runInSandbox(code, language, env);
      return { code, language, ...result };
    },
  });
}
