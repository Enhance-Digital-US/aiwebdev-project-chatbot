export type AppEnv = {
  Bindings: {
    OPENAI_API_KEY: string;
    /** "development" under `pnpm dev` (set by the dev script); anything else counts as production */
    ENVIRONMENT?: string;
    /** Cloudflare account that owns the AI Gateway (wrangler.jsonc vars) */
    AI_GATEWAY_ACCOUNT_ID: string;
    /** AI Gateway name (wrangler.jsonc vars) */
    AI_GATEWAY_NAME: string;
    /** Token for an authenticated gateway, sent as cf-aig-authorization (secret) */
    AI_GATEWAY_TOKEN?: string;
    LANGFUSE_PUBLIC_KEY: string;
    LANGFUSE_SECRET_KEY: string;
    /** Langfuse region host (default: https://us.cloud.langfuse.com) */
    LANGFUSE_BASE_URL?: string;
    /** MCP client implementation: "raw" (default, Workers-compatible) or "ai-sdk" (Node only) */
    MCP_IMPL?: "raw" | "ai-sdk";
    /** Ollama base URL for the gemma4:12b model (default: http://localhost:11434) */
    OLLAMA_BASE_URL?: string;
    /** Issue-tracker MCP endpoint: the hosted tracker in wrangler.jsonc vars; `pnpm dev` passes localhost:8787 */
    ISSUE_TRACKER_URL?: string;
    /** Issue-tracker persona for local dev tokens: user-alice (admin), user-bob (member, default), user-carol (viewer) */
    ISSUE_TRACKER_PERSONA?: string;
  };
  Variables: {
    userId: string | null;
  };
};
