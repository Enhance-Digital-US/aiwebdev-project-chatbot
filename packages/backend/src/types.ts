export type AppEnv = {
  Bindings: {
    OPENAI_API_KEY: string;
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
    /** Ollama base URL for the gemma4:12b model (default: http://localhost:11434) */
    OLLAMA_BASE_URL?: string;
  };
  Variables: {
    userId: string | null;
  };
};
