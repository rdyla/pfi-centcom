import { IngestPersistenceError } from "../db/ingest-events";
import { log } from "../lib/logger";
import type { WorkerEnv } from "../config/env";

interface IngestEventRow {
	id: string;
	tenantId: string;
	providerId: string;
	providerEventType: string;
	rawPayloadJson: string;
	receivedAt: string;
}

interface ParsedEnvelope {
	tenantId: string;
	resourceType: string;
	eventType: string;
	providerEventId?: string;
	deliveryId?: string;
	occurredAt?: string;
	payload: Record<string, unknown>;
}

interface NormalizedEventRecord {
	id: string;
	tenantId: string;
	providerId: string;
	ingestEventId: string;
	providerEventId: string | null;
	providerEventType: string;
	resourceType: string;
	resourceId: string | null;
	severity: "critical" | "high" | "medium" | "low" | "info";
	status: string | null;
	occurredAt: string;
	actorJson: string | null;
	subjectJson: string | null;
	locationJson: string | null;
	payloadJson: string;
	fingerprint: string;
}

interface ZoomEmergencyAlert {
	title: string;
	description: string;
	alertFingerprint: string;
	normalizedEvent: NormalizedEventRecord;
}

export async function processIngestEvent(
	env: WorkerEnv,
	eventId: string,
): Promise<{ normalizedEventId: string; alertId?: string }> {
	if (!env.DB) {
		throw new IngestPersistenceError("D1 binding 'DB' is required for ingest processing.", 500);
	}

	const ingestEvent = await loadIngestEvent(env.DB, eventId);
	if (!ingestEvent) {
		throw new IngestPersistenceError(`Ingest event '${eventId}' was not found.`, 404);
	}

	try {
		const envelope = parseEnvelope(ingestEvent.rawPayloadJson);
		if (ingestEvent.providerEventType !== "phone.emergency_alert") {
			await markIngestEventIgnored(
				env.DB,
				eventId,
				`No processor implemented for event '${ingestEvent.providerEventType}'.`,
			);
			return { normalizedEventId: "" };
		}

		const normalized = buildZoomEmergencyAlert(ingestEvent, envelope);
		await insertNormalizedEvent(env.DB, normalized.normalizedEvent);
		const alertId = await upsertAlertForNormalizedEvent(env.DB, normalized);
		await markIngestEventProcessed(env.DB, eventId);

		return {
			normalizedEventId: normalized.normalizedEvent.id,
			alertId,
		};
	} catch (error) {
		await markIngestEventFailed(
			env.DB,
			eventId,
			error instanceof Error ? error.message : "Unknown processing error.",
		);
		throw error;
	}
}

async function loadIngestEvent(db: D1Database, eventId: string): Promise<IngestEventRow | null> {
	const result = await db
		.prepare(
			`SELECT
				id,
				tenant_id AS tenantId,
				provider_id AS providerId,
				provider_event_type AS providerEventType,
				raw_payload_json AS rawPayloadJson,
				received_at AS receivedAt
			FROM webhook_ingest_events
			WHERE id = ?
			LIMIT 1`,
		)
		.bind(eventId)
		.first<IngestEventRow>();

	return result ?? null;
}

function parseEnvelope(rawPayloadJson: string): ParsedEnvelope {
	try {
		return JSON.parse(rawPayloadJson) as ParsedEnvelope;
	} catch {
		throw new Error("Stored ingest payload could not be parsed.");
	}
}

function buildZoomEmergencyAlert(
	ingestEvent: IngestEventRow,
	envelope: ParsedEnvelope,
): ZoomEmergencyAlert {
	const raw = getObjectField(envelope.payload, "raw") ?? {};
	const payload = getObjectField(raw, "payload") ?? {};
	const object = getObjectField(payload, "object") ?? {};
	const caller = getObjectField(object, "caller");
	const callee = getObjectField(object, "callee");
	const location = getObjectField(object, "location");
	const emergencyAddress = getObjectField(object, "emergency_address");
	const callId =
		getStringField(object, "call_id") ??
		envelope.providerEventId ??
		crypto.randomUUID();
	const callerName =
		getStringField(caller, "display_name") ??
		getStringField(caller, "extension_number") ??
		"Unknown caller";
	const callerExtension = getStringField(caller, "extension_number");
	const calleeNumber = getStringField(callee, "phone_number") ?? "unknown destination";
	const siteName = getStringField(caller, "site_name");
	const deliverTo = getStringField(object, "deliver_to");
	const occurredAt = envelope.occurredAt ?? ingestEvent.receivedAt;
	const normalizedEventId = `norm_${crypto.randomUUID()}`;
	const fingerprint = [
		ingestEvent.tenantId,
		"zoom",
		envelope.eventType,
		callId,
	].join(":");
	const title = `Zoom emergency alert for ${callerName}`;
	const descriptionParts = [
		callerExtension ? `Extension ${callerExtension}` : null,
		`dialed ${calleeNumber}`,
		siteName ? `at ${siteName}` : null,
		deliverTo ? `deliver to ${deliverTo}` : null,
	]
		.filter(Boolean)
		.join(" ");

	return {
		title,
		description: descriptionParts,
		alertFingerprint: fingerprint,
		normalizedEvent: {
			id: normalizedEventId,
			tenantId: ingestEvent.tenantId,
			providerId: ingestEvent.providerId,
			ingestEventId: ingestEvent.id,
			providerEventId: envelope.providerEventId ?? callId,
			providerEventType: envelope.eventType,
			resourceType: "zoom_phone_emergency_alert",
			resourceId: callId,
			severity: "critical",
			status: "open",
			occurredAt,
			actorJson: caller ? JSON.stringify(caller) : null,
			subjectJson: callee ? JSON.stringify(callee) : null,
			locationJson: JSON.stringify({
				location,
				emergencyAddress,
				router: getStringField(object, "router"),
			}),
			payloadJson: JSON.stringify({
				raw,
				object,
			}),
			fingerprint,
		},
	};
}

async function insertNormalizedEvent(db: D1Database, record: NormalizedEventRecord) {
	await db
		.prepare(
			`INSERT INTO normalized_events (
				id,
				tenant_id,
				ingest_event_id,
				provider_id,
				provider_event_id,
				provider_event_type,
				resource_type,
				resource_id,
				severity,
				status,
				occurred_at,
				actor_json,
				subject_json,
				location_json,
				payload_json,
				fingerprint
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			record.id,
			record.tenantId,
			record.ingestEventId,
			record.providerId,
			record.providerEventId,
			record.providerEventType,
			record.resourceType,
			record.resourceId,
			record.severity,
			record.status,
			record.occurredAt,
			record.actorJson,
			record.subjectJson,
			record.locationJson,
			record.payloadJson,
			record.fingerprint,
		)
		.run();
}

async function upsertAlertForNormalizedEvent(
	db: D1Database,
	normalized: ZoomEmergencyAlert,
): Promise<string> {
	const existing = await db
		.prepare(
			`SELECT id
			FROM alerts
			WHERE tenant_id = ? AND fingerprint = ?
			LIMIT 1`,
		)
		.bind(normalized.normalizedEvent.tenantId, normalized.alertFingerprint)
		.first<{ id: string }>();

	const now = new Date().toISOString();
	const alertId = existing?.id ?? `alert_${crypto.randomUUID()}`;

	if (existing) {
		await db
			.prepare(
				`UPDATE alerts
				SET last_event_at = ?, updated_at = ?, status = 'open'
				WHERE id = ?`,
			)
			.bind(normalized.normalizedEvent.occurredAt, now, alertId)
			.run();
	} else {
		await db
			.prepare(
				`INSERT INTO alerts (
					id,
					tenant_id,
					title,
					description,
					severity,
					status,
					source,
					resource_type,
					resource_id,
					fingerprint,
					first_event_at,
					last_event_at,
					metadata_json,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				alertId,
				normalized.normalizedEvent.tenantId,
				normalized.title,
				normalized.description,
				normalized.normalizedEvent.severity,
				"zoom",
				normalized.normalizedEvent.resourceType,
				normalized.normalizedEvent.resourceId,
				normalized.alertFingerprint,
				normalized.normalizedEvent.occurredAt,
				normalized.normalizedEvent.occurredAt,
				normalized.normalizedEvent.payloadJson,
				now,
				now,
			)
			.run();
	}

	await db
		.prepare(
			`INSERT INTO alert_events (id, alert_id, normalized_event_id)
			 VALUES (?, ?, ?)`,
		)
		.bind(`alert_event_${crypto.randomUUID()}`, alertId, normalized.normalizedEvent.id)
		.run();

	log("info", "Processed Zoom emergency alert.", {
		alertId,
		eventId: normalized.normalizedEvent.ingestEventId,
		tenantId: normalized.normalizedEvent.tenantId,
	});

	return alertId;
}

async function markIngestEventProcessed(db: D1Database, eventId: string) {
	await db
		.prepare(
			"UPDATE webhook_ingest_events SET processing_status = ?, error_message = NULL WHERE id = ?",
		)
		.bind("processed", eventId)
		.run();
}

async function markIngestEventIgnored(db: D1Database, eventId: string, message: string) {
	await db
		.prepare(
			"UPDATE webhook_ingest_events SET processing_status = ?, error_message = ? WHERE id = ?",
		)
		.bind("ignored", message, eventId)
		.run();
}

async function markIngestEventFailed(db: D1Database, eventId: string, message: string) {
	await db
		.prepare(
			"UPDATE webhook_ingest_events SET processing_status = ?, error_message = ? WHERE id = ?",
		)
		.bind("failed", message, eventId)
		.run();
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
