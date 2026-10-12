import { registerTelemetry } from "ai";
import { OpenTelemetry, type EnrichSpan } from "@ai-sdk/otel";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";

const DEFAULT_LANGFUSE_BASE_URL = "https://us.cloud.langfuse.com";

class LangfuseFetchExporter implements SpanExporter {
  private url: string;
  private authHeader: string;
  private pendingExports: Promise<void>[] = [];

  constructor(opts: { url: string; publicKey: string; secretKey: string }) {
    this.url = opts.url;
    this.authHeader = `Basic ${btoa(`${opts.publicKey}:${opts.secretKey}`)}`;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void) {
    const body = JsonTraceSerializer.serializeRequest(spans);
    if (!body) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    const exportPromise = fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        "x-langfuse-ingestion-version": "4",
      },
      body,
    })
      .then((res) => {
        resultCallback({
          code: res.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED,
          ...(res.ok ? {} : { error: new Error(`Langfuse export: ${res.status}`) }),
        });
      })
      .catch((err) => {
        resultCallback({
          code: ExportResultCode.FAILED,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });

    this.pendingExports.push(exportPromise);
  }

  async shutdown() {
    await this.forceFlush();
  }

  async forceFlush() {
    const pending = this.pendingExports.splice(0);
    await Promise.allSettled(pending);
  }
}

const enrichSpan: EnrichSpan = ({ runtimeContext }) => {
  if (!runtimeContext) return undefined;
  const attrs: Record<string, string> = {};
  if (typeof runtimeContext.sessionId === "string") {
    attrs["langfuse.session.id"] = runtimeContext.sessionId;
  }
  if (typeof runtimeContext.userId === "string") {
    attrs["langfuse.user.id"] = runtimeContext.userId;
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
};

let provider: BasicTracerProvider | null = null;

export function initTelemetry(env: {
  LANGFUSE_PUBLIC_KEY: string;
  LANGFUSE_SECRET_KEY: string;
  LANGFUSE_BASE_URL?: string;
}) {
  if (provider) return provider;

  const exporter = new LangfuseFetchExporter({
    url: `${(env.LANGFUSE_BASE_URL ?? DEFAULT_LANGFUSE_BASE_URL).replace(/\/$/, "")}/api/public/otel/v1/traces`,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
  });

  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ "service.name": "chatbot" }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  registerTelemetry(
    new OpenTelemetry({
      tracer: provider.getTracer("gen_ai"),
      enrichSpan,
    })
  );

  return provider;
}

export function flushTelemetry(): Promise<void> {
  if (!provider) return Promise.resolve();
  return provider.forceFlush().catch(() => {});
}
