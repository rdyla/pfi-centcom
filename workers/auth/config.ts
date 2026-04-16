import type { WorkerEnv } from "../config/env";

export interface EntraConfig {
	tenantId: string;
	clientId: string;
	clientSecret: string;
	sessionSecret: string;
	allowedEmails: string[];
	allowedDomains: string[];
}

export function getEntraConfig(env: WorkerEnv): EntraConfig | null {
	if (
		!env.ENTRA_TENANT_ID ||
		!env.ENTRA_CLIENT_ID ||
		!env.ENTRA_CLIENT_SECRET ||
		!env.AUTH_SESSION_SECRET
	) {
		return null;
	}

	return {
		tenantId: env.ENTRA_TENANT_ID,
		clientId: env.ENTRA_CLIENT_ID,
		clientSecret: env.ENTRA_CLIENT_SECRET,
		sessionSecret: env.AUTH_SESSION_SECRET,
		allowedEmails: splitCsv(env.ADMIN_ALLOWED_EMAILS),
		allowedDomains: splitCsv(env.ADMIN_ALLOWED_DOMAINS),
	};
}

function splitCsv(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}
