import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import type { AppEnv } from "./types";

export type ModelConfig = {
  createModel: (env: AppEnv["Bindings"]) => LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
  sendReasoning?: boolean;
  supportsTools?: boolean;
  telemetryId: string;
};

const models: Record<string, ModelConfig> = {
  "gpt-4o-mini": {
    createModel: (env) =>
      createOpenAI({ apiKey: env.OPENAI_API_KEY })("gpt-4o-mini"),
    telemetryId: "openai-chat",
  },
  "gemma4:12b": {
    // Local-only: needs a reachable Ollama server (not available when deployed)
    createModel: (env) =>
      createOllama({
        baseURL: `${env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/api`,
      })("gemma4:12b"),
    providerOptions: { ollama: { think: true } },
    sendReasoning: true,
    telemetryId: "ollama-chat",
  },
};

export function getModel(modelId: string): ModelConfig | undefined {
  return Object.hasOwn(models, modelId) ? models[modelId] : undefined;
}

export const availableModels = Object.keys(models);
