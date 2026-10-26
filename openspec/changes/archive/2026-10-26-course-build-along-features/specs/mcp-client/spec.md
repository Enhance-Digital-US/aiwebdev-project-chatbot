# Spec Delta

## MODIFIED Requirements

### Requirement: Static server list
The backend SHALL read MCP servers from a static list in code, each with a name, a Streamable HTTP URL, an enabled flag and optional headers or a credential source. Only enabled servers SHALL be contacted. The list SHALL include `cf-docs` (`https://docs.mcp.cloudflare.com/mcp`), `deepwiki` (`https://mcp.deepwiki.com/mcp`), and `issue-tracker` (the course's issue-tracker MCP server for the current environment).

#### Scenario: Disabled server
- **WHEN** a server entry has `enabled: false`
- **THEN** no request is made to it

#### Scenario: Issue tracker locally
- **WHEN** the backend runs in local development
- **THEN** the `issue-tracker` entry points at `http://localhost:8787/mcp`

#### Scenario: Issue tracker when deployed
- **WHEN** the backend runs in production
- **THEN** the `issue-tracker` entry points at the hosted tracker, `https://issue-tracker-mcp-production.enhancedigital.workers.dev/mcp`, set per environment as `ISSUE_TRACKER_URL`

## ADDED Requirements

### Requirement: Issue tracker credentials in development
In local development, the backend SHALL obtain an issue-tracker access token on demand from the server's development-only token endpoint, for a persona set in configuration (default `user-bob`, role `member`). It SHALL request a new token rather than reuse one past its expiry.

#### Scenario: Default persona
- **WHEN** the backend calls an issue-tracker tool locally without persona configuration
- **THEN** the call is made with a fresh token for `user-bob` with role `member`

#### Scenario: Viewer persona
- **WHEN** the configured persona is `user-carol`
- **THEN** read tools succeed and `create_issue` is refused by the server

### Requirement: Issue tracker credentials when deployed
In a deployed environment, each user SHALL connect the issue tracker with a browser login as one of its personas. The chatbot SHALL register as an OAuth client by Client ID Metadata Document, falling back to dynamic client registration. It SHALL keep each user's refresh token server-side and send a valid access token with their issue-tracker calls. A user who hasn't connected SHALL be told how to connect, not shown an error.

#### Scenario: Not yet connected
- **WHEN** a deployed user's request would use an issue-tracker tool before they have connected
- **THEN** the issue-tracker tools are unavailable and the assistant offers a "connect issue tracker" link

#### Scenario: Expired access token
- **WHEN** a connected user's access token has expired but their refresh token is valid
- **THEN** the chatbot refreshes it and the call succeeds

#### Scenario: Tokens never reach the browser
- **WHEN** a user has connected the issue tracker
- **THEN** no access or refresh token is sent to the browser

### Requirement: Multi-round-trip elicitation
When a server answers a tool call with an input-required result for an elicitation, the client SHALL ask the user through the chat UI and retry the call with the user's response, instead of failing the call. Input requests other than elicitation SHALL still fail the call with an error the model can read.

#### Scenario: Confirmation requested
- **WHEN** `delete_project` returns an input-required result asking to confirm
- **THEN** the user sees a confirmation card, and the call is retried with their answer

#### Scenario: Unsupported input request
- **WHEN** a server asks for a kind of input the client doesn't support
- **THEN** the tool call fails with an error naming the unsupported request
