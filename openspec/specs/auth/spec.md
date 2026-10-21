# auth Specification

## Purpose

Restricts the deployed app to signed-in users through Cloudflare Zero Trust Access at the edge, and lets the Worker read the verified user identity for tracing.

## Requirements

### Requirement: Edge-enforced login
Login SHALL be enforced by a Cloudflare Zero Trust Access self-hosted application on `chatbot.course-projects.ai-web.dev`, with Clerk as its OIDC identity provider, covering every path including `/api/*`. The app itself MUST NOT implement sign-in.

#### Scenario: Unauthenticated visit
- **WHEN** a visitor without an Access session opens the production URL
- **THEN** Cloudflare Access redirects them to sign in before any app asset or API is served

### Requirement: No bypass hostnames
The Worker's `workers.dev` URL and preview URLs MUST be disabled, because Access protects only the custom hostname.

#### Scenario: workers.dev request
- **WHEN** someone requests the Worker's `workers.dev` hostname
- **THEN** the Worker is not reachable there

### Requirement: Access JWT verification
When a request carries `Cf-Access-Jwt-Assertion` and both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, the Worker SHALL verify the JWT's signature against the team's JWKS (`<team>/cdn-cgi/access/certs`), its issuer against `ACCESS_TEAM_DOMAIN` and its audience against `ACCESS_AUD`.

#### Scenario: Valid token
- **WHEN** a request carries a valid Access JWT for the configured team and audience
- **THEN** the request is attributed to the token's user

#### Scenario: Wrong audience
- **WHEN** the JWT's audience does not match `ACCESS_AUD`
- **THEN** verification fails

### Requirement: User identity for tracing
The verified user ID SHALL be the JWT `email` claim, else its `sub` claim, else none (for example, service tokens). This identity SHALL be used only to label traces, not to authorize requests.

#### Scenario: Identity without email
- **WHEN** a valid JWT has no `email` but has `sub`
- **THEN** the user ID is the `sub` value

### Requirement: Anonymous fallback
A request without the Access header, or whose JWT fails verification, SHALL proceed as anonymous. A verification failure SHALL be logged as a warning. No JWKS fetch SHALL happen for requests without the header.

#### Scenario: Local development
- **WHEN** a request reaches `wrangler dev` without an Access header
- **THEN** it is served anonymously with no JWKS request

#### Scenario: Invalid token
- **WHEN** a request carries an expired Access JWT
- **THEN** the request is served anonymously and a warning is logged

### Requirement: JWKS caching
The JWKS for each team domain SHALL be reused across requests within an isolate and re-fetched only when keys rotate.

#### Scenario: Repeated requests
- **WHEN** many authenticated requests hit one isolate
- **THEN** the JWKS is fetched once
