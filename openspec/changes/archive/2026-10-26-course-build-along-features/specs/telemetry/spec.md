# Spec Delta

## MODIFIED Requirements

### Requirement: Function naming per model
Each trace SHALL be named by the selected model's telemetry ID: `openai-chat` for `gpt-6-luna` and `ollama-chat` for `gemma4:12b`.

#### Scenario: OpenAI trace name
- **WHEN** a request uses `gpt-6-luna`
- **THEN** the trace's function ID is `openai-chat`
