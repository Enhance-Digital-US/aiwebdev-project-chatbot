export type AppEnv = {
  Bindings: {
    OPENAI_API_KEY: string;
    LANGFUSE_PUBLIC_KEY: string;
    LANGFUSE_SECRET_KEY: string;
    /** MCP client implementation: "raw" (default, Workers-compatible) or "ai-sdk" (Node only) */
    MCP_IMPL?: "raw" | "ai-sdk";
  };
};
