import type { AppEnv } from "../types";
import type { CredentialSource } from "../mcp/credentials";
import { chatOwner } from "../chats/store";
import { decrypt, encrypt } from "./crypto";
import { discover, OAuthError, requestToken, type TokenSet } from "./client";

type Bindings = AppEnv["Bindings"];

/** Refresh this long before the access token's real expiry, so a call never races it. */
const EXPIRY_MARGIN_MS = 60_000;

export interface StoredTokens extends TokenSet {
  clientId: string;
  /** The stored ciphertext, to tell whether another request has rotated the row since. */
  sealedRefreshToken: string | null;
}

interface TokenRow {
  client_id: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: number;
}

// Bound to the owner, so a row copied to another user's id won't decrypt.
const context = (owner: string, kind: "access" | "refresh") => `issue-tracker:${kind}:${owner}`;

export async function saveTokens(
  env: Bindings,
  owner: string,
  clientId: string,
  tokens: TokenSet,
  now = Date.now()
): Promise<void> {
  const key = env.TOKEN_ENCRYPTION_KEY;
  await env.DB.prepare(
    `INSERT INTO issue_tracker_tokens (user_id, client_id, access_token_enc, refresh_token_enc, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET client_id = excluded.client_id,
       access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
       expires_at = excluded.expires_at, updated_at = excluded.updated_at`
  )
    .bind(
      owner,
      clientId,
      await encrypt(key, tokens.accessToken, context(owner, "access")),
      tokens.refreshToken ? await encrypt(key, tokens.refreshToken, context(owner, "refresh")) : null,
      tokens.expiresAt,
      now
    )
    .run();
}

/** The owner's tokens, or null if they haven't connected. */
export async function loadTokens(env: Bindings, owner: string): Promise<StoredTokens | null> {
  const row = await env.DB.prepare(
    "SELECT client_id, access_token_enc, refresh_token_enc, expires_at FROM issue_tracker_tokens WHERE user_id = ?"
  )
    .bind(owner)
    .first<TokenRow>();
  if (!row) return null;
  const key = env.TOKEN_ENCRYPTION_KEY;
  return {
    clientId: row.client_id,
    accessToken: await decrypt(key, row.access_token_enc, context(owner, "access")),
    refreshToken: row.refresh_token_enc
      ? await decrypt(key, row.refresh_token_enc, context(owner, "refresh"))
      : undefined,
    sealedRefreshToken: row.refresh_token_enc,
    expiresAt: row.expires_at,
  };
}

/** Disconnects the owner; with `onlyIf`, only if the row still holds that refresh token. */
export async function deleteTokens(db: D1Database, owner: string, onlyIf?: string | null): Promise<void> {
  if (onlyIf === undefined) {
    await db.prepare("DELETE FROM issue_tracker_tokens WHERE user_id = ?").bind(owner).run();
  } else {
    await db
      .prepare("DELETE FROM issue_tracker_tokens WHERE user_id = ? AND refresh_token_enc IS ?")
      .bind(owner, onlyIf)
      .run();
  }
}

export async function isConnected(db: D1Database, owner: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM issue_tracker_tokens WHERE user_id = ?").bind(owner).first()) !== null;
}

/**
 * A valid access token for the owner, refreshing it if it has expired; null
 * when they aren't connected or the refresh token no longer works (7 days old,
 * or the persona's password changed), so they're offered to connect again.
 */
export async function accessTokenFor(
  env: Bindings,
  owner: string,
  resource: string,
  now = Date.now
): Promise<string | null> {
  const stored = await loadTokens(env, owner);
  if (!stored) return null;
  if (now() < stored.expiresAt - EXPIRY_MARGIN_MS) return stored.accessToken;
  if (!stored.refreshToken) {
    await deleteTokens(env.DB, owner, null);
    return null;
  }

  try {
    const fresh = await requestToken(
      await discover(resource),
      { grant_type: "refresh_token", refresh_token: stored.refreshToken, client_id: stored.clientId, resource },
      now()
    );
    // Keep the old refresh token if the server didn't rotate it.
    await saveTokens(env, owner, stored.clientId, { ...fresh, refreshToken: fresh.refreshToken ?? stored.refreshToken }, now());
    return fresh.accessToken;
  } catch (error) {
    if (!(error instanceof OAuthError && error.code === "invalid_grant")) throw error;
    // A concurrent request (a chat turn and a workflow step) may have just
    // rotated the refresh token we used; then its result is good.
    const current = await loadTokens(env, owner);
    if (current && current.sealedRefreshToken !== stored.sealedRefreshToken) return current.accessToken;
    await deleteTokens(env.DB, owner, stored.sealedRefreshToken);
    return null;
  }
}

/** Per-user credentials from the OAuth connection (design §5, deployed). */
export function createOAuthSource({ resource, now }: { resource: string; now?: () => number }): CredentialSource {
  return async ({ env, userId, local }) => {
    const owner = chatOwner(userId, local);
    if (!owner) return null;
    const token = await accessTokenFor(env, owner, resource, now);
    return token ? { authorization: `Bearer ${token}` } : null;
  };
}
