import type { Hono, MiddlewareHandler } from "hono";
import type { AppEnv } from "./types";
import { initTelemetry } from "./telemetry";
import { ACCESS_JWT_HEADER, verifyAccessUser } from "./auth/access";

// No CORS middleware: the frontend is served from the same Worker (static
// assets) in production and through the Vite proxy in dev, so /api/* is
// always same-origin. Add `hono/cors` back only if a separate origin needs access.

export function registerMiddleware(app: Hono<AppEnv>) {
  app.use("/api/*", async (c, next) => {
    initTelemetry({
      LANGFUSE_PUBLIC_KEY: c.env.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: c.env.LANGFUSE_SECRET_KEY,
      LANGFUSE_BASE_URL: c.env.LANGFUSE_BASE_URL,
    });
    await next();
  });

  // Login is enforced by Cloudflare Access before the request reaches the
  // Worker; here we only identify the user (traces, saved chats, issue-tracker
  // tokens). No header (local dev, evals) → anonymous, with no JWKS fetch.
  const identify: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set("userId", null);

    const token = c.req.header(ACCESS_JWT_HEADER);
    if (token && c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD) {
      try {
        const userId = await verifyAccessUser(token, {
          teamDomain: c.env.ACCESS_TEAM_DOMAIN,
          audience: c.env.ACCESS_AUD,
        });
        c.set("userId", userId);
      } catch (err) {
        console.warn("Access JWT verification failed, continuing as anonymous:", err);
      }
    }

    await next();
  };
  app.use("/api/*", identify);
  // Connecting the issue tracker (routes/oauth.ts) is per user too.
  app.use("/oauth/*", identify);
}
