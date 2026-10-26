# chat-persistence Specification

## Purpose

Keeps conversations across reloads and devices for each signed-in user, lists them in a history sidebar, and reconnects each conversation to the workflows it started.

## Requirements

### Requirement: Conversations are stored per user
Every conversation SHALL be stored with its messages, title and owner. Users SHALL only be able to read and continue their own conversations. In local development, without an identity, all conversations belong to one local user.

#### Scenario: Reload restores the conversation
- **WHEN** a user reloads the page on an existing conversation
- **THEN** every message, including tool, reasoning and workflow parts, is shown again

#### Scenario: Another user's conversation
- **WHEN** a deployed user requests a conversation they don't own
- **THEN** the request is refused

### Requirement: History sidebar
The UI SHALL list the user's conversations by title, most recent first, grouped by day, and SHALL let them open one or start a new conversation.

#### Scenario: Open a past conversation
- **WHEN** a user picks a conversation in the sidebar
- **THEN** it opens with its messages, and new messages continue it

#### Scenario: New conversation
- **WHEN** a user starts a new conversation
- **THEN** an empty conversation opens, and it appears in the sidebar once it has a title

### Requirement: Workflows reconnect to their conversation
Each workflow instance started from a conversation SHALL be linked to it, so reopening the conversation shows the instance's current status.

#### Scenario: Pending approval after reopening
- **WHEN** a user reopens a conversation whose bug-report workflow is waiting for approval
- **THEN** the approval card is shown and still accepts a decision
