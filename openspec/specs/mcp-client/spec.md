# mcp-client Specification

## Purpose

Connects the backend to external MCP servers over Streamable HTTP and exposes their tools to the model alongside local tools, without letting a broken server break the chat.

## Requirements

### Requirement: Static server list
The backend SHALL read MCP servers from a static list in code, each with a name, a Streamable HTTP URL, an enabled flag and optional headers. Only enabled servers SHALL be contacted. The list SHALL include `cf-docs` (`https://docs.mcp.cloudflare.com/mcp`) and `deepwiki` (`https://mcp.deepwiki.com/mcp`).

#### Scenario: Disabled server
- **WHEN** a server entry has `enabled: false`
- **THEN** no request is made to it

### Requirement: Namespaced remote tools
Every remote tool SHALL be exposed to the model as `${serverName}_${toolName}` so it cannot collide with local tools or another server's tools. MCP tools SHALL run without a user approval step.

#### Scenario: Cloudflare docs search tool
- **WHEN** the `cf-docs` server advertises `search_docs`
- **THEN** the model sees a tool named `cf-docs_search_docs`

### Requirement: Swappable client implementation
The backend SHALL provide two MCP client implementations behind one interface, selected by `MCP_IMPL`: `raw` (default, a hand-rolled client that works on Workers) and `ai-sdk` (the `@ai-sdk/mcp` client, which works only under Node).

#### Scenario: Default implementation
- **WHEN** `MCP_IMPL` is unset
- **THEN** the raw client is used

### Requirement: Dual-era protocol negotiation
The raw client SHALL first speak stateless MCP `2026-07-28`, sending protocol version and client info in each request's `_meta` plus `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*` headers. If the server rejects that with a non-modern error, it SHALL fall back to `2025-11-25` with `initialize` and `Mcp-Session-Id`.

#### Scenario: Legacy server
- **WHEN** a server such as DeepWiki rejects the stateless request with an error that is not a modern MCP error
- **THEN** the client initializes a legacy session and lists tools through it

#### Scenario: Server error is not a fallback signal
- **WHEN** the modern request fails with HTTP 5xx
- **THEN** the client reports the failure instead of retrying as legacy

### Requirement: Legacy era caching
The raw client SHALL remember servers found to be legacy for the lifetime of the Worker isolate and SHALL skip the modern probe for them. If a legacy connection fails, it SHALL forget that server's era so the next request probes again.

#### Scenario: Second request to a legacy server
- **WHEN** a legacy server is contacted again in the same isolate
- **THEN** the client goes straight to the legacy handshake

### Requirement: Response formats
The raw client SHALL accept JSON-RPC responses delivered either as `application/json` or as a `text/event-stream` body.

#### Scenario: SSE response
- **WHEN** a server answers `tools/list` with an SSE stream
- **THEN** the client reads the JSON-RPC result from the stream's data events

### Requirement: Failure isolation
Servers SHALL be connected in parallel, each with a 5-second connect and tool-list timeout. A server that fails or times out SHALL be logged and skipped; the chat MUST continue with the remaining tools.

#### Scenario: One server down
- **WHEN** one MCP server is unreachable
- **THEN** the chat still answers using local tools and the other servers' tools, and the failure is logged

### Requirement: Tool call errors surfaced to the model
When a remote tool call fails or returns `isError`, the client SHALL raise a descriptive error so the model receives a tool-error result and can recover.

#### Scenario: Remote tool reports an error
- **WHEN** `tools/call` returns `isError: true` with text content
- **THEN** the model receives a tool error containing the server name, tool name and that text

### Requirement: Connection teardown
After the response stream ends, the backend SHALL close MCP connections in the background without delaying the stream. Legacy sessions SHALL be ended with an HTTP `DELETE`; close errors SHALL be ignored.

#### Scenario: Stream finishes
- **WHEN** a chat stream completes
- **THEN** open MCP sessions are closed after the response has been delivered
