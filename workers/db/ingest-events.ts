import type { ProviderSlug, WebhookEnvelope } from "../domain/events";

interface TenantRow {
	id: string;
	name: string;
}

interface ProviderRow {
	id: string;
	slug: string;
}

export interface CreateWebhookIngestEventInput {
	eventId: string;
	provider: ProviderSlug;
	envelope: WebhookEnvelope;
	headers: Headers;
	receivedAt: string;
	connectionId?: string;
	queueDispatched: boolean;
	signatureStatus?: "pending" | "verified" | "failed" | "skipped";
}

export interface PersistedWebhookIngestEvent {
	eventId: string;
	tenantId: string;
	providerId: string;
	provider: ProviderSlug;
	idempotencyKey: string;
}

export class IngestPersistenceError extends Error {
	readonly status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "IngestPersistenceError";
		this.status = status;
	}
}

export async function createWebhookIngestEvent(
	db: D1Database,
	input: CreateWebhookIngestEventInput,
): Promise<PersistedWebhookIngestEvent> {
	const tenant = await findTenant(db, input.envelope.tenantId);
	if (!tenant) {
		throw new IngestPersistenceError(
			`Unknown tenant '${input.envelope.tenantId}'. Create the tenant before sending webhooks.`,
			404,
		);
	}

	const provider = await findProvider(db, input.provider);
	if (!provider) {
		throw new IngestPersistenceError(
			`Provider '${input.provider}' is not configured in the database.`,
			500,
		);
	}

	const idempotencyKey = await createIdempotencyKey(input.provider, input.envelope);
	const payloadJson = JSON.stringify(input.envelope);
	const headersJson = JSON.stringify(Object.fromEntries(input.headers.entries()));

	try {
		await db
			.prepare(
				`INSERT INTO webhook_ingest_events (
					id,
					tenant_id,
					provider_id,
					connection_id,
					provider_event_id,
					provider_event_type,
					resource_type,
					delivery_id,
					idempotency_key,
					signature_status,
					received_at,
					queued_at,
					raw_payload_json,
					headers_json,
					processing_status
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				input.eventId,
				tenant.id,
				provider.id,
				input.connectionId ?? null,
				input.envelope.providerEventId ?? null,
				input.envelope.eventType,
				input.envelope.resourceType,
				input.envelope.deliveryId ?? null,
				idempotencyKey,
				input.signatureStatus ?? "skipped",
				input.receivedAt,
				input.queueDispatched ? input.receivedAt : null,
				payloadJson,
				headersJson,
				input.queueDispatched ? "queued" : "received",
			)
			.run();
	} catch (error) {
		if (isD1UniqueConstraintError(error)) {
			throw new IngestPersistenceError(
				`Duplicate webhook for tenant '${tenant.id}' and provider '${input.provider}'.`,
				409,
			);
		}

		throw error;
	}

	return {
		eventId: input.eventId,
		tenantId: tenant.id,
		providerId: provider.id,
		provider: input.provider,
		idempotencyKey,
	};
}

export async function markWebhookIngestEventQueued(
	db: D1Database,
	eventId: string,
	queuedAt: string,
): Promise<void> {
	await db
		.prepare(
			"UPDATE webhook_ingest_events SET processing_status = ?, queued_at = ? WHERE id = ?",
		)
		.bind("queued", queuedAt, eventId)
		.run();
}

async function findTenant(db: D1Database, tenantId: string): Promise<TenantRow | null> {
	const result = await db
		.prepare("SELECT id, name FROM tenants WHERE id = ? OR slug = ? LIMIT 1")
		.bind(tenantId, tenantId)
		.first<TenantRow>();

	return result ?? null;
}

async function findProvider(db: D1Database, providerSlug: ProviderSlug): Promise<ProviderRow | null> {
	const result = await db
		.prepare("SELECT id, slug FROM providers WHERE slug = ? LIMIT 1")
		.bind(providerSlug)
		.first<ProviderRow>();

	return result ?? null;
}

async function createIdempotencyKey(
	provider: ProviderSlug,
	envelope: WebhookEnvelope,
): Promise<string> {
	const source = [
		provider,
		envelope.tenantId,
		envelope.providerEventId ?? "",
		envelope.deliveryId ?? "",
		envelope.eventType,
		envelope.resourceType,
		JSON.stringify(envelope.payload),
	].join(":");

	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
	return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function isD1UniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
