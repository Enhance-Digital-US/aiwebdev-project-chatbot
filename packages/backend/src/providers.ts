import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { AppEnv } from "./types";

export type ModelConfig = {
  createModel: (env: AppEnv["Bindings"]) => LanguageModel;
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

/** Used when a request names no model. */
export const DEFAULT_MODEL = "gpt-6-luna";

const models: Record<string, ModelConfig> = {
  "gpt-6-luna": {
    // A reasoning model (default effort: medium). Its reasoning isn't streamed
    // to the UI.
    createModel: (env) => createGatewayOpenAI(env)("gpt-6-luna"),
  },
};

export function getModel(modelId: string): ModelConfig | undefined {
  return Object.hasOwn(models, modelId) ? models[modelId] : undefined;
}

export const availableModels = Object.keys(models);
