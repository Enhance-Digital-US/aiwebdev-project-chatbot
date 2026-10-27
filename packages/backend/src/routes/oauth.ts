import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { chatOwner } from "../chats/store";
import { issueTrackerResource } from "../mcp/config";
import { decrypt, encrypt } from "../oauth/crypto";
import {
  authorizationUrl,
  callbackUrl,
  clientIdFor,
  clientMetadata,
  discover,
  pkce,
  randomState,
  requestToken,
} from "../oauth/client";
import { deleteTokens, saveTokens } from "../oauth/tokens";

/**
 * Connecting the issue tracker (design §9). Mounted at /oauth, outside /api,
 * so the client metadata URL can get its own Access bypass.
 */
const app = new Hono<AppEnv>();

const STATE_COOKIE = "issue_tracker_oauth";
const STATE_CONTEXT = "oauth-state";
const STATE_TTL_S = 600;

/** What /connect remembers for /callback, sealed in a cookie. */
interface PendingLogin {
  state: string;
  verifier: string;
  clientId: string;
  issuer: string;
  owner: string;
  returnTo: string;
  expiresAt: number;
}

/** A path on this site, never another origin (`//evil.example`). */
export function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

function ownerOf(c: Context<AppEnv>): string | null {
  return chatOwner(c.get("userId"), c.env.ENVIRONMENT === "development");
}

/** Not the request URL: wrangler dev rewrites the host to the custom domain. */
function appUrl(c: Context<AppEnv>): string {
  if (!c.env.APP_URL) throw new Error("APP_URL is not set");
  return c.env.APP_URL;
}

const problem = (c: Context<AppEnv>, message: string, status: 400 | 401 | 500) =>
  c.text(`${message}\n\nGo back to the chat and try connecting again.`, status);

// The Client ID Metadata Document: the issue tracker fetches it, without an
// Access login, to learn who "Team Assistant" is and where it may redirect.
app.get("/client-metadata.json", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(clientMetadata(appUrl(c)));
});

app.get("/connect", async (c) => {
  const owner = ownerOf(c);
  if (!owner) return problem(c, "Sign in to the chatbot before connecting the issue tracker.", 401);

  const resource = issueTrackerResource(c.env);
  const server = await discover(resource);
  const clientId = await clientIdFor(server, appUrl(c));
  const { verifier, challenge } = await pkce();
  const pending: PendingLogin = {
    state: randomState(),
    verifier,
    clientId,
    issuer: server.issuer,
    owner,
    returnTo: safeReturnTo(c.req.query("return_to")),
    expiresAt: Date.now() + STATE_TTL_S * 1000,
  };
  setCookie(c, STATE_COOKIE, await encrypt(c.env.TOKEN_ENCRYPTION_KEY, JSON.stringify(pending), STATE_CONTEXT), {
    path: "/oauth",
    httpOnly: true,
    secure: appUrl(c).startsWith("https:"),
    // Lax, not Strict: the callback is a cross-site redirect from the tracker.
    sameSite: "Lax",
    maxAge: STATE_TTL_S,
  });
  return c.redirect(
    authorizationUrl(server, {
      clientId,
      redirectUri: callbackUrl(appUrl(c)),
      challenge,
      state: pending.state,
      resource,
    })
  );
});

app.get("/callback", async (c) => {
  const sealed = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/oauth" });
  if (!sealed) return problem(c, "This sign-in has expired or was already used.", 400);

  let pending: PendingLogin;
  try {
    pending = JSON.parse(await decrypt(c.env.TOKEN_ENCRYPTION_KEY, sealed, STATE_CONTEXT));
  } catch {
    return problem(c, "This sign-in couldn't be verified.", 400);
  }
  const { state, code, error, iss } = c.req.query();
  if (state !== pending.state || Date.now() > pending.expiresAt) {
    return problem(c, "This sign-in has expired or doesn't match.", 400);
  }
  if (pending.owner !== ownerOf(c)) return problem(c, "This sign-in was started by another user.", 400);
  // RFC 9207: the response must come from the server we sent the user to.
  if (iss !== undefined && iss !== pending.issuer) return problem(c, "Unexpected authorization server.", 400);
  // Denied on the tracker's consent page: back to the chat, still unconnected.
  if (error || !code) return c.redirect(pending.returnTo);

  const resource = issueTrackerResource(c.env);
  const tokens = await requestToken(await discover(resource), {
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(appUrl(c)),
    client_id: pending.clientId,
    code_verifier: pending.verifier,
    resource,
  });
  await saveTokens(c.env, pending.owner, pending.clientId, tokens);
  return c.redirect(pending.returnTo);
});

app.post("/disconnect", async (c) => {
  const owner = ownerOf(c);
  if (!owner) return c.json({ error: "Not signed in" }, 401);
  await deleteTokens(c.env.DB, owner);
  return c.body(null, 204);
});

export default app;
