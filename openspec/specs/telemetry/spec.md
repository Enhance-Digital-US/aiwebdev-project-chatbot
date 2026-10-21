# telemetry Specification

## Purpose

Traces every model call to Langfuse over OpenTelemetry, with model, token usage, prompts, completions and tool calls, grouped by chat session and user, in a way that works inside Cloudflare Workers.

## Requirements

### Requirement: Langfuse OTLP export
The backend SHALL export AI SDK `gen_ai.*` spans to `<LANGFUSE_BASE_URL>/api/public/otel/v1/traces` (default base `https://us.cloud.langfuse.com`) using `fetch`, Basic auth built from `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`, and the header `x-langfuse-ingestion-version: 4`.

#### Scenario: Trace for a chat turn
- **WHEN** a chat request completes
- **THEN** Langfuse receives a trace with the model name, input and output token counts, prompt and completion

### Requirement: Lazy idempotent initialization
Telemetry SHALL be initialized on the first `/api/*` request, because Worker bindings are not available at module scope. Later calls SHALL be no-ops. Spans SHALL carry the resource attribute `service.name: chatbot`.

#### Scenario: Repeated requests
- **WHEN** several requests hit the same isolate
- **THEN** only one tracer provider is created

### Requirement: Immediate span export
Each span SHALL be exported as soon as it ends, with no batching timers, because Worker isolates are short-lived.

#### Scenario: Span ends
- **WHEN** a model-call span ends
- **THEN** its export request starts without waiting for a batch

### Requirement: Flush after stream end
Pending exports SHALL be flushed after the response stream finishes, not when the response object is created, so spans carry full token usage. The flush SHALL run in the background via `waitUntil`, and flush errors SHALL be ignored.

#### Scenario: Token counts present
- **WHEN** a streamed reply finishes
- **THEN** the exported generation has non-zero output token usage

### Requirement: Sessions and users
Every span SHALL carry `langfuse.session.id` set to the chat ID when one was accepted, and `langfuse.user.id` set to the authenticated user when one was identified. Missing values SHALL leave the attribute off.

#### Scenario: Anonymous local request
- **WHEN** a request arrives with no Cloudflare Access JWT
- **THEN** spans have no `langfuse.user.id`

#### Scenario: Conversation grouping
- **WHEN** several messages are sent in one chat
- **THEN** their traces share the same `langfuse.session.id`

### Requirement: Function naming per model
Each trace SHALL be named by the selected model's telemetry ID: `openai-chat` for `gpt-4o-mini` and `ollama-chat` for `gemma4:12b`.

#### Scenario: OpenAI trace name
- **WHEN** a request uses `gpt-4o-mini`
- **THEN** the trace's function ID is `openai-chat`
