# chat-ui Specification

## Purpose

The single-page React chat interface that sends messages to the chat API, lets the user pick a model, and renders streamed text, reasoning, tool calls and code execution.

## Requirements

### Requirement: Single chat page
The frontend SHALL serve the chat interface at `/` inside a root layout with a "Chatbot" header, and SHALL manage all chat state with the AI SDK `useChat` hook posting to `/api/chat`.

#### Scenario: Opening the app
- **WHEN** a signed-in user opens `/`
- **THEN** the chat page is shown with an empty state titled "What can I help you with?"

### Requirement: Model picker
The prompt input SHALL include a model selector. It SHALL always offer GPT-4o Mini (`gpt-4o-mini`), the default, and SHALL offer Gemma 4 12B (`gemma4:12b`) only in development builds. The selected model ID SHALL be sent as `model` with each message.

#### Scenario: Production build
- **WHEN** the app runs from a production build
- **THEN** only GPT-4o Mini is offered

#### Scenario: Development build
- **WHEN** the app runs under the Vite dev server
- **THEN** both GPT-4o Mini and Gemma 4 12B are offered

### Requirement: Message part rendering
Each message SHALL render its parts in order: `text` as formatted markdown, `reasoning` as a collapsible trace, `tool-executeCode` as a code sandbox, other `tool-*` parts and `dynamic-tool` parts as a tool invocation. Unknown part types SHALL render nothing.

#### Scenario: Reasoning while streaming
- **WHEN** a reasoning part is still streaming
- **THEN** the reasoning trace shows as in progress and the final text renders below it

#### Scenario: MCP tool call
- **WHEN** a message contains a `dynamic-tool` part named `cf-docs_search_docs`
- **THEN** a tool invocation shows that namespaced name, its input, and its output

### Requirement: Tool invocation display
A tool invocation SHALL show the tool name, its status, its input, and its output or error text. It SHALL start collapsed and SHALL expand automatically once the tool reaches `output-available` or `output-error`.

#### Scenario: Tool completes
- **WHEN** a tool part moves to `output-available`
- **THEN** the invocation expands to show the output

### Requirement: Code execution display
An `executeCode` tool part SHALL render as a sandbox panel labelled Python or JavaScript, showing the code and, once complete, its stdout and stderr.

#### Scenario: Python execution
- **WHEN** the model runs Python code through `executeCode`
- **THEN** a "Python" sandbox panel shows the code and its output

### Requirement: Conversation controls
The conversation SHALL offer a scroll-to-bottom button and, once there is at least one message, a download button for the conversation. The submit button SHALL reflect the streaming status.

#### Scenario: Download available
- **WHEN** the conversation has messages
- **THEN** a download button is shown

### Requirement: No in-app authentication
The frontend MUST NOT contain sign-in UI or auth code. It SHALL rely on same-origin requests carrying the edge session cookie.

#### Scenario: API call credentials
- **WHEN** the page posts to `/api/chat`
- **THEN** the request sends no auth header and relies on the browser's same-origin cookie
