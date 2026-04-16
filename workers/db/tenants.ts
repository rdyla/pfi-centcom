export interface TenantSummary {
	id: string;
	slug: string;
	name: string;
	status: "active" | "inactive";
	timezone: string;
	createdAt: string;
}

export interface CreateTenantInput {
	name: string;
	slug: string;
	timezone: string;
}

export class TenantAdminError extends Error {
	readonly status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "TenantAdminError";
		this.status = status;
	}
}

export async function listTenants(db: D1Database): Promise<TenantSummary[]> {
	const result = await db
		.prepare(
			`SELECT id, slug, name, status, timezone, created_at AS createdAt
			 FROM tenants
			 ORDER BY created_at DESC, name ASC`,
		)
		.all<TenantSummary>();

	return result.results ?? [];
}

export async function createTenant(
	db: D1Database,
	input: CreateTenantInput,
): Promise<TenantSummary> {
	const id = `tenant_${crypto.randomUUID()}`;
	const now = new Date().toISOString();

	try {
		await db
			.prepare(
				`INSERT INTO tenants (id, slug, name, status, timezone, created_at, updated_at)
				 VALUES (?, ?, ?, 'active', ?, ?, ?)`,
			)
			.bind(id, input.slug, input.name, input.timezone, now, now)
			.run();
	} catch (error) {
		if (isD1UniqueConstraintError(error)) {
			throw new TenantAdminError(
				`A tenant with slug '${input.slug}' already exists.`,
				409,
			);
		}

		throw error;
	}

	const created = await db
		.prepare(
			`SELECT id, slug, name, status, timezone, created_at AS createdAt
			 FROM tenants
			 WHERE id = ?
			 LIMIT 1`,
		)
		.bind(id)
		.first<TenantSummary>();

	if (!created) {
		throw new TenantAdminError("Tenant was created but could not be reloaded.", 500);
	}

	return created;
}

function isD1UniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
