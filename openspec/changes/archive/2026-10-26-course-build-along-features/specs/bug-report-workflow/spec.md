# Spec Delta

## Purpose

Turns an error log pasted into the chat into a filed bug report through a durable workflow that survives refreshes, crashes and deploys, waits for the user's approval, and files exactly one issue.

## ADDED Requirements

### Requirement: Starting a bug report
The model SHALL have a `fileBugReport` tool that takes a pasted log (at most 20,000 characters) and an optional note, starts one workflow instance, and returns its instance id without waiting for it to finish.

#### Scenario: User asks to file a log
- **WHEN** a user pastes a stack trace and asks the assistant to file it as a bug
- **THEN** the model calls `fileBugReport`, and the chat shows a workflow card for the new instance

#### Scenario: Oversized log
- **WHEN** the log exceeds 20,000 characters
- **THEN** the tool call is rejected with an error the model can relay, and no instance starts

### Requirement: Secrets are redacted before any model sees the log
The workflow's first step SHALL mask API keys, bearer tokens, email addresses and IP addresses in the log deterministically, without a model call. Later steps SHALL see only the redacted log.

#### Scenario: Log with a key
- **WHEN** the pasted log contains `Authorization: Bearer sk-abc123…`
- **THEN** the drafted bug report and the filed issue contain a masked placeholder, not the key

### Requirement: Structured bug draft
The workflow SHALL draft the report as structured output matching a schema with a title, summary, steps to reproduce, severity and component. A draft that fails the schema SHALL be retried by the workflow, not filed.

#### Scenario: Valid draft
- **WHEN** the draft step completes
- **THEN** its output has every schema field, and the workflow card shows the title and severity

### Requirement: Duplicate check
Before asking for approval, the workflow SHALL search the issue tracker for issues similar to the draft's title and show any candidates on the approval card.

#### Scenario: Similar issue exists
- **WHEN** an open issue with a closely matching title exists
- **THEN** the approval card lists it as a possible duplicate

### Requirement: Durable approval
The workflow SHALL pause until the user approves, edits and approves, or rejects the draft, for up to 24 hours. The pause SHALL survive page refreshes, Worker restarts and deploys. Only the user who started the instance SHALL be able to decide; in local development, where there is no signed-in identity, any caller may.

#### Scenario: Refresh while waiting
- **WHEN** the user refreshes the page while the workflow waits for approval
- **THEN** the workflow is still waiting, and its status can be read by instance id

#### Scenario: Reject
- **WHEN** the user rejects the draft
- **THEN** the workflow ends with status `rejected` and nothing is filed

#### Scenario: Timeout
- **WHEN** 24 hours pass without a decision
- **THEN** the workflow ends with status `expired` and nothing is filed

#### Scenario: Another user decides
- **WHEN** a deployed user who did not start the instance submits a decision
- **THEN** the decision is refused

### Requirement: Filing exactly once
The filing step SHALL create the issue with the workflow instance id as its idempotency key, so a retried filing step returns the already-created issue instead of creating another.

#### Scenario: Filing step retried
- **WHEN** the filing step fails after the issue was created and is retried
- **THEN** the issue tracker contains exactly one issue for that instance, and the workflow ends with that issue's link

### Requirement: Permission refusal is final
If the issue tracker refuses to create the issue because of the caller's role, the workflow SHALL end with status `not-permitted` and SHALL NOT retry.

#### Scenario: Viewer approves
- **WHEN** the approving persona is a `viewer`
- **THEN** the workflow ends `not-permitted` after one filing attempt, and the card explains that viewers cannot file issues

### Requirement: Status endpoint
The backend SHALL expose each instance's status, current step, draft and result by instance id, and accept the approval decision for it.

#### Scenario: Card polls status
- **WHEN** the workflow card requests the status of a running instance
- **THEN** it receives the current step and, once drafted, the draft
