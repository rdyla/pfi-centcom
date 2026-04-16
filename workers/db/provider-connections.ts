import type { ProviderSlug } from "../domain/events";

export interface ProviderOption {
	id: string;
	slug: ProviderSlug;
	name: string;
}

export interface ProviderConnectionSummary {
	id: string;
	tenantId: string;
	tenantName: string;
	providerSlug: ProviderSlug;
	displayName: string;
	status: "active" | "inactive" | "error";
	externalAccountId: string | null;
	webhookRoutingKey: string | null;
	apiBaseUrl: string | null;
	clientId: string | null;
	hasWebhookSecret: boolean;
	hasCredentialSecret: boolean;
	createdAt: string;
}

export interface CreateProviderConnectionInput {
	tenantId: string;
	providerSlug: ProviderSlug;
	displayName: string;
	externalAccountId?: string;
	webhookRoutingKey?: string;
	apiBaseUrl?: string;
	clientId?: string;
	webhookSecret?: string;
	credentialsJson?: string;
}

interface TenantRow {
	id: string;
	name: string;
}

interface ProviderRow {
	id: string;
	slug: ProviderSlug;
	name: string;
}

interface ConnectionConfig {
	apiBaseUrl?: string;
	clientId?: string;
	credentialRef?: string;
}

export interface ResolvedWebhookConnection {
	connectionId: string;
	tenantId: string;
	tenantSlug: string;
	tenantName: string;
	providerSlug: ProviderSlug;
	displayName: string;
	webhookSecret: string;
}

export class ProviderConnectionError extends Error {
	readonly status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "ProviderConnectionError";
		this.status = status;
	}
}

export async function listProviderOptions(db: D1Database): Promise<ProviderOption[]> {
	const result = await db
		.prepare(`SELECT id, slug, name FROM providers WHERE status = 'active' ORDER BY name ASC`)
		.all<ProviderOption>();

	return result.results ?? [];
}

export async function listProviderConnections(
	db: D1Database,
): Promise<ProviderConnectionSummary[]> {
	const result = await db
		.prepare(
			`SELECT
				c.id,
				c.tenant_id AS tenantId,
				t.name AS tenantName,
				p.slug AS providerSlug,
				c.display_name AS displayName,
				c.status,
				c.external_account_id AS externalAccountId,
				c.webhook_routing_key AS webhookRoutingKey,
				c.webhook_secret_ref AS webhookSecretRef,
				c.auth_config_json AS authConfigJson,
				c.created_at AS createdAt
			FROM tenant_provider_connections c
			INNER JOIN tenants t ON t.id = c.tenant_id
			INNER JOIN providers p ON p.id = c.provider_id
			ORDER BY c.created_at DESC, t.name ASC, p.name ASC`,
		)
		.all<{
			id: string;
			tenantId: string;
			tenantName: string;
			providerSlug: ProviderSlug;
			displayName: string;
			status: "active" | "inactive" | "error";
			externalAccountId: string | null;
			webhookRoutingKey: string | null;
			webhookSecretRef: string | null;
			authConfigJson: string | null;
			createdAt: string;
		}>();

	return (result.results ?? []).map((row) => {
		const config = parseConnectionConfig(row.authConfigJson);
		return {
			id: row.id,
			tenantId: row.tenantId,
			tenantName: row.tenantName,
			providerSlug: row.providerSlug,
			displayName: row.displayName,
			status: row.status,
			externalAccountId: row.externalAccountId,
			webhookRoutingKey: row.webhookRoutingKey,
			apiBaseUrl: config.apiBaseUrl ?? null,
			clientId: config.clientId ?? null,
			hasWebhookSecret: Boolean(row.webhookSecretRef),
			hasCredentialSecret: Boolean(config.credentialRef),
			createdAt: row.createdAt,
		};
	});
}

export async function createProviderConnection(
	db: D1Database,
	kv: KVNamespace | undefined,
	input: CreateProviderConnectionInput,
): Promise<ProviderConnectionSummary> {
	const tenant = await findTenant(db, input.tenantId);
	if (!tenant) {
		throw new ProviderConnectionError("Select a valid tenant before saving a connection.", 404);
	}

	const provider = await findProvider(db, input.providerSlug);
	if (!provider) {
		throw new ProviderConnectionError(
			`Provider '${input.providerSlug}' was not found in the database.`,
			500,
		);
	}

	await ensureConnectionNameAvailable(db, tenant.id, provider.id, input.displayName);

	if ((input.webhookSecret || input.credentialsJson) && !kv) {
		throw new ProviderConnectionError(
			"SECRETS_KV is not configured. Add a KV binding before saving provider secrets.",
			500,
		);
	}

	let parsedCredentials: unknown;
	if (input.credentialsJson) {
		try {
			parsedCredentials = JSON.parse(input.credentialsJson);
		} catch {
			throw new ProviderConnectionError("Credentials JSON must be valid JSON.", 400);
		}
	}

	const connectionId = `conn_${crypto.randomUUID()}`;
	const now = new Date().toISOString();
	const webhookSecretRef = input.webhookSecret
		? `connections/${connectionId}/webhook-secret`
		: null;
	const credentialRef = input.credentialsJson
		? `connections/${connectionId}/credentials`
		: null;
	const authConfigJson = JSON.stringify({
		apiBaseUrl: emptyToNull(input.apiBaseUrl) ?? undefined,
		clientId: emptyToNull(input.clientId) ?? undefined,
		credentialRef,
	});

	try {
		if (webhookSecretRef && kv) {
			await kv.put(webhookSecretRef, input.webhookSecret!);
		}
		if (credentialRef && kv) {
			await kv.put(
				credentialRef,
				JSON.stringify({
					provider: input.providerSlug,
					tenantId: tenant.id,
					credentials: parsedCredentials,
					updatedAt: now,
				}),
			);
		}

		await db
			.prepare(
				`INSERT INTO tenant_provider_connections (
					id,
					tenant_id,
					provider_id,
					display_name,
					status,
					webhook_secret_ref,
					auth_config_json,
					external_account_id,
					webhook_routing_key,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				connectionId,
				tenant.id,
				provider.id,
				input.displayName,
				webhookSecretRef,
				authConfigJson,
				emptyToNull(input.externalAccountId),
				emptyToNull(input.webhookRoutingKey),
				now,
				now,
			)
			.run();
	} catch (error) {
		if (webhookSecretRef && kv) {
			await kv.delete(webhookSecretRef);
		}
		if (credentialRef && kv) {
			await kv.delete(credentialRef);
		}

		if (isD1UniqueConstraintError(error)) {
			throw new ProviderConnectionError(
				`A ${provider.name} connection named '${input.displayName}' already exists for ${tenant.name}.`,
				409,
			);
		}

		throw error;
	}

	return {
		id: connectionId,
		tenantId: tenant.id,
		tenantName: tenant.name,
		providerSlug: provider.slug,
		displayName: input.displayName,
		status: "active",
		externalAccountId: emptyToNull(input.externalAccountId),
		webhookRoutingKey: emptyToNull(input.webhookRoutingKey),
		apiBaseUrl: emptyToNull(input.apiBaseUrl),
		clientId: emptyToNull(input.clientId),
		hasWebhookSecret: Boolean(webhookSecretRef),
		hasCredentialSecret: Boolean(credentialRef),
		createdAt: now,
	};
}

export async function resolveWebhookConnectionByTenantSlug(
	db: D1Database,
	kv: KVNamespace | undefined,
	providerSlug: ProviderSlug,
	tenantSlug: string,
): Promise<ResolvedWebhookConnection> {
	const result = await db
		.prepare(
			`SELECT
				c.id AS connectionId,
				c.display_name AS displayName,
				c.webhook_secret_ref AS webhookSecretRef,
				t.id AS tenantId,
				t.slug AS tenantSlug,
				t.name AS tenantName,
				p.slug AS providerSlug
			FROM tenant_provider_connections c
			INNER JOIN tenants t ON t.id = c.tenant_id
			INNER JOIN providers p ON p.id = c.provider_id
			WHERE t.slug = ? AND p.slug = ? AND c.status = 'active'
			ORDER BY c.created_at DESC
			LIMIT 1`,
		)
		.bind(tenantSlug, providerSlug)
		.first<{
			connectionId: string;
			displayName: string;
			webhookSecretRef: string | null;
			tenantId: string;
			tenantSlug: string;
			tenantName: string;
			providerSlug: ProviderSlug;
		}>();

	if (!result) {
		throw new ProviderConnectionError(
			`No active ${providerSlug} connection found for tenant '${tenantSlug}'.`,
			404,
		);
	}

	if (!result.webhookSecretRef) {
		throw new ProviderConnectionError(
			`The ${providerSlug} connection for tenant '${tenantSlug}' does not have a webhook secret configured.`,
			400,
		);
	}

	if (!kv) {
		throw new ProviderConnectionError(
			"PFI_SECRETS_KV is not configured. Webhook secret lookup is unavailable.",
			500,
		);
	}

	const webhookSecret = await kv.get(result.webhookSecretRef);
	if (!webhookSecret) {
		throw new ProviderConnectionError(
			`Webhook secret '${result.webhookSecretRef}' was not found in KV.`,
			500,
		);
	}

	return {
		connectionId: result.connectionId,
		displayName: result.displayName,
		providerSlug: result.providerSlug,
		tenantId: result.tenantId,
		tenantName: result.tenantName,
		tenantSlug: result.tenantSlug,
		webhookSecret,
	};
}

async function findTenant(db: D1Database, tenantId: string): Promise<TenantRow | null> {
	const result = await db
		.prepare("SELECT id, name FROM tenants WHERE id = ? LIMIT 1")
		.bind(tenantId)
		.first<TenantRow>();

	return result ?? null;
}

async function findProvider(
	db: D1Database,
	providerSlug: ProviderSlug,
): Promise<ProviderRow | null> {
	const result = await db
		.prepare("SELECT id, slug, name FROM providers WHERE slug = ? LIMIT 1")
		.bind(providerSlug)
		.first<ProviderRow>();

	return result ?? null;
}

async function ensureConnectionNameAvailable(
	db: D1Database,
	tenantId: string,
	providerId: string,
	displayName: string,
) {
	const existing = await db
		.prepare(
			`SELECT id
			 FROM tenant_provider_connections
			 WHERE tenant_id = ? AND provider_id = ? AND display_name = ?
			 LIMIT 1`,
		)
		.bind(tenantId, providerId, displayName)
		.first<{ id: string }>();

	if (existing) {
		throw new ProviderConnectionError(
			`This tenant already has a connection named '${displayName}' for that provider.`,
			409,
		);
	}
}

function parseConnectionConfig(authConfigJson: string | null): ConnectionConfig {
	if (!authConfigJson) {
		return {};
	}

	try {
		return JSON.parse(authConfigJson) as ConnectionConfig;
	} catch {
		return {};
	}
}

function isD1UniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function emptyToNull(value: string | undefined): string | null {
	return value && value.trim().length > 0 ? value.trim() : null;
}
