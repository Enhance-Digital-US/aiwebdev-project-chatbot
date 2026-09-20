import { Eval } from "braintrust";
import { Factuality, AnswerRelevancy } from "autoevals";
import { readFileSync } from "fs";
import { parse } from "yaml";

const CHATBOT_URL = process.env.CHATBOT_URL ?? "http://localhost:8787";

interface TestCase {
  description: string;
  vars: { prompt: string };
  assert?: Array<{ type: string; value: string }>;
}

interface DatasetFile {
  tests: TestCase[];
}

async function callChatbot(prompt: string): Promise<string> {
  // The backend passes `messages` straight to `convertToModelMessages`, which
  // expects the AI SDK `UIMessage` shape (`Omit<UIMessage, "id">`):
  // `{ role, parts: [{ type: "text", text }] }` — there is no `content` field.
  const messages = [
    { role: "user" as const, parts: [{ type: "text" as const, text: prompt }] },
  ];

  let res: Response;
  try {
    res = await fetch(`${CHATBOT_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: "gpt-4o-mini",
      }),
    });
  } catch (err) {
    throw new Error(`Failed to reach chatbot at ${CHATBOT_URL}: ${err}`);
  }

  if (!res.ok) {
    throw new Error(`Chatbot API error: ${res.status} ${res.statusText}`);
  }

  // The backend responds via `createUIMessageStreamResponse`, which emits
  // Server-Sent Events: `data: <json>\n\n`, terminated by `data: [DONE]\n\n`.
  // Each JSON payload is a `UIMessageChunk`; text is delivered as
  // `{ type: "text-delta", id, delta }` chunks that must be concatenated.
  const text = await res.text();
  const content = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((data) => data.length > 0 && data !== "[DONE]")
    .map((data) => {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    })
    .filter(
      (chunk): chunk is { type: string; delta?: string } =>
        chunk?.type === "text-delta",
    )
    .map((chunk) => chunk.delta ?? "")
    .join("");

  return content;
}

function loadDataset(path: string): TestCase[] {
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw) as DatasetFile;
  return parsed.tests;
}

const qualityTests = loadDataset("datasets/quality.yaml");
const safetyTests = loadDataset("datasets/safety.yaml");

Eval("chatbot", {
  data: () =>
    [...qualityTests, ...safetyTests].map((tc) => ({
      input: tc.vars.prompt,
      metadata: { description: tc.description },
    })),

  task: async (input: string) => {
    return callChatbot(input);
  },

  scores: [Factuality, AnswerRelevancy],

  experimentName: `chatbot-eval-${new Date().toISOString().slice(0, 10)}`,
});
