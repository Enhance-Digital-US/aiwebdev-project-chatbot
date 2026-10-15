import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Cloudflare Access sits in front of the Worker and enforces login (Clerk is
 * the OIDC identity provider). Requests it lets through carry a signed
 * `Cf-Access-Jwt-Assertion` header. We only *read* identity from it, to label
 * Langfuse traces — enforcement already happened at the edge.
 */
export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

export type AccessConfig = {
  /** e.g. "https://enhancedigital.cloudflareaccess.com" — the JWT `iss` */
  teamDomain: string;
  /** Access application AUD tag — the JWT `aud` */
  audience: string;
};

// One JWKS per team domain, kept across requests in the isolate so keys are
// fetched once and re-fetched only on rotation (jose handles the caching).
const jwksByTeam = new Map<string, JWTVerifyGetKey>();

export function getAccessJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain));
    jwksByTeam.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verify an Access JWT and return the user id to attribute traces to, or null
 * if the token has no user identity (e.g. a service token). Throws if the
 * signature, issuer, audience, or expiry is invalid.
 */
export async function verifyAccessUser(
  token: string,
  config: AccessConfig,
  jwks: JWTVerifyGetKey = getAccessJwks(config.teamDomain),
): Promise<string | null> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.teamDomain.replace(/\/$/, ""),
    audience: config.audience,
  });

  // Email is human-readable in the Langfuse Users view; Access keys identities
  // by email, so it is as stable as the Access user itself. Fall back to `sub`
  // for identities without an email. Service tokens have neither (sub is "").
  if (typeof payload.email === "string" && payload.email) return payload.email;
  if (typeof payload.sub === "string" && payload.sub) return payload.sub;
  return null;
}
