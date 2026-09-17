import type { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./types";
import { initTelemetry } from "./telemetry";

export function registerMiddleware(app: Hono<AppEnv>) {
  app.use(
    "/api/*",
    cors({
      origin: ["http://localhost:5173"],
      allowMethods: ["POST"],
      allowHeaders: ["Content-Type"],
    })
  );

  app.use("/api/*", async (c, next) => {
    initTelemetry({
      LANGFUSE_PUBLIC_KEY: c.env.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: c.env.LANGFUSE_SECRET_KEY,
    });
    await next();
  });
}
