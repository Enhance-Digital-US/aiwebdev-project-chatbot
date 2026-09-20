import type { LanguageModelMiddleware } from "ai";
import type { SafetyChecker } from "./checker";
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

export function createGuardrailMiddleware(
  checker: SafetyChecker
): LanguageModelMiddleware {
  let previousMessageCount = 0;

  return {
    transformParams: async ({ params }) => {
      const newMessages = extractNewMessages(
        params.prompt,
        previousMessageCount
      );

      if (newMessages.length > 0) {
        const result = await checker(newMessages);
        if (!result.safe) {
          const labels = result.categories.map(categoryLabel).join(", ");
          throw new Error(
            `Content blocked by guardrails: ${labels}`
          );
        }
      }

      previousMessageCount = extractNewMessages(params.prompt, 0).length;
      return params;
    },

    wrapStream: async ({ doStream, params }) => {
      const { stream, ...rest } = await doStream();
      let sentenceBuffer = "";
      let fullText = "";

      type StreamChunk = (typeof stream) extends ReadableStream<infer T>
        ? T
        : never;

      const transform = new TransformStream<StreamChunk, StreamChunk>({
        transform(chunk: StreamChunk, controller) {
          if (chunk.type !== "text-delta") {
            controller.enqueue(chunk);
            return;
          }

          const delta = (chunk as { type: "text-delta"; delta: string }).delta;
          const regex = regexCheck(delta);
          if (!regex.safe) {
            controller.enqueue({
              ...chunk,
              delta: " [Content filtered] ",
            } as StreamChunk);
            return;
          }

          sentenceBuffer += delta;
          fullText += delta;

          const boundary = findSentenceBoundary(sentenceBuffer);
          if (boundary !== -1) {
            const sentence = sentenceBuffer.slice(0, boundary + 1);
            sentenceBuffer = sentenceBuffer.slice(boundary + 1);

            controller.enqueue({
              ...chunk,
              delta: sentence,
            } as StreamChunk);
          }
        },

        flush(controller) {
          if (sentenceBuffer.length > 0) {
            controller.enqueue({
              type: "text-delta",
              id: "guard-flush",
              delta: sentenceBuffer,
            } as StreamChunk);
          }
        },
      });

      return { stream: stream.pipeThrough(transform), ...rest };
    },
  };
}
