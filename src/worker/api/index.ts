import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { CloudflareError } from "../cloudflare/client";
import { requireAuth } from "../middleware/auth";
import { withDb, type AppBindings } from "../middleware/context";
import { accountRoutes } from "./accounts";
import { activityRoutes } from "./activity";
import { adminRoutes } from "./admin";
import { apiKeyRoutes } from "./api-keys";
import { authRoutes } from "./auth";
import { backupRoutes } from "./backups";
import { brandingRoutes } from "./branding";
import { calendarInteropRoutes, calendarRoutes } from "./calendar";
import { contactRoutes } from "./contacts";
import { demoRoutes } from "./demo";
import { domainRoutes } from "./domains";
import { fileRoutes } from "./files";
import { folderRoutes } from "./folders";
import { imapRoutes } from "./imap";
import { importExportRoutes } from "./import-export";
import { publicRoutes } from "./public";
import { mailboxRoutes } from "./mailboxes";
import { messageRoutes } from "./messages";
import { routingRuleRoutes } from "./routing-rules";
import { sendRoutes } from "./send";
import { settingsRoutes } from "./settings";
import { setupRoutes } from "./setup";
import { templateRoutes } from "./templates";
import { v1Routes } from "./v1";
import { webhookRoutes } from "./webhooks";

const api = new Hono<AppBindings>().basePath("/api");

api.use("*", withDb);

api.onError((error, c) => {
	if (error instanceof HTTPException) {
		// A route may attach its own response (validation details, for example).
		return error.res ?? c.json({ error: error.message }, error.status);
	}
	// Provisioning talks to Cloudflare on the caller's behalf, and what Cloudflare
	// refused is the whole answer — swallowing it into "Internal error" leaves the
	// operator with a 500 and no idea which name, zone or token was wrong.
	if (error instanceof CloudflareError) {
		console.error("Cloudflare API error", error.status, error.code, error.message);
		return c.json({ error: error.message }, 502);
	}
	console.error("Unhandled API error", error);
	return c.json({ error: "Internal error" }, 500);
});

// Public: no session required.
api.route("/setup", setupRoutes);
api.route("/auth", authRoutes);
api.route("/public", publicRoutes);
// Branding is public: the login screen needs the app name and icon before anyone
// has signed in. The write routes inside it enforce admin themselves.
api.route("/branding", brandingRoutes);

// Everything below needs an identity.
api.use("/accounts/*", requireAuth);
api.use("/activity/*", requireAuth);
api.use("/admin/*", requireAuth);
api.use("/api-keys/*", requireAuth);
api.use("/backups/*", requireAuth);
api.use("/calendar/*", requireAuth);
api.use("/contacts/*", requireAuth);
api.use("/domains/*", requireAuth);

api.use("/demo", requireAuth);
api.use("/demo/*", requireAuth);
api.use("/files/*", requireAuth);
api.use("/folders/*", requireAuth);
api.use("/imap/*", requireAuth);
api.use("/mail/*", requireAuth);
api.use("/mailboxes/*", requireAuth);
api.use("/messages/*", requireAuth);
api.use("/routing-rules/*", requireAuth);
api.use("/send/*", requireAuth);
api.use("/settings/*", requireAuth);
api.use("/templates/*", requireAuth);
api.use("/webhooks/*", requireAuth);
api.use("/v1/*", requireAuth);

api.route("/accounts", accountRoutes);
api.route("/activity", activityRoutes);
api.route("/admin", adminRoutes);
api.route("/api-keys", apiKeyRoutes);
api.route("/backups", backupRoutes);
api.route("/calendar", calendarRoutes);
// iCalendar in and out, plus invitations, on the same prefix as the events themselves.
api.route("/calendar", calendarInteropRoutes);
api.route("/contacts", contactRoutes);
api.route("/domains", domainRoutes);
api.route("/demo", demoRoutes);
api.route("/files", fileRoutes);
api.route("/folders", folderRoutes);
api.route("/imap", imapRoutes);
api.route("/mail", importExportRoutes);
api.route("/mailboxes", mailboxRoutes);
api.route("/messages", messageRoutes);
api.route("/routing-rules", routingRuleRoutes);
api.route("/send", sendRoutes);
api.route("/settings", settingsRoutes);
api.route("/templates", templateRoutes);
api.route("/webhooks", webhookRoutes);
api.route("/v1", v1Routes);

api.notFound((c) => c.json({ error: "No such endpoint" }, 404));

export { api };
