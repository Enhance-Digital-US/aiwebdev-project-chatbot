import type { LanguageModelMiddleware } from "ai";
import type { SafetyChecker, SafetyResult } from "./checker";
import { extractNewMessages, categoryLabel } from "./checker";
import { regexCheck } from "./simple";

function findSentenceBoundary(text: string): number {
  const pattern = /[.!?]\s|\n\n/g;
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    last = match.index + match[0].length - 1;
  }
  return last;
}

function buildRefusalMessage(categories: string[]): string {
  const hasSelfHarm = categories.some(
    (c) => c === "S11" || c.includes("SELF_HARM") || c.includes("SELF-HARM"),
  );

  if (hasSelfHarm) {
    return (
      "I can't help with that, but I want you to know that support is available.\n\n" +
      "- **988 Suicide & Crisis Lifeline** — call or text 988 (US)\n" +
      "- **Crisis Text Line** — text HOME to 741741\n" +
      "- **International Association for Suicide Prevention** — https://www.iasp.info/resources/Crisis_Centres/\n\n" +
      "You don't have to go through this alone."
    );
  }

  // Categories stay server-side (logged at the call site): naming them in the
  // reply tells an attacker which detector fired and how to rephrase around it.
  return "I'm not able to help with that request. Let me know if there's something else I can assist with.";
}

export function createGuardrailMiddleware(
  checker: SafetyChecker,
): LanguageModelMiddleware {
  let previousMessageCount = 0;
  let blockedResult: SafetyResult | null = null;

  function takeRefusal(): string {
    const categories = blockedResult!.categories;
    console.warn(`Guardrail blocked input: ${categories.map(categoryLabel).join(", ")}`);
    blockedResult = null;
    return buildRefusalMessage(categories);
  }

  return {
    transformParams: async ({ params }) => {
      blockedResult = null;
      const newMessages = extractNewMessages(
        params.prompt,
        previousMessageCount,
      );

      // Skip tool-sourced messages — they contain trusted first-party content
      // (e.g. skill instructions) that may match injection heuristics
      const checkableMessages = newMessages.filter(
        (m) => m.source !== "tool",
      );

      if (checkableMessages.length > 0) {
        const result = await checker(checkableMessages);
        if (!result.safe) {
          blockedResult = result;
          return params;
        }
      }

      previousMessageCount = extractNewMessages(params.prompt, 0).length;
      return params;
    },

    // Non-streaming calls (generateText, e.g. follow-up suggestions) get the
    // same input block; without this, transformParams' verdict was never enforced.
    wrapGenerate: async ({ doGenerate }) => {
      if (blockedResult) {
        const refusal = takeRefusal();
        return {
          content: [{ type: "text", text: refusal }],
          finishReason: { unified: "stop", raw: "guardrail" },
          usage: {
            inputTokens: { total: 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 0, text: undefined, reasoning: undefined },
          },
          warnings: [],
        } as unknown as Awaited<ReturnType<typeof doGenerate>>;
      }

      const result = await doGenerate();
      return {
        ...result,
        content: result.content.map((part) =>
          part.type === "text" && !regexCheck(part.text).safe
            ? { ...part, text: " [Content filtered] " }
            : part,
        ),
      };
    },

    wrapStream: async ({ doStream }) => {
      if (blockedResult) {
        const refusal = takeRefusal();

        const partId = "guard-refusal";
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: partId });
            controller.enqueue({
              type: "text-delta",
              id: partId,
              delta: refusal,
            });
            controller.enqueue({ type: "text-end", id: partId });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: {
                inputTokens: {
                  total: 0,
                  noCache: undefined,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 0 },
              },
            });
            controller.close();
          },
        });

        return { stream };
      }

      const { stream, ...rest } = await doStream();
      let sentenceBuffer = "";

      type StreamChunk = (typeof stream) extends ReadableStream<infer T>
        ? T
        : never;

      const transform = new TransformStream<StreamChunk, StreamChunk>({
        transform(chunk: StreamChunk, controller) {
          if (chunk.type === "text-end" && sentenceBuffer.length > 0) {
            const check = regexCheck(sentenceBuffer);
            const text = check.safe ? sentenceBuffer : " [Content filtered] ";
            controller.enqueue({
              type: "text-delta",
              id: (chunk as { id: string }).id,
              delta: text,
            } as StreamChunk);
            sentenceBuffer = "";
          }

          if (chunk.type !== "text-delta") {
            controller.enqueue(chunk);
            return;
          }

          const delta = (chunk as { type: "text-delta"; delta: string }).delta;
          sentenceBuffer += delta;

          const boundary = findSentenceBoundary(sentenceBuffer);
          if (boundary !== -1) {
            const sentence = sentenceBuffer.slice(0, boundary + 1);
            sentenceBuffer = sentenceBuffer.slice(boundary + 1);

            const check = regexCheck(sentence);
            if (!check.safe) {
              controller.enqueue({
                ...chunk,
                delta: " [Content filtered] ",
              } as StreamChunk);
            } else {
              controller.enqueue({
                ...chunk,
                delta: sentence,
              } as StreamChunk);
            }
          }
        },

        flush(controller) {
          if (sentenceBuffer.length > 0) {
            const check = regexCheck(sentenceBuffer);
            const text = check.safe ? sentenceBuffer : " [Content filtered] ";
            controller.enqueue({
              type: "text-delta",
              id: "guard-flush",
              delta: text,
            } as StreamChunk);
          }
        },
      });

      return { stream: stream.pipeThrough(transform), ...rest };
    },
  };
}
