import { webhookEnvelopeSchema, type ProviderSlug, type WebhookEnvelope } from "./events";
import type { IngestQueueMessage, WorkerEnv } from "../config/env";
import {
	createWebhookIngestEvent,
	IngestPersistenceError,
	markWebhookIngestEventQueued,
} from "../db/ingest-events";
import { log } from "../lib/logger";

export interface AcceptedWebhook {
	eventId: string;
	accepted: true;
	idempotencyKey: string;
	queued: boolean;
	provider: ProviderSlug;
	tenantId: string;
}

export async function acceptWebhook(
	env: WorkerEnv,
	provider: ProviderSlug,
	envelope: WebhookEnvelope,
	headers: Headers,
	options?: {
		connectionId?: string;
		signatureStatus?: "pending" | "verified" | "failed" | "skipped";
	},
): Promise<AcceptedWebhook> {
	if (!env.DB) {
		throw new IngestPersistenceError("D1 binding 'DB' is required for webhook ingestion.", 500);
	}

	const eventId = crypto.randomUUID();
	const receivedAt = new Date().toISOString();

	const persisted = await createWebhookIngestEvent(env.DB, {
		eventId,
		provider,
		envelope,
		headers,
		receivedAt,
		connectionId: options?.connectionId,
		queueDispatched: false,
		signatureStatus: options?.signatureStatus,
	});

	const message = createIngestMessage(provider, persisted.tenantId, envelope, eventId, receivedAt);

	if (env.INGEST_QUEUE) {
		await env.INGEST_QUEUE.send(message);
		await markWebhookIngestEventQueued(env.DB, eventId, new Date().toISOString());
	} else {
		log("warn", "Ingest queue binding missing; webhook accepted without queue dispatch.", {
			eventId,
			provider,
			tenantId: persisted.tenantId,
		});
	}

	return {
		eventId,
		accepted: true,
		idempotencyKey: persisted.idempotencyKey,
		queued: Boolean(env.INGEST_QUEUE),
		provider,
		tenantId: persisted.tenantId,
	};
}

function createIngestMessage(
	provider: ProviderSlug,
	tenantId: string,
	envelope: WebhookEnvelope,
	eventId: string,
	receivedAt: string,
): IngestQueueMessage {
	return {
		eventId,
		provider,
		tenantId,
		receivedAt,
		resourceType: envelope.resourceType,
	};
}
