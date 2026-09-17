import { Hono } from "hono";
import type { AppEnv } from "./types";
import { registerMiddleware } from "./middleware";
import chatRoutes from "./routes/chat";

const app = new Hono<AppEnv>();

registerMiddleware(app);

app.route("/api", chatRoutes);

export default app;
