import { createRequestHandler } from "react-router";
import { createApiApp } from "./api/routes";
import type { WorkerEnv } from "./config/env";
import { processIngestEvent } from "./domain/process-ingest";
import { log } from "./lib/logger";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: WorkerEnv;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

const apiApp = createApiApp();

export default {
	async fetch(request, env: WorkerEnv, ctx) {
		const url = new URL(request.url);

		if (
			url.pathname === "/health" ||
			url.pathname.startsWith("/auth/") ||
			url.pathname.startsWith("/api/") ||
			url.pathname.startsWith("/webhooks/")
		) {
			return apiApp.fetch(request, env, ctx);
		}

		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},
	async queue(batch, env: WorkerEnv) {
		for (const message of batch.messages) {
			try {
				log("info", "Processing queue message.", {
					body: message.body,
					hasDatabase: Boolean(env.DB),
				});
				const payload = message.body as { eventId?: string };
				if (!payload.eventId) {
					throw new Error("Queue message did not include an eventId.");
				}
				await processIngestEvent(env, payload.eventId);
				message.ack();
			} catch (error) {
				log("error", "Failed to process ingest queue message.", {
					error: error instanceof Error ? error.message : String(error),
					body: message.body,
				});
				message.retry();
			}
		}
	},
} satisfies ExportedHandler<WorkerEnv>;
