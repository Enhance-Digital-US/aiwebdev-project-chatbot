export type AppEnv = {
  Bindings: {
    OPENAI_API_KEY: string;
    /** Cloudflare account that owns the AI Gateway (wrangler.jsonc vars) */
    AI_GATEWAY_ACCOUNT_ID: string;
    /** AI Gateway name (wrangler.jsonc vars) */
    AI_GATEWAY_NAME: string;
    /** Token for an authenticated gateway, sent as cf-aig-authorization (secret) */
    AI_GATEWAY_TOKEN?: string;
    /** Ollama base URL for the gemma4:12b model (default: http://localhost:11434) */
    OLLAMA_BASE_URL?: string;
  };
};
