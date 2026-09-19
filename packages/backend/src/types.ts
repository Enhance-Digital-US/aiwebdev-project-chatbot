export type AppEnv = {
  Bindings: {
    OPENAI_API_KEY: string;
    LANGFUSE_PUBLIC_KEY: string;
    LANGFUSE_SECRET_KEY: string;
    /** MCP client implementation: "ai-sdk" (default) or "raw" */
    MCP_IMPL?: "ai-sdk" | "raw";
  };
};
