import type { Hono } from "hono";
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

    c.set("userId", null);

    // Login is enforced by Cloudflare Access before the request reaches the
    // Worker; here we only identify the user for tracing. No header (local dev,
    // evals) → anonymous, with no JWKS fetch.
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
  });
}
