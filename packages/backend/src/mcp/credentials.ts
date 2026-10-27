import type { AppEnv } from "../types";

export interface CredentialContext {
  env: AppEnv["Bindings"];
  /** Cloudflare Access user (email or sub); null locally. */
  userId: string | null;
  /** True under `wrangler dev` (request host is localhost). */
  local: boolean;
}

/**
 * Supplies per-request auth headers for one MCP server. Returning null means
 * "no credential available": the server is skipped for this request.
 */
export type CredentialSource = (ctx: CredentialContext) => Promise<Record<string, string> | null>;

/** The issue tracker's simulated personas and the role each one's token carries. */
export const PERSONA_ROLES: Record<string, "admin" | "member" | "viewer"> = {
  "user-alice": "admin",
  "user-bob": "member",
  "user-carol": "viewer",
};

export const DEFAULT_PERSONA = "user-bob";

/** Re-mint this long before the token's real expiry, so a call never races it. */
const EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Development-only credentials: mints a token for the configured persona from
 * the issue tracker's `POST /auth/dev-token` and caches it (per isolate) until
 * shortly before it expires. The endpoint exists only in the tracker's
 * development environment, so this source is only used when running locally.
 */
export function createDevTokenSource({
  tokenUrl,
  now = Date.now,
}: {
  tokenUrl: string;
  now?: () => number;
}): CredentialSource {
  const cache = new Map<string, CachedToken>();

  return async ({ env, local }) => {
    if (!local) return null;

    const persona = env.ISSUE_TRACKER_PERSONA ?? DEFAULT_PERSONA;
    const role = PERSONA_ROLES[persona];
    if (!role) throw new Error(`Unknown ISSUE_TRACKER_PERSONA "${persona}"`);

    const cached = cache.get(persona);
    if (cached && now() < cached.expiresAt - EXPIRY_MARGIN_MS) {
      return { authorization: `Bearer ${cached.token}` };
    }

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sub: persona, scope: role }),
    });
    if (!res.ok) throw new Error(`dev-token for ${persona} → HTTP ${res.status}`);
    const { access_token, expires_in } = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    cache.set(persona, { token: access_token, expiresAt: now() + expires_in * 1000 });
    return { authorization: `Bearer ${access_token}` };
  };
}
