import type { Sandbox } from "@cloudflare/sandbox";

export type AppEnv = {
  Bindings: {
    OPENAI_API_KEY: string;
    LANGFUSE_PUBLIC_KEY: string;
    LANGFUSE_SECRET_KEY: string;
    /** MCP client implementation: "raw" (default, Workers-compatible) or "ai-sdk" (Node only) */
    MCP_IMPL?: "raw" | "ai-sdk";
    /** Sandbox provider: "e2b", "cloudflare", or omit for stub */
    SANDBOX_PROVIDER?: "e2b" | "cloudflare";
    /** E2B API key — required when SANDBOX_PROVIDER=e2b */
    E2B_API_KEY?: string;
    /** Cloudflare Sandbox DO binding — required when SANDBOX_PROVIDER=cloudflare */
    SANDBOX?: DurableObjectNamespace<Sandbox>;
  };
};
