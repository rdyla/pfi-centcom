import { IngestPersistenceError } from "../../db/ingest-events";
import { resolveWebhookConnectionByTenantSlug } from "../../db/provider-connections";
import { acceptWebhook, type AcceptedWebhook } from "../../domain/ingest";
import { processIngestEvent } from "../../domain/process-ingest";
import type { WorkerEnv } from "../../config/env";
import type { WebhookEnvelope } from "../../domain/events";

export async function handleZoomWebhook(
	request: Request,
	env: WorkerEnv,
	tenantSlug: string,
): Promise<Response> {
	if (!env.DB) {
		throw new IngestPersistenceError("D1 binding 'DB' is required for Zoom webhooks.", 500);
	}

	const connection = await resolveWebhookConnectionByTenantSlug(
		env.DB,
		env.PFI_SECRETS_KV,
		"zoom",
		tenantSlug,
	);
	const rawBody = await request.json();

	if (isZoomEndpointValidation(rawBody)) {
		return Response.json({
			plainToken: rawBody.payload.plainToken,
			encryptedToken: await createZoomValidationToken(
				rawBody.payload.plainToken,
				connection.webhookSecret,
			),
		});
	}

	await verifyZoomSignature(request.headers, rawBody, connection.webhookSecret);
	const envelope = normalizeZoomWebhook(connection.tenantId, rawBody);
	const result = await acceptWebhook(env, "zoom", envelope, request.headers, {
		connectionId: connection.connectionId,
		signatureStatus: "verified",
	});
	if (!env.INGEST_QUEUE) {
		await processIngestEvent(env, result.eventId);
	}

	return Response.json(result, { status: 202 });
}

function isZoomEndpointValidation(body: unknown): body is {
	event: "endpoint.url_validation";
	payload: { plainToken: string };
} {
	return (
		typeof body === "object" &&
		body !== null &&
		"event" in body &&
		body.event === "endpoint.url_validation" &&
		"payload" in body &&
		typeof body.payload === "object" &&
		body.payload !== null &&
		"plainToken" in body.payload &&
		typeof body.payload.plainToken === "string"
	);
}

function normalizeZoomWebhook(tenantId: string, body: unknown): WebhookEnvelope {
	const event = getStringField(body, "event") ?? "zoom.unknown";
	const payload = getObjectField(body, "payload") ?? {};
	const objectPayload = getObjectField(payload, "object");
	const providerEventId =
		getStringField(objectPayload, "uuid") ??
		getStringField(objectPayload, "id") ??
		getStringField(body, "event_id");
	const occurredAt = getZoomOccurredAt(body, objectPayload);

	return {
		tenantId,
		resourceType: deriveZoomResourceType(event, objectPayload),
		eventType: event,
		providerEventId: providerEventId ?? undefined,
		deliveryId: getStringField(body, "event_ts") ?? undefined,
		occurredAt,
		payload: {
			raw: body,
		},
	};
}

function deriveZoomResourceType(
	event: string,
	objectPayload: Record<string, unknown> | null,
): string {
	return getStringField(objectPayload, "object") ?? event.split(".")[0] ?? "zoom";
}

function getZoomOccurredAt(
	body: unknown,
	objectPayload: Record<string, unknown> | null,
): string | undefined {
	const eventTs = getNumberField(body, "event_ts");
	if (eventTs) {
		return new Date(eventTs).toISOString();
	}

	const timestamp =
		getStringField(objectPayload, "start_time") ?? getStringField(objectPayload, "created_at");
	if (!timestamp) {
		return undefined;
	}

	const parsed = new Date(timestamp);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

async function verifyZoomSignature(headers: Headers, body: unknown, secret: string) {
	const timestamp = headers.get("x-zm-request-timestamp");
	const signature = headers.get("x-zm-signature");
	if (!timestamp || !signature) {
		throw new IngestPersistenceError("Zoom webhook signature headers are missing.", 401);
	}

	const message = `v0:${timestamp}:${JSON.stringify(body)}`;
	const expected = await createZoomSignature(message, secret);
	const candidate = `v0=${expected}`;
	if (!timingSafeEqual(candidate, signature)) {
		throw new IngestPersistenceError("Zoom webhook signature verification failed.", 401);
	}
}

async function createZoomValidationToken(plainToken: string, secret: string): Promise<string> {
	return createZoomSignature(plainToken, secret);
}

async function createZoomSignature(value: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let result = 0;
	for (let index = 0; index < a.length; index += 1) {
		result |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return result === 0;
}

function getObjectField(
	value: unknown,
	key: string,
): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || !(key in value)) {
		return null;
	}

	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === "object" && candidate !== null
		? (candidate as Record<string, unknown>)
		: null;
}

function getStringField(value: unknown, key: string): string | null {
	if (typeof value !== "object" || value === null || !(key in value)) {
		return null;
	}

	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function getNumberField(value: unknown, key: string): number | null {
	if (typeof value !== "object" || value === null || !(key in value)) {
		return null;
	}

	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === "number" ? candidate : null;
}
