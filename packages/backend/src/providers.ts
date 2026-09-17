import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import type { AppEnv } from "./types";

export type ModelConfig = {
  createModel: (env: AppEnv["Bindings"]) => LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
  sendReasoning?: boolean;
  telemetryId: string;
};

const models: Record<string, ModelConfig> = {
  "gpt-4o-mini": {
    createModel: (env) =>
      createOpenAI({ apiKey: env.OPENAI_API_KEY })("gpt-4o-mini"),
    telemetryId: "openai-chat",
  },
  "gemma4:12b": {
    createModel: () =>
      createOllama({ baseURL: "http://localhost:11434/api" })("gemma4:12b"),
    providerOptions: { ollama: { think: true } },
    sendReasoning: true,
    telemetryId: "ollama-chat",
  },
};

export function getModel(modelId: string): ModelConfig {
  const config = models[modelId];
  if (!config) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  return config;
}

export const availableModels = Object.keys(models);
