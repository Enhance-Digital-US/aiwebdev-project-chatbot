/**
 * The OAuth client side of connecting the issue tracker (design §9): MCP
 * authorization discovery, client registration (CIMD, else DCR), and the
 * token endpoint. Public client: PKCE, no client secret.
 */

export interface AuthServer {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  supportsCimd: boolean;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ms since epoch */
  expiresAt: number;
}

/** A token endpoint refusal, e.g. `invalid_grant` for an expired refresh token. */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    description?: string
  ) {
    super(description ? `${code}: ${description}` : code);
  }
}

const CLIENT_NAME = "Team Assistant";
const servers = new Map<string, Promise<AuthServer>>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Protected resource metadata (RFC 9728) → authorization server metadata
 * (RFC 8414). Cached per isolate; a failure isn't cached.
 */
export function discover(resource: string): Promise<AuthServer> {
  let server = servers.get(resource);
  if (!server) {
    server = (async () => {
      const { origin, pathname } = new URL(resource);
      const prm = await getJson<{ authorization_servers?: string[] }>(
        `${origin}/.well-known/oauth-protected-resource${pathname}`
      );
      const issuer = prm.authorization_servers?.[0];
      if (!issuer) throw new Error(`${resource} names no authorization server`);
      const meta = await getJson<Record<string, unknown>>(
        new URL("/.well-known/oauth-authorization-server", issuer).toString()
      );
      return {
        issuer: String(meta.issuer),
        authorizationEndpoint: String(meta.authorization_endpoint),
        tokenEndpoint: String(meta.token_endpoint),
        registrationEndpoint: meta.registration_endpoint ? String(meta.registration_endpoint) : undefined,
        supportsCimd: meta.client_id_metadata_document_supported === true,
      };
    })();
    servers.set(resource, server);
    server.catch(() => servers.delete(resource));
  }
  return server;
}

/** The Client ID Metadata Document served at `clientMetadataUrl(appUrl)`. */
export function clientMetadata(appUrl: string) {
  return {
    client_id: clientMetadataUrl(appUrl),
    client_name: CLIENT_NAME,
    client_uri: appUrl,
    redirect_uris: [callbackUrl(appUrl)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export const clientMetadataUrl = (appUrl: string) => new URL("/oauth/client-metadata.json", appUrl).toString();
export const callbackUrl = (appUrl: string) => new URL("/oauth/callback", appUrl).toString();

/**
 * The client id to authorize with. CIMD needs the server to fetch our metadata
 * URL, so it's only used when that URL is public https; otherwise (local
 * development) the client registers dynamically, getting a new id each time.
 */
export async function clientIdFor(server: AuthServer, appUrl: string): Promise<string> {
  const { protocol, hostname } = new URL(appUrl);
  const publicUrl = protocol === "https:" && hostname !== "localhost" && hostname !== "127.0.0.1";
  if (server.supportsCimd && publicUrl) return clientMetadataUrl(appUrl);
  if (!server.registrationEndpoint) throw new Error("The issue tracker supports neither CIMD for this URL nor DCR");

  // RFC 7591: the same metadata, minus the id the server assigns.
  const { client_id: _, ...registration } = clientMetadata(appUrl);
  const res = await fetch(server.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registration),
  });
  if (!res.ok) throw new Error(`Client registration → HTTP ${res.status}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

/** PKCE (RFC 7636): a random verifier and its S256 challenge. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export const randomState = () => base64url(crypto.getRandomValues(new Uint8Array(16)));

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function authorizationUrl(
  server: AuthServer,
  p: { clientId: string; redirectUri: string; challenge: string; state: string; resource: string }
): string {
  const url = new URL(server.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state,
    // RFC 8707: the token's audience must be the tracker's MCP endpoint.
    resource: p.resource,
  }).toString();
  return url.toString();
}

/** POSTs a grant to the token endpoint; a refusal throws OAuthError. */
export async function requestToken(
  server: AuthServer,
  grant: Record<string, string>,
  now = Date.now()
): Promise<TokenSet> {
  const res = await fetch(server.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(grant),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") {
    if (typeof body.error === "string") throw new OAuthError(body.error, body.error_description as string | undefined);
    throw new Error(`Token endpoint → HTTP ${res.status}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresAt: now + Number(body.expires_in ?? 3600) * 1000,
  };
}
