# Spec Delta

## MODIFIED Requirements

### Requirement: Model picker
The prompt input SHALL include a model selector. It SHALL always offer GPT-6 Luna (`gpt-6-luna`), the default, and SHALL offer Gemma 4 12B (`gemma4:12b`) only in development builds. The selected model ID SHALL be sent as `model` with each message.

#### Scenario: Production build
- **WHEN** the app runs from a production build
- **THEN** only GPT-6 Luna is offered

#### Scenario: Development build
- **WHEN** the app runs under the Vite dev server
- **THEN** both GPT-6 Luna and Gemma 4 12B are offered

### Requirement: Single chat page
The frontend SHALL serve the chat interface at `/` inside a root layout with a "Team Assistant" header showing the current conversation's title, and SHALL manage all chat state with the AI SDK `useChat` hook posting to `/api/chat`.

#### Scenario: Opening the app
- **WHEN** a signed-in user opens `/`
- **THEN** the chat page is shown with an empty state titled "What can I help you with?"

#### Scenario: Titled conversation
- **WHEN** the first answer of a conversation arrives with a title
- **THEN** the header shows that title

## ADDED Requirements

### Requirement: Suggestion chips
The UI SHALL show the latest answer's follow-up prompts as chips below it. Choosing a chip SHALL send it as the next message.

#### Scenario: Choose a suggestion
- **WHEN** the user clicks a suggestion chip
- **THEN** its text is sent as a new user message and the chips disappear until the next answer

### Requirement: Confirmation card
When a tool call needs the user's confirmation, the UI SHALL show a card with the server's message and approve and cancel actions, and SHALL send the user's answer back so the call can continue.

#### Scenario: Confirm a deletion
- **WHEN** the issue tracker asks to confirm deleting a project
- **THEN** a confirmation card shows its message, and approving it completes the deletion

#### Scenario: Cancel
- **WHEN** the user cancels
- **THEN** the call completes without the action, and the model is told it was cancelled

### Requirement: Workflow card
A bug-report workflow SHALL be shown as a card with its steps (redact, draft, dedupe, approval, file) and their states, the draft once available, possible duplicates, approve/edit/reject actions while waiting, and the filed issue's link or final status.

#### Scenario: Waiting for approval
- **WHEN** the workflow reaches the approval step
- **THEN** the card shows the draft, any duplicates, and the approve, edit and reject actions

#### Scenario: Card survives refresh
- **WHEN** the page is refreshed while the workflow runs
- **THEN** the card for that instance can be restored from its instance id and shows the current state

### Requirement: Cost meter
The header SHALL show the conversation's running token total and estimated cost, updated after each answer.

#### Scenario: Meter after an answer
- **WHEN** an answer finishes
- **THEN** the meter shows the new totals
