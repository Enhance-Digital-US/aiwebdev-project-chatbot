import type { Hono } from "hono";
import type { AppEnv } from "./types";
import { initTelemetry } from "./telemetry";

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

    // Who's asking. There's no sign-in until the app is deployed behind
    // Cloudflare Access (lesson 19), so every request is anonymous for now.
    c.set("userId", null);

    await next();
  });
}
