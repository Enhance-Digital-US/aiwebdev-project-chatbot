# tools Specification

## Purpose

Local server-side tools the model can call during a chat turn: weather lookup, unit conversion, and sandboxed code execution.

## Requirements

### Requirement: Local tool registry
The backend SHALL keep a registry of local tools. Each tool SHALL declare a description and a validated input schema. Adding a tool SHALL require a new tool module and one registry entry. Local tools SHALL run on the server with no user approval step.

#### Scenario: Registered tools
- **WHEN** a tool-capable model receives a request
- **THEN** `getWeather`, `convertUnits` and `executeCode` are among the offered tools

#### Scenario: Malformed tool input
- **WHEN** the model calls a tool with input that fails its schema
- **THEN** the call fails validation and the tool does not execute

### Requirement: Weather tool
`getWeather` SHALL accept `{ city }` and SHALL return `{ city, temperature, condition }`. It is a demo tool: values are simulated, with temperature between 5 and 39 and condition one of sunny, cloudy, rainy, snowy or windy.

#### Scenario: Weather request
- **WHEN** the model calls `getWeather` with `{ "city": "Tokyo" }`
- **THEN** the result contains `city: "Tokyo"`, a numeric temperature and a condition

### Requirement: Unit conversion tool
`convertUnits` SHALL accept `{ value, from, to }`, match unit names case-insensitively, support length (km, miles, meters, feet), temperature (celsius, fahrenheit, kelvin) and weight (kg, lbs, grams), and round results to 3 decimals.

#### Scenario: Supported conversion
- **WHEN** the model calls `convertUnits` with `{ "value": 5, "from": "miles", "to": "km" }`
- **THEN** the result is `8.047`

#### Scenario: Unsupported pair
- **WHEN** the model asks to convert from `kg` to `miles`
- **THEN** the tool returns a result string starting with `Error: cannot convert from kg to miles` instead of throwing

### Requirement: Code execution tool
`executeCode` SHALL accept `{ code, language }` with language `python` or `javascript` (default `javascript`) and SHALL return the code, language, stdout, stderr and exit code.

#### Scenario: JavaScript by default
- **WHEN** the model calls `executeCode` without a language
- **THEN** the code runs as JavaScript

### Requirement: Sandbox provider selection
`executeCode` SHALL run code in the provider named by `SANDBOX_PROVIDER`: `e2b` (requires `E2B_API_KEY`), `cloudflare` (requires the `SANDBOX` Durable Object binding), or a stub when unset. Each execution SHALL use a fresh sandbox that is destroyed afterwards, with a 15-second execution timeout.

#### Scenario: Stub provider
- **WHEN** `SANDBOX_PROVIDER` is unset
- **THEN** no code runs and stdout is a simulated message saying to set `SANDBOX_PROVIDER` for real execution

#### Scenario: Missing E2B key
- **WHEN** `SANDBOX_PROVIDER` is `e2b` and `E2B_API_KEY` is not set
- **THEN** the tool call fails with `E2B_API_KEY is not set`
