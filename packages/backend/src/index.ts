import { Hono } from "hono";
import type { AppEnv } from "./types";
import chatRoutes from "./routes/chat";

const app = new Hono<AppEnv>();

app.route("/api", chatRoutes);

export default app;
