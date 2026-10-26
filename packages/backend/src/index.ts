import { Hono } from "hono";
import type { AppEnv } from "./types";
import { registerMiddleware } from "./middleware";
import chatRoutes from "./routes/chat";
import workflowRoutes from "./routes/workflows";
import chatsRoutes from "./routes/chats";
import oauthRoutes from "./routes/oauth";

const app = new Hono<AppEnv>();

registerMiddleware(app);

app.route("/api", chatRoutes);
app.route("/api", workflowRoutes);
app.route("/api", chatsRoutes);
// Outside /api so the client metadata URL can have its own Access bypass.
app.route("/oauth", oauthRoutes);

export default app;

// Workflow classes must be exported from the Worker's main module.
export { BugReportWorkflow } from "./workflows/bug-report";
