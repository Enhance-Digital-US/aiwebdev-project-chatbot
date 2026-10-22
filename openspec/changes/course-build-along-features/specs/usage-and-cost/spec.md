# Spec Delta

## Purpose

Shows what each conversation costs and keeps that cost bounded: per-message token usage, an estimated price, a hard token cap per conversation, and caching of repeated requests.

## ADDED Requirements

### Requirement: Per-message usage
Each assistant message SHALL carry its token usage: input, output, reasoning and cached input tokens, summed over every model step it took.

#### Scenario: Multi-step answer
- **WHEN** an answer took two tool steps and a final response
- **THEN** its usage is the sum of all three steps

### Requirement: Cost estimate
The system SHALL estimate each message's cost from a per-model price table, and the UI SHALL show the conversation's running total of tokens and estimated cost.

#### Scenario: Meter updates
- **WHEN** a new answer finishes streaming
- **THEN** the conversation's cost meter increases by that answer's estimate

#### Scenario: Model without a price
- **WHEN** a model has no entry in the price table (e.g. a local model)
- **THEN** its tokens are counted and its cost is shown as unknown, not as zero

### Requirement: Per-conversation token cap
The backend SHALL refuse a new request once the conversation's stored token total reaches a configured cap, with an error the UI shows plainly.

#### Scenario: Cap reached
- **WHEN** a conversation's total has reached the cap and the user sends another message
- **THEN** no model call is made, and the UI says the conversation's token budget is used up

### Requirement: Cached repeats
Requests eligible for gateway caching SHALL be served from the cache when repeated, and cached tokens SHALL be reported as such.

#### Scenario: Repeated prompt
- **WHEN** the same eligible request is sent twice
- **THEN** the second response reports cached tokens, and its estimated cost is lower
