export interface WorkerEnv {
	VALUE_FROM_CLOUDFLARE?: string;
	APP_ENV?: string;
	DYNAMICS_BASE_URL?: string;
	ENTRA_TENANT_ID?: string;
	ENTRA_CLIENT_ID?: string;
	ENTRA_CLIENT_SECRET?: string;
	AUTH_SESSION_SECRET?: string;
	ADMIN_ALLOWED_EMAILS?: string;
	ADMIN_ALLOWED_DOMAINS?: string;
	DB?: D1Database;
	PFI_SECRETS_KV?: KVNamespace;
	INGEST_QUEUE?: Queue<IngestQueueMessage>;
	ALERT_QUEUE?: Queue<AlertQueueMessage>;
}

export interface IngestQueueMessage {
	eventId: string;
	tenantId: string;
	provider: string;
	receivedAt: string;
	resourceType: string;
}

export interface AlertQueueMessage {
	alertId: string;
	tenantId: string;
	severity: "critical" | "high" | "medium" | "low";
}

export function getPlatformStatus(env: WorkerEnv) {
	return {
		appEnv: env.APP_ENV ?? "development",
		hasDatabase: Boolean(env.DB),
		hasSecretsKv: Boolean(env.PFI_SECRETS_KV),
		hasEntraConfig: Boolean(
			env.ENTRA_TENANT_ID &&
				env.ENTRA_CLIENT_ID &&
				env.ENTRA_CLIENT_SECRET &&
				env.AUTH_SESSION_SECRET,
		),
		hasIngestQueue: Boolean(env.INGEST_QUEUE),
		hasAlertQueue: Boolean(env.ALERT_QUEUE),
		hasDynamicsConfig: Boolean(env.DYNAMICS_BASE_URL),
	};
}
