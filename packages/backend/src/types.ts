import type { Sandbox } from "@cloudflare/sandbox";
import type { BugReportParams } from "./workflows/bug-report";

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
    /** Sandbox provider: "e2b", "cloudflare", or omit for stub */
    SANDBOX_PROVIDER?: "e2b" | "cloudflare";
    /** E2B API key — required when SANDBOX_PROVIDER=e2b */
    E2B_API_KEY?: string;
    /** Cloudflare Sandbox DO binding — required when SANDBOX_PROVIDER=cloudflare */
    SANDBOX?: DurableObjectNamespace<Sandbox>;
    /** Guardrail tier: "simple" (regex+OpenAI), "local" (Ollama Llama Guard), "cloud" (CF Workers AI), "none" */
    GUARDRAIL_TIER?: "simple" | "local" | "cloud" | "none";
    /** Ollama base URL for local guardrails (default: http://localhost:11434) */
    OLLAMA_BASE_URL?: string;
    /** Bug-report workflow (workflows/bug-report.ts) */
    BUG_REPORT: Workflow<BugReportParams>;
    /** D1: bug_reports progress (migrations/) */
    DB: D1Database;
    /** How long a bug report waits for approval (default "24 hours"; shorten in .dev.vars to test expiry) */
    BUG_REPORT_APPROVAL_TIMEOUT?: string;
    /** Local fault injection: "fail-after-file" fails the first filing attempt after the issue exists */
    BUG_REPORT_CHAOS?: string;
    /** CF Workers AI binding — required for cloud guardrail tier */
    AI: Ai;
    /** Issue-tracker MCP endpoint: the hosted tracker in wrangler.jsonc vars; `pnpm dev` passes localhost:8787 */
    ISSUE_TRACKER_URL?: string;
    /** Issue-tracker persona for local dev tokens: user-alice (admin), user-bob (member, default), user-carol (viewer) */
    ISSUE_TRACKER_PERSONA?: string;
    /** Cloudflare Access team domain, the Access JWT `iss` (e.g. "https://enhancedigital.cloudflareaccess.com") */
    ACCESS_TEAM_DOMAIN?: string;
    /** Cloudflare Access application AUD tag, the Access JWT `aud` */
    ACCESS_AUD?: string;
  };
  Variables: {
    userId: string | null;
  };
};
