# evals Specification

## Purpose

Offline and online evaluation of the chatbot: Promptfoo suites run against the full stack and gate pull requests, with Braintrust, Langfuse scoring and Garak red teaming as extensions.

## Requirements

### Requirement: Full-stack eval provider
Evals SHALL call the running backend's `POST /api/chat` (base URL from `CHATBOT_URL`, default `http://localhost:8787`) with AI SDK UI messages, and SHALL use the concatenated streamed text as the output, so middleware, guardrails, tools and skills are all exercised.

#### Scenario: Backend not running
- **WHEN** the eval provider cannot reach `CHATBOT_URL`
- **THEN** the test case reports an error saying the chatbot could not be reached

#### Scenario: Stream error
- **WHEN** the stream contains an error chunk
- **THEN** the output includes `[Error: <message>]`

### Requirement: Three dataset suites
Test cases SHALL live in three datasets: safety (prompt injection, harmful content, jailbreaks and false-positive checks), quality (factual Q&A, coherence, edge cases) and tools (tool invocation correctness). `pnpm eval` SHALL run all suites, and `pnpm eval:safety`, `eval:quality` and `eval:tools` SHALL run one each.

#### Scenario: Single suite
- **WHEN** a developer runs `pnpm eval:safety` in `packages/evals`
- **THEN** only the safety test cases run

### Requirement: LLM-as-judge grading
LLM-graded assertions SHALL use `openai:gpt-4o-mini` by default. The grader SHALL be overridable at run time with promptfoo's `--grader` flag.

#### Scenario: Grader override
- **WHEN** evals run with `--grader openai:gpt-4.1`
- **THEN** rubric assertions are graded by that model

### Requirement: Pull request gate
A GitHub Actions workflow SHALL run on pull requests to `main` that touch `packages/backend`, `packages/frontend` or `packages/evals`. It SHALL build, start the backend with `GUARDRAIL_TIER=simple`, run each suite, fail when a pass rate drops below its threshold, and upload the results.

#### Scenario: Safety regression
- **WHEN** a pull request causes one safety test to fail
- **THEN** the workflow fails

### Requirement: Pass-rate thresholds
Safety SHALL require a 100% pass rate. Quality SHALL require at least 85%. Tool use SHALL require at least the configured threshold, which is currently 80% in the workflow.

#### Scenario: Quality variance tolerated
- **WHEN** 90% of quality tests pass
- **THEN** the quality step passes

### Requirement: Braintrust extension
`pnpm eval:braintrust` SHALL run the same dataset files through Braintrust, using `BRAINTRUST_API_KEY`.

#### Scenario: Shared datasets
- **WHEN** a test case is added to a dataset file
- **THEN** both the Promptfoo and Braintrust runners pick it up

### Requirement: Langfuse online scoring
`pnpm eval:langfuse` SHALL fetch recent production traces from Langfuse's v2 observations API, score them, and write the scores back to Langfuse. It SHALL exit with an error if Langfuse keys are missing.

#### Scenario: Missing keys
- **WHEN** `LANGFUSE_PUBLIC_KEY` is not set
- **THEN** the script exits non-zero with an explanatory message

### Requirement: Manual red teaming
Garak adversarial testing SHALL be documented as a manual step against the running chat API, not part of CI.

#### Scenario: CI run
- **WHEN** the eval workflow runs on a pull request
- **THEN** Garak is not invoked
