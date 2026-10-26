import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import type { AppEnv } from "./types";
import type { Price } from "./usage";

export type ModelConfig = {
  createModel: (env: AppEnv["Bindings"]) => LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
  sendReasoning?: boolean;
  supportsTools?: boolean;
  telemetryId: string;
  /** USD per 1M tokens; omitted means the cost is unknown (design §10). */
  price?: Price;
  /** Routed through AI Gateway, so requests can opt into its response cache. */
  gateway?: boolean;
};

/**
 * Hosted providers go through Cloudflare AI Gateway (logs, caching, rate limits).
 * The gateway's OpenAI endpoint is OpenAI-compatible, so only the base URL changes;
 * the provider key still authenticates with OpenAI, and the gateway token with the gateway.
 */
export function gatewayOpenAIConfig(env: AppEnv["Bindings"]) {
  return {
    apiKey: env.OPENAI_API_KEY,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/openai`,
    headers: env.AI_GATEWAY_TOKEN
      ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` }
      : undefined,
  };
}

export function createGatewayOpenAI(env: AppEnv["Bindings"]) {
  return createOpenAI(gatewayOpenAIConfig(env));
}

const models: Record<string, ModelConfig> = {
  "gpt-4o-mini": {
    createModel: (env) => createGatewayOpenAI(env)("gpt-4o-mini"),
    telemetryId: "openai-chat",
    // https://developers.openai.com/api/docs/models/gpt-4o-mini
    price: { input: 0.15, cachedInput: 0.075, output: 0.6 },
    gateway: true,
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
