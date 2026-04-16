import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { WorkerEnv } from "../config/env";
import { getPlatformStatus } from "../config/env";
import { AuthError, handleCallback, logout, startLogin } from "../auth/entra";
import { IngestPersistenceError } from "../db/ingest-events";
import { ProviderConnectionError } from "../db/provider-connections";
import { platformOverview, providerSlugSchema, webhookEnvelopeSchema } from "../domain/events";
import { acceptWebhook } from "../domain/ingest";
import { handleZoomWebhook } from "../integrations/zoom/webhooks";

type AppContext = {
	Bindings: WorkerEnv;
};

export function createApiApp() {
	const app = new Hono<AppContext>();

	app.get("/health", (c) => {
		return c.json({
			ok: true,
			service: "pfi-centcom",
			status: getPlatformStatus(c.env),
			timestamp: new Date().toISOString(),
		});
	});

	app.get("/api/system/overview", (c) => {
		return c.json({
			overview: platformOverview,
			status: getPlatformStatus(c.env),
		});
	});

	app.get("/auth/login", async (c) => {
		return startLogin(c.req.raw, c.env);
	});

	app.get("/auth/callback", async (c) => {
		return handleCallback(c.req.raw, c.env);
	});

	app.get("/auth/logout", (c) => {
		return logout(c.req.raw, c.env);
	});

	app.post("/webhooks/zoom/:tenantSlug", async (c) => {
		return handleZoomWebhook(c.req.raw, c.env, c.req.param("tenantSlug"));
	});

	app.post(
		"/webhooks/:provider",
		async (c) => {
			const provider = providerSlugSchema.safeParse(c.req.param("provider"));
			if (!provider.success) {
				throw new HTTPException(404, { message: "Unsupported provider." });
			}

			const body = await c.req.json();
			const result = await acceptWebhook(
				c.env,
				provider.data,
				webhookEnvelopeSchema.parse(body),
				c.req.raw.headers,
			);
			return c.json(result, 202);
		},
	);

	app.onError((error, c) => {
		console.error(error);

		if (error instanceof IngestPersistenceError) {
			return c.json(
				{
					error: error.message,
				},
				error.status,
			);
		}

		if (error instanceof AuthError) {
			return c.json(
				{
					error: error.message,
				},
				error.status,
			);
		}

		if (error instanceof ProviderConnectionError) {
			return c.json(
				{
					error: error.message,
				},
				error.status,
			);
		}

		if (error instanceof HTTPException) {
			return c.json(
				{
					error: error.message,
				},
				error.status,
			);
		}

		return c.json(
			{
				error:
					c.env.APP_ENV === "development" && error instanceof Error
						? error.message
						: "Unexpected server error.",
			},
			500,
		);
	});

	return app;
}
