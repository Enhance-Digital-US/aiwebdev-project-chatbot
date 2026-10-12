import type { Hono } from "hono";
import { createClerkClient } from "@clerk/backend";
import type { AppEnv } from "./types";
import { initTelemetry } from "./telemetry";
import { parseAuthorizedParties } from "./auth/authorized-parties";

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

    if (c.env.CLERK_SECRET_KEY) {
      // Outside the try: a malformed allow-list is a deploy bug and must surface as a 500,
      // not be swallowed into "anonymous".
      const authorizedParties = parseAuthorizedParties(c.env.CLERK_AUTHORIZED_PARTIES);
      try {
        const clerk = createClerkClient({
          secretKey: c.env.CLERK_SECRET_KEY,
          publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
        });
        const requestState = await clerk.authenticateRequest(c.req.raw, { authorizedParties });
        if (requestState.isAuthenticated) {
          c.set("userId", requestState.toAuth().userId);
        }
      } catch (err) {
        console.warn("Clerk auth failed, continuing as unauthenticated:", err);
      }
    }

    await next();
  });
}
