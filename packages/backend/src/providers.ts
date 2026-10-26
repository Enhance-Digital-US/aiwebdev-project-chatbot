import type { LanguageModel, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import type { AppEnv } from "./types";
import type { Price } from "./usage";

export type ModelConfig = {
  createModel: (env: AppEnv["Bindings"]) => LanguageModel;
  providerOptions?: Parameters<typeof streamText>[0]["providerOptions"];
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

/** Used when a request names no model, and by the bug-report workflow's draft step. */
export const DEFAULT_MODEL = "gpt-6-luna";

const models: Record<string, ModelConfig> = {
  "gpt-6-luna": {
    // A reasoning model (default effort: medium). Its reasoning isn't streamed
    // to the UI; reasoning tokens are billed as output and show in the meter.
    createModel: (env) => createGatewayOpenAI(env)("gpt-6-luna"),
    telemetryId: "openai-chat",
    // https://developers.openai.com/api/docs/models/gpt-6-luna (standard tier,
    // prompts up to 272K tokens; longer ones cost more and aren't modeled)
    price: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
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
