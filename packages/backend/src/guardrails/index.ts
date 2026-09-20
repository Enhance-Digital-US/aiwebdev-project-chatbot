import type { AppEnv } from "../types";
import type { SafetyChecker } from "./checker";
import { createSimpleChecker } from "./simple";
import { createLocalChecker } from "./local";
import { createCloudChecker } from "./cloud";
import { createGuardrailMiddleware } from "./middleware";

export type { SafetyChecker, SafetyResult, GuardMessage } from "./checker";
export { createGuardrailMiddleware } from "./middleware";

type GuardrailTier = "simple" | "local" | "cloud" | "none";

export function createGuardrailChecker(
  env: AppEnv["Bindings"]
): SafetyChecker | null {
  const tier = (env.GUARDRAIL_TIER ?? "none") as GuardrailTier;

  switch (tier) {
    case "simple":
      return createSimpleChecker(env.OPENAI_API_KEY);
    case "local":
      return createLocalChecker(env.OLLAMA_BASE_URL);
    case "cloud":
      return createCloudChecker(env.AI);
    case "none":
      return null;
  }
}

export function createGuardrails(env: AppEnv["Bindings"]) {
  const checker = createGuardrailChecker(env);
  if (!checker) return null;
  return createGuardrailMiddleware(checker);
}
